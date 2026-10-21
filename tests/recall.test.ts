import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  advanceEncounter,
  createEncounterSession,
  startEncounter,
  type Encounter,
  type EncounterSession,
} from '../src/lib/encounterEngine.ts'
import { recordEncounter, type LearningProgressMap } from '../src/lib/learningProgress.ts'
import {
  completeExpedition,
  expeditionEncounterLimit,
  getCompletionDelayMilliseconds,
  hasReachedExpeditionLimit,
  isExpeditionRunning,
  recordExpeditionEncounter,
  startExpedition,
} from '../src/lib/expedition.ts'
import {
  getRecallCueMilliseconds,
  getRecallRevealMilliseconds,
  nextRecallStep,
  planRecallPositions,
  recallMaxPerExpedition,
  recallWindows,
  selectRecallWord,
  startRecallStep,
} from '../src/lib/recall.ts'
import { calculateEncounterXp, calculateReturnGold, getEncounterRewardKind } from '../src/lib/rewards.ts'
import { classifyWord } from '../src/lib/wordSelector.ts'
import { words } from '../src/data/words.ts'
import { seededRandom, wordProgress } from './helpers.ts'

const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)

// w0〜w14 familiar、w15〜w17 growth、w18〜w19 見たことのある new。
const mixedProgress: LearningProgressMap = Object.fromEntries(
  wordIds.map((wordId, index) => [
    wordId,
    wordProgress(wordId, {
      encounterCount: index < 18 ? 5 : 1,
      attentionDebt: index >= 15 && index < 18 ? 2 : 0,
    }),
  ]),
)
const familiarProgress: LearningProgressMap = Object.fromEntries(
  wordIds.map((wordId) => [wordId, wordProgress(wordId, { encounterCount: 5 })]),
)

// App と同じ順序（表示 → 遠征に記録 → 進捗に Encounter を記録）で1遠征を進める。
const runExpedition = (progress: LearningProgressMap, seed: number, updateProgress = false) => {
  const random = seededRandom(seed)
  let currentProgress = progress
  let session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, {
    progress: currentProgress,
    random,
  })
  let expedition = startExpedition()
  const shown: Encounter[] = []

  for (let index = 0; index < 300 && isExpeditionRunning(expedition); index += 1) {
    if (index > 0) {
      session = advanceEncounter(session, wordIds, { progress: currentProgress, random })
    }
    expedition = recordExpeditionEncounter(expedition, session.current)
    shown.push(session.current)
    if (updateProgress) {
      currentProgress = recordEncounter(currentProgress, session.current.wordId, '2026-10-21T08:00:00.000Z')
    }
  }

  return { expedition, shown, session, progress: currentProgress }
}

// ---------- Recall scheduling ----------

test('Recall: 1遠征で最大4回、遠征内の各区間に分散する', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { shown } = runExpedition(mixedProgress, seed)
    const recalls = shown
      .map((encounter, index) => ({ encounter, position: index + 1 }))
      .filter(({ encounter }) => encounter.source === 'recall')
    assert.ok(recalls.length <= recallMaxPerExpedition, `seed ${seed}: ${recalls.length}`)
    assert.equal(recalls.length, 4, `seed ${seed}: 候補が十分なら4回`)

    // 再遭遇に押し出されても数 Encounter しかずれない
    recalls.forEach(({ position }, index) => {
      const [from, to] = recallWindows[index]
      assert.ok(position >= from && position <= to + 3, `seed ${seed}: #${index + 1} at ${position}`)
    })
  }
})

test('Recall: 予定位置は4つの区間それぞれからランダムに選ばれる', () => {
  const random = seededRandom(7)
  const seen = new Set<number>()
  for (let index = 0; index < 50; index += 1) {
    const positions = planRecallPositions(random)
    assert.equal(positions.length, recallMaxPerExpedition)
    positions.forEach((position, windowIndex) => {
      const [from, to] = recallWindows[windowIndex]
      assert.ok(position >= from && position <= to)
    })
    seen.add(positions[0])
  }
  // 固定位置ではなく揺らぎがある
  assert.ok(seen.size > 5)
  assert.deepEqual(planRecallPositions(() => 0), recallWindows.map(([from]) => from))
  assert.deepEqual(planRecallPositions(() => 0.999999), recallWindows.map(([, to]) => to))
})

