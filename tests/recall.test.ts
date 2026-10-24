import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordEncounter, type LearningProgressMap } from '../src/lib/learningProgress.ts'
import { getCompletionDelayMilliseconds, recordExpeditionEncounter, startExpedition } from '../src/lib/expedition.ts'
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

// Task 016 で遠征の選出は scheduler.ts に置き換えたため、Recall のエンジン統合テストは削除した。
// 以下は Recall 自体（recall.ts）の純粋関数のテスト。

// ---------- Recall scheduling ----------

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

test('Recall: 同じ語は可能な限り重複して Recall しない', () => {
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

// ---------- State ----------

test('State: Recall でも encounterCount が増え、attentionDebt は既存ルールどおり1減る', () => {
  const wordId = selectRecallWord({ wordIds, progress: mixedProgress, recalledWordIds: [], random: seededRandom(4) })?.wordId ?? ''
  const before = mixedProgress[wordId]
  const after = recordEncounter(mixedProgress, wordId, '2026-10-21T08:00:00.000Z')[wordId]

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

test('105語目が通常 Encounter なら従来どおり設定速度ぶん見せてから完了する', () => {
  assert.equal(getCompletionDelayMilliseconds({ source: 'normal' }, 3000), 3000)
  assert.equal(getCompletionDelayMilliseconds({ source: 'reencounter' }, 250), 250)
  assert.equal(getCompletionDelayMilliseconds({ source: 'recall' }, 3000), 0)
})
