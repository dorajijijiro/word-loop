import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  answerUnderstanding,
  dayMilliseconds,
  getKnownReviewIntervalDays,
  getUnderstanding,
  handleUnderstandingKeyDown,
  loadUnderstanding,
  parseUnderstanding,
  recordUnderstanding,
  resolveUnderstandingTarget,
  saveUnderstanding,
  startUnderstandingPress,
  understandingPressMaxMilliseconds,
  type UnderstandingMap,
  type UnderstandingPress,
  type UnderstandingStatus,
  type UnderstandingTarget,
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
  assert.deepEqual(getUnderstanding(map, 'apple'), {
    status: 'known',
    answeredAt: '2026-10-24T10:00:00.000Z',
    knownStreak: 1,
    nextDueAt: '2026-10-25T10:00:00.000Z',
  })
  assert.deepEqual(getUnderstanding(map, 'dog'), {
    status: 'unknown',
    answeredAt: '2026-10-24T10:00:01.000Z',
    knownStreak: 0,
    nextDueAt: null,
  })

  const updated = recordUnderstanding(map, 'apple', 'unknown', '2026-10-24T11:00:00.000Z')
  assert.deepEqual(getUnderstanding(updated, 'apple'), {
    status: 'unknown',
    answeredAt: '2026-10-24T11:00:00.000Z',
    knownStreak: 0,
    nextDueAt: null,
  })
  assert.deepEqual(getUnderstanding(updated, 'dog'), getUnderstanding(map, 'dog'))
  // 元のデータは変更しない
  assert.equal(getUnderstanding(map, 'apple')?.status, 'known')
})

test('理解度: 押し始めた語に記録する（押下中に表示が変わっても別の語に記録しない）', () => {
  const press = startUnderstandingPress(1000, { wordId: 'apple', sequence: 7 })
  const dog = { wordId: 'dog', sequence: 8 }
  assert.deepEqual(resolveUnderstandingTarget(press, 1180, dog), { wordId: 'apple', sequence: 7 })
  assert.deepEqual(resolveUnderstandingTarget(press, 1000 + understandingPressMaxMilliseconds, dog), {
    wordId: 'apple',
    sequence: 7,
  })
  // 押し始めの情報がない・古すぎる・時刻が逆転している場合は、確定した時点で表示中の語
  assert.deepEqual(resolveUnderstandingTarget(null, 1180, dog), dog)
  assert.deepEqual(resolveUnderstandingTarget(press, 1001 + understandingPressMaxMilliseconds, dog), dog)
  assert.deepEqual(resolveUnderstandingTarget(press, 999, dog), dog)
})

test('理解度の保存: version 2 の形式で保存し、読み込むと同じ内容に戻る', () => {
  const store = installStorage()
  const map = recordUnderstanding({}, 'apple', 'known', '2026-10-24T10:00:00.000Z')
  saveUnderstanding(map)
  assert.deepEqual(JSON.parse(store.get('word-loop.understanding') ?? ''), {
    version: 2,
    words: {
      apple: {
        status: 'known',
        answeredAt: '2026-10-24T10:00:00.000Z',
        knownStreak: 1,
        nextDueAt: '2026-10-25T10:00:00.000Z',
      },
    },
  })
  assert.deepEqual(loadUnderstanding(), map)
})

// ---------- Task 016: 出題間隔 ----------

test('出題間隔: 「わかる」の連続回数で 1 / 3 / 7 / 30 / 90 日後と延び、5回目以降は90日後（24時間単位）', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10].map(getKnownReviewIntervalDays), [1, 3, 7, 30, 90, 90, 90])
  let map: UnderstandingMap = {}
  let at = Date.parse('2026-01-01T00:00:00.000Z')
  const dueDays: number[] = []
  for (let answer = 1; answer <= 6; answer += 1) {
    map = recordUnderstanding(map, 'apple', 'known', new Date(at).toISOString())
    const entry = getUnderstanding(map, 'apple')
    assert.equal(entry?.knownStreak, answer)
    const due = Date.parse(entry?.nextDueAt ?? '')
    dueDays.push((due - at) / dayMilliseconds)
    at = due
  }
  assert.deepEqual(dueDays, [1, 3, 7, 30, 90, 90])
})

