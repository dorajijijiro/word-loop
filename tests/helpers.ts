// テスト用の再現可能な乱数（線形合同法）。0以上1未満を返す。
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}
