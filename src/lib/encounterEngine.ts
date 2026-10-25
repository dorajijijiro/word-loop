// 次に表示する単語（Encounter）を決めるロジック。
// 選出の優先順位は scheduler.ts（短期予約 → 復習候補 → 未回答の語）。候補がなければ null を返し、遠征はそこで終わる。
// 短期予約は「まだわからない」と答えたときだけ入り、別の語を挟んでから再登場する（Task 016）。
import type { LearningProgressMap } from './learningProgress.ts'
import {
  getReappearSequence,
  selectNextWord,
  type ReencounterReservation,
} from './scheduler.ts'
import type { UnderstandingMap } from './understanding.ts'
import { classifyWord, type LearningBucket, type RandomSource } from './wordSelector.ts'

export type { ReencounterReservation } from './scheduler.ts'

// 「前へ」で戻れる履歴の上限。
const historyLimit = 50

// recall は Task 014 以降の遠征では発生しない（報酬・表示の型のために残している）。
export type EncounterSource = 'normal' | 'reencounter' | 'recall'

export type Encounter = {
  // 起動してからの通し番号。表示が変わるたびに1増える。
  sequence: number
  wordId: string
  source: EncounterSource
  // 表示した時点での語の分類（ラベル・XP 用。出題の判断には使わない）。
  bucket: LearningBucket
}

export type EncounterSession = {
  current: Encounter
  // current より前に表示した語（古い順）。「前へ」で戻るために使う。
  history: string[]
  // 「まだわからない」と答えた語の短期予約。dueSequence の昇順。同じ語は1件まで。
  reencounterQueue: ReencounterReservation[]
  // この遠征で表示した語。短期予約以外では同じ遠征で再選出しない。
  shownWordIds: string[]
  // 最後に通常選出・「前へ」で表示した語（再開位置の保存用）。
  lastNormalWordId: string
}

// 選出時に参照する最新の学習進捗・理解度・現在時刻と乱数関数。
export type SelectionContext = {
  progress: LearningProgressMap
  understanding: UnderstandingMap
  // 現在時刻（ミリ秒）。
  now: number
  // 語ごとのランクの順番（未回答の語を易しいランクから導入する。Task 018）。
  rankOrder?: ReadonlyMap<string, number>
  random?: RandomSource
}

export function createEncounterSession(wordIds: string[], startWordId: string): EncounterSession {
  const wordId = wordIds.includes(startWordId) ? startWordId : wordIds[0]
  return {
    current: { sequence: 0, wordId, source: 'normal', bucket: 'new' },
    history: [],
    reencounterQueue: [],
    shownWordIds: [],
    lastNormalWordId: wordId,
  }
}

export function isReencounterReserved(session: EncounterSession, wordId: string) {
  return session.reencounterQueue.some((reservation) => reservation.wordId === wordId)
}

const pushHistory = (history: string[], wordId: string) => [...history, wordId].slice(-historyLimit)

const addShown = (shownWordIds: string[], wordId: string) =>
  shownWordIds.includes(wordId) ? shownWordIds : [...shownWordIds, wordId]

// 次の語を選ぶ。候補がなければ null。
const selectEncounter = (
  session: EncounterSession,
  wordIds: string[],
  context: SelectionContext,
  previousWordId: string | null,
): Pick<EncounterSession, 'current' | 'reencounterQueue' | 'shownWordIds' | 'lastNormalWordId'> | null => {
  const sequence = session.current.sequence + 1
  const choice = selectNextWord({
    wordIds,
    understanding: context.understanding,
    progress: context.progress,
    now: context.now,
    sequence,
    previousWordId,
    shownWordIds: new Set(session.shownWordIds),
    reservations: session.reencounterQueue,
    rankOrder: context.rankOrder,
    random: context.random,
  })
  if (choice === null) {
    return null
  }

  const isReappear = choice.reason === 'reappear'
  return {
    current: {
      sequence,
      wordId: choice.wordId,
      source: isReappear ? 'reencounter' : 'normal',
      bucket: classifyWord(context.progress, choice.wordId),
    },
    reencounterQueue: isReappear
      ? session.reencounterQueue.filter((reservation) => reservation.wordId !== choice.wordId)
      : session.reencounterQueue,
    shownWordIds: addShown(session.shownWordIds, choice.wordId),
    lastNormalWordId: isReappear ? session.lastNormalWordId : choice.wordId,
  }
}

// 自動周回・「次へ」で呼ぶ。今すぐ出せる候補がなければ null（遠征を終える）。
// まだ時期が来ていない短期予約だけが残っていても、同じ語や期日前の語で埋めない。
export function advanceEncounter(
  session: EncounterSession,
  wordIds: string[],
  context: SelectionContext,
): EncounterSession | null {
  const selected = selectEncounter(session, wordIds, context, session.current.wordId)
  if (selected === null) {
    return null
  }
  return { ...session, ...selected, history: pushHistory(session.history, session.current.wordId) }
}

// 「前へ」で呼ぶ。直前に表示した語をもう一度表示する（新しい Encounter として数える）。
// 「前へ」では予約語を差し込まない（予約は次の前進時に出る）。戻れる履歴がなければ何もしない。
export function retreatEncounter(
  session: EncounterSession,
  context: Pick<SelectionContext, 'progress'>,
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

// 「まだわからない」と答えた語を、回答した Encounter から別の語を挟んだ後に再登場させる。
// 同じ語の予約は1件まで（すでにあれば何もしない）。
export function reserveReencounter(
  session: EncounterSession,
  wordId: string,
  answeredSequence: number,
): EncounterSession {
  if (isReencounterReserved(session, wordId)) {
    return session
  }

  const reservation = { wordId, dueSequence: getReappearSequence(answeredSequence) }
  return {
    ...session,
    reencounterQueue: [...session.reencounterQueue, reservation].sort(
      (left, right) => left.dueSequence - right.dueSequence,
    ),
  }
}

// 再登場前に「わかる」へ訂正されたときに呼ぶ。予約がなければ何もしない。
export function cancelReencounter(session: EncounterSession, wordId: string): EncounterSession {
  if (!isReencounterReserved(session, wordId)) {
    return session
  }
  return {
    ...session,
    reencounterQueue: session.reencounterQueue.filter((reservation) => reservation.wordId !== wordId),
  }
}

// 遠征開始時に呼ぶ。履歴・短期予約・表示済みの語をリセットし、最初の語を選ぶ。
// 候補が0件なら null（空の遠征は作らない）。
// 前の遠征の最後の語とはなるべく連続しないようにする（ほかに候補がなければその語でもよい）。
export function startEncounter(
  session: EncounterSession,
  wordIds: string[],
  context: SelectionContext,
): EncounterSession | null {
  const resetSession: EncounterSession = { ...session, history: [], reencounterQueue: [], shownWordIds: [] }
  const first =
    selectEncounter(resetSession, wordIds, context, session.current.sequence === 0 ? null : session.current.wordId) ??
    selectEncounter(resetSession, wordIds, context, null)
  return first === null ? null : { ...resetSession, ...first }
}

// 遠征終了時に呼ぶ。未消化の短期予約は次の遠征へ持ち越さない（unknown の語は次の遠征の復習候補になる）。
export function clearReencounterQueue(session: EncounterSession): EncounterSession {
  return { ...session, reencounterQueue: [] }
}
