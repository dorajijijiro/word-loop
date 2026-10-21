import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  advanceEncounter,
  createEncounterSession,
  registerAttention,
  reserveReencounter,
  startEncounter,
} from '../src/lib/encounterEngine.ts'
import { recordAttention, recordEncounter, type LearningProgressMap } from '../src/lib/learningProgress.ts'
import {
  completeExpedition,
  expeditionEncounterLimit,
  hasReachedExpeditionLimit,
  isExpeditionRunning,
  recordExpeditionEncounter,
  returnFromExpedition,
  startExpedition,
} from '../src/lib/expedition.ts'
import {
  applyExpeditionRewards,
  createPlayerProgress,
  loadPlayerProgress,
  parsePlayerProgress,
  savePlayerProgress,
} from '../src/lib/playerProgress.ts'
import { calculateEncounterXp, calculateReturnGold } from '../src/lib/rewards.ts'
import { seededRandom, wordProgress } from './helpers.ts'

test('XP 計算: familiar 1 / new 5 / growth 5 / re-encounter 10', () => {
  assert.equal(calculateEncounterXp({ kind: 'familiar' }), 1)
  assert.equal(calculateEncounterXp({ kind: 'new' }), 5)
  assert.equal(calculateEncounterXp({ kind: 'growth' }), 5)
  assert.equal(calculateEncounterXp({ kind: 'reencounter' }), 10)
})

test('XP: 同じ Encounter（通し番号）は二重に加算しない', () => {
  const encounter = { sequence: 1, source: 'normal' as const, bucket: 'growth' as const }
  const once = recordExpeditionEncounter(startExpedition(), encounter)
  const twice = recordExpeditionEncounter(once, encounter)
  assert.equal(twice, once)
  assert.equal(twice.xp, 5)
  assert.equal(twice.encounterCount, 1)
})

test('Gold 計算: 基本100 + (new + growth)×2 + 再遭遇×5、未完了は0', () => {
  const counts = { familiarCount: 82, newCount: 3, growthCount: 10, reencounterCount: 10 }
  assert.equal(calculateReturnGold(counts, true), 100 + 26 + 50)
  assert.equal(calculateReturnGold(counts, false), 0)
})

test('105 Encounter 上限: 105 で止まり、完了時に報酬が確定する', () => {
  const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
  const progress = Object.fromEntries(
    wordIds.map((wordId, index) => [
      wordId,
      wordProgress(wordId, { encounterCount: index < 18 ? 5 : 0, attentionDebt: index === 17 ? 2 : 0 }),
    ]),
  )
  const context = { progress, random: seededRandom(8) }
  let session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)
  let expedition = recordExpeditionEncounter(startExpedition(), session.current)

  for (let index = 0; index < 200; index += 1) {
    if (index % 20 === 0) {
      session = reserveReencounter(session, session.current.wordId)
    }
    session = advanceEncounter(session, wordIds, context)
    expedition = recordExpeditionEncounter(expedition, session.current)
  }

  assert.equal(expedition.encounterCount, expeditionEncounterLimit)
  assert.equal(
    expedition.familiarCount +
      expedition.newCount +
      expedition.growthCount +
      expedition.reencounterCount +
      expedition.recallCount,
    expeditionEncounterLimit,
  )
  assert.ok(expedition.reencounterCount > 0)
  const learning = expedition.newCount + expedition.growthCount
  assert.ok(learning >= 7 && learning <= 13, `learning ${learning}`)
  assert.ok(expedition.newCount > 0 && expedition.growthCount > 0)
  assert.equal(isExpeditionRunning(expedition), false)
  assert.equal(hasReachedExpeditionLimit(expedition), true)
  assert.equal(
    expedition.xp,
    expedition.familiarCount + learning * 5 + (expedition.reencounterCount + expedition.recallCount) * 10,
  )

  const completed = completeExpedition(expedition)
  assert.equal(completed.status, 'completed')
  assert.deepEqual(completed.rewards, {
    xp: expedition.xp,
    gold: 100 + learning * 2 + (expedition.reencounterCount + expedition.recallCount) * 5,
  })
  // 二重に完了しない
  assert.equal(completeExpedition(completed), completed)

  const returned = returnFromExpedition(completed)
  assert.equal(returned.status, 'returned')
  assert.deepEqual(returned.rewards, completed.rewards)
})

