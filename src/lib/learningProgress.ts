const storageKey = 'word-loop.learning-progress'
const storageVersion = 1

export type WordLearningProgress = {
  wordId: string
  encounterCount: number
  lastEncounteredAt: string | null
  attentionCount: number
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
  }
}

export function getWordProgress(progress: LearningProgressMap, wordId: string) {
  return progress[wordId] ?? createWordProgress(wordId)
}

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
    },
  }
}

export function recordAttention(progress: LearningProgressMap, wordId: string): LearningProgressMap {
  const current = getWordProgress(progress, wordId)

  return {
    ...progress,
    [wordId]: {
      ...current,
      attentionCount: current.attentionCount + 1,
    },
  }
}

const parseWordProgress = (wordId: string, value: unknown): WordLearningProgress | null => {
  if (!isRecord(value)) {
    return null
  }

  return {
    wordId,
    encounterCount: isCount(value.encounterCount) ? value.encounterCount : 0,
    lastEncounteredAt: isDateString(value.lastEncounteredAt) ? value.lastEncounteredAt : null,
    attentionCount: isCount(value.attentionCount) ? value.attentionCount : 0,
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
