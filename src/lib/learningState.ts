import { words } from '../data/words'

const storageKey = 'word-loop.learning-state'
const wordIds = new Set(words.map((word) => word.id))

export type LearningState = {
  currentWordId: string
  intervalSeconds: number
  speechEnabled: boolean
  showPhrase: boolean
}

const defaultLearningState: LearningState = {
  currentWordId: words[0].id,
  intervalSeconds: 1,
  speechEnabled: true,
  showPhrase: true,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function loadLearningState(): LearningState {
  if (typeof window === 'undefined') {
    return defaultLearningState
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey)
    if (storedValue === null) {
      return defaultLearningState
    }

    const parsedValue: unknown = JSON.parse(storedValue)
    if (!isRecord(parsedValue)) {
      return defaultLearningState
    }

    return {
      currentWordId:
        typeof parsedValue.currentWordId === 'string' && wordIds.has(parsedValue.currentWordId)
          ? parsedValue.currentWordId
          : defaultLearningState.currentWordId,
      intervalSeconds:
        typeof parsedValue.intervalSeconds === 'number' &&
        Number.isFinite(parsedValue.intervalSeconds) &&
        parsedValue.intervalSeconds >= 0.2 &&
        parsedValue.intervalSeconds <= 3
          ? parsedValue.intervalSeconds
          : defaultLearningState.intervalSeconds,
      speechEnabled:
        typeof parsedValue.speechEnabled === 'boolean'
          ? parsedValue.speechEnabled
          : defaultLearningState.speechEnabled,
      showPhrase:
        typeof parsedValue.showPhrase === 'boolean'
          ? parsedValue.showPhrase
          : defaultLearningState.showPhrase,
    }
  } catch {
    return defaultLearningState
  }
}

export function saveLearningState(state: LearningState) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    // 保存できないブラウザ設定でも、学習画面の操作は継続する。
  }
}
