import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  attentionDebtMax,
  createWordProgress,
  decreaseAttentionDebt,
  increaseAttentionDebt,
  loadLearningProgress,
  recordAttention,
  recordEncounter,
  saveLearningProgress,
  type LearningProgressMap,
} from '../src/lib/learningProgress.ts'
import { classifyWord } from '../src/lib/wordSelector.ts'

const storageKey = 'word-loop.learning-progress'

const withFakeStorage = (run: (storage: Map<string, string>) => void) => {
  const storage = new Map<string, string>()
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  }
  Object.assign(globalThis, { window: fakeWindow })
  try {
    run(storage)
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
}

test('旧保存データ（version 1）を読み込め、新フィールドは null / 0 で補う', () => {
  withFakeStorage((storage) => {
    storage.set(
      storageKey,
      JSON.stringify({
        version: 1,
        words: {
          apple: { wordId: 'apple', encounterCount: 12, lastEncounteredAt: '2026-10-20T10:00:00.000Z', attentionCount: 3 },
          cat: { wordId: 'cat', encounterCount: 1, lastEncounteredAt: null, attentionCount: 0 },
        },
      }),
    )

    const progress = loadLearningProgress()
    assert.deepEqual(progress.apple, {
      wordId: 'apple',
      encounterCount: 12,
      lastEncounteredAt: '2026-10-20T10:00:00.000Z',
      attentionCount: 3,
      lastAttentionAt: null,
      attentionDebt: 0,
    })
    assert.equal(progress.cat.attentionDebt, 0)
    // 旧仕様では attentionCount > 0 で永久に growth だった語も、familiar に戻れる
    assert.equal(classifyWord(progress, 'apple'), 'familiar')

    // 保存すると version 2 の形式になり、Encounter / Attention 回数は失われない
    saveLearningProgress(progress)
    const saved = JSON.parse(storage.get(storageKey) ?? '{}')
    assert.equal(saved.version, 2)
    assert.equal(saved.words.apple.encounterCount, 12)
    assert.equal(saved.words.apple.attentionCount, 3)
    assert.equal(saved.words.apple.attentionDebt, 0)
    assert.equal(saved.words.apple.lastAttentionAt, null)
    assert.deepEqual(loadLearningProgress(), progress)
  })
})

test('壊れた新フィールドは安全な値にし、debt は上限で丸める', () => {
  withFakeStorage((storage) => {
    storage.set(
      storageKey,
      JSON.stringify({
        version: 2,
        words: {
          a: { encounterCount: 4, attentionCount: 1, lastAttentionAt: 'broken', attentionDebt: -2 },
          b: { encounterCount: 4, attentionCount: 1, lastAttentionAt: 123, attentionDebt: 1.5 },
          c: { encounterCount: 4, attentionCount: 1, attentionDebt: 99 },
        },
      }),
    )

    const progress = loadLearningProgress()
    assert.equal(progress.a.attentionDebt, 0)
    assert.equal(progress.a.lastAttentionAt, null)
    assert.equal(progress.b.attentionDebt, 0)
    assert.equal(progress.b.lastAttentionAt, null)
    assert.equal(progress.c.attentionDebt, attentionDebtMax)
  })
})

test('Attention: debt が +2（上限3）になり、lastAttentionAt を保存する', () => {
  let progress: LearningProgressMap = {}
  progress = recordAttention(progress, 'apple', '2026-10-21T08:00:00.000Z')
  assert.equal(progress.apple.attentionDebt, 2)
  assert.equal(progress.apple.attentionCount, 1)
  assert.equal(progress.apple.lastAttentionAt, '2026-10-21T08:00:00.000Z')

  progress = recordAttention(progress, 'apple', '2026-10-21T08:01:00.000Z')
  assert.equal(progress.apple.attentionDebt, 3)
  assert.equal(progress.apple.attentionCount, 2)
  assert.equal(progress.apple.lastAttentionAt, '2026-10-21T08:01:00.000Z')

  assert.equal(increaseAttentionDebt(0), 2)
  assert.equal(increaseAttentionDebt(2), 3)
  assert.equal(increaseAttentionDebt(3), 3)
})

test('Encounter: debt が1減り、0 未満にならない', () => {
  let progress: LearningProgressMap = {
    apple: { ...createWordProgress('apple'), encounterCount: 4, attentionDebt: 2, attentionCount: 1 },
  }
  progress = recordEncounter(progress, 'apple', '2026-10-21T08:00:00.000Z')
  assert.equal(progress.apple.attentionDebt, 1)
  progress = recordEncounter(progress, 'apple', '2026-10-21T08:00:01.000Z')
  assert.equal(progress.apple.attentionDebt, 0)
  progress = recordEncounter(progress, 'apple', '2026-10-21T08:00:02.000Z')
  assert.equal(progress.apple.attentionDebt, 0)
  assert.equal(progress.apple.encounterCount, 7)
  // attentionCount は履歴として残る
  assert.equal(progress.apple.attentionCount, 1)
  assert.equal(decreaseAttentionDebt(0), 0)
})

test('状態変化: new → growth → familiar（表示→同じ表示でタップ→再遭遇でタップなし）', () => {
  const at = '2026-10-21T08:00:00.000Z'
  let progress: LearningProgressMap = {}
  assert.equal(classifyWord(progress, 'cat'), 'new')

  // 初回表示でタップ: debt 0 →（表示で -1、0のまま）→ タップで 2
  progress = recordEncounter(progress, 'cat', at)
  progress = recordAttention(progress, 'cat', at)
  assert.equal(classifyWord(progress, 'cat'), 'growth')

  // 再遭遇・タップなし: 2 → 1（まだ growth）
  progress = recordEncounter(progress, 'cat', at)
  assert.equal(progress.cat.attentionDebt, 1)
  assert.equal(classifyWord(progress, 'cat'), 'growth')

  // もう一度タップなし: 1 → 0、3回見たので familiar
  progress = recordEncounter(progress, 'cat', at)
  assert.equal(progress.cat.attentionDebt, 0)
  assert.equal(classifyWord(progress, 'cat'), 'familiar')
})
