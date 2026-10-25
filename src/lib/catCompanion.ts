// 学習画面の猫の反応と短いイベント（Task 017）。学習スケジューラー（scheduler.ts）とは独立している。
// - 理解度を回答すると、✓ でも × でも同じ小さな反応をし、同じだけ進行する（回答の内容は入力に含めない）。
// - 同じ Encounter での連打・訂正は1回分として数える（2回目以降は反応も進行もしない）。
// - catMealAnswerInterval 回の回答ごとに「餌を食べる」イベント（約 catMealDurationMilliseconds）を起こす。
//   イベントの開始間隔は catMealMinimumGapMilliseconds 以上あける。待っているイベント（保留）は最大1回分で、それ以上は貯めない。
// - 未回答で進んでも何もしない（催促・罰はない）。猫のために回答・停止を求めない。
// - 状態は遠征の中だけで持ち、保存しない。時刻は引数で受け取る。値はすべて暫定。

export const catMealAnswerInterval = 3
export const catMealDurationMilliseconds = 3000
export const catMealMinimumGapMilliseconds = 10000
export const catReactionMilliseconds = 600

export type CatState = {
  // 次の食事までに数えた回答の数（0 〜 catMealAnswerInterval − 1）。
  answerCount: number
  // 進行に数えた Encounter の通し番号（同じ Encounter の連打・訂正を数えないため）。
  countedSequences: number[]
  // 開始を待っている食事イベントがあるか（最大1回分）。
  mealPending: boolean
  // 食事中なら開始時刻。
  mealStartedAt: number | null
  lastMealStartedAt: number | null
  // 小さな反応。id は表示のやり直し用に毎回増やす。
  reaction: { id: number; startedAt: number } | null
  reactionCount: number
}

export function createCatState(): CatState {
  return {
    answerCount: 0,
    countedSequences: [],
    mealPending: false,
    mealStartedAt: null,
    lastMealStartedAt: null,
    reaction: null,
    reactionCount: 0,
  }
}

export function isCatEating(state: CatState) {
  return state.mealStartedAt !== null
}

// 時刻を進める。終わった反応・食事を片付け、開始できる保留の食事を始める。変化がなければ同じ state を返す。
export function updateCat(state: CatState, now: number): CatState {
  let next = state
  if (next.reaction !== null && now >= next.reaction.startedAt + catReactionMilliseconds) {
    next = { ...next, reaction: null }
  }
  if (next.mealStartedAt !== null && now >= next.mealStartedAt + catMealDurationMilliseconds) {
    next = { ...next, mealStartedAt: null }
  }
  if (
    next.mealPending &&
    next.mealStartedAt === null &&
    (next.lastMealStartedAt === null || now >= next.lastMealStartedAt + catMealMinimumGapMilliseconds)
  ) {
    next = { ...next, mealPending: false, mealStartedAt: now, lastMealStartedAt: now }
  }
  return next
}

// 理解度の回答（✓ / × のどちらでも同じ）を1回受け取る。sequence はその回答の Encounter の通し番号。
export function recordCatAnswer(state: CatState, sequence: number, now: number): CatState {
  if (state.countedSequences.includes(sequence)) {
    return state
  }

  const answerCount = state.answerCount + 1
  const reachedMeal = answerCount >= catMealAnswerInterval
  return updateCat(
    {
      ...state,
      answerCount: reachedMeal ? 0 : answerCount,
      countedSequences: [...state.countedSequences, sequence],
      // すでに保留があれば、それ以上は貯めない
      mealPending: state.mealPending || reachedMeal,
      reaction: { id: state.reactionCount + 1, startedAt: now },
      reactionCount: state.reactionCount + 1,
    },
    now,
  )
}

// 次に updateCat を呼ぶべき時刻。予定がなければ null。
export function getNextCatUpdateAt(state: CatState): number | null {
  const times: number[] = []
  if (state.reaction !== null) {
    times.push(state.reaction.startedAt + catReactionMilliseconds)
  }
  if (state.mealStartedAt !== null) {
    times.push(state.mealStartedAt + catMealDurationMilliseconds)
  } else if (state.mealPending) {
    times.push((state.lastMealStartedAt ?? 0) + catMealMinimumGapMilliseconds)
  }
  return times.length === 0 ? null : Math.min(...times)
}
