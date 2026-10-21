import { createWordProgress, type WordLearningProgress } from '../src/lib/learningProgress.ts'

// テスト用の再現可能な乱数（線形合同法）。0以上1未満を返す。
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

// テスト用の学習進捗1語分。指定しない項目は未遭遇の初期値。
export function wordProgress(
  wordId: string,
  fields: Partial<Omit<WordLearningProgress, 'wordId'>> = {},
): WordLearningProgress {
  return { ...createWordProgress(wordId), ...fields }
}
