// Task 016: 自己申告に基づく出題間隔と出題順序の確認。時刻・乱数は注入し、実時間は待たない。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEncounterSession, startEncounter } from '../src/lib/encounterEngine.ts'
import {
  completeExhaustedExpedition,
  expeditionEncounterLimit,
  startExpedition,
} from '../src/lib/expedition.ts'
import type { LearningProgressMap } from '../src/lib/learningProgress.ts'
import { applyExpeditionRewards, createPlayerProgress } from '../src/lib/playerProgress.ts'
import { calculateReturnGold } from '../src/lib/rewards.ts'
import { getReappearSequence, selectNextWord, shortTermReappearGap, type ScheduleInput } from '../src/lib/scheduler.ts'
import {
  dayMilliseconds,
  getUnderstanding,
  parseUnderstanding,
  recordUnderstanding,
  type UnderstandingMap,
} from '../src/lib/understanding.ts'
import { words } from '../src/data/words.ts'
import { seededRandom, simulateExpedition, wordProgress } from './helpers.ts'

const t0 = Date.parse('2026-10-24T00:00:00.000Z')
const iso = (milliseconds: number) => new Date(milliseconds).toISOString()
const hour = 60 * 60 * 1000

const baseInput = (fields: Partial<ScheduleInput>): ScheduleInput => ({
  wordIds: [],
  understanding: {},
  progress: {},
  now: t0,
  sequence: 1,
  previousWordId: null,
  shownWordIds: new Set(),
  reservations: [],
  random: seededRandom(1),
  ...fields,
})

// ---------- 出題間隔 ----------

test('known: 次回期日の前には選ばれず、期日以降に復習候補になる', () => {
  const understanding = recordUnderstanding({}, 'apple', 'known', iso(t0))
  const input = baseInput({ wordIds: ['apple'], understanding })
  assert.equal(selectNextWord({ ...input, now: t0 + 23 * hour }), null)
  assert.equal(selectNextWord({ ...input, now: t0 + dayMilliseconds - 1 }), null)
  assert.deepEqual(selectNextWord({ ...input, now: t0 + dayMilliseconds }), { wordId: 'apple', reason: 'review' })
  assert.deepEqual(selectNextWord({ ...input, now: t0 + 5 * dayMilliseconds }), { wordId: 'apple', reason: 'review' })
})

test('known: 遠征を通して期日前の known は1回も出ない（待ち時間を埋めるために出さない）', () => {
  const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
  // w0〜w9 は期日前の known、w10〜w19 は未回答
  let understanding: UnderstandingMap = {}
  for (const wordId of wordIds.slice(0, 10)) {
    understanding = recordUnderstanding(understanding, wordId, 'known', iso(t0 - hour))
  }
  const { shown, expedition } = simulateExpedition({ wordIds, understanding, now: t0, seed: 3 })
  assert.deepEqual(new Set(shown.map((encounter) => encounter.wordId)), new Set(wordIds.slice(10)))
  assert.equal(expedition.encounterCount, 10)
  assert.equal(expedition.endReason, 'exhausted')
})

test('known: 遠征中に「わかる」と答えた語は、連続回数に応じた期日まで出ない', () => {
  const wordIds = ['apple', 'dog', 'cat']
  let understanding: UnderstandingMap = {}
  let now = t0
  const intervals: number[] = []
  for (let round = 0; round < 5; round += 1) {
    const result = simulateExpedition({
      wordIds,
      understanding,
      now,
      seed: round,
      answer: (encounter) => (encounter.wordId === 'apple' ? 'known' : null),
    })
    assert.ok(result.shown.some((encounter) => encounter.wordId === 'apple'), `round ${round}`)
    understanding = result.understanding
    const due = Date.parse(getUnderstanding(understanding, 'apple')?.nextDueAt ?? '')
    intervals.push(Math.round((due - result.now) / dayMilliseconds))
    // 期日の直前には出ない
    const before = simulateExpedition({ wordIds, understanding, now: due - 1, seed: round, stepMilliseconds: 0 })
    assert.ok(!before.shown.some((encounter) => encounter.wordId === 'apple'), `round ${round}`)
    now = due
  }
  assert.deepEqual(intervals, [1, 3, 7, 30, 90])
})

// ---------- 「まだわからない」 ----------

