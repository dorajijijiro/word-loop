import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LearningProgressMap } from '../src/lib/learningProgress.ts'
import {
  addBucketCount,
  chooseBucket,
  classifyWord,
  createBucketCounts,
  groupWordsByBucket,
  selectNormalWord,
  type BucketCounts,
} from '../src/lib/wordSelector.ts'
import { seededRandom } from './helpers.ts'

const progressOf = (entries: [string, number, number][]): LearningProgressMap =>
  Object.fromEntries(
    entries.map(([wordId, encounterCount, attentionCount]) => [
      wordId,
      { wordId, encounterCount, attentionCount, lastEncounteredAt: null },
    ]),
  )

test('familiar / growth 分類: 3回以上かつ attention 0 だけが familiar', () => {
  const progress = progressOf([
    ['a', 3, 0],
    ['b', 2, 0],
    ['c', 10, 1],
    ['d', 100, 0],
  ])
  assert.equal(classifyWord(progress, 'a'), 'familiar')
  assert.equal(classifyWord(progress, 'b'), 'growth')
  assert.equal(classifyWord(progress, 'c'), 'growth')
  assert.equal(classifyWord(progress, 'd'), 'familiar')
  assert.equal(classifyWord(progress, 'unknown'), 'growth')
  assert.deepEqual(groupWordsByBucket(['a', 'b', 'c', 'd', 'e'], progress), {
    familiar: ['a', 'd'],
    growth: ['b', 'c', 'e'],
  })
})

test('分類ルールは差し替えられる', () => {
  const progress = progressOf([['a', 0, 0]])
  assert.equal(classifyWord(progress, 'a', () => 'familiar'), 'familiar')
})

test('9:1 選出: 100 Encounter で growth はおおむね1割', () => {
  const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
  // 18語 familiar、2語 growth
  const progress = progressOf(wordIds.map((id, index) => [id, index < 18 ? 5 : 0, 0]))

  for (const seed of [1, 2, 3, 42, 2026]) {
    const random = seededRandom(seed)
    let plannedCounts: BucketCounts = createBucketCounts()
    let actual = createBucketCounts()
    let previousWordId: string | undefined

    for (let index = 0; index < 100; index += 1) {
      const selection = selectNormalWord({ wordIds, progress, plannedCounts, previousWordId, random })
      plannedCounts = addBucketCount(plannedCounts, selection.plannedBucket)
      actual = addBucketCount(actual, selection.bucket)
      previousWordId = selection.wordId
    }

    assert.ok(actual.growth >= 8 && actual.growth <= 12, `seed ${seed}: growth ${actual.growth}`)
    assert.equal(actual.familiar + actual.growth, 100)
  }
})

test('chooseBucket: 目標から1回分以上ずれたら補正する', () => {
  const alwaysFamiliar = () => 0.99
  const alwaysGrowth = () => 0
  assert.equal(chooseBucket({ familiar: 9, growth: 0 }, alwaysFamiliar), 'growth')
  assert.equal(chooseBucket({ familiar: 0, growth: 2 }, alwaysGrowth), 'familiar')
  assert.equal(chooseBucket({ familiar: 0, growth: 0 }, alwaysFamiliar), 'familiar')
  assert.equal(chooseBucket({ familiar: 0, growth: 0 }, alwaysGrowth), 'growth')
})

test('候補不足: 片方の bucket が空なら存在する bucket から補う', () => {
  const wordIds = ['a', 'b', 'c']
  const allGrowth = progressOf([])
  const allFamiliar = progressOf(wordIds.map((id) => [id, 5, 0]))
  const random = seededRandom(7)

  for (let index = 0; index < 50; index += 1) {
    const plannedCounts = { familiar: index, growth: 0 }
    const fromGrowth = selectNormalWord({ wordIds, progress: allGrowth, plannedCounts, random })
    assert.equal(fromGrowth.bucket, 'growth')
    assert.ok(wordIds.includes(fromGrowth.wordId))

    const fromFamiliar = selectNormalWord({ wordIds, progress: allFamiliar, plannedCounts, random })
    assert.equal(fromFamiliar.bucket, 'familiar')
    assert.ok(wordIds.includes(fromFamiliar.wordId))
  }
})

test('同一語の連続回避: 他の候補があれば直前の語を出さない', () => {
  // growth は1語だけ。growth を狙っても直前と同じなら familiar から補う
  const wordIds = ['a', 'b', 'g']
  const progress = progressOf([
    ['a', 5, 0],
    ['b', 5, 0],
  ])
  const random = seededRandom(3)
  let previousWordId: string | undefined
  let plannedCounts = createBucketCounts()

  for (let index = 0; index < 200; index += 1) {
    const selection = selectNormalWord({ wordIds, progress, plannedCounts, previousWordId, random })
    assert.notEqual(selection.wordId, previousWordId)
    plannedCounts = addBucketCount(plannedCounts, selection.plannedBucket)
    previousWordId = selection.wordId
  }
})

test('語が1つしかない場合は連続を許して停止しない', () => {
  const selection = selectNormalWord({
    wordIds: ['only'],
    progress: {},
    plannedCounts: createBucketCounts(),
    previousWordId: 'only',
  })
  assert.equal(selection.wordId, 'only')
})
