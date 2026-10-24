import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  advanceEncounter,
  cancelReencounter,
  createEncounterSession,
  isReencounterReserved,
  reserveReencounter,
  retreatEncounter,
  startEncounter,
  type EncounterSession,
  type SelectionContext,
} from '../src/lib/encounterEngine.ts'
import type { LearningProgressMap } from '../src/lib/learningProgress.ts'
import { shortTermReappearGap } from '../src/lib/scheduler.ts'
import { seededRandom, wordProgress } from './helpers.ts'

const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
const familiarProgress: LearningProgressMap = Object.fromEntries(
  wordIds.map((wordId) => [wordId, wordProgress(wordId, { encounterCount: 5 })]),
)
const now = Date.parse('2026-10-24T00:00:00.000Z')
const contextOf = (seed: number, progress = familiarProgress): SelectionContext => ({
  progress,
  understanding: {},
  now,
  random: seededRandom(seed),
})

const start = (context: SelectionContext): EncounterSession => {
  const session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)
  assert.ok(session !== null)
  return session
}

const advance = (session: EncounterSession, context: SelectionContext): EncounterSession => {
  const next = advanceEncounter(session, wordIds, context)
  assert.ok(next !== null)
  return next
}

test('短期予約: 回答した Encounter から別の5語を挟んだ後に、予約語が again として出る', () => {
  const context = contextOf(11)
  let session = start(context)
  const answered = session.current
  session = reserveReencounter(session, answered.wordId, answered.sequence)

  const shown: EncounterSession['current'][] = []
  for (let index = 0; index <= shortTermReappearGap; index += 1) {
    session = advance(session, context)
    shown.push(session.current)
  }

  assert.ok(shown.slice(0, shortTermReappearGap).every((encounter) => encounter.wordId !== answered.wordId))
  const last = shown.at(-1)
  assert.equal(last?.sequence, answered.sequence + shortTermReappearGap + 1)
  assert.equal(last?.wordId, answered.wordId)
  assert.equal(last?.source, 'reencounter')
  assert.equal(session.reencounterQueue.length, 0)
})

test('短期予約: 同じ語は重複させず、時期の早い順に並び、取り消せる', () => {
  let session = start(contextOf(3))
  session = reserveReencounter(session, 'w5', 10)
  assert.equal(reserveReencounter(session, 'w5', 12), session)
  session = reserveReencounter(session, 'w6', 8)
  assert.deepEqual(
    session.reencounterQueue.map((reservation) => reservation.wordId),
    ['w6', 'w5'],
  )
  session = cancelReencounter(session, 'w5')
  assert.equal(isReencounterReserved(session, 'w5'), false)
  assert.equal(cancelReencounter(session, 'w5'), session)
})

test('予約語が表示中の語と同じなら1つ後ろへずらして連続を避ける', () => {
  const context = contextOf(5)
  let session = start(context)
  session = {
    ...session,
    reencounterQueue: [{ wordId: session.current.wordId, dueSequence: session.current.sequence + 1 }],
  }
  const currentWordId = session.current.wordId

  session = advance(session, context)
  assert.notEqual(session.current.wordId, currentWordId)
  assert.equal(session.current.source, 'normal')
  assert.equal(session.reencounterQueue.length, 1)

  session = advance(session, context)
  assert.equal(session.current.wordId, currentWordId)
  assert.equal(session.current.source, 'reencounter')
})

test('連続表示しない: 遠征開始・通常選出・再登場を通して同じ語が続かない', () => {
  const context = contextOf(99)
  const previous = { ...createEncounterSession(wordIds, 'w0'), current: { sequence: 7, wordId: 'w3', source: 'normal' as const, bucket: 'familiar' as const } }
  let session = startEncounter(previous, wordIds, context)
  assert.ok(session !== null)
  assert.notEqual(session.current.wordId, 'w3')

  for (let index = 0; index < 19; index += 1) {
    const current = session.current
    if (index % 3 === 0) {
      session = reserveReencounter(session, current.wordId, current.sequence)
    }
    const next = advanceEncounter(session, wordIds, context)
    if (next === null) break
    assert.notEqual(next.current.wordId, current.wordId)
    session = next
  }
})

test('前へ: 直前の語に戻り、履歴がなければ何もしない', () => {
  const context = contextOf(1)
  const started = start(context)
  assert.equal(retreatEncounter(started, context), started)

  const advanced = advance(started, context)
  const retreated = retreatEncounter(advanced, context)
  assert.equal(retreated.current.wordId, started.current.wordId)
  assert.equal(retreated.current.sequence, advanced.current.sequence + 1)
})

test('遠征開始で短期予約・表示済みの語・履歴をリセットする', () => {
  const context = contextOf(2)
  let session = start(context)
  session = reserveReencounter(session, session.current.wordId, session.current.sequence)
  session = advance(session, context)

  const restarted = startEncounter(session, wordIds, context)
  assert.ok(restarted !== null)
  assert.deepEqual(restarted.reencounterQueue, [])
  assert.deepEqual(restarted.history, [])
  assert.deepEqual(restarted.shownWordIds, [restarted.current.wordId])
})

test('再登場の表示 bucket は最新の progress で判定する（表示用。出題の判断には使わない）', () => {
  const tapped = 'w3'
  let session = start(contextOf(6))
  session = { ...session, reencounterQueue: [{ wordId: tapped, dueSequence: session.current.sequence + 1 }] }
  if (session.current.wordId === tapped) {
    session = { ...session, current: { ...session.current, wordId: 'w4' } }
  }

  const progress = { ...familiarProgress, [tapped]: wordProgress(tapped, { encounterCount: 5, attentionDebt: 1 }) }
  const next = advance(session, contextOf(6, progress))
  assert.equal(next.current.source, 'reencounter')
  assert.equal(next.current.bucket, 'growth')
})