test('unknown: 別の5 Encounter を挟んだ後に again として再登場し、予約は重複しない', () => {
  const wordIds = Array.from({ length: 30 }, (_, index) => `w${index}`)
  let answeredSequence = -1
  let answeredWordId = ''
  const { shown, understanding } = simulateExpedition({
    wordIds,
    now: t0,
    seed: 5,
    answer: (encounter, index) => {
      if (index === 3) {
        answeredSequence = encounter.sequence
        answeredWordId = encounter.wordId
        // 同じ Encounter で2回押しても予約は1件
        return ['unknown', 'unknown']
      }
      return null
    },
  })
  const appearances = shown.filter((encounter) => encounter.wordId === answeredWordId)
  assert.equal(appearances.length, 2)
  const again = appearances[1]
  assert.equal(again.source, 'reencounter')
  assert.equal(again.sequence, getReappearSequence(answeredSequence))
  assert.equal(again.sequence - answeredSequence - 1, shortTermReappearGap)
  // 再登場しただけでは理解度は変わらない
  assert.equal(getUnderstanding(understanding, answeredWordId)?.status, 'unknown')
})

test('unknown: 再登場時にも「まだわからない」と答えれば再び予約し、答えなければ同じ遠征ではもう出ない', () => {
  const wordIds = Array.from({ length: 40 }, (_, index) => `w${index}`)
  let target = ''
  let unknownAnswers = 0
  const { shown } = simulateExpedition({
    wordIds,
    now: t0,
    seed: 8,
    answer: (encounter, index) => {
      if (index === 0) {
        target = encounter.wordId
      }
      // 最初と1回目の再登場で「まだわからない」、2回目の再登場では答えない
      if (encounter.wordId === target && unknownAnswers < 2) {
        unknownAnswers += 1
        return 'unknown'
      }
      return null
    },
  })
  const appearances = shown.filter((encounter) => encounter.wordId === target)
  assert.equal(appearances.length, 3)
  assert.deepEqual(
    appearances.map((encounter) => encounter.source),
    ['normal', 'reencounter', 'reencounter'],
  )
})

test('unknown: 再登場前に「わかる」へ訂正すると予約を取り消し、同じ遠征では再登場しない', () => {
  const wordIds = Array.from({ length: 30 }, (_, index) => `w${index}`)
  let target = ''
  const { shown, understanding } = simulateExpedition({
    wordIds,
    now: t0,
    seed: 6,
    answer: (encounter, index) => {
      if (index === 2) {
        target = encounter.wordId
        return ['unknown', 'known']
      }
      return null
    },
  })
  assert.equal(shown.filter((encounter) => encounter.wordId === target).length, 1)
  assert.equal(shown.filter((encounter) => encounter.source === 'reencounter').length, 0)
  assert.equal(getUnderstanding(understanding, target)?.status, 'known')
  assert.equal(getUnderstanding(understanding, target)?.knownStreak, 1)
})

test('unknown: 未消化の短期予約は次の遠征へ持ち越さず、unknown の語は次の遠征の復習候補（未回答より先）になる', () => {
  const wordIds = Array.from({ length: 10 }, (_, index) => `w${index}`)
  let target = ''
  // 最後の語で「まだわからない」→ 予約の時期が来る前に候補がなくなり遠征が終わる
  const first = simulateExpedition({
    wordIds,
    now: t0,
    seed: 2,
    answer: (encounter, index) => {
      if (index === 9) {
        target = encounter.wordId
        return 'unknown'
      }
      return null
    },
  })
  assert.equal(first.expedition.encounterCount, 10)
  assert.equal(first.expedition.endReason, 'exhausted')
  assert.deepEqual(first.session?.reencounterQueue, [])

  const second = simulateExpedition({
    wordIds,
    understanding: first.understanding,
    progress: first.progress,
    session: first.session ?? undefined,
    now: first.now + hour,
    seed: 3,
  })
  // 前の遠征の最後の語でも、ほかに候補がないわけではないので、連続を避けて別の語から始める
  assert.notEqual(second.shown[0].wordId, target)
  const reviewIndex = second.shown.findIndex((encounter) => encounter.wordId === target)
  assert.equal(reviewIndex, 1)
  assert.equal(second.shown[reviewIndex].source, 'normal')
})

// ---------- 未回答 ----------

test('未回答: known にも unknown にもせず、回答しなければ遠征後も未回答のまま次の遠征の候補になる', () => {
  const wordIds = Array.from({ length: 8 }, (_, index) => `w${index}`)
  const first = simulateExpedition({ wordIds, now: t0, seed: 1 })
  assert.deepEqual(first.understanding, {})
  // 同じ遠征では繰り返し選出しない（8語なら8 Encounter で終わる）
  assert.equal(first.expedition.encounterCount, 8)
  assert.equal(new Set(first.shown.map((encounter) => encounter.wordId)).size, 8)

  const second = simulateExpedition({ wordIds, progress: first.progress, now: first.now, seed: 2 })
  assert.equal(second.expedition.encounterCount, 8)
})

