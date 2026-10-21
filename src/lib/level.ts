// プレイヤーレベル。保存せず、PlayerProgress.totalXp から毎回算出する派生値。
// Lv.n に到達する累積XP = 100 × (n - 1)²（Lv.1: 0 / Lv.2: 100 / Lv.3: 400 / Lv.4: 900 …）。
// 係数は暫定。変える場合は levelXpUnit だけを変更する。

export const levelXpUnit = 100

export type LevelProgress = {
  level: number
  // 現在のレベルに入ってから獲得したXP。
  currentLevelXp: number
  // 現在のレベルから次のレベルまでに必要なXP（区間の幅）。
  nextLevelXp: number
  // currentLevelXp / nextLevelXp。0以上1未満。
  progressRatio: number
  // 現在のレベル・次のレベルに到達する累積XP（表示用）。
  levelStartTotalXp: number
  nextLevelTotalXp: number
}

export type LevelChange = {
  from: number
  to: number
  leveledUp: boolean
}

const normalizeXp = (totalXp: number) =>
  Number.isFinite(totalXp) && totalXp > 0 ? Math.floor(totalXp) : 0

// Lv.level に到達する累積XP。
export function getLevelThresholdXp(level: number): number {
  const steps = Math.max(0, Math.floor(level) - 1)
  return levelXpUnit * steps * steps
}

export function getLevel(totalXp: number): number {
  const xp = normalizeXp(totalXp)
  let level = Math.floor(Math.sqrt(xp / levelXpUnit)) + 1
  // 浮動小数点の誤差で境界がずれないよう、整数の閾値で補正する。
  while (getLevelThresholdXp(level + 1) <= xp) {
    level += 1
  }
  while (level > 1 && getLevelThresholdXp(level) > xp) {
    level -= 1
  }
  return level
}

export function getLevelProgress(totalXp: number): LevelProgress {
  const xp = normalizeXp(totalXp)
  const level = getLevel(xp)
  const levelStartTotalXp = getLevelThresholdXp(level)
  const nextLevelTotalXp = getLevelThresholdXp(level + 1)
  const currentLevelXp = xp - levelStartTotalXp
  const nextLevelXp = nextLevelTotalXp - levelStartTotalXp

  return {
    level,
    currentLevelXp,
    nextLevelXp,
    progressRatio: Math.min(1, Math.max(0, currentLevelXp / nextLevelXp)),
    levelStartTotalXp,
    nextLevelTotalXp,
  }
}

// 遠征開始前と報酬反映後の累積XPからレベル変化を判定する。
export function getLevelChange(beforeTotalXp: number, afterTotalXp: number): LevelChange {
  const from = getLevel(beforeTotalXp)
  const to = getLevel(afterTotalXp)
  return { from, to, leveledUp: to > from }
}
