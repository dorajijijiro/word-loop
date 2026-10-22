import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LearningProgressMap } from '../src/lib/learningProgress.ts'
import {
  addBucketCount,
  addTrackCount,
  chooseTrack,
  classifyWord,
  createBucketCounts,
  createTrackCounts,
  getMinimumFamiliarPool,
  groupWordsByBucket,
  selectNormalWord,
  type BucketCounts,
  type TrackCounts,
} from '../src/lib/wordSelector.ts'
import { seededRandom, wordProgress } from './helpers.ts'

// [wordId, encounterCount, attentionDebt, attentionCount]
const progressOf = (entries: [string, number, number, number?][]): LearningProgressMap =>
  Object.fromEntries(
    entries.map(([wordId, encounterCount, attentionDebt, attentionCount = 0]) => [
      wordId,
      wordProgress(wordId, { encounterCount, attentionDebt, attentionCount }),
    ]),
  )

type RunResult = { actual: BucketCounts; previousRepeats: number }

const runSelection = (
  wordIds: string[],
  progress: LearningProgressMap,
  seed: number,
  count = 100,
): RunResult => {
  const random = seededRandom(seed)
  let plannedCounts: TrackCounts = createTrackCounts()
  let actual = createBucketCounts()
  let previousWordId: string | undefined
  let previousRepeats = 0

  for (let index = 0; index < count; index += 1) {
    const selection = selectNormalWord({ wordIds, progress, plannedCounts, previousWordId, random })
    plannedCounts = addTrackCount(plannedCounts, selection.plannedTrack)
    actual = addBucketCount(actual, selection.bucket)
    if (selection.wordId === previousWordId) {
      previousRepeats += 1
    }
    previousWordId = selection.wordId
  }

  return { actual, previousRepeats }
}

test('分類: 未遭遇・1〜2回は new', () => {
  const progress = progressOf([
    ['one', 1, 0],
    ['two', 2, 0],
  ])
  assert.equal(classifyWord(progress, 'unknown'), 'new')
  assert.equal(classifyWord(progress, 'one'), 'new')
  assert.equal(classifyWord(progress, 'two'), 'new')
})

test('分類: attentionDebt があれば Encounter 回数に関係なく growth', () => {
  const progress = progressOf([
    ['first-tap', 1, 2],
    ['many', 50, 1],
  ])
  assert.equal(classifyWord(progress, 'first-tap'), 'growth')
  assert.equal(classifyWord(progress, 'many'), 'growth')
})

test('分類: 3回以上かつ attentionDebt 0 は familiar', () => {
  const progress = progressOf([
    ['three', 3, 0],
    ['hundred', 100, 0],
  ])
  assert.equal(classifyWord(progress, 'three'), 'familiar')
  assert.equal(classifyWord(progress, 'hundred'), 'familiar')
})

test('分類: 過去に attentionCount があっても debt 0 なら familiar に戻れる', () => {
  const progress = progressOf([
    ['recovered', 8, 0, 4],
    ['still-new', 2, 0, 1],
  ])
  assert.equal(classifyWord(progress, 'recovered'), 'familiar')
  assert.equal(classifyWord(progress, 'still-new'), 'new')
  assert.deepEqual(groupWordsByBucket(['recovered', 'still-new', 'x'], progress), {
    new: ['still-new', 'x'],
    growth: [],
    familiar: ['recovered'],
  })
})

test('分類ルールは差し替えられる', () => {
  const progress = progressOf([['a', 0, 0]])
  assert.equal(classifyWord(progress, 'a', () => 'familiar'), 'familiar')
})

test('9:1 選出: familiar 中心で learning（new + growth）はおおむね1割', () => {
  const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
  // 16語 familiar、2語 growth、2語 new
  const progress = progressOf(
    wordIds.map((id, index) => [id, index < 18 ? 5 : 1, index >= 16 && index < 18 ? 2 : 0]),
  )

  for (const seed of [1, 2, 3, 42, 2026]) {
    const { actual } = runSelection(wordIds, progress, seed)
    const learning = actual.new + actual.growth
    assert.ok(learning >= 8 && learning <= 12, `seed ${seed}: learning ${learning}`)
    assert.ok(actual.familiar >= 88, `seed ${seed}: familiar ${actual.familiar}`)
    assert.equal(actual.familiar + actual.new + actual.growth, 100)
  }
})

test('learning 枠: growth を new より優先し、new も枯れない', () => {
  const wordIds = Array.from({ length: 40 }, (_, index) => `w${index}`)
  // 20語 familiar、10語 growth、10語 new（growth が大量にある状態）
  const progress = progressOf(
    wordIds.map((id, index) => [id, index < 30 ? 5 : 0, index >= 20 && index < 30 ? 3 : 0]),
  )

  let growth = 0
  let fresh = 0
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const { actual } = runSelection(wordIds, progress, seed)
    growth += actual.growth
    fresh += actual.new
  }

  // 10遠征ぶん（learning 約100回）で growth 約75% / new 約25%
  assert.ok(growth > fresh * 2, `growth ${growth} / new ${fresh}`)
  assert.ok(fresh >= 10, `new ${fresh}`)
})

test('learning 枠: growth がなければ new から選ぶ', () => {
  const wordIds = ['f1', 'f2', 'n1']
  const progress = progressOf([
    ['f1', 5, 0],
    ['f2', 5, 0],
  ])
  const selection = selectNormalWord({
    wordIds,
    progress,
    plannedCounts: { familiar: 9, learning: 0 },
    random: seededRandom(1),
  })
  assert.equal(selection.plannedTrack, 'learning')
  assert.equal(selection.wordId, 'n1')
  assert.equal(selection.bucket, 'new')
})

