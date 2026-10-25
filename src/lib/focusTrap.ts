// ダイアログ（設定）の中で Tab / Shift+Tab を巡回させるための、次のフォーカス先の計算（Task 017 の修正）。
// activeIndex: 今フォーカスがある要素の、フォーカス可能な要素の中での位置。ダイアログ本体など一覧にない場合は -1。
// 戻り値: フォーカスを移す要素の位置。null ならブラウザの既定の移動に任せる（一覧の途中での移動）。
export function getFocusTrapTarget(focusableCount: number, activeIndex: number, shiftKey: boolean): number | null {
  if (focusableCount === 0) {
    return null
  }
  const last = focusableCount - 1
  // 開いた直後（ダイアログ本体にフォーカス）や一覧の外: 逆方向なら最後へ、順方向なら最初へ。外へは抜けさせない。
  if (activeIndex < 0 || activeIndex > last) {
    return shiftKey ? last : 0
  }
  if (shiftKey && activeIndex === 0) {
    return last
  }
  if (!shiftKey && activeIndex === last) {
    return 0
  }
  return null
}
