import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getLevel,
  getLevelChange,
  getLevelProgress,
  getLevelThresholdXp,
} from '../src/lib/level.ts'
import { applyExpeditionRewards, createPlayerProgress } from '../src/lib/playerProgress.ts'

test('Level: XP 0 は Lv.1、壊れた値も Lv.1', () => {
  assert.equal(getLevel(0), 1)
  assert.equal(getLevel(-50), 1)
  assert.equal(getLevel(Number.NaN), 1)
  const progress = getLevelProgress(0)
  assert.deepEqual(
    { ...progress },
    {
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      progressRatio: 0,
      levelStartTotalXp: 0,
      nextLevelTotalXp: 100,
    },
  )
})

test('Level: 境界値（100 / 400 / 900 XP）で上がる', () => {
  assert.equal(getLevel(99), 1)
  assert.equal(getLevel(100), 2)
  assert.equal(getLevel(399), 2)
  assert.equal(getLevel(400), 3)
  assert.equal(getLevel(899), 3)
  assert.equal(getLevel(900), 4)
  for (let level = 1; level <= 200; level += 1) {
    const threshold = getLevelThresholdXp(level)
    assert.equal(getLevel(threshold), level)
    if (threshold > 0) {
      assert.equal(getLevel(threshold - 1), level - 1)
    }
  }
})

test('Level: 次レベルまでの必要XPと progressRatio', () => {
  const progress = getLevelProgress(420)
  assert.equal(progress.level, 3)
  assert.equal(progress.currentLevelXp, 20)
  assert.equal(progress.nextLevelXp, 500)
  assert.equal(progress.nextLevelTotalXp, 900)
  assert.equal(progress.progressRatio, 20 / 500)
})

test('Level: XP が増えて Level が下がらず、progressRatio は常に 0〜1', () => {
  let previous = 1
  for (let xp = 0; xp <= 50_000; xp += 7) {
    const progress = getLevelProgress(xp)
    assert.ok(progress.level >= previous)
    assert.ok(progress.progressRatio >= 0 && progress.progressRatio <= 1)
    assert.ok(progress.currentLevelXp >= 0 && progress.currentLevelXp < progress.nextLevelXp)
    previous = progress.level
  }
})

test('Level: PlayerProgress の totalXp から再現でき、レベルアップを判定できる', () => {
  const before = { ...createPlayerProgress(), totalXp: 380 }
  const after = applyExpeditionRewards(before, { xp: 176, gold: 137 })
  assert.equal(getLevelProgress(after.totalXp).level, getLevel(556))
  assert.deepEqual(getLevelChange(before.totalXp, after.totalXp), {
    from: 2,
    to: 3,
    leveledUp: true,
  })
  assert.deepEqual(getLevelChange(420, 500), { from: 3, to: 3, leveledUp: false })
  // 1回の遠征で複数レベル上がる場合
  assert.deepEqual(getLevelChange(0, 450), { from: 1, to: 3, leveledUp: true })
})