test('Recall 候補: growth を優先し、growth がなければ new も候補になる', () => {
  const growthFirst = selectRecallWord({ wordIds, progress: mixedProgress, recalledWordIds: [], random: seededRandom(1) })
  assert.equal(growthFirst?.bucket, 'growth')
  assert.ok(['w15', 'w16', 'w17'].includes(growthFirst?.wordId ?? ''))

  const recalledGrowth = selectRecallWord({
    wordIds,
    progress: mixedProgress,
    recalledWordIds: ['w15', 'w16', 'w17'],
    random: seededRandom(1),
  })
  assert.equal(recalledGrowth?.bucket, 'new')
  assert.ok(['w18', 'w19'].includes(recalledGrowth?.wordId ?? ''))
})

test('Recall 候補: familiar と未遭遇の語は対象にしない', () => {
  const progress = { ...familiarProgress, w3: wordProgress('w3', { encounterCount: 0 }) }
  assert.equal(selectRecallWord({ wordIds, progress, recalledWordIds: [] }), null)
})

test('Recall: familiar のみなら Recall 0回でも遠征は105で終わる', () => {
  const { expedition, shown } = runExpedition(familiarProgress, 3)
  assert.equal(expedition.recallCount, 0)
  assert.equal(shown.filter((encounter) => encounter.source === 'recall').length, 0)
  assert.equal(expedition.encounterCount, expeditionEncounterLimit)
  assert.equal(completeExpedition(expedition).status, 'completed')
})

test('Recall: 同じ語は可能な限り重複して Recall しない', () => {
  const { shown } = runExpedition(mixedProgress, 9)
  const recalled = shown.filter((encounter) => encounter.source === 'recall').map((encounter) => encounter.wordId)
  assert.equal(recalled.length, 4)
  assert.equal(new Set(recalled).size, 4)

  // 候補が1語しかなければ、その語で重複を許す
  const single = Object.fromEntries(
    wordIds.map((wordId) => [wordId, wordProgress(wordId, { encounterCount: 5, attentionDebt: wordId === 'w5' ? 3 : 0 })]),
  )
  assert.deepEqual(selectRecallWord({ wordIds, progress: single, recalledWordIds: ['w5'] }), {
    wordId: 'w5',
    bucket: 'growth',
  })
  // 直前の語と同じなら出さない
  assert.equal(selectRecallWord({ wordIds, progress: single, recalledWordIds: [], previousWordId: 'w5' }), null)
})

// ---------- Encounter ----------

const sessionWithRecallDue = (): EncounterSession => {
  const context = { progress: mixedProgress, random: seededRandom(4) }
  const session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)
  return {
    ...session,
    current: { ...session.current, wordId: 'w0' },
    recallSchedule: [session.current.sequence + 1, ...session.recallSchedule.slice(1)],
  }
}

test('Encounter: 期限が来た再遭遇は Recall より優先し、Recall は次の Encounter へずれる', () => {
  const context = { progress: mixedProgress, random: seededRandom(4) }
  const due = sessionWithRecallDue()
  const session = {
    ...due,
    reencounterQueue: [{ wordId: 'w3', dueSequence: due.current.sequence + 1 }],
  }

  const first = advanceEncounter(session, wordIds, context)
  assert.equal(first.current.source, 'reencounter')
  assert.equal(first.current.sequence, session.current.sequence + 1)
  assert.equal(first.recallSchedule.length, session.recallSchedule.length)

  const second = advanceEncounter(first, wordIds, context)
  assert.equal(second.current.source, 'recall')
  assert.equal(second.current.sequence, first.current.sequence + 1)
  assert.equal(second.recallSchedule.length, session.recallSchedule.length - 1)
})

test('Encounter: 予定の来た Recall は通常選出より優先し、比率計算には含めない', () => {
  const context = { progress: mixedProgress, random: seededRandom(4) }
  const session = sessionWithRecallDue()
  const next = advanceEncounter(session, wordIds, context)

  assert.equal(next.current.source, 'recall')
  assert.equal(next.current.sequence, session.current.sequence + 1)
  assert.equal(next.current.bucket, 'growth')
  assert.deepEqual(next.plannedCounts, session.plannedCounts)
  assert.deepEqual(next.recalledWordIds, [next.current.wordId])
  assert.deepEqual(next.history.at(-1), session.current.wordId)
})