test('chooseTrack: 目標から1回分以上ずれたら補正する', () => {
  const alwaysFamiliar = () => 0.99
  const alwaysLearning = () => 0
  assert.equal(chooseTrack({ familiar: 9, learning: 0 }, alwaysFamiliar), 'learning')
  assert.equal(chooseTrack({ familiar: 0, learning: 2 }, alwaysLearning), 'familiar')
  assert.equal(chooseTrack({ familiar: 0, learning: 0 }, alwaysFamiliar), 'familiar')
  assert.equal(chooseTrack({ familiar: 0, learning: 0 }, alwaysLearning), 'learning')
})

test('初回（全語 new）: familiar がなくても new から選び、growth とは表示しない', () => {
  const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
  const { actual } = runSelection(wordIds, {}, 5, 30)
  assert.equal(actual.new, 30)
  assert.equal(actual.growth, 0)
})

test('familiar が少ない間は familiar 枠に new を混ぜ、少数語の繰り返しを避ける', () => {
  const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
  // 2語だけ familiar、残り18語 new
  const progress = progressOf(wordIds.map((id, index) => [id, index < 2 ? 3 : 1, 0]))
  const { actual } = runSelection(wordIds, progress, 9, 50)
  assert.ok(actual.new > actual.familiar, `new ${actual.new} / familiar ${actual.familiar}`)
  assert.equal(actual.growth, 0)
})

test('familiar 枠に new を混ぜる最低語数は語彙数に応じて増える（20語: 8、200語: 30、上限30）', () => {
  assert.equal(getMinimumFamiliarPool(20), 8)
  assert.equal(getMinimumFamiliarPool(100), 15)
  assert.equal(getMinimumFamiliarPool(200), 30)
  assert.equal(getMinimumFamiliarPool(15000), 30)
})

test('境界値: 最低語数の切り替わり（53語→8、54語→9、193語→29、194語→30）', () => {
  assert.equal(getMinimumFamiliarPool(0), 8)
  assert.equal(getMinimumFamiliarPool(53), 8)
  assert.equal(getMinimumFamiliarPool(54), 9)
  assert.equal(getMinimumFamiliarPool(193), 29)
  assert.equal(getMinimumFamiliarPool(194), 30)
})

test('境界値: 語彙200語で familiar 29語なら familiar 枠に new が入り、30語ちょうどなら familiar だけから選ぶ', () => {
  const wordIds = Array.from({ length: 200 }, (_, index) => `w${index}`)
  // 0.99 固定: familiar 枠を狙い、候補の末尾（混ぜた場合は new の語）を選ぶ
  const random = () => 0.99
  const select = (familiarCount: number) =>
    selectNormalWord({
      wordIds,
      progress: progressOf(wordIds.slice(0, familiarCount).map((id) => [id, 3, 0])),
      plannedCounts: createTrackCounts(),
      random,
    })
  assert.deepEqual([select(29).plannedTrack, select(29).bucket], ['familiar', 'new'])
  assert.deepEqual([select(30).plannedTrack, select(30).bucket], ['familiar', 'familiar'])
})

test('語彙200語: familiar が10語だけの間は familiar 枠に new を混ぜ、その10語ばかりを繰り返さない', () => {
  const wordIds = Array.from({ length: 200 }, (_, index) => `w${index}`)
  // 10語だけ familiar、50語は1回見た new、残りは未遭遇
  const progress = progressOf(wordIds.slice(0, 60).map((id, index) => [id, index < 10 ? 3 : 1, 0]))
  const { actual } = runSelection(wordIds, progress, 11, 100)
  assert.ok(actual.new > actual.familiar, `new ${actual.new} / familiar ${actual.familiar}`)
})

test('語彙200語: familiar が30語以上あれば familiar 中心（9:1）に戻る', () => {
  const wordIds = Array.from({ length: 200 }, (_, index) => `w${index}`)
  const progress = progressOf(wordIds.slice(0, 30).map((id) => [id, 3, 0]))
  const { actual } = runSelection(wordIds, progress, 12, 100)
  assert.ok(actual.familiar >= 85, `familiar ${actual.familiar}`)
})

test('候補不足: どの組み合わせでも停止せず1語返す', () => {
  const wordIds = ['a', 'b', 'c']
  const cases: LearningProgressMap[] = [
    progressOf([]),
    progressOf(wordIds.map((id) => [id, 5, 0])),
    progressOf(wordIds.map((id) => [id, 5, 2])),
  ]
  const random = seededRandom(7)

  for (const progress of cases) {
    for (let index = 0; index < 50; index += 1) {
      const plannedCounts = { familiar: index, learning: index % 3 }
      const selection = selectNormalWord({ wordIds, progress, plannedCounts, random })
      assert.ok(wordIds.includes(selection.wordId))
      assert.equal(selection.bucket, classifyWord(progress, selection.wordId))
    }
  }
})

test('同一語の連続回避: 他の候補があれば直前の語を出さない', () => {
  // growth は1語だけ。growth を狙っても直前と同じなら他から補う
  const wordIds = ['a', 'b', 'g']
  const progress = progressOf([
    ['a', 5, 0],
    ['b', 5, 0],
    ['g', 5, 2],
  ])
  const { previousRepeats } = runSelection(wordIds, progress, 3, 200)
  assert.equal(previousRepeats, 0)
})

test('語が1つしかない場合は連続を許して停止しない', () => {
  const selection = selectNormalWord({
    wordIds: ['only'],
    progress: {},
    plannedCounts: createTrackCounts(),
    previousWordId: 'only',
  })
  assert.equal(selection.wordId, 'only')
  assert.equal(selection.bucket, 'new')
})