test('出題間隔: 「まだわからない」で連続回数が0に戻り、次の「わかる」は1回目（1日後）からやり直す', () => {
  let map = recordUnderstanding({}, 'apple', 'known', '2026-01-01T00:00:00.000Z')
  map = recordUnderstanding(map, 'apple', 'known', '2026-01-02T00:00:00.000Z')
  map = recordUnderstanding(map, 'apple', 'known', '2026-01-05T00:00:00.000Z')
  assert.equal(getUnderstanding(map, 'apple')?.knownStreak, 3)
  map = recordUnderstanding(map, 'apple', 'unknown', '2026-01-12T00:00:00.000Z')
  assert.deepEqual(getUnderstanding(map, 'apple'), {
    status: 'unknown',
    answeredAt: '2026-01-12T00:00:00.000Z',
    knownStreak: 0,
    nextDueAt: null,
  })
  map = recordUnderstanding(map, 'apple', 'known', '2026-01-12T00:00:05.000Z')
  assert.equal(getUnderstanding(map, 'apple')?.knownStreak, 1)
  assert.equal(getUnderstanding(map, 'apple')?.nextDueAt, '2026-01-13T00:00:05.000Z')
})

test('同じ Encounter: 連打しても連続回数は1回分だけ増え、訂正は最後の回答を採用する', () => {
  const start = recordUnderstanding({}, 'apple', 'known', '2026-01-01T00:00:00.000Z')
  const target: UnderstandingTarget = { wordId: 'apple', sequence: 40 }
  let map = start
  let bases = {}
  // 連打（わかる ×3）
  for (const second of [0, 1, 2]) {
    const result = answerUnderstanding(map, bases, target, 'known', `2026-01-02T00:00:0${second}.000Z`)
    map = result.map
    bases = result.bases
  }
  assert.equal(getUnderstanding(map, 'apple')?.knownStreak, 2)
  assert.equal(getUnderstanding(map, 'apple')?.nextDueAt, '2026-01-05T00:00:02.000Z')

  // わかる → まだわからない → わかる（同じ Encounter）は1回の学習
  map = start
  bases = {}
  const sequence: UnderstandingStatus[] = ['known', 'unknown', 'known']
  sequence.forEach((status, index) => {
    const result = answerUnderstanding(map, bases, target, status, `2026-01-02T00:00:0${index}.000Z`)
    map = result.map
    bases = result.bases
  })
  assert.equal(getUnderstanding(map, 'apple')?.knownStreak, 2)

  // 最後が「まだわからない」なら unknown（連続回数0）
  const corrected = answerUnderstanding(map, bases, target, 'unknown', '2026-01-02T00:00:09.000Z')
  assert.deepEqual(getUnderstanding(corrected.map, 'apple'), {
    status: 'unknown',
    answeredAt: '2026-01-02T00:00:09.000Z',
    knownStreak: 0,
    nextDueAt: null,
  })

  // 別の Encounter（再登場など）での回答は新しい1回として数える
  const next = answerUnderstanding(map, bases, { wordId: 'apple', sequence: 46 }, 'known', '2026-01-02T00:01:00.000Z')
  assert.equal(getUnderstanding(next.map, 'apple')?.knownStreak, 3)
})

test('同じ Encounter: 押下中に語が変わっても、回答前の記録は押し始めた語の Encounter ごとに持つ', () => {
  const start = recordUnderstanding({}, 'dog', 'known', '2026-01-01T00:00:00.000Z')
  // Encounter 10（apple）を押し始めて、Encounter 11（dog）の表示中に確定した
  let result = answerUnderstanding(start, {}, { wordId: 'apple', sequence: 10 }, 'known', '2026-01-02T00:00:00.000Z')
  result = answerUnderstanding(result.map, result.bases, { wordId: 'dog', sequence: 11 }, 'known', '2026-01-02T00:00:01.000Z')
  result = answerUnderstanding(result.map, result.bases, { wordId: 'apple', sequence: 10 }, 'known', '2026-01-02T00:00:02.000Z')
  assert.equal(getUnderstanding(result.map, 'apple')?.knownStreak, 1)
  assert.equal(getUnderstanding(result.map, 'dog')?.knownStreak, 2)
})

