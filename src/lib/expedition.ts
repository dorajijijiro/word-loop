// 1回の学習セッション（遠征）の進行を管理する。
// 遠征は「開始 → encounterLimit 回の Encounter → 完了 → 帰還」で1区切り。
// XP は Encounter ごとに、Gold は完了時に rewards.ts で計算する。
import type { Encounter } from './encounterEngine.ts'
import {
  calculateEncounterXp,
  calculateReturnGold,
  getEncounterRewardKind,
  type ExpeditionRewards,
} from './rewards.ts'

// 1遠征あたりの Encounter 数（基本100＋再遭遇などの追加分5）。現在は固定値。
// 再遭遇・Recall もすべて1 Encounter として数え、この数を超えない。
export const expeditionEncounterLimit = 105

// idle: 初回の待機 / running: 遠征中 / completed: 遠征完了（結果表示） / returned: 帰還（報酬と累積表示）
export type ExpeditionStatus = 'idle' | 'running' | 'completed' | 'returned'

export type ExpeditionState = {
  // この遠征で表示した Encounter 数。通常語・再遭遇語のどちらも1として数える。
  encounterCount: number
  encounterLimit: number
  status: ExpeditionStatus
  // encounterCount の内訳。familiar + new + growth + reencounter + recall = encounterCount。
  // recall は元の bucket（new / growth）には数えない。
  familiarCount: number
  newCount: number
  growthCount: number
  reencounterCount: number
  recallCount: number
  // この遠征で獲得した XP（Encounter ごとに加算）。
  xp: number
  // 最後に記録した Encounter の通し番号。同じ Encounter の二重加算を防ぐ。
  lastRecordedSequence: number | null
  // 完了時に確定した報酬。完了前は null。
  rewards: ExpeditionRewards | null
}

export function createIdleExpedition(): ExpeditionState {
  return {
    encounterCount: 0,
    encounterLimit: expeditionEncounterLimit,
    status: 'idle',
    familiarCount: 0,
    newCount: 0,
    growthCount: 0,
    reencounterCount: 0,
    recallCount: 0,
    xp: 0,
    lastRecordedSequence: null,
    rewards: null,
  }
}

// 遠征開始。Encounter は開始時点ではなく、最初の単語を表示したときに数える。
export function startExpedition(): ExpeditionState {
  return { ...createIdleExpedition(), status: 'running' }
}

export function isExpeditionRunning(expedition: ExpeditionState) {
  return expedition.status === 'running' && expedition.encounterCount < expedition.encounterLimit
}

// 上限の Encounter を記録済みで、最後の単語を表示している状態。
// この間は単語を進めず、表示を見せ終えてから completeExpedition で completed にする。
export function hasReachedExpeditionLimit(expedition: ExpeditionState) {
  return expedition.status === 'running' && expedition.encounterCount >= expedition.encounterLimit
}

// 単語を1つ表示したときに呼ぶ。上限に達したら以降は数えない。
// 同じ通し番号の Encounter は1回だけ数える。
// 上限に達しても status は running のまま（最後の単語を画面に見せるため）。
export function recordExpeditionEncounter(
  expedition: ExpeditionState,
  encounter: Pick<Encounter, 'sequence' | 'source' | 'bucket'>,
): ExpeditionState {
  if (
    !isExpeditionRunning(expedition) ||
    (expedition.lastRecordedSequence !== null &&
      encounter.sequence <= expedition.lastRecordedSequence)
  ) {
    return expedition
  }

  const kind = getEncounterRewardKind(encounter)

  return {
    ...expedition,
    encounterCount: expedition.encounterCount + 1,
    familiarCount: expedition.familiarCount + (kind === 'familiar' ? 1 : 0),
    newCount: expedition.newCount + (kind === 'new' ? 1 : 0),
    growthCount: expedition.growthCount + (kind === 'growth' ? 1 : 0),
    reencounterCount: expedition.reencounterCount + (kind === 'reencounter' ? 1 : 0),
    recallCount: expedition.recallCount + (kind === 'recall' ? 1 : 0),
    xp: expedition.xp + calculateEncounterXp({ kind }),
    lastRecordedSequence: encounter.sequence,
  }
}

// 上限に達してから遠征完了へ切り替えるまでの待ち時間。
// 通常の語は他の語と同じ時間（設定速度ぶん）見せてから完了する。
// Recall は cue → reveal の表示時間を Recall 側で消化済みなので、reveal が終わったらすぐ完了する。
export function getCompletionDelayMilliseconds(
  lastEncounter: Pick<Encounter, 'source'>,
  intervalMilliseconds: number,
): number {
  return lastEncounter.source === 'recall' ? 0 : intervalMilliseconds
}

// 最後の単語を表示し終えたときに呼ぶ。ここで今回の報酬が確定する。
export function completeExpedition(expedition: ExpeditionState): ExpeditionState {
  if (!hasReachedExpeditionLimit(expedition)) {
    return expedition
  }

  return {
    ...expedition,
    status: 'completed',
    rewards: { xp: expedition.xp, gold: calculateReturnGold(expedition, true) },
  }
}

// 遠征完了画面から帰還画面へ進む。今回の結果は帰還画面で表示するため残す。
export function returnFromExpedition(expedition: ExpeditionState): ExpeditionState {
  if (expedition.status !== 'completed') {
    return expedition
  }

  return { ...expedition, status: 'returned' }
}