test('Encounter: Recall 候補がなければその予定を見送り、通常選出で sequence が1増える', () => {
  const context = { progress: familiarProgress, random: seededRandom(4) }
  const session = { ...sessionWithRecallDue(), plannedCounts: { familiar: 0, learning: 0 } }
  const next = advanceEncounter(session, wordIds, context)
  assert.equal(next.current.source, 'normal')
  assert.equal(next.current.sequence, session.current.sequence + 1)
  assert.equal(next.recallSchedule.length, session.recallSchedule.length - 1)
})

test('Encounter: Recall も含めて105を超えない', () => {
  for (const seed of [11, 12, 13]) {
    const { expedition, shown, session } = runExpedition(mixedProgress, seed, true)
    assert.equal(shown.length, expeditionEncounterLimit)
    assert.equal(expedition.encounterCount, expeditionEncounterLimit)
    assert.ok(expedition.recallCount > 0)
    // 通し番号は1ずつ増える
    shown.forEach((encounter, index) => {
      assert.equal(encounter.sequence, shown[0].sequence + index)
    })
    // 上限後に記録しても増えない
    const after = recordExpeditionEncounter(expedition, { ...session.current, sequence: session.current.sequence + 1 })
    assert.equal(after.encounterCount, expeditionEncounterLimit)
  }
})

// ---------- State ----------

test('State: Recall でも encounterCount が増え、attentionDebt は既存ルールどおり1減る', () => {
  const context = { progress: mixedProgress, random: seededRandom(4) }
  const next = advanceEncounter(sessionWithRecallDue(), wordIds, context)
  const wordId = next.current.wordId
  const before = mixedProgress[wordId]
  const after = recordEncounter(mixedProgress, wordId, '2026-10-21T08:00:00.000Z')[wordId]

  assert.equal(next.current.source, 'recall')
  assert.equal(after.encounterCount, before.encounterCount + 1)
  assert.equal(after.attentionDebt, before.attentionDebt - 1)
  assert.equal(after.lastEncounteredAt, '2026-10-21T08:00:00.000Z')
})

test('State: Recall だけで familiar へ昇格しない（通常 Encounter と同じ記録のみ）', () => {
  // debt 2 の growth 語は Recall 1回では growth のまま
  const growth = recordEncounter(mixedProgress, 'w15', '2026-10-21T08:00:00.000Z')
  assert.equal(classifyWord(growth, 'w15'), 'growth')
  // 1回見ただけの new 語は Recall 1回では new のまま（3回で familiar という既存ルールのみ）
  const seenNew = recordEncounter(mixedProgress, 'w18', '2026-10-21T08:00:00.000Z')
  assert.equal(seenNew.w18.encounterCount, 2)
  assert.equal(classifyWord(seenNew, 'w18'), 'new')
})

// ---------- Rewards ----------

test('Rewards: Recall は +10 XP、元 bucket とは別の種別として数える', () => {
  assert.equal(calculateEncounterXp({ kind: 'recall' }), 10)
  assert.equal(getEncounterRewardKind({ source: 'recall', bucket: 'growth' }), 'recall')
  assert.equal(getEncounterRewardKind({ source: 'recall', bucket: 'new' }), 'recall')

  const encounter = { sequence: 3, source: 'recall' as const, bucket: 'new' as const }
  const once = recordExpeditionEncounter(startExpedition(), encounter)
  const twice = recordExpeditionEncounter(once, encounter)
  assert.equal(twice, once)
  assert.equal(once.xp, 10)
  assert.equal(once.recallCount, 1)
  assert.equal(once.newCount, 0)

  const counts = { familiarCount: 82, newCount: 10, growthCount: 5, reencounterCount: 4, recallCount: 4 }
  assert.equal(calculateReturnGold(counts, true), 100 + 15 * 2 + 4 * 5 + 4 * 5)
})

test('Rewards: 遠征集計の合計 = 105、XP は内訳から計算した値と一致する（二重加算なし）', () => {
  const { expedition } = runExpedition(mixedProgress, 21, true)
  const total =
    expedition.familiarCount +
    expedition.newCount +
    expedition.growthCount +
    expedition.reencounterCount +
    expedition.recallCount
  assert.equal(total, expeditionEncounterLimit)
  assert.ok(expedition.recallCount > 0)
  assert.equal(
    expedition.xp,
    expedition.familiarCount +
      (expedition.newCount + expedition.growthCount) * 5 +
      (expedition.reencounterCount + expedition.recallCount) * 10,
  )
})

