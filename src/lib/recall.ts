// Recall Encounter（能動想起）のスケジュールと対象語の選び方、Cue → Reveal の進行。
// Recall は通常 Encounter の流れにときどき混ざる短いイベントで、回答入力・正誤判定はしない。
// 日本語＋概念Cueを見せ、少し間を置いて英語を出し、そのまま次の Encounter へ戻る。
import type { LearningProgressMap } from './learningProgress.ts'
import { getWordProgress } from './learningProgress.ts'
import { classifyWord, type LearningBucket, type RandomSource } from './wordSelector.ts'

// 1遠征で発生させる Recall の最大回数。候補が足りなければ少なくなる（0回でもよい）。
export const recallMaxPerExpedition = 4

// Recall を置く区間（遠征内の何 Encounter 目か、1始まり・両端を含む）。
// 遠征全体に分散させるため、区間ごとに1回ずつランダムな位置へ置く。
// 期限の来た再遭遇が優先されるので、実際の位置は1〜2 Encounter 後ろへずれることがある。
export const recallWindows: ReadonlyArray<readonly [number, number]> = [
  [15, 30],
  [35, 55],
  [60, 80],
  [85, 100],
]

// Recall の対象になる元の bucket。familiar は対象にしない。
export type RecallSourceBucket = Exclude<LearningBucket, 'familiar'>

// 遠征内の何 Encounter 目で Recall を出すかを決める（昇順）。
export function planRecallPositions(
  random: RandomSource = Math.random,
  windows: ReadonlyArray<readonly [number, number]> = recallWindows,
): number[] {
  return windows
    .slice(0, recallMaxPerExpedition)
    .map(([from, to]) => from + Math.min(to - from, Math.floor(random() * (to - from + 1))))
}

export type RecallCandidateInput = {
  // Recall Cue を持つ語。
  wordIds: string[]
  progress: LearningProgressMap
  // この遠征で Recall 済みの語。
  recalledWordIds: string[]
  // 直前に表示した語。連続表示しない。
  previousWordId?: string
  random?: RandomSource
}

export type RecallCandidate = {
  wordId: string
  bucket: RecallSourceBucket
}

const pickRandom = (candidates: string[], random: RandomSource) =>
  candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]

// Recall する語を選ぶ。growth → new の順に、この遠征でまだ Recall していない語を優先する。
// new は一度も見ていない語を除く（見たことのない英語を思い出すことはできないため）。
// 未 Recall の候補がなければ Recall 済みの語から選び、それもなければ null（Recall しない）。
export function selectRecallWord({
  wordIds,
  progress,
  recalledWordIds,
  previousWordId,
  random = Math.random,
}: RecallCandidateInput): RecallCandidate | null {
  const growth: string[] = []
  const seenNew: string[] = []
  for (const wordId of wordIds) {
    if (wordId === previousWordId) {
      continue
    }
    const bucket = classifyWord(progress, wordId)
    if (bucket === 'growth') {
      growth.push(wordId)
    } else if (bucket === 'new' && getWordProgress(progress, wordId).encounterCount > 0) {
      seenNew.push(wordId)
    }
  }

  const notRecalled = (wordId: string) => !recalledWordIds.includes(wordId)
  const pools: Array<[string[], RecallSourceBucket]> = [
    [growth.filter(notRecalled), 'growth'],
    [seenNew.filter(notRecalled), 'new'],
    [growth, 'growth'],
    [seenNew, 'new'],
  ]

  for (const [pool, bucket] of pools) {
    if (pool.length > 0) {
      return { wordId: pickRandom(pool, random), bucket }
    }
  }
  return null
}

// ---------- Cue → Reveal → 次の Encounter ----------
// UI から切り離した小さな状態機械。App はタイマーで nextRecallStep を呼ぶだけにする。

export type RecallPhase = 'cue' | 'reveal'

export type RecallStep = {
  // 対象の Encounter の通し番号。
  sequence: number
  phase: RecallPhase
  // このフェーズを表示しておく時間。
  durationMilliseconds: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// Cue（英語を隠して思い出す時間）。0.25秒設定でも一瞬で答えを出さず、3秒設定でも待たせすぎない。
export function getRecallCueMilliseconds(intervalSeconds: number) {
  return Math.round(clamp(intervalSeconds * 2, 0.8, 1.5) * 1000)
}

// Reveal（英語を見て音を聞く時間）。
export function getRecallRevealMilliseconds(intervalSeconds: number) {
  return Math.round(clamp(intervalSeconds * 1.5, 0.6, 1.2) * 1000)
}

export function startRecallStep(sequence: number, intervalSeconds: number): RecallStep {
  return { sequence, phase: 'cue', durationMilliseconds: getRecallCueMilliseconds(intervalSeconds) }
}

// cue → reveal → null（Recall 終了。呼び出し側が次の Encounter へ進める）。
export function nextRecallStep(step: RecallStep, intervalSeconds: number): RecallStep | null {
  if (step.phase === 'cue') {
    return {
      sequence: step.sequence,
      phase: 'reveal',
      durationMilliseconds: getRecallRevealMilliseconds(intervalSeconds),
    }
  }
  return null
}
