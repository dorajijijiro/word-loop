// 単語ごとの理解度の自己申告（「わかる」「まだわからない」）。
// 本人の任意の申告をそのまま記録するだけで、習得・正解の判定ではない。
// new / growth / familiar の学習進捗（learning-progress）とは独立したキーで保存し、
// 出現頻度・9:1 の比率・Attention・XP / Gold には影響させない（反映は今後のタスクで検討する）。
const storageKey = 'word-loop.understanding'
// version 1: words[wordId] = { status, answeredAt }
const storageVersion = 1

export type UnderstandingStatus = 'known' | 'unknown'

export type WordUnderstanding = {
  status: UnderstandingStatus
  // 最後に回答した日時（ISO 8601）。
  answeredAt: string
}

// 記録のない語は「未回答」。未回答を「まだわからない」とは扱わない。
export type UnderstandingMap = Record<string, WordUnderstanding>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStatus = (value: unknown): value is UnderstandingStatus => value === 'known' || value === 'unknown'

const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))

export function getUnderstanding(map: UnderstandingMap, wordId: string): WordUnderstanding | null {
  return Object.hasOwn(map, wordId) ? map[wordId] : null
}

// 回答を記録する。再回答は最新の選択と日時で上書きする。
export function recordUnderstanding(
  map: UnderstandingMap,
  wordId: string,
  status: UnderstandingStatus,
  answeredAt: string,
): UnderstandingMap {
  return { ...map, [wordId]: { status, answeredAt } }
}

// ボタンを押し始めた時点の語（とその時刻）。
export type UnderstandingPress = { wordId: string; startedAt: number }

// 押し始めた語を記録先として使う時間の上限。これより古い押下情報は使わない（押しかけて離した場合など）。
export const understandingPressMaxMilliseconds = 10000

// ボタンを押し始めたとき（pointerdown）の押下情報。
export function startUnderstandingPress(timeStamp: number, currentWordId: string): UnderstandingPress {
  return { wordId: currentWordId, startedAt: timeStamp }
}

// キーボードの keydown を処理する。Enter / Space の押し始めだけを押下情報にする。
// キーを押し続けたときの自動リピート（repeat）は、押し始めの語を上書きしない。
// Enter は keydown ごとに click が起きるため、自動リピートでは既定の動作を止めて、別の語へ連続で回答しないようにする。
// （Space は離したときに1回だけ click が起きるので、自動リピートは無視するだけでよい）
export function handleUnderstandingKeyDown(
  press: UnderstandingPress | null,
  key: string,
  repeat: boolean,
  timeStamp: number,
  currentWordId: string,
): { press: UnderstandingPress | null; preventDefault: boolean } {
  if (key !== 'Enter' && key !== ' ') {
    return { press, preventDefault: false }
  }
  if (repeat) {
    return { press, preventDefault: key === 'Enter' }
  }
  return { press: startUnderstandingPress(timeStamp, currentWordId), preventDefault: false }
}

// 記録先の語を決める。高速周回で押下中に表示が変わっても、押し始めた時点の語に記録する。
// 押し始めの情報がない操作（支援技術からの実行など）は、確定した時点で表示中の語に記録する。
export function resolveUnderstandingTarget(
  press: UnderstandingPress | null,
  answeredAtMilliseconds: number,
  currentWordId: string,
): string {
  if (press === null) {
    return currentWordId
  }
  const elapsed = answeredAtMilliseconds - press.startedAt
  return elapsed >= 0 && elapsed <= understandingPressMaxMilliseconds ? press.wordId : currentWordId
}

// 保存値を読む。形式が違う語の記録だけを捨て、ほかの語の記録は残す。
// 全体が壊れていても空（全語未回答）になるだけで、学習進捗など他のキーには触れない。
export function parseUnderstanding(value: unknown): UnderstandingMap {
  if (!isRecord(value) || !isRecord(value.words)) {
    return {}
  }

  const map: UnderstandingMap = {}
  for (const [wordId, entry] of Object.entries(value.words)) {
    if (isRecord(entry) && isStatus(entry.status) && isDateString(entry.answeredAt)) {
      map[wordId] = { status: entry.status, answeredAt: entry.answeredAt }
    }
  }
  return map
}

export function loadUnderstanding(): UnderstandingMap {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey)
    return storedValue === null ? {} : parseUnderstanding(JSON.parse(storedValue))
  } catch {
    return {}
  }
}

export function saveUnderstanding(map: UnderstandingMap) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ version: storageVersion, words: map }))
  } catch {
    // 保存できないブラウザ設定でも、遠征は継続する。
  }
}
