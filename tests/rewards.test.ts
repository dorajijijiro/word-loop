import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  completeExhaustedExpedition,
  completeExpedition,
  expeditionEncounterLimit,
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
import {
  calculateEncounterXp,
  calculateReturnBaseGold,
  calculateReturnGold,
  returnBaseGold,
} from '../src/lib/rewards.ts'
import { simulateExpedition, wordProgress } from './helpers.ts'

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
  const counts = {
    encounterCount: 105,
    encounterLimit: expeditionEncounterLimit,
    familiarCount: 82,
    newCount: 3,
    growthCount: 10,
    reencounterCount: 10,
  }
  assert.equal(calculateReturnGold(counts, true), 100 + 26 + 50)
  assert.equal(calculateReturnGold(counts, false), 0)
})

test('Gold 計算: 基本 Gold は Encounter 数で按分する（0 / 1 / 3 / 105 Encounter）', () => {
  const counts = (encounterCount: number, newCount: number) => ({
    encounterCount,
    encounterLimit: expeditionEncounterLimit,
    familiarCount: 0,
    newCount,
    growthCount: 0,
    reencounterCount: 0,
  })
  const base = (encounterCount: number) =>
    calculateReturnBaseGold({ encounterCount, encounterLimit: expeditionEncounterLimit })
  assert.deepEqual([0, 1, 3, 105].map(base), [0, 1, 3, 100])
  // 0 Encounter: 基本 Gold・その他の Gold とも発生しない
  assert.equal(calculateReturnGold(counts(0, 0), true), 0)
  // 1語（new）: 基本1 + 語ごとの加算2 = 3
  assert.equal(calculateReturnGold(counts(1, 1), true), 3)
  // 3語（new）: 基本3 + 6 = 9
  assert.equal(calculateReturnGold(counts(3, 3), true), 9)
  // 105語（new）: 基本100 + 210（従来どおり）
  assert.equal(calculateReturnGold(counts(105, 105), true), 100 + 210)
  // 四捨五入: 52語 → 49.52… → 50、53語 → 50.47… → 50
  assert.equal(base(52), Math.round((returnBaseGold * 52) / expeditionEncounterLimit))
  assert.equal(base(52), 50)
  assert.equal(base(53), 50)
  // 上限を超える値は上限として扱う
  assert.equal(base(200), 100)
})

test('105 Encounter 上限: 105 で止まり、完了時に報酬が確定する', () => {
  const wordIds = Array.from({ length: 200 }, (_, index) => `w${index}`)
  const progress = Object.fromEntries(
    wordIds.map((wordId, index) => [
      wordId,
      wordProgress(wordId, { encounterCount: index < 150 ? 5 : 0, attentionDebt: index === 160 ? 2 : 0 }),
    ]),
  )
  const { expedition, session } = simulateExpedition({
    wordIds,
    progress,
    now: Date.parse('2026-10-24T00:00:00.000Z'),
    seed: 8,
    // 20 Encounter ごとに「まだわからない」→ again として再登場する
    answer: (_, index) => (index % 20 === 0 ? 'unknown' : null),
  })

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
  assert.equal(isExpeditionRunning(expedition), false)
  assert.equal(expedition.status, 'completed')
  assert.equal(expedition.endReason, 'limit')
  assert.deepEqual(session?.reencounterQueue, [])
  const learning = expedition.newCount + expedition.growthCount
  assert.equal(
    expedition.xp,
    expedition.familiarCount + learning * 5 + (expedition.reencounterCount + expedition.recallCount) * 10,
  )
  assert.deepEqual(expedition.rewards, {
    xp: expedition.xp,
    gold: 100 + learning * 2 + (expedition.reencounterCount + expedition.recallCount) * 5,
  })
  // 二重に完了しない
  assert.equal(completeExpedition(expedition), expedition)
  assert.equal(completeExhaustedExpedition(expedition), expedition)

  const returned = returnFromExpedition(expedition)
  assert.equal(returned.status, 'returned')
  assert.deepEqual(returned.rewards, expedition.rewards)
})

test('遠征: 初回は全語 new から始まり、familiar / new / growth / again の合計が Encounter 数と一致する', () => {
  const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
  const now = Date.parse('2026-10-24T00:00:00.000Z')
  const first = simulateExpedition({
    wordIds,
    now,
    seed: 21,
    answer: (_, index) => (index < 10 && index % 3 === 0 ? 'unknown' : null),
  })
  const { expedition } = first
  assert.equal(expedition.endReason, 'exhausted')
  assert.equal(
    expedition.familiarCount +
      expedition.newCount +
      expedition.growthCount +
      expedition.reencounterCount +
      expedition.recallCount,
    expedition.encounterCount,
  )
  assert.equal(expedition.newCount, 20)
  assert.equal(expedition.reencounterCount, 4)
  assert.equal(expedition.encounterCount, 24)
  assert.equal(expedition.xp, 20 * 5 + 4 * 10)
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