test('未回答: 表示回数の少ない語を優先し、同条件の語は偏らないように選ぶ', () => {
  const progress: LearningProgressMap = {
    a: wordProgress('a', { encounterCount: 9 }),
    b: wordProgress('b', { encounterCount: 2 }),
    c: wordProgress('c', { encounterCount: 2 }),
    d: wordProgress('d', { encounterCount: 5 }),
  }
  const input = baseInput({ wordIds: ['a', 'b', 'c', 'd'], progress })
  const counts = { b: 0, c: 0 } as Record<string, number>
  const random = seededRandom(10)
  for (let index = 0; index < 400; index += 1) {
    const choice = selectNextWord({ ...input, random })
    assert.ok(choice !== null && (choice.wordId === 'b' || choice.wordId === 'c'))
    counts[choice.wordId] += 1
  }
  assert.ok(counts.b > 150 && counts.c > 150, JSON.stringify(counts))
  // familiar（encounterCount 9）を多く出す 9:1 の選出は使わない
  const shown = new Set(['b', 'c'])
  assert.equal(selectNextWord({ ...input, shownWordIds: shown })?.wordId, 'd')
})

// ---------- 出題順序 ----------

test('出題順序: 時期が来た短期予約 → 復習候補 → 未回答。同じ優先度では待っている期間が長い語から', () => {
  let understanding: UnderstandingMap = {}
  understanding = recordUnderstanding(understanding, 'knownOld', 'known', iso(t0 - 10 * dayMilliseconds))
  understanding = recordUnderstanding(understanding, 'knownNew', 'known', iso(t0 - 2 * dayMilliseconds))
  understanding = recordUnderstanding(understanding, 'unknownWord', 'unknown', iso(t0 - 3 * dayMilliseconds))
  const wordIds = ['fresh', 'knownNew', 'unknownWord', 'knownOld', 'reserved']
  // fresh と reserved は未回答。表示回数の少ない fresh が先。
  const progress = { reserved: wordProgress('reserved', { encounterCount: 1 }) }
  const input = baseInput({ wordIds, understanding, progress, sequence: 20 })

  // ① 時期が来た短期予約
  const reservations = [{ wordId: 'reserved', dueSequence: 20 }]
  assert.deepEqual(selectNextWord({ ...input, reservations, shownWordIds: new Set(['reserved']) }), {
    wordId: 'reserved',
    reason: 'reappear',
  })
  // 時期が来ていない予約は飛ばす
  assert.equal(selectNextWord({ ...input, reservations: [{ wordId: 'reserved', dueSequence: 21 }] })?.reason, 'review')

  // ② 復習候補: knownOld（期日から9日）→ unknownWord（回答から3日）→ knownNew（期日から1日）
  const order: string[] = []
  const shown = new Set<string>()
  for (let index = 0; index < 5; index += 1) {
    const choice = selectNextWord({ ...input, shownWordIds: shown })
    if (choice === null) break
    order.push(`${choice.wordId}:${choice.reason}`)
    shown.add(choice.wordId)
  }
  assert.deepEqual(order, [
    'knownOld:review',
    'unknownWord:review',
    'knownNew:review',
    'fresh:unanswered',
    'reserved:unanswered',
  ])
})

test('出題順序: 同じ語を連続で出さない（予約語が直前の語なら次に回す）', () => {
  const input = baseInput({
    wordIds: ['a', 'b'],
    sequence: 10,
    previousWordId: 'a',
    shownWordIds: new Set(['a']),
    reservations: [{ wordId: 'a', dueSequence: 9 }],
  })
  assert.deepEqual(selectNextWord(input), { wordId: 'b', reason: 'unanswered' })
  // ほかに候補がなく、予約語が直前の語なら null（同じ語で埋めない）
  assert.equal(selectNextWord({ ...input, shownWordIds: new Set(['a', 'b']), previousWordId: 'a' }), null)

  const wordIds = Array.from({ length: 12 }, (_, index) => `w${index}`)
  const { shown } = simulateExpedition({
    wordIds,
    now: t0,
    seed: 4,
    answer: (encounter, index) => (index % 2 === 0 ? 'unknown' : null),
  })
  for (let index = 1; index < shown.length; index += 1) {
    assert.notEqual(shown[index].wordId, shown[index - 1].wordId)
  }
})

test('出題順序: 一度表示した復習語は、回答がなければ同じ遠征では再選出しない', () => {
  let understanding: UnderstandingMap = {}
  for (const wordId of ['a', 'b', 'c']) {
    understanding = recordUnderstanding(understanding, wordId, 'unknown', iso(t0 - dayMilliseconds))
  }
  understanding = recordUnderstanding(understanding, 'd', 'known', iso(t0 - 2 * dayMilliseconds))
  const { shown, expedition } = simulateExpedition({ wordIds: ['a', 'b', 'c', 'd'], understanding, now: t0, seed: 9 })
  assert.equal(shown.length, 4)
  assert.equal(new Set(shown.map((encounter) => encounter.wordId)).size, 4)
  assert.equal(expedition.endReason, 'exhausted')
})

