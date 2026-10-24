import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  getUnderstanding,
  loadUnderstanding,
  parseUnderstanding,
  recordUnderstanding,
  resolveUnderstandingTarget,
  saveUnderstanding,
  understandingPressMaxMilliseconds,
} from '../src/lib/understanding.ts'
import { loadLearningProgress } from '../src/lib/learningProgress.ts'

// localStorage だけを持つ最小の window を用意する。
const installStorage = (initial: Record<string, string> = {}) => {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  }
  ;(globalThis as { window?: unknown }).window = { localStorage }
  return store
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

test('理解度: 記録のない語は未回答（null）で、「まだわからない」とは扱わない', () => {
  assert.equal(getUnderstanding({}, 'apple'), null)
  // Object のプロトタイプのキーも未回答として扱う
  assert.equal(getUnderstanding({}, 'constructor'), null)
})

test('理解度: わかる / まだわからない を対象の語に記録し、再回答は最新の選択と日時で上書きする', () => {
  let map = recordUnderstanding({}, 'apple', 'known', '2026-10-24T10:00:00.000Z')
  map = recordUnderstanding(map, 'dog', 'unknown', '2026-10-24T10:00:01.000Z')
  assert.deepEqual(getUnderstanding(map, 'apple'), { status: 'known', answeredAt: '2026-10-24T10:00:00.000Z' })
  assert.deepEqual(getUnderstanding(map, 'dog'), { status: 'unknown', answeredAt: '2026-10-24T10:00:01.000Z' })

  const updated = recordUnderstanding(map, 'apple', 'unknown', '2026-10-24T11:00:00.000Z')
  assert.deepEqual(getUnderstanding(updated, 'apple'), { status: 'unknown', answeredAt: '2026-10-24T11:00:00.000Z' })
  assert.deepEqual(getUnderstanding(updated, 'dog'), getUnderstanding(map, 'dog'))
  // 元のデータは変更しない
  assert.equal(getUnderstanding(map, 'apple')?.status, 'known')
})

test('理解度: 押し始めた語に記録する（押下中に表示が変わっても別の語に記録しない）', () => {
  const press = { wordId: 'apple', startedAt: 1000 }
  assert.equal(resolveUnderstandingTarget(press, 1180, 'dog'), 'apple')
  assert.equal(resolveUnderstandingTarget(press, 1000 + understandingPressMaxMilliseconds, 'dog'), 'apple')
  // 押し始めの情報がない・古すぎる・時刻が逆転している場合は、確定した時点で表示中の語
  assert.equal(resolveUnderstandingTarget(null, 1180, 'dog'), 'dog')
  assert.equal(resolveUnderstandingTarget(press, 1001 + understandingPressMaxMilliseconds, 'dog'), 'dog')
  assert.equal(resolveUnderstandingTarget(press, 999, 'dog'), 'dog')
})

test('理解度の保存: version 1 の形式で保存し、読み込むと同じ内容に戻る', () => {
  const store = installStorage()
  const map = recordUnderstanding({}, 'apple', 'known', '2026-10-24T10:00:00.000Z')
  saveUnderstanding(map)
  assert.deepEqual(JSON.parse(store.get('word-loop.understanding') ?? ''), {
    version: 1,
    words: { apple: { status: 'known', answeredAt: '2026-10-24T10:00:00.000Z' } },
  })
  assert.deepEqual(loadUnderstanding(), map)
})

test('理解度の保存: 保存がない旧データでは全語未回答になる', () => {
  installStorage({ 'word-loop.learning-progress': JSON.stringify({ version: 2, words: {} }) })
  assert.deepEqual(loadUnderstanding(), {})
})

test('理解度の読み込み: 形式が違う語の記録だけを捨て、ほかの語の記録は残す', () => {
  const map = parseUnderstanding({
    version: 1,
    words: {
      apple: { status: 'known', answeredAt: '2026-10-24T10:00:00.000Z' },
      dog: { status: 'maybe', answeredAt: '2026-10-24T10:00:00.000Z' },
      cat: { status: 'unknown', answeredAt: 'yesterday' },
      sun: 'known',
      water: { status: 'unknown', answeredAt: '2026-10-24T10:00:00.000Z' },
    },
  })
  assert.deepEqual(Object.keys(map).sort(), ['apple', 'water'])
})

test('理解度の読み込み: 壊れた保存データでも学習進捗は初期化されない', () => {
  const learningProgress = JSON.stringify({
    version: 2,
    words: {
      apple: {
        wordId: 'apple',
        encounterCount: 4,
        lastEncounteredAt: '2026-10-24T10:00:00.000Z',
        attentionCount: 1,
        lastAttentionAt: '2026-10-24T10:00:00.000Z',
        attentionDebt: 2,
      },
    },
  })
  for (const broken of ['{not json', 'null', '[]', '"known"', JSON.stringify({ version: 1, words: [] })]) {
    const store = installStorage({ 'word-loop.learning-progress': learningProgress, 'word-loop.understanding': broken })
    assert.deepEqual(loadUnderstanding(), {}, broken)
    assert.equal(loadLearningProgress().apple.encounterCount, 4)
    assert.equal(store.get('word-loop.learning-progress'), learningProgress)
  }
})
