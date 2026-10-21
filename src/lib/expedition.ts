// 1回の学習セッション（遠征）の進行を管理する。
// 遠征は「開始 → encounterLimit 回の Encounter → 帰還」で1区切り。
// 将来 XP・Gold・HP・帰還報酬などを加える場合は ExpeditionState と recordExpeditionEncounter を拡張する。
import type { EncounterSource } from './encounterEngine'

// 1遠征あたりの Encounter 数（基本100＋再遭遇などの追加分5）。現在は固定値。
export const expeditionEncounterLimit = 105

export type ExpeditionStatus = 'idle' | 'running' | 'completed'

export type ExpeditionState = {
  // この遠征で表示した Encounter 数。通常語・再遭遇語のどちらも1として数える。
  encounterCount: number
  encounterLimit: number
  status: ExpeditionStatus
  // encounterCount のうち再遭遇語だった数（帰還画面の表示用）。
  reencounterCount: number
}

export function createIdleExpedition(): ExpeditionState {
  return {
    encounterCount: 0,
    encounterLimit: expeditionEncounterLimit,
    status: 'idle',
    reencounterCount: 0,
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
// 上限に達しても status は running のまま（最後の単語を画面に見せるため）。
export function recordExpeditionEncounter(
  expedition: ExpeditionState,
  source: EncounterSource,
): ExpeditionState {
  if (!isExpeditionRunning(expedition)) {
    return expedition
  }

  const encounterCount = expedition.encounterCount + 1

  return {
    ...expedition,
    encounterCount,
    reencounterCount: expedition.reencounterCount + (source === 'reencounter' ? 1 : 0),
  }
}

// 最後の単語を表示し終えたときに呼ぶ。
export function completeExpedition(expedition: ExpeditionState): ExpeditionState {
  if (!hasReachedExpeditionLimit(expedition)) {
    return expedition
  }

  return { ...expedition, status: 'completed' }
}

// 帰還画面を閉じて待機状態へ戻す。学習進捗には触れない。
export function returnFromExpedition(): ExpeditionState {
  return createIdleExpedition()
}
