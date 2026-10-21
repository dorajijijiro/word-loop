// 遠征の報酬（XP / Gold）の計算。値はすべて暫定。
// 将来「初回の未知語」「数時間後・翌日・1週間後の再認識」「日本語なしで認識」などで XP を変える場合は、
// EncounterRewardInput に判定材料を足し、calculateEncounterXp の中だけを変更する。
import type { Encounter } from './encounterEngine.ts'

export type EncounterRewardKind = 'familiar' | 'growth' | 'reencounter'

export const encounterXpTable: Record<EncounterRewardKind, number> = {
  familiar: 1,
  growth: 5,
  reencounter: 10,
}

export const returnBaseGold = 100
export const growthEncounterGold = 2
export const reencounterGold = 5

export type EncounterRewardInput = {
  kind: EncounterRewardKind
}

export type ExpeditionResultCounts = {
  familiarCount: number
  growthCount: number
  reencounterCount: number
}

export type ExpeditionRewards = {
  xp: number
  gold: number
}

export function getEncounterRewardKind(
  encounter: Pick<Encounter, 'source' | 'bucket'>,
): EncounterRewardKind {
  return encounter.source === 'reencounter' ? 'reencounter' : encounter.bucket
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
    counts.growthCount * growthEncounterGold +
    counts.reencounterCount * reencounterGold
  )
}