test('旧データの移行: version 1 の known は「わかる1回目」（answeredAt の1日後が期日）、unknown は復習候補、ほかは未回答', () => {
  const store = installStorage({
    'word-loop.understanding': JSON.stringify({
      version: 1,
      words: {
        apple: { status: 'known', answeredAt: '2026-10-20T09:30:00.000Z' },
        dog: { status: 'unknown', answeredAt: '2026-10-21T09:30:00.000Z' },
      },
    }),
  })
  const before = store.get('word-loop.understanding')
  const map = loadUnderstanding()
  assert.deepEqual(map, {
    apple: {
      status: 'known',
      answeredAt: '2026-10-20T09:30:00.000Z',
      knownStreak: 1,
      nextDueAt: '2026-10-21T09:30:00.000Z',
    },
    dog: { status: 'unknown', answeredAt: '2026-10-21T09:30:00.000Z', knownStreak: 0, nextDueAt: null },
  })
  assert.equal(getUnderstanding(map, 'cat'), null)
  // 読み込みでは書き換えない。何度読み込んでも期日は先送りされない。
  assert.equal(store.get('word-loop.understanding'), before)
  assert.deepEqual(loadUnderstanding(), map)
  // 保存し直しても回答日時・期日はそのまま
  saveUnderstanding(map)
  assert.deepEqual(loadUnderstanding(), map)
  assert.equal(JSON.parse(store.get('word-loop.understanding') ?? '').version, 2)
})

