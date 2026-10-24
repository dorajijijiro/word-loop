// 遠征で次に出す語を、理解度の自己申告に基づいて選ぶ純粋関数（Task 016）。
// 時刻（now）と乱数（random）は引数で受け取るので、実時間を待たずに検証できる。
// 優先順位: ① 再登場の時期が来た「まだわからない」の短期予約 → ② 復習候補 → ③ 未回答の語。
// - 復習候補: 期日が来た known と、この遠征でまだ表示していない unknown。待っている期間が長い語から出す。
// - 未回答: この遠征でまだ表示していない語。過去の表示回数が少ない語から出す。
// - この遠征で一度表示した語は、短期予約（明示的な「まだわからない」）以外では再選出しない。
// - 期日前の known は出さない。候補がなければ null（遠征はそこで終わる）。
// new / growth / familiar の分類は、出題可否・順序の判断には使わない。
import { getWordProgress, type LearningProgressMap } from './learningProgress.ts'
import { getUnderstanding, type UnderstandingMap } from './understanding.ts'
import type { RandomSource } from './wordSelector.ts'

// 「まだわからない」と答えた語を、別の語を何 Encounter 挟んでから再登場させるか（暫定値）。
export const shortTermReappearGap = 5

export type ReencounterReservation = {
  wordId: string
  // この通し番号以降に出す。
  dueSequence: number
}

// 回答した Encounter の通し番号から、短期予約の再登場時期を決める。
export function getReappearSequence(answeredSequence: number) {
  return answeredSequence + shortTermReappearGap + 1
}

export type ScheduleReason = 'reappear' | 'review' | 'unanswered'

export type ScheduleChoice = {
  wordId: string
  reason: ScheduleReason
}

export type ScheduleInput = {
  wordIds: string[]
  understanding: UnderstandingMap
  progress: LearningProgressMap
  // 現在時刻（ミリ秒）。
  now: number
  // これから出す Encounter の通し番号。
  sequence: number
  // 直前に表示した語。連続表示を避ける。null なら避けない。
  previousWordId: string | null
  // この遠征で表示した語。
  shownWordIds: ReadonlySet<string>
  // 短期予約（予約順）。
  reservations: ReencounterReservation[]
  random?: RandomSource
}

// 優先度（大きいほど先）が最大の候補から1つ。同じ優先度なら偏らないようにランダムに選ぶ。
const pickHighest = (candidates: { wordId: string; priority: number }[], random: RandomSource) => {
  if (candidates.length === 0) {
    return null
  }
  const highest = Math.max(...candidates.map((candidate) => candidate.priority))
  const top = candidates.filter((candidate) => candidate.priority === highest)
  return top[Math.min(top.length - 1, Math.floor(random() * top.length))].wordId
}

// 復習候補なら、待っている期間（ミリ秒）。候補でなければ null。
// known: 期日を過ぎた長さ。unknown: 最後に「まだわからない」と答えてからの長さ。
export function getReviewWaitMilliseconds(understanding: UnderstandingMap, wordId: string, now: number) {
  const entry = getUnderstanding(understanding, wordId)
  if (entry === null) {
    return null
  }
  if (entry.status === 'unknown') {
    return now - Date.parse(entry.answeredAt)
  }
  if (entry.nextDueAt === null) {
    return null
  }
  const wait = now - Date.parse(entry.nextDueAt)
  return wait >= 0 ? wait : null
}

export function selectNextWord(input: ScheduleInput): ScheduleChoice | null {
  const random = input.random ?? Math.random
  const isAvailable = (wordId: string) => wordId !== input.previousWordId

  // ① 再登場の時期が来た短期予約（予約の古い順）。
  const due = input.reservations.find(
    (reservation) => reservation.dueSequence <= input.sequence && isAvailable(reservation.wordId),
  )
  if (due !== undefined) {
    return { wordId: due.wordId, reason: 'reappear' }
  }

  const unshown = input.wordIds.filter((wordId) => isAvailable(wordId) && !input.shownWordIds.has(wordId))

  // ② 復習候補（待っている期間が長い語から）。
  const reviews = unshown.flatMap((wordId) => {
    const wait = getReviewWaitMilliseconds(input.understanding, wordId, input.now)
    return wait === null ? [] : [{ wordId, priority: wait }]
  })
  const review = pickHighest(reviews, random)
  if (review !== null) {
    return { wordId: review, reason: 'review' }
  }

  // ③ 未回答の語（過去の表示回数が少ない語から）。
  const unanswered = unshown
    .filter((wordId) => getUnderstanding(input.understanding, wordId) === null)
    .map((wordId) => ({ wordId, priority: -getWordProgress(input.progress, wordId).encounterCount }))
  const next = pickHighest(unanswered, random)
  return next === null ? null : { wordId: next, reason: 'unanswered' }
}
