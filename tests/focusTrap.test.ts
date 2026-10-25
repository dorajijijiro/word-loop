import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getFocusTrapTarget } from '../src/lib/focusTrap.ts'

// 設定パネルを開いた直後は、パネル本体（一覧の外 = -1）にフォーカスがある。
test('設定のフォーカス: 開いた直後の Shift+Tab は背後へ抜けず、パネル内の最後の要素へ移る', () => {
  assert.equal(getFocusTrapTarget(5, -1, true), 4)
})

test('設定のフォーカス: 開いた直後の Tab はパネル内の最初の要素へ移る', () => {
  assert.equal(getFocusTrapTarget(5, -1, false), 0)
})

test('設定のフォーカス: 最初で Shift+Tab → 最後、最後で Tab → 最初に巡回する', () => {
  assert.equal(getFocusTrapTarget(5, 0, true), 4)
  assert.equal(getFocusTrapTarget(5, 4, false), 0)
})

test('設定のフォーカス: 途中の要素ではブラウザの既定の移動に任せる', () => {
  assert.equal(getFocusTrapTarget(5, 2, true), null)
  assert.equal(getFocusTrapTarget(5, 2, false), null)
  assert.equal(getFocusTrapTarget(5, 0, false), null)
  assert.equal(getFocusTrapTarget(5, 4, true), null)
})

test('設定のフォーカス: 要素が1つなら Tab / Shift+Tab ともその要素にとどまる', () => {
  assert.equal(getFocusTrapTarget(1, 0, true), 0)
  assert.equal(getFocusTrapTarget(1, 0, false), 0)
  assert.equal(getFocusTrapTarget(1, -1, true), 0)
})

test('設定のフォーカス: フォーカスできる要素がなければ何もしない', () => {
  assert.equal(getFocusTrapTarget(0, -1, true), null)
})
