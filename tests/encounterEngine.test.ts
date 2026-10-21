import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  advanceEncounter,
  createEncounterSession,
  reencounterDelay,
  registerAttention,
  reserveReencounter,
  retreatEncounter,
  startEncounter,
  type EncounterSession,
} from '../src/lib/encounterEngine.ts'
import type { LearningProgressMap } from '../src/lib/learningProgress.ts'
import { seededRandom, wordProgress } from './helpers.ts'

const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
const familiarProgress: LearningProgressMap = Object.fromEntries(
  wordIds.map((wordId) => [wordId, wordProgress(wordId, { encounterCount: 5 })]),
)

test('再遭遇優先: 期限が来た予約は 9:1 選出より先に出る', () => {
  const context = { progress: familiarProgress, random: seededRandom(11) }
  let session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)
  const tappedWordId = session.current.wordId
  const tappedSequence = session.current.sequence
  session = reserveReencounter(session, tappedWordId)

  const shown: EncounterSession['current'][] = []
  for (let index = 0; index < reencounterDelay; index += 1) {
    session = advanceEncounter(session, wordIds, context)
    shown.push(session.current)
  }

  const last = shown.at(-1)
  assert.equal(last?.sequence, tappedSequence + reencounterDelay)
  assert.equal(last?.wordId, tappedWordId)
  assert.equal(last?.source, 'reencounter')
  assert.equal(session.reencounterQueue.length, 0)
  // 再遭遇は 9:1 比率の計算に含めない
  assert.equal(session.plannedCounts.familiar + session.plannedCounts.learning, reencounterDelay)
})

test('再遭遇語が表示中の語と同じなら1つ後ろへずらして連続を避ける', () => {
  const context = { progress: familiarProgress, random: seededRandom(5) }
  let session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)
  session = {
    ...session,
    reencounterQueue: [{ wordId: session.current.wordId, dueSequence: session.current.sequence + 1 }],
  }
  const currentWordId = session.current.wordId

  session = advanceEncounter(session, wordIds, context)
  assert.notEqual(session.current.wordId, currentWordId)
  assert.equal(session.current.source, 'normal')
  assert.equal(session.reencounterQueue.length, 1)

  session = advanceEncounter(session, wordIds, context)
  assert.equal(session.current.wordId, currentWordId)
  assert.equal(session.current.source, 'reencounter')
})

test('連続表示しない: 通常選出・再遭遇・遠征開始を通して同じ語が続かない', () => {
  const context = { progress: familiarProgress, random: seededRandom(99) }
  let session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)
  assert.notEqual(session.current.wordId, 'w0')

  for (let index = 0; index < 300; index += 1) {
    const previous = session.current.wordId
    if (index % 7 === 0) {
      session = reserveReencounter(session, previous)
    }
    session = advanceEncounter(session, wordIds, context)
    assert.notEqual(session.current.wordId, previous)
  }
})

test('前へ: 直前の語に戻り、履歴がなければ何もしない', () => {
  const context = { progress: familiarProgress, random: seededRandom(1) }
  const started = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)
  assert.equal(retreatEncounter(started, context), started)

  const advanced = advanceEncounter(started, wordIds, context)
  const retreated = retreatEncounter(advanced, context)
  assert.equal(retreated.current.wordId, started.current.wordId)
  assert.equal(retreated.current.sequence, advanced.current.sequence + 1)
})

test('遠征開始で再遭遇予約・比率・履歴をリセットする', () => {
  const context = { progress: familiarProgress, random: seededRandom(2) }
  let session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)
  session = reserveReencounter(session, session.current.wordId)
  session = advanceEncounter(session, wordIds, context)

  const restarted = startEncounter(session, wordIds, context)
  assert.deepEqual(restarted.reencounterQueue, [])
  assert.deepEqual(restarted.history, [])
  assert.equal(restarted.plannedCounts.familiar + restarted.plannedCounts.learning, 1)
})

test('Attention: 同じ Encounter の連打は1回として数え、次の Encounter では再び数える', () => {
  const context = { progress: familiarProgress, random: seededRandom(4) }
  let session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, context)

  const first = registerAttention(session)
  const second = registerAttention(first.session)
  assert.equal(first.isFirstAttention, true)
  assert.equal(second.isFirstAttention, false)
  assert.equal(second.session.reencounterQueue.length, 1)

  session = advanceEncounter(second.session, wordIds, context)
  assert.equal(registerAttention(session).isFirstAttention, true)
})

test('再遭遇の表示 bucket は最新の progress で判定する', () => {
  const tapped = 'w3'
  let session = startEncounter(createEncounterSession(wordIds, 'w0'), wordIds, {
    progress: familiarProgress,
    random: seededRandom(6),
  })
  session = { ...session, reencounterQueue: [{ wordId: tapped, dueSequence: session.current.sequence + 1 }] }
  if (session.current.wordId === tapped) {
    session = { ...session, current: { ...session.current, wordId: 'w4' } }
  }

  const progress = { ...familiarProgress, [tapped]: wordProgress(tapped, { encounterCount: 5, attentionDebt: 1 }) }
  const next = advanceEncounter(session, wordIds, { progress, random: seededRandom(6) })
  assert.equal(next.current.source, 'reencounter')
  assert.equal(next.current.bucket, 'growth')
})
