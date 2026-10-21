import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  advanceEncounter,
  createEncounterSession,
  reencounterDelay,
  reserveReencounter,
  retreatEncounter,
  startEncounter,
  type EncounterSession,
} from '../src/lib/encounterEngine.ts'
import type { LearningProgressMap } from '../src/lib/learningProgress.ts'
import { seededRandom } from './helpers.ts'

const wordIds = Array.from({ length: 20 }, (_, index) => `w${index}`)
const familiarProgress: LearningProgressMap = Object.fromEntries(
  wordIds.map((wordId) => [wordId, { wordId, encounterCount: 5, attentionCount: 0, lastEncounteredAt: null }]),
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
  assert.equal(session.plannedCounts.familiar + session.plannedCounts.growth, reencounterDelay)
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
  assert.equal(restarted.plannedCounts.familiar + restarted.plannedCounts.growth, 1)
})
