// 通常 Encounter で次に出す単語を選ぶロジック。
// 単語を new（観測が少ない）/ growth（最近 Attention した）/ familiar（見慣れている）に分類し、
// 遠征内で familiar 約9割・learning（new + growth）約1割になるよう選ぶ。
// 再遭遇はこの比率の外側で扱う（encounterEngine 側で優先される）。
// 分類ルールは BucketRule として差し替えられる。将来 stable / fluent などを足す場合も
// LearningBucket と provisionalBucketRule、bucket ごとの選出順（fallbackOrder）を変更する。
import { getWordProgress, type LearningProgressMap, type WordLearningProgress } from './learningProgress.ts'

export type LearningBucket = 'new' | 'growth' | 'familiar'

export const learningBuckets: LearningBucket[] = ['new', 'growth', 'familiar']

export type BucketRule = (progress: WordLearningProgress) => LearningBucket

export type BucketCounts = Record<LearningBucket, number>

// 9:1 の比率を管理する単位。learning = new + growth。
export type SelectionTrack = 'familiar' | 'learning'

export type TrackCounts = Record<SelectionTrack, number>

// 0以上1未満を返す乱数関数。テストでは固定値を返す関数を注入する。
export type RandomSource = () => number

// 通常 Encounter のうち learning（new + growth）にしたい割合。
export const learningTargetRatio = 0.1

// learning 枠で growth と new の両方に候補があるとき、new を選ぶ割合。
// growth（ユーザーが明示的に Attention した語）を優先しつつ、new の導入が止まらないようにする。
export const newShareInLearning = 0.25

// この回数に満たない語は new（word-loop 内での観測が少ない）。
export const familiarEncounterThreshold = 3

// familiar 枠で循環させる語がこの数に満たない間は、familiar 枠に new も混ぜる。
// 初回遠征で、先に3回見た少数の語ばかりが繰り返されるのを防ぎ、new を自然に familiar へ育てる。
// 語彙数に応じて getMinimumFamiliarPool で増やす（20語では 8、200語では 30）。
export const minimumFamiliarPool = 8

// 語彙が多いとき、familiar 枠で循環させたい最低語数の語彙全体に対する割合と上限。
// 1遠征の familiar 枠は約95回あるため、30語あれば1語あたり3回前後に収まる。
export const familiarPoolShare = 0.15
export const maximumFamiliarPool = 30

// 語彙200語で familiar が8語を超えた途端に、その8語だけが familiar 枠を占めて繰り返されるのを防ぐ。
export function getMinimumFamiliarPool(wordCount: number) {
  return Math.min(maximumFamiliarPool, Math.max(minimumFamiliarPool, Math.ceil(wordCount * familiarPoolShare)))
}

// 暫定ルール:
// attentionDebt > 0 → growth（初回でタップした語も growth）
// それ以外で encounterCount < 3 → new
// それ以外 → familiar
// attentionCount（過去の Attention 履歴）は分類に使わない。
export const provisionalBucketRule: BucketRule = (progress) => {
  if (progress.attentionDebt > 0) {
    return 'growth'
  }
  if (progress.encounterCount < familiarEncounterThreshold) {
    return 'new'
  }
  return 'familiar'
}

export function createBucketCounts(): BucketCounts {
  return { new: 0, growth: 0, familiar: 0 }
}

export function addBucketCount(counts: BucketCounts, bucket: LearningBucket): BucketCounts {
  return { ...counts, [bucket]: counts[bucket] + 1 }
}

export function createTrackCounts(): TrackCounts {
  return { familiar: 0, learning: 0 }
}

export function addTrackCount(counts: TrackCounts, track: SelectionTrack): TrackCounts {
  return { ...counts, [track]: counts[track] + 1 }
}

export function getBucketTrack(bucket: LearningBucket): SelectionTrack {
  return bucket === 'familiar' ? 'familiar' : 'learning'
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
  const groups: Record<LearningBucket, string[]> = { new: [], growth: [], familiar: [] }
  for (const wordId of wordIds) {
    groups[classifyWord(progress, wordId, rule)].push(wordId)
  }
  return groups
}

// 次の Encounter を familiar / learning のどちらの枠から出すかを決める。
// plannedCounts はこの遠征でこれまでに「狙った」枠の回数（候補不足で補った回は狙った側で数える）。
// 基本は乱数で選び、目標比率から1回分以上ずれたら補正する。これで100回程度で概ね9:1に収まる。
export function chooseTrack(
  plannedCounts: TrackCounts,
  random: RandomSource,
  ratio: number = learningTargetRatio,
): SelectionTrack {
  const total = plannedCounts.familiar + plannedCounts.learning
  const learningDeficit = (total + 1) * ratio - plannedCounts.learning

  if (learningDeficit >= 1) {
    return 'learning'
  }
  if (learningDeficit <= -1) {
    return 'familiar'
  }
  return random() < ratio ? 'learning' : 'familiar'
}

// 枠ごとに、どの候補グループから順に探すか。前のグループに候補がなければ次へ進む。
// learning 枠: growth 優先（一定割合で new）→ もう一方 → familiar。
// familiar 枠: familiar → new → growth。familiar が getMinimumFamiliarPool 未満の間は familiar と new をまとめて1グループにする。
//   growth を後ろにするのは、候補不足の補充でタップした語ばかりが続かないようにするため。
const candidatePools = (
  track: SelectionTrack,
  groups: Record<LearningBucket, string[]>,
  random: RandomSource,
): string[][] => {
  if (track === 'familiar') {
    const wordCount = groups.new.length + groups.growth.length + groups.familiar.length
    return groups.familiar.length < getMinimumFamiliarPool(wordCount)
      ? [[...groups.familiar, ...groups.new], groups.growth]
      : [groups.familiar, groups.new, groups.growth]
  }

  const preferNew = groups.growth.length > 0 && groups.new.length > 0 && random() < newShareInLearning
  return preferNew
    ? [groups.new, groups.growth, groups.familiar]
    : [groups.growth, groups.new, groups.familiar]
}

const pickRandom = (candidates: string[], random: RandomSource) =>
  candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]

export type NormalSelection = {
  wordId: string
  // 実際に出した語の bucket（候補不足で補った場合は狙った枠と異なる）
  bucket: LearningBucket
  // 比率計算用に狙った枠
  plannedTrack: SelectionTrack
}

export type NormalSelectionInput = {
  wordIds: string[]
  progress: LearningProgressMap
  plannedCounts: TrackCounts
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
  ratio = learningTargetRatio,
}: NormalSelectionInput): NormalSelection {
  const groups = groupWordsByBucket(wordIds, progress, rule)
  const plannedTrack = chooseTrack(plannedCounts, random, ratio)

  // 枠ごとの順に、直前の語以外から選ぶ。
  for (const pool of candidatePools(plannedTrack, groups, random)) {
    const candidates = pool.filter((wordId) => wordId !== previousWordId)
    if (candidates.length > 0) {
      const wordId = pickRandom(candidates, random)
      return { wordId, bucket: classifyWord(progress, wordId, rule), plannedTrack }
    }
  }

  // 語が1種類しかない場合だけ、同じ語の連続を許す。
  const wordId = pickRandom(wordIds, random)
  return { wordId, bucket: classifyWord(progress, wordId, rule), plannedTrack }
}
