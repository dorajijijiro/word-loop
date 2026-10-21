import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  advanceEncounter,
  createEncounterSession,
  reserveReencounter,
  startEncounter,
} from '../src/lib/encounterEngine.ts'
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
import { seededRandom } from './helpers.ts'

test('XP 計算: familiar 1 / growth 5 / re-encounter 10', () => {
  assert.equal(calculateEncounterXp({ kind: 'familiar' }), 1)
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

test('Gold 計算: 基本100 + growth×2 + 再遭遇×5、未完了は0', () => {
  const counts = { familiarCount: 85, growthCount: 10, reencounterCount: 10 }
  assert.equal(calculateReturnGold(counts, true), 100 + 20 + 50)
  assert.equal(calculateReturnGold(counts, false), 0)
})

test('105 Encounter 上限: 105 で止まり、完了時に報酬が確定する', () => {
  const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
  const progress = Object.fromEntries(
    wordIds.map((wordId, index) => [
      wordId,
      { wordId, encounterCount: index < 18 ? 5 : 0, attentionCount: 0, lastEncounteredAt: null },
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
    expedition.familiarCount + expedition.growthCount + expedition.reencounterCount,
    expeditionEncounterLimit,
  )
  assert.ok(expedition.reencounterCount > 0)
  assert.ok(expedition.growthCount >= 7 && expedition.growthCount <= 13, `growth ${expedition.growthCount}`)
  assert.equal(isExpeditionRunning(expedition), false)
  assert.equal(hasReachedExpeditionLimit(expedition), true)
  assert.equal(
    expedition.xp,
    expedition.familiarCount + expedition.growthCount * 5 + expedition.reencounterCount * 10,
  )

  const completed = completeExpedition(expedition)
  assert.equal(completed.status, 'completed')
  assert.deepEqual(completed.rewards, {
    xp: expedition.xp,
    gold: 100 + expedition.growthCount * 2 + expedition.reencounterCount * 5,
  })
  // 二重に完了しない
  assert.equal(completeExpedition(completed), completed)

  const returned = returnFromExpedition(completed)
  assert.equal(returned.status, 'returned')
  assert.deepEqual(returned.rewards, completed.rewards)
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
