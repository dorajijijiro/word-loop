// Task 017: 猫の反応とイベント進行（学習スケジューラーとは独立）。時刻は引数で渡し、実時間は待たない。
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  catMealAnswerInterval,
  catMealDurationMilliseconds,
  catMealMinimumGapMilliseconds,
  catReactionMilliseconds,
  createCatState,
  getNextCatUpdateAt,
  isCatEating,
  recordCatAnswer,
  updateCat,
  type CatState,
} from '../src/lib/catCompanion.ts'
import { loadLearningState } from '../src/lib/learningState.ts'

// 理解度の回答（✓ / ×）を App と同じ形で猫に渡す。回答の内容は猫の入力に含めない。
type Answer = { sequence: number; status: 'known' | 'unknown'; at: number }
const run = (answers: Answer[]) =>
  answers.reduce<CatState>((state, answer) => recordCatAnswer(updateCat(state, answer.at), answer.sequence, answer.at), createCatState())

test('定数: 3回答ごとに食事、約3秒、開始間隔は最短10秒', () => {
  assert.equal(catMealAnswerInterval, 3)
  assert.equal(catMealDurationMilliseconds, 3000)
  assert.equal(catMealMinimumGapMilliseconds, 10000)
})

test('✓ でも × でも同じ反応・同じ進行量になる', () => {
  const known = run([1, 2].map((sequence) => ({ sequence, status: 'known', at: sequence * 1000 })))
  const unknown = run([1, 2].map((sequence) => ({ sequence, status: 'unknown', at: sequence * 1000 })))
  const mixed = run([
    { sequence: 1, status: 'unknown', at: 1000 },
    { sequence: 2, status: 'known', at: 2000 },
  ])
  assert.deepEqual(known, unknown)
  assert.deepEqual(known, mixed)
  assert.equal(known.answerCount, 2)
  assert.ok(known.reaction !== null)
})

test('同じ Encounter での連打・回答訂正では反応も進行もしない', () => {
  let state = recordCatAnswer(createCatState(), 5, 1000)
  const once = state
  for (const at of [1100, 1200, 1300]) {
    state = recordCatAnswer(state, 5, at)
  }
  assert.equal(state, once)
  assert.equal(state.answerCount, 1)
  // 別の Encounter（同じ語の再登場を含む）は新しい1回
  state = recordCatAnswer(state, 6, 1400)
  assert.equal(state.answerCount, 2)
  assert.equal(state.reaction?.id, 2)
})

test('3回答目で食事を始め、約3秒で終わる', () => {
  let state = run([1, 2, 3].map((sequence) => ({ sequence, status: 'known', at: 1000 + sequence })))
  assert.equal(isCatEating(state), true)
  assert.equal(state.answerCount, 0)
  assert.equal(state.mealStartedAt, 1003)
  assert.equal(updateCat(state, 1003 + catMealDurationMilliseconds - 1).mealStartedAt, 1003)
  state = updateCat(state, 1003 + catMealDurationMilliseconds)
  assert.equal(isCatEating(state), false)
})

test('食事の開始間隔は最短10秒。待ち中の食事は1回分だけ保留し、それ以上は貯めない', () => {
  // 12回の回答を0.5秒ごと（6秒間）にすると、食事の条件は4回分たまるが、保留は1回分まで
  let state = createCatState()
  for (let sequence = 1; sequence <= 12; sequence += 1) {
    const at = sequence * 500
    state = recordCatAnswer(updateCat(state, at), sequence, at)
  }
  assert.equal(state.lastMealStartedAt, 1500)
  assert.equal(state.mealPending, true)
  // 次の食事は最初の開始から10秒後
  assert.equal(getNextCatUpdateAt(updateCat(state, 7000)), 1500 + catMealMinimumGapMilliseconds)
  state = updateCat(state, 1500 + catMealMinimumGapMilliseconds - 1)
  assert.equal(isCatEating(state), false)
  state = updateCat(state, 1500 + catMealMinimumGapMilliseconds)
  assert.equal(isCatEating(state), true)
  assert.equal(state.mealPending, false)
  // その後は回答がなければ食事は起きない（貯めた分はない）
  state = updateCat(state, 1500 + catMealMinimumGapMilliseconds + catMealDurationMilliseconds)
  assert.equal(isCatEating(state), false)
  assert.equal(getNextCatUpdateAt(state), null)
  state = updateCat(state, 100000)
  assert.equal(isCatEating(state), false)
})

test('食事中の回答も受け付け（出題は止めない）、反応は短時間で消える', () => {
  let state = run([1, 2, 3].map((sequence) => ({ sequence, status: 'unknown', at: sequence })))
  state = recordCatAnswer(state, 4, 100)
  assert.equal(state.answerCount, 1)
  assert.equal(isCatEating(state), true)
  assert.equal(updateCat(state, 100 + catReactionMilliseconds).reaction, null)
})

test('未回答のまま進んでも猫の状態は変わらない（催促・罰なし）', () => {
  const state = createCatState()
  assert.equal(updateCat(state, 999999), state)
  assert.equal(getNextCatUpdateAt(state), null)
})

// ---------- 表示設定の保存 ----------

const installStorage = (initial: Record<string, string> = {}) => {
  const store = new Map(Object.entries(initial))
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

test('設定: ボタンの説明の表示は learning-state に保存し、旧データ（項目なし）では表示する', () => {
  installStorage({
    'word-loop.learning-state': JSON.stringify({ currentWordId: 'negotiate', intervalSeconds: 0.5, speechEnabled: false, showPhrase: false }),
  })
  assert.deepEqual(loadLearningState(), {
    currentWordId: 'negotiate',
    intervalSeconds: 0.5,
    speechEnabled: false,
    showPhrase: false,
    showAnswerHints: true,
  })
  installStorage({
    'word-loop.learning-state': JSON.stringify({ currentWordId: 'negotiate', intervalSeconds: 0.5, speechEnabled: true, showPhrase: true, showAnswerHints: false }),
  })
  assert.equal(loadLearningState().showAnswerHints, false)
  installStorage({ 'word-loop.learning-state': JSON.stringify({ showAnswerHints: 'no' }) })
  assert.equal(loadLearningState().showAnswerHints, true)
})
