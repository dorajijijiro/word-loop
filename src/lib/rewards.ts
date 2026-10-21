// 遠征の報酬（XP / Gold）の計算。値はすべて暫定。
// 将来「初回の未知語」「数時間後・翌日・1週間後の再認識」「日本語なしで認識」などで XP を変える場合は、
// EncounterRewardInput に判定材料を足し、calculateEncounterXp の中だけを変更する。
import type { Encounter } from './encounterEngine.ts'

// recall は元の bucket（new / growth）とは別の種別として数える。
export type EncounterRewardKind = 'familiar' | 'new' | 'growth' | 'reencounter' | 'recall'

export const encounterXpTable: Record<EncounterRewardKind, number> = {
  familiar: 1,
  // new は暫定的に growth と同じ。報酬バランスは後で調整する。
  new: 5,
  growth: 5,
  reencounter: 10,
  // 正誤判定はしないので「思い出せた報酬」ではなく「Recall Encounter を経験した報酬」。
  recall: 10,
}

export const returnBaseGold = 100
// new / growth（learning 枠）の Encounter 1回あたりの Gold。
export const learningEncounterGold = 2
export const reencounterGold = 5
// Recall は再遭遇と同じく「学習中の語への特別な接触」として扱う。
export const recallGold = 5

export type EncounterRewardInput = {
  kind: EncounterRewardKind
}

export type ExpeditionResultCounts = {
  familiarCount: number
  newCount: number
  growthCount: number
  reencounterCount: number
  // Milestone C 以前の集計には存在しないため省略可能（0 扱い）。
  recallCount?: number
}

export type ExpeditionRewards = {
  xp: number
  gold: number
}

export function getEncounterRewardKind(
  encounter: Pick<Encounter, 'source' | 'bucket'>,
): EncounterRewardKind {
  if (encounter.source === 'reencounter' || encounter.source === 'recall') {
    return encounter.source
  }
  return encounter.bucket
}

// 1 Encounter 分の XP。同じ Encounter を二重に数えないことは呼び出し側（expedition）が保証する。
export function calculateEncounterXp(input: EncounterRewardInput): number {
  return encounterXpTable[input.kind]
}

// 遠征を最後まで終えて帰還したときの Gold。途中で終えた遠征（未完了）には与えない。
export function calculateReturnGold(counts: ExpeditionResultCounts, completed: boolean): number {
  if (!completed) {
    return 0
  }

  return (
    returnBaseGold +
    (counts.newCount + counts.growthCount) * learningEncounterGold +
    counts.reencounterCount * reencounterGold +
    (counts.recallCount ?? 0) * recallGold
  )
}
