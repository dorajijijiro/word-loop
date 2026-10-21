// 通常 Encounter で次に出す単語を選ぶロジック。
// 単語を familiar（既知語）/ growth（未定着語）に分類し、遠征内で familiar 約9割・growth 約1割になるよう選ぶ。
// 再遭遇はこの比率の外側で扱う（encounterEngine 側で優先される）。
// 分類ルールは BucketRule として差し替えられる。将来ルールを変える場合は provisionalBucketRule を置き換える。
import { getWordProgress, type LearningProgressMap, type WordLearningProgress } from './learningProgress.ts'

export type LearningBucket = 'familiar' | 'growth'

export const learningBuckets: LearningBucket[] = ['familiar', 'growth']

export type BucketRule = (progress: WordLearningProgress) => LearningBucket

export type BucketCounts = Record<LearningBucket, number>

// 0以上1未満を返す乱数関数。テストでは固定値を返す関数を注入する。
export type RandomSource = () => number

// 通常 Encounter のうち growth にしたい割合。
export const growthTargetRatio = 0.1

// 暫定ルール: 3回以上見ていて「もう一度見る」をしていない語を familiar とする。
export const provisionalBucketRule: BucketRule = (progress) =>
  progress.encounterCount >= 3 && progress.attentionCount === 0 ? 'familiar' : 'growth'

export function createBucketCounts(): BucketCounts {
  return { familiar: 0, growth: 0 }
}

export function addBucketCount(counts: BucketCounts, bucket: LearningBucket): BucketCounts {
  return { ...counts, [bucket]: counts[bucket] + 1 }
}

export function classifyWord(
  progress: LearningProgressMap,
  wordId: string,
  rule: BucketRule = provisionalBucketRule,
): LearningBucket {
  return rule(getWordProgress(progress, wordId))
}

export function groupWordsByBucket(
  wordIds: string[],
  progress: LearningProgressMap,
  rule: BucketRule = provisionalBucketRule,
): Record<LearningBucket, string[]> {
  const groups: Record<LearningBucket, string[]> = { familiar: [], growth: [] }
  for (const wordId of wordIds) {
    groups[classifyWord(progress, wordId, rule)].push(wordId)
  }
  return groups
}

// 次の Encounter をどちらの bucket から出すかを決める。
// plannedCounts はこの遠征でこれまでに「狙った」bucket の回数（候補不足で補った回は狙った側で数える）。
// 基本は乱数で選び、目標比率から1回分以上ずれたら補正する。これで100回程度で概ね9:1に収まる。
export function chooseBucket(
  plannedCounts: BucketCounts,
  random: RandomSource,
  ratio: number = growthTargetRatio,
): LearningBucket {
  const total = plannedCounts.familiar + plannedCounts.growth
  const growthDeficit = (total + 1) * ratio - plannedCounts.growth

  if (growthDeficit >= 1) {
    return 'growth'
  }
  if (growthDeficit <= -1) {
    return 'familiar'
  }
  return random() < ratio ? 'growth' : 'familiar'
}

const pickRandom = (candidates: string[], random: RandomSource) =>
  candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]

export type NormalSelection = {
  wordId: string
  // 実際に出した語の bucket（候補不足で補った場合は狙った bucket と異なる）
  bucket: LearningBucket
  // 比率計算用に狙った bucket
  plannedBucket: LearningBucket
}

export type NormalSelectionInput = {
  wordIds: string[]
  progress: LearningProgressMap
  plannedCounts: BucketCounts
  // 直前に表示した語。可能な限り連続で出さない。
  previousWordId?: string
  random?: RandomSource
  rule?: BucketRule
  ratio?: number
}

// 9:1 の通常選出。候補が足りない場合は存在する bucket から補い、必ず1語返す（wordIds は1語以上が前提）。
export function selectNormalWord({
  wordIds,
  progress,
  plannedCounts,
  previousWordId,
  random = Math.random,
  rule = provisionalBucketRule,
  ratio = growthTargetRatio,
}: NormalSelectionInput): NormalSelection {
  const groups = groupWordsByBucket(wordIds, progress, rule)
  const plannedBucket = chooseBucket(plannedCounts, random, ratio)
  const otherBucket: LearningBucket = plannedBucket === 'familiar' ? 'growth' : 'familiar'
  const withoutPrevious = (candidates: string[]) =>
    candidates.filter((wordId) => wordId !== previousWordId)

  // 狙った bucket → もう一方の bucket の順に、直前の語以外から選ぶ。
  for (const bucket of [plannedBucket, otherBucket]) {
    const candidates = withoutPrevious(groups[bucket])
    if (candidates.length > 0) {
      return { wordId: pickRandom(candidates, random), bucket, plannedBucket }
    }
  }

  // 語が1種類しかない場合だけ、同じ語の連続を許す。
  const wordId = pickRandom(wordIds, random)
  return { wordId, bucket: classifyWord(progress, wordId, rule), plannedBucket }
}
