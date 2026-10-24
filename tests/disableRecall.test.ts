// Task 014: 遠征で Recall を選出・実行しないことの確認。
// Task 016 で遠征の選出を scheduler.ts に置き換えたので、新しい選出でも Recall が出ないことを確かめる。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LearningProgressMap } from '../src/lib/learningProgress.ts'
import { expeditionEncounterLimit, getCompletionDelayMilliseconds } from '../src/lib/expedition.ts'
import { recallEnabledInExpedition } from '../src/lib/recall.ts'
import { recordUnderstanding, type UnderstandingMap } from '../src/lib/understanding.ts'
import { words } from '../src/data/words.ts'
import { simulateExpedition, wordProgress } from './helpers.ts'

const wordIds = words.map((word) => word.id)

// Recall 候補（growth / 見たことのある new）が十分にある進捗。以前の選出なら Recall が出る状態。
const progressWithRecallCandidates: LearningProgressMap = Object.fromEntries(
  wordIds.map((wordId, index) => [
    wordId,
    wordProgress(wordId, {
      encounterCount: index % 4 === 0 ? 1 : 5,
      attentionDebt: index % 5 === 0 ? 2 : 0,
    }),
  ]),
)

test('Recall 無効化: 遠征では Recall を有効にしない設定になっている', () => {
  assert.equal(recallEnabledInExpedition, false)
})

test('Recall 無効化: Recall 候補があっても遠征中に Recall が1回も出ない', () => {
  const now = Date.parse('2026-10-24T00:00:00.000Z')
  let understanding: UnderstandingMap = {}
  wordIds.slice(0, 30).forEach((wordId, index) => {
    understanding = recordUnderstanding(understanding, wordId, index % 2 === 0 ? 'unknown' : 'known', '2026-10-01T00:00:00.000Z')
  })
  for (const seed of [1, 2, 3, 4]) {
    const { expedition, shown } = simulateExpedition({
      wordIds,
      progress: progressWithRecallCandidates,
      understanding,
      now,
      seed,
      answer: (_, index) => (index % 10 === 0 ? 'unknown' : null),
    })
    assert.equal(shown.some((encounter) => encounter.source === 'recall'), false, `seed ${seed}`)
    assert.equal(expedition.recallCount, 0)
    assert.equal(expedition.encounterCount, expeditionEncounterLimit)
    // 最後の語は通常どおり設定速度ぶん見せてから完了する（Recall の待ちは発生しない）。
    assert.equal(getCompletionDelayMilliseconds(shown[shown.length - 1], 1000), 1000)
  }
})