// ---------- Cue → Reveal ----------

test('Recall 進行: cue → reveal → 終了の順に進む', () => {
  const cue = startRecallStep(42, 0.25)
  assert.deepEqual(cue, { sequence: 42, phase: 'cue', durationMilliseconds: 800 })
  const reveal = nextRecallStep(cue, 0.25)
  assert.deepEqual(reveal, { sequence: 42, phase: 'reveal', durationMilliseconds: 600 })
  assert.equal(reveal === null ? 'x' : nextRecallStep(reveal, 0.25), null)
})

test('Recall 進行: 想起時間は速度と調和し、速すぎず長すぎない', () => {
  assert.equal(getRecallCueMilliseconds(0.2), 800)
  assert.equal(getRecallCueMilliseconds(0.25), 800)
  assert.equal(getRecallCueMilliseconds(0.5), 1000)
  assert.equal(getRecallCueMilliseconds(1), 1500)
  assert.equal(getRecallCueMilliseconds(3), 1500)
  assert.equal(getRecallRevealMilliseconds(0.25), 600)
  assert.equal(getRecallRevealMilliseconds(0.5), 750)
  assert.equal(getRecallRevealMilliseconds(3), 1200)
})

// ---------- Word データ ----------

test('Word データ: 全項目に1〜2行の短い Recall Cue があり、英語を含まない', () => {
  assert.ok(words.length >= 20)
  for (const word of words) {
    const cue = word.recallCue ?? ''
    const lines = cue.split('\n')
    assert.ok(cue.length > 0, word.id)
    assert.ok(lines.length >= 1 && lines.length <= 2, word.id)
    assert.ok(lines.every((line) => line.length > 0 && line.length <= 20), `${word.id}: ${cue}`)
    // Cue 中に答え（英語）を見せない
    assert.ok(!/[A-Za-z]/.test(cue), word.id)
  }
})

test('105語目が Recall: reveal を見せ終えたら通常語ぶんの待ちを足さずに完了する', () => {
  const random = seededRandom(31)
  const context = { progress: mixedProgress, random }
  let session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)
  // 105語目だけを Recall の予定にする
  session = { ...session, recallSchedule: [session.current.sequence + expeditionEncounterLimit - 1] }
  let expedition = recordExpeditionEncounter(startExpedition(), session.current)
  while (isExpeditionRunning(expedition)) {
    session = advanceEncounter(session, wordIds, context)
    expedition = recordExpeditionEncounter(expedition, session.current)
  }

  const last = session.current
  assert.equal(last.source, 'recall')
  assert.equal(expedition.encounterCount, expeditionEncounterLimit)
  assert.equal(expedition.recallCount, 1)
  assert.equal(hasReachedExpeditionLimit(expedition), true)

  // 105語目を表示してから完了までの時間 = cue + reveal（+ 完了待ち 0）
  for (const intervalSeconds of [0.25, 1, 3]) {
    const cue = startRecallStep(last.sequence, intervalSeconds)
    const reveal = nextRecallStep(cue, intervalSeconds)
    assert.ok(reveal !== null)
    assert.equal(nextRecallStep(reveal, intervalSeconds), null)
    const total =
      cue.durationMilliseconds +
      reveal.durationMilliseconds +
      getCompletionDelayMilliseconds(last, intervalSeconds * 1000)
    assert.equal(total, getRecallCueMilliseconds(intervalSeconds) + getRecallRevealMilliseconds(intervalSeconds))
  }
  // 3秒/語でも reveal 後 1.2 秒で完了（余分な 3 秒は入らない）
  assert.equal(getRecallRevealMilliseconds(3) + getCompletionDelayMilliseconds(last, 3000), 1200)
})

test('105語目が通常 Encounter なら従来どおり設定速度ぶん見せてから完了する', () => {
  assert.equal(getCompletionDelayMilliseconds({ source: 'normal' }, 3000), 3000)
  assert.equal(getCompletionDelayMilliseconds({ source: 'reencounter' }, 250), 250)
  assert.equal(getCompletionDelayMilliseconds({ source: 'recall' }, 3000), 0)
})
