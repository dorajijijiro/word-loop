// 遠征をまたいで累積するプレイヤーの成長（XP / Gold / 完了遠征数）。
// 単語ごとの学習進捗（learning-progress）や設定（learning-state）とは別のキーで保存する。
import type { ExpeditionRewards } from './rewards.ts'

const storageKey = 'word-loop.player-progress'
const storageVersion = 1

export type PlayerProgress = {
  totalXp: number
  gold: number
  completedExpeditions: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function createPlayerProgress(): PlayerProgress {
  return { totalXp: 0, gold: 0, completedExpeditions: 0 }
}

// 遠征1回分の報酬を確定させる。
export function applyExpeditionRewards(
  progress: PlayerProgress,
  rewards: ExpeditionRewards,
): PlayerProgress {
  return {
    totalXp: progress.totalXp + rewards.xp,
    gold: progress.gold + rewards.gold,
    completedExpeditions: progress.completedExpeditions + 1,
  }
}

// 壊れた値は項目ごとに 0 へ戻す。
export function parsePlayerProgress(value: unknown): PlayerProgress {
  if (!isRecord(value)) {
    return createPlayerProgress()
  }

  return {
    totalXp: isCount(value.totalXp) ? value.totalXp : 0,
    gold: isCount(value.gold) ? value.gold : 0,
    completedExpeditions: isCount(value.completedExpeditions) ? value.completedExpeditions : 0,
  }
}

export function loadPlayerProgress(): PlayerProgress {
  if (typeof window === 'undefined') {
    return createPlayerProgress()
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey)
    if (storedValue === null) {
      return createPlayerProgress()
    }

    const parsedValue: unknown = JSON.parse(storedValue)
    return parsePlayerProgress(isRecord(parsedValue) ? parsedValue.player : null)
  } catch {
    return createPlayerProgress()
  }
}

export function savePlayerProgress(progress: PlayerProgress) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ version: storageVersion, player: progress }),
    )
  } catch {
    // 保存できないブラウザ設定でも、遠征は継続する。
  }
}