// ---------- 遠征の終了と報酬 ----------

test('遠征: 未回答が十分にあれば105 Encounter を上限として完了し、同じ語を繰り返さない', () => {
  const wordIds = words.map((word) => word.id)
  const { shown, expedition } = simulateExpedition({ wordIds, now: t0, seed: 12 })
  assert.equal(expedition.encounterCount, expeditionEncounterLimit)
  assert.equal(expedition.endReason, 'limit')
  assert.equal(new Set(shown.map((encounter) => encounter.wordId)).size, expeditionEncounterLimit)
  assert.ok(shown.every((encounter) => encounter.source !== 'recall'))
})

test('遠征: 候補が尽きたら105未満でも終了し、表示した Encounter 分の報酬だけを確定する', () => {
  const wordIds = Array.from({ length: 6 }, (_, index) => `w${index}`)
  const { expedition, shown } = simulateExpedition({ wordIds, now: t0, seed: 7 })
  assert.equal(expedition.status, 'completed')
  assert.equal(expedition.endReason, 'exhausted')
  assert.equal(expedition.encounterCount, 6)
  assert.equal(shown.length, 6)
  // 初回は全語 new（+5 XP）
  assert.equal(expedition.xp, 30)
  assert.deepEqual(expedition.rewards, { xp: 30, gold: calculateReturnGold(expedition, true) })
  // 現行の Gold は基本100が固定で付く（短い遠征でも100。係数は変更していない）
  assert.equal(expedition.rewards?.gold, 100 + 6 * 2)
  const player = applyExpeditionRewards(createPlayerProgress(), expedition.rewards ?? { xp: 0, gold: 0 })
  assert.deepEqual(player, { totalXp: 30, gold: 112, completedExpeditions: 1 })
})

test('遠征: 時期が来ていない短期予約だけが残っても、同じ語や既知語で埋めずに終了する', () => {
  const wordIds = ['a', 'b', 'c']
  let understanding: UnderstandingMap = {}
  understanding = recordUnderstanding(understanding, 'known', 'known', iso(t0))
  const { shown, expedition } = simulateExpedition({
    wordIds: [...wordIds, 'known'],
    understanding,
    now: t0,
    seed: 1,
    answer: () => 'unknown',
  })
  // 3語とも「まだわからない」でも、別の5 Encounter を挟めないので再登場せずに終わる
  assert.equal(shown.length, 3)
  assert.ok(!shown.some((encounter) => encounter.wordId === 'known'))
  assert.equal(expedition.endReason, 'exhausted')
})

test('遠征: 開始時点で候補が0件なら遠征を作らず、XP・Gold・完了遠征数は増えない', () => {
  const wordIds = ['a', 'b']
  let understanding: UnderstandingMap = {}
  for (const wordId of wordIds) {
    understanding = recordUnderstanding(understanding, wordId, 'known', iso(t0))
  }
  assert.equal(
    startEncounter(createEncounterSession(wordIds, 'a'), wordIds, { progress: {}, understanding, now: t0 + hour }),
    null,
  )
  const result = simulateExpedition({ wordIds, understanding, now: t0 + hour, seed: 1 })
  assert.equal(result.started, false)
  assert.equal(result.expedition.status, 'idle')
  assert.equal(result.expedition.rewards, null)
  // 1語も表示していない遠征は完了させない
  const empty = startExpedition()
  assert.equal(completeExhaustedExpedition(empty), empty)
  // 期日が来れば候補になる
  assert.equal(simulateExpedition({ wordIds, understanding, now: t0 + dayMilliseconds, seed: 1 }).shown.length, 2)
})

// ---------- 旧データ ----------

test('旧データ: version 1 の known は answeredAt の1日後から復習候補、unknown は復習候補、回答のない語は未回答', () => {
  const understanding = parseUnderstanding({
    version: 1,
    words: {
      oldKnown: { status: 'known', answeredAt: iso(t0 - 2 * dayMilliseconds) },
      recentKnown: { status: 'known', answeredAt: iso(t0 - hour) },
      oldUnknown: { status: 'unknown', answeredAt: iso(t0 - hour) },
    },
  })
  const { shown } = simulateExpedition({
    wordIds: ['plain', 'recentKnown', 'oldUnknown', 'oldKnown'],
    understanding,
    now: t0,
    seed: 1,
  })
  assert.deepEqual(
    shown.map((encounter) => encounter.wordId),
    ['oldKnown', 'oldUnknown', 'plain'],
  )
})
