// 次に表示する単語（Encounter）を決めるロジック。
// 優先順位は「期限が来た再遭遇語」→「9:1 通常選出（wordSelector）」。
// 再遭遇は 9:1 比率の外側として扱い、比率の計算には含めない。
import type { LearningProgressMap } from './learningProgress.ts'
import {
  addBucketCount,
  classifyWord,
  createBucketCounts,
  selectNormalWord,
  type BucketCounts,
  type LearningBucket,
  type RandomSource,
} from './wordSelector.ts'

// タップした単語を何Encounter後に再登場させるか（MVPでは固定値）。
export const reencounterDelay = 5

// 「前へ」で戻れる履歴の上限。
const historyLimit = 50

export type EncounterSource = 'normal' | 'reencounter'

export type Encounter = {
  // 起動してからの通し番号。表示が変わるたびに1増える。
  sequence: number
  wordId: string
  source: EncounterSource
  // 表示した時点での語の分類。
  bucket: LearningBucket
}

export type ReencounterReservation = {
  wordId: string
  dueSequence: number
}

export type EncounterSession = {
  current: Encounter
  // current より前に表示した語（古い順）。「前へ」で戻るために使う。
  history: string[]
  // 予約順に並ぶ。dueSequence も予約順に単調増加する。
  reencounterQueue: ReencounterReservation[]
  // この遠征の通常選出で狙った bucket の回数（9:1 の比率計算用）。
  plannedCounts: BucketCounts
  // 最後に通常選出・「前へ」で表示した語（再開位置の保存用）。
  lastNormalWordId: string
}

// 選出時に参照する最新の学習進捗と乱数関数。
export type SelectionContext = {
  progress: LearningProgressMap
  random?: RandomSource
}

export function createEncounterSession(wordIds: string[], startWordId: string): EncounterSession {
  const wordId = wordIds.includes(startWordId) ? startWordId : wordIds[0]
  return {
    current: { sequence: 0, wordId, source: 'normal', bucket: 'growth' },
    history: [],
    reencounterQueue: [],
    plannedCounts: createBucketCounts(),
    lastNormalWordId: wordId,
  }
}

export function isReencounterReserved(session: EncounterSession, wordId: string) {
  return session.reencounterQueue.some((reservation) => reservation.wordId === wordId)
}

const pushHistory = (history: string[], wordId: string) => [...history, wordId].slice(-historyLimit)

const selectNormalEncounter = (
  session: EncounterSession,
  wordIds: string[],
  context: SelectionContext,
): Pick<EncounterSession, 'current' | 'plannedCounts' | 'lastNormalWordId'> => {
  const selection = selectNormalWord({
    wordIds,
    progress: context.progress,
    plannedCounts: session.plannedCounts,
    previousWordId: session.current.wordId,
    random: context.random,
  })

  return {
    current: {
      sequence: session.current.sequence + 1,
      wordId: selection.wordId,
      source: 'normal',
      bucket: selection.bucket,
    },
    plannedCounts: addBucketCount(session.plannedCounts, selection.plannedBucket),
    lastNormalWordId: selection.wordId,
  }
}

// 自動周回・「次へ」で呼ぶ。期限が来た再遭遇予約があれば最優先で出し、なければ 9:1 で選ぶ。
export function advanceEncounter(
  session: EncounterSession,
  wordIds: string[],
  context: SelectionContext,
): EncounterSession {
  const sequence = session.current.sequence + 1
  const history = pushHistory(session.history, session.current.wordId)
  const [dueReservation, ...restQueue] = session.reencounterQueue

  // 予約語がちょうど表示中の語なら連続表示になるため、1 Encounter だけ後ろへずらす。
  if (
    dueReservation !== undefined &&
    dueReservation.dueSequence <= sequence &&
    dueReservation.wordId !== session.current.wordId
  ) {
    return {
      ...session,
      current: {
        sequence,
        wordId: dueReservation.wordId,
        source: 'reencounter',
        bucket: classifyWord(context.progress, dueReservation.wordId),
      },
      history,
      reencounterQueue: restQueue,
    }
  }

  return {
    ...session,
    ...selectNormalEncounter(session, wordIds, context),
    history,
  }
}

// 「前へ」で呼ぶ。直前に表示した語をもう一度表示する（新しい Encounter として数える）。
// 「前へ」では再遭遇語を差し込まない（予約は次の前進時に出る）。戻れる履歴がなければ何もしない。
export function retreatEncounter(
  session: EncounterSession,
  context: SelectionContext,
): EncounterSession {
  const wordId = session.history.at(-1)
  if (wordId === undefined) {
    return session
  }

  return {
    ...session,
    current: {
      sequence: session.current.sequence + 1,
      wordId,
      source: 'normal',
      bucket: classifyWord(context.progress, wordId),
    },
    history: session.history.slice(0, -1),
    lastNormalWordId: wordId,
  }
}

// 表示中の単語を再遭遇対象にする。同じ wordId の予約は1件まで。
export function reserveReencounter(session: EncounterSession, wordId: string): EncounterSession {
  if (isReencounterReserved(session, wordId)) {
    return session
  }

  return {
    ...session,
    reencounterQueue: [
      ...session.reencounterQueue,
      { wordId, dueSequence: session.current.sequence + reencounterDelay },
    ],
  }
}

// 遠征開始時に呼ぶ。履歴・比率・再遭遇予約をリセットし、最初の語を 9:1 で選ぶ。
// 前の遠征の最後の語（session.current）とは連続しないようにする。
export function startEncounter(
  session: EncounterSession,
  wordIds: string[],
  context: SelectionContext,
): EncounterSession {
  const resetSession: EncounterSession = {
    ...session,
    history: [],
    reencounterQueue: [],
    plannedCounts: createBucketCounts(),
  }

  return { ...resetSession, ...selectNormalEncounter(resetSession, wordIds, context) }
}

// 遠征終了時に呼ぶ。未消化の再遭遇予約を破棄する。
export function clearReencounterQueue(session: EncounterSession): EncounterSession {
  return { ...session, reencounterQueue: [] }
}
