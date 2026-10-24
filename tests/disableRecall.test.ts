// Task 014: 遠征で Recall を選出・実行しないことの確認。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  advanceEncounter,
  createEncounterSession,
  registerAttention,
  startEncounter,
  type Encounter,
  type SelectionContext,
} from '../src/lib/encounterEngine.ts'
import { recordAttention, recordEncounter, type LearningProgressMap } from '../src/lib/learningProgress.ts'
import {
  expeditionEncounterLimit,
  getCompletionDelayMilliseconds,
  hasReachedExpeditionLimit,
  isExpeditionRunning,
  recordExpeditionEncounter,
  startExpedition,
} from '../src/lib/expedition.ts'
import { recallEnabledInExpedition } from '../src/lib/recall.ts'
import { words } from '../src/data/words.ts'
import { seededRandom, wordProgress } from './helpers.ts'

const wordIds = words.map((word) => word.id)
const recallWordIds = words.filter((word) => word.recallCue !== undefined).map((word) => word.id)

// Recall 候補（growth / 見たことのある new）が十分にある進捗。Recall が有効なら必ず Recall が出る状態。
const progressWithRecallCandidates: LearningProgressMap = Object.fromEntries(
  wordIds.map((wordId, index) => [
    wordId,
    wordProgress(wordId, {
      encounterCount: index % 4 === 0 ? 1 : 5,
      attentionDebt: index % 5 === 0 ? 2 : 0,
    }),
  ]),
)

// App と同じ context（recallEnabled は recallEnabledInExpedition）・同じ順序で1遠征を進める。
// tapAt の Encounter 目では Attention（タップ）する。
const runAppExpedition = (seed: number, tapAt: number[] = []) => {
  const random = seededRandom(seed)
  let progress = progressWithRecallCandidates
  const context = (): SelectionContext => ({
    progress,
    random,
    recallWordIds,
    recallEnabled: recallEnabledInExpedition,
  })
  let session = startEncounter(createEncounterSession(wordIds, wordIds[0]), wordIds, context())
  let expedition = startExpedition()
  const shown: Encounter[] = []
  const tapped: { wordId: string; sequence: number }[] = []

  for (let index = 0; index < 300 && isExpeditionRunning(expedition); index += 1) {
    if (index > 0) {
      session = advanceEncounter(session, wordIds, context())
    }
    expedition = recordExpeditionEncounter(expedition, session.current)
    shown.push(session.current)
    progress = recordEncounter(progress, session.current.wordId, '2026-10-24T08:00:00.000Z')
    if (tapAt.includes(expedition.encounterCount)) {
      const result = registerAttention(session)
      session = result.session
      progress = recordAttention(progress, session.current.wordId, '2026-10-24T08:00:00.000Z')
      tapped.push({ wordId: session.current.wordId, sequence: session.current.sequence })
    }
  }

  return { expedition, shown, session, tapped }
}

test('Recall 無効化: 遠征では Recall を有効にしない設定になっている', () => {
  assert.equal(recallEnabledInExpedition, false)
})

test('Recall 無効化: 遠征開始時に Recall を予定しない', () => {
  const session = startEncounter(createEncounterSession(wordIds, wordIds[0]), wordIds, {
    progress: progressWithRecallCandidates,
    random: seededRandom(1),
    recallWordIds,
    recallEnabled: false,
  })
  assert.deepEqual(session.recallSchedule, [])
})

test('Recall 無効化: Recall 候補があっても遠征中に Recall が1回も出ず、105 Encounter で完了する', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { expedition, shown } = runAppExpedition(seed)
    assert.equal(
      shown.some((encounter) => encounter.source === 'recall'),
      false,
      `seed ${seed}`,
    )
    assert.equal(expedition.recallCount, 0)
    assert.equal(expedition.encounterCount, expeditionEncounterLimit)
    assert.equal(shown.length, expeditionEncounterLimit)
    assert.equal(hasReachedExpeditionLimit(expedition), true)
    // 最後の語は通常どおり設定速度ぶん見せてから完了する（Recall の待ちは発生しない）。
    assert.equal(getCompletionDelayMilliseconds(shown[shown.length - 1], 1000), 1000)
  }
})

test('Recall 無効化: Attention した語は again として約5 Encounter 後に再登場する', () => {
  const { shown, tapped, expedition } = runAppExpedition(3, [10, 40, 80])
  assert.equal(tapped.length, 3)
  for (const tap of tapped) {
    const again = shown.find(
      (encounter) =>
        encounter.source === 'reencounter' && encounter.wordId === tap.wordId && encounter.sequence > tap.sequence,
    )
    assert.ok(again !== undefined, tap.wordId)
    const distance = again.sequence - tap.sequence
    assert.ok(distance >= 5 && distance <= 7, `${tap.wordId}: ${distance}`)
  }
  assert.equal(expedition.reencounterCount, 3)
  assert.equal(expedition.encounterCount, expeditionEncounterLimit)
})

test('Recall 無効化: Recall を有効にした場合は従来どおり Recall が出る（エンジン側の機能は残っている）', () => {
  const random = seededRandom(1)
  const context = { progress: progressWithRecallCandidates, random, recallWordIds, recallEnabled: true }
  let session = startEncounter(createEncounterSession(wordIds, wordIds[0]), wordIds, context)
  assert.ok(session.recallSchedule.length > 0)
  let recallCount = 0
  for (let index = 1; index < expeditionEncounterLimit; index += 1) {
    session = advanceEncounter(session, wordIds, context)
    if (session.current.source === 'recall') recallCount += 1
  }
  assert.ok(recallCount > 0)
})