// App と同じ順序（表示 → 進捗に Encounter を記録 → 必要ならタップ）で遠征を1回分シミュレーションする。
const simulateExpedition = (
  wordIds: string[],
  initialProgress: LearningProgressMap,
  seed: number,
  shouldTap: (wordId: string, index: number) => boolean,
) => {
  const random = seededRandom(seed)
  const at = '2026-10-21T08:00:00.000Z'
  let progress = initialProgress
  let session = startEncounter(createEncounterSession(wordIds, wordIds[0]), wordIds, { progress, random })
  let expedition = startExpedition()

  for (let index = 0; index < 300 && isExpeditionRunning(expedition); index += 1) {
    if (index > 0) {
      session = advanceEncounter(session, wordIds, { progress, random })
    }
    expedition = recordExpeditionEncounter(expedition, session.current)
    progress = recordEncounter(progress, session.current.wordId, at)

    if (shouldTap(session.current.wordId, index)) {
      // 同じ表示中の連打（3回）は1回として数える
      for (let tap = 0; tap < 3; tap += 1) {
        const result = registerAttention(session)
        session = result.session
        if (result.isFirstAttention) {
          progress = recordAttention(progress, session.current.wordId, at)
        }
      }
    }
  }

  return { expedition, progress }
}

test('遠征: 初回は全語 new から始まり、familiar / new / growth / again / recall の合計が Encounter 数と一致する', () => {
  const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
  const tappedOnce = new Set<string>()
  const { expedition, progress } = simulateExpedition(wordIds, {}, 21, (wordId, index) => {
    // 序盤に数語だけ1回ずつタップする
    if (index < 40 && index % 9 === 0 && !tappedOnce.has(wordId)) {
      tappedOnce.add(wordId)
      return true
    }
    return false
  })

  assert.equal(expedition.encounterCount, expeditionEncounterLimit)
  assert.equal(
    expedition.familiarCount +
      expedition.newCount +
      expedition.growthCount +
      expedition.reencounterCount +
      expedition.recallCount,
    expedition.encounterCount,
  )
  assert.ok(expedition.newCount > 0, 'new が出る')
  assert.ok(expedition.familiarCount > expedition.newCount, `familiar ${expedition.familiarCount}`)
  assert.ok(expedition.reencounterCount >= tappedOnce.size)
  // 一度タップした語も、その後タップしなければ debt 0 に戻り familiar になれる
  for (const wordId of tappedOnce) {
    assert.equal(progress[wordId].attentionDebt, 0, wordId)
    assert.equal(progress[wordId].attentionCount, 1, wordId)
  }
  assert.equal(
    expedition.xp,
    expedition.familiarCount +
      (expedition.newCount + expedition.growthCount) * 5 +
      (expedition.reencounterCount + expedition.recallCount) * 10,
  )

  // 2回目の遠征は familiar 中心の 9:1 に近づく
  const second = simulateExpedition(wordIds, progress, 22, () => false)
  assert.ok(second.expedition.familiarCount >= 88, `familiar ${second.expedition.familiarCount}`)
  assert.equal(
    second.expedition.familiarCount +
      second.expedition.newCount +
      second.expedition.growthCount +
      second.expedition.reencounterCount +
      second.expedition.recallCount,
    expeditionEncounterLimit,
  )
})

test('PlayerProgress: 報酬の累積と壊れたデータの初期化', () => {
  let player = createPlayerProgress()
  player = applyExpeditionRewards(player, { xp: 150, gold: 140 })
  player = applyExpeditionRewards(player, { xp: 100, gold: 120 })
  assert.deepEqual(player, { totalXp: 250, gold: 260, completedExpeditions: 2 })

  assert.deepEqual(parsePlayerProgress(null), createPlayerProgress())
  assert.deepEqual(parsePlayerProgress([1, 2]), createPlayerProgress())
  assert.deepEqual(parsePlayerProgress({ totalXp: -1, gold: 1.5, completedExpeditions: 3 }), {
    totalXp: 0,
    gold: 0,
    completedExpeditions: 3,
  })
})

test('PlayerProgress: localStorage への保存と読み込み', () => {
  const storage = new Map<string, string>()
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  }
  Object.assign(globalThis, { window: fakeWindow })

  try {
    assert.deepEqual(loadPlayerProgress(), createPlayerProgress())
    savePlayerProgress({ totalXp: 10, gold: 20, completedExpeditions: 1 })
    assert.ok(storage.has('word-loop.player-progress'))
    assert.deepEqual(loadPlayerProgress(), { totalXp: 10, gold: 20, completedExpeditions: 1 })

    storage.set('word-loop.player-progress', '{broken')
    assert.deepEqual(loadPlayerProgress(), createPlayerProgress())
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
})
