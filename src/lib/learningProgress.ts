const storageKey = 'word-loop.learning-progress'
// version 1: encounterCount / lastEncounteredAt / attentionCount
// version 2: lastAttentionAt / attentionDebt を追加（version 1 のデータはそのまま読み込める）
const storageVersion = 2

export type WordLearningProgress = {
  wordId: string
  encounterCount: number
  lastEncounteredAt: string | null
  // これまでに Attention（カードタップ）した回数。履歴として残し、分類には使わない。
  attentionCount: number
  // 最後に Attention した日時。将来の時間経過による再認識判定のために保存する（現在の分類では未使用）。
  lastAttentionAt: string | null
  // この語をあと何回程度「注意対象（growth）」として扱いたいか。
  // Attention で増え、Attention されずに再遭遇するたびに減る。
  attentionDebt: number
}

// Attention 1回で増やす attentionDebt と、その上限（暫定値）。
export const attentionDebtIncrement = 2
export const attentionDebtMax = 3

export function increaseAttentionDebt(debt: number): number {
  return Math.min(attentionDebtMax, debt + attentionDebtIncrement)
}

// Attention されずに Encounter した1回分の回復。0 未満にはしない。
export function decreaseAttentionDebt(debt: number): number {
  return Math.max(0, debt - 1)
}

// wordId ごとの学習進捗。単語データ本体とは別に管理する。
export type LearningProgressMap = Record<string, WordLearningProgress>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))

export function createWordProgress(wordId: string): WordLearningProgress {
  return {
    wordId,
    encounterCount: 0,
    lastEncounteredAt: null,
    attentionCount: 0,
    lastAttentionAt: null,
    attentionDebt: 0,
  }
}

export function getWordProgress(progress: LearningProgressMap, wordId: string) {
  return progress[wordId] ?? createWordProgress(wordId)
}

// 単語を表示したときに呼ぶ。表示の時点で attentionDebt を1減らす。
// 同じ表示中にあとから Attention されれば recordAttention で増えるので、
// 「再遭遇してタップされなかった」ときだけ実質的に回復する。
export function recordEncounter(
  progress: LearningProgressMap,
  wordId: string,
  encounteredAt: string,
): LearningProgressMap {
  const current = getWordProgress(progress, wordId)

  return {
    ...progress,
    [wordId]: {
      ...current,
      encounterCount: current.encounterCount + 1,
      lastEncounteredAt: encounteredAt,
      attentionDebt: decreaseAttentionDebt(current.attentionDebt),
    },
  }
}

// カードタップ（Attention）で呼ぶ。同じ Encounter の連打は呼び出し側で1回にまとめる（encounterEngine.registerAttention）。
export function recordAttention(
  progress: LearningProgressMap,
  wordId: string,
  attendedAt: string,
): LearningProgressMap {
  const current = getWordProgress(progress, wordId)

  return {
    ...progress,
    [wordId]: {
      ...current,
      attentionCount: current.attentionCount + 1,
      lastAttentionAt: attendedAt,
      attentionDebt: increaseAttentionDebt(current.attentionDebt),
    },
  }
}

// version 1 のデータには lastAttentionAt / attentionDebt がないため、null / 0 として読み込む。
export const parseWordProgress = (wordId: string, value: unknown): WordLearningProgress | null => {
  if (!isRecord(value)) {
    return null
  }

  return {
    wordId,
    encounterCount: isCount(value.encounterCount) ? value.encounterCount : 0,
    lastEncounteredAt: isDateString(value.lastEncounteredAt) ? value.lastEncounteredAt : null,
    attentionCount: isCount(value.attentionCount) ? value.attentionCount : 0,
    lastAttentionAt: isDateString(value.lastAttentionAt) ? value.lastAttentionAt : null,
    attentionDebt: isCount(value.attentionDebt) ? Math.min(attentionDebtMax, value.attentionDebt) : 0,
  }
}

export function loadLearningProgress(): LearningProgressMap {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey)
    if (storedValue === null) {
      return {}
    }

    const parsedValue: unknown = JSON.parse(storedValue)
    if (!isRecord(parsedValue) || !isRecord(parsedValue.words)) {
      return {}
    }

    const progress: LearningProgressMap = {}
    for (const [wordId, value] of Object.entries(parsedValue.words)) {
      const wordProgress = parseWordProgress(wordId, value)
      if (wordProgress !== null) {
        progress[wordId] = wordProgress
      }
    }

    return progress
  } catch {
    return {}
  }
}

export function saveLearningProgress(progress: LearningProgressMap) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ version: storageVersion, words: progress }),
    )
  } catch {
    // 保存できないブラウザ設定でも、学習画面の操作は継続する。
  }
}