test('旧データの移行: 不正な追加項目は status と answeredAt から安全に補い、ほかの語は残す', () => {
  const map = parseUnderstanding({
    version: 2,
    words: {
      apple: { status: 'known', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: -3, nextDueAt: 'later' },
      dog: { status: 'known', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: 3, nextDueAt: null },
      cat: { status: 'known', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: 2.5 },
      sun: { status: 'unknown', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: 4, nextDueAt: '2026-11-01T00:00:00.000Z' },
      moon: { status: 'known', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: 2, nextDueAt: '2026-10-23T00:00:00.000Z' },
      bad: { status: 'known', answeredAt: 'yesterday', knownStreak: 2 },
    },
  })
  assert.deepEqual(map.apple, { status: 'known', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: 1, nextDueAt: '2026-10-21T00:00:00.000Z' })
  assert.deepEqual(map.dog, { status: 'known', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: 3, nextDueAt: '2026-10-27T00:00:00.000Z' })
  assert.deepEqual(map.cat, { status: 'known', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: 1, nextDueAt: '2026-10-21T00:00:00.000Z' })
  assert.deepEqual(map.sun, { status: 'unknown', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: 0, nextDueAt: null })
  assert.deepEqual(map.moon, { status: 'known', answeredAt: '2026-10-20T00:00:00.000Z', knownStreak: 2, nextDueAt: '2026-10-23T00:00:00.000Z' })
  assert.equal(getUnderstanding(map, 'bad'), null)
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

// ---------- イベントの流れ（App の理解度ボタンと同じ処理順） ----------
// ブラウザのボタンは、Enter は keydown ごとに click、Space は keyup で1回 click、マウス・タッチは離したときに click が起きる。
// その流れを再現し、表示中の語（current）が途中で変わっても押し始めた語に1回だけ記録されることを確かめる。
type ButtonEvent =
  | { type: 'keydown'; key: string; repeat: boolean; t: number; current: string }
  | { type: 'keyup'; key: string; t: number; current: string }
  | { type: 'pointerdown'; t: number; current: string }
  | { type: 'pointerup'; t: number; current: string }

// 表示中の語ごとに別の Encounter（通し番号は語の名前から決める）として扱う。
const targetOf = (wordId: string): UnderstandingTarget => ({ wordId, sequence: wordId.length * 100 + wordId.charCodeAt(0) })

const runButtonEvents = (events: ButtonEvent[], status: UnderstandingStatus = 'known') => {
  let press: UnderstandingPress | null = null
  let map: UnderstandingMap = {}
  const answers: string[] = []
  const click = (t: number, current: string) => {
    const { wordId } = resolveUnderstandingTarget(press, t, targetOf(current))
    press = null
    map = recordUnderstanding(map, wordId, status, new Date(t).toISOString())
    answers.push(wordId)
  }
  for (const event of events) {
    if (event.type === 'keydown') {
      const result = handleUnderstandingKeyDown(press, event.key, event.repeat, event.t, targetOf(event.current))
      press = result.press
      // 既定の動作を止めなければ、Enter は keydown ごとに click になる
      if (event.key === 'Enter' && !result.preventDefault) click(event.t, event.current)
    } else if (event.type === 'keyup') {
      if (event.key === ' ') click(event.t, event.current)
    } else if (event.type === 'pointerdown') {
      press = startUnderstandingPress(event.t, targetOf(event.current))
    } else {
      click(event.t, event.current)
    }
  }
  return { answers, map }
}

test('理解度のキー操作: Space を押し続けて自動リピートが起きても、押し始めた語に1回だけ記録する', () => {
  const { answers, map } = runButtonEvents([
    { type: 'keydown', key: ' ', repeat: false, t: 1000, current: 'apple' },
    { type: 'keydown', key: ' ', repeat: true, t: 1500, current: 'dog' },
    { type: 'keydown', key: ' ', repeat: true, t: 1533, current: 'dog' },
    { type: 'keydown', key: ' ', repeat: true, t: 1800, current: 'cat' },
    { type: 'keyup', key: ' ', t: 1900, current: 'cat' },
  ])
  assert.deepEqual(answers, ['apple'])
  assert.deepEqual(Object.keys(map), ['apple'])
})

test('理解度のキー操作: Enter の自動リピートでは回答せず、別の語へ連続で回答しない', () => {
  const { answers } = runButtonEvents([
    { type: 'keydown', key: 'Enter', repeat: false, t: 1000, current: 'apple' },
    { type: 'keydown', key: 'Enter', repeat: true, t: 1500, current: 'dog' },
    { type: 'keydown', key: 'Enter', repeat: true, t: 1533, current: 'cat' },
    { type: 'keyup', key: 'Enter', t: 1600, current: 'cat' },
  ])
  assert.deepEqual(answers, ['apple'])
  assert.deepEqual(handleUnderstandingKeyDown(null, 'Enter', true, 1500, targetOf('dog')), {
    press: null,
    preventDefault: true,
  })
})

test('理解度のキー操作: 離してから押し直せば、そのとき表示中の語に記録する（通常の再押下）', () => {
  const { answers } = runButtonEvents([
    { type: 'keydown', key: ' ', repeat: false, t: 1000, current: 'apple' },
    { type: 'keyup', key: ' ', t: 1100, current: 'apple' },
    { type: 'keydown', key: ' ', repeat: false, t: 1600, current: 'dog' },
    { type: 'keyup', key: ' ', t: 1700, current: 'cat' },
    { type: 'keydown', key: 'Enter', repeat: false, t: 2000, current: 'sun' },
    { type: 'keyup', key: 'Enter', t: 2050, current: 'sun' },
    { type: 'keydown', key: 'Enter', repeat: false, t: 2600, current: 'moon' },
  ])
  assert.deepEqual(answers, ['apple', 'dog', 'sun', 'moon'])
})

test('理解度のキー操作: Enter / Space 以外のキーは押下情報を変えない', () => {
  const press = startUnderstandingPress(1000, targetOf('apple'))
  assert.deepEqual(handleUnderstandingKeyDown(press, 'Tab', false, 1200, targetOf('dog')), { press, preventDefault: false })
  assert.deepEqual(handleUnderstandingKeyDown(press, 'a', true, 1200, targetOf('dog')), { press, preventDefault: false })
})

test('理解度のポインター操作: 押している間に語が変わっても押し始めた語に記録し、次の押下は新しい語に記録する', () => {
  const { answers } = runButtonEvents(
    [
      { type: 'pointerdown', t: 1000, current: 'apple' },
      { type: 'pointerup', t: 1400, current: 'dog' },
      { type: 'pointerdown', t: 1500, current: 'dog' },
      { type: 'pointerup', t: 1550, current: 'dog' },
    ],
    'unknown',
  )
  assert.deepEqual(answers, ['apple', 'dog'])
})
