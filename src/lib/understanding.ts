// 単語ごとの理解度の自己申告（「わかる」「まだわからない」）と、それに基づく次回の出題期日。
// 本人の任意の申告をそのまま使うだけで、習得・正解の判定ではない。未回答は known にも unknown にもしない。
// new / growth / familiar の学習進捗（learning-progress）とは独立したキーで保存する。
const storageKey = 'word-loop.understanding'
// version 1（Task 015）: words[wordId] = { status, answeredAt }
// version 2（Task 016）: words[wordId] = { status, answeredAt, knownStreak, nextDueAt }
const storageVersion = 2

export type UnderstandingStatus = 'known' | 'unknown'

export type WordUnderstanding = {
  status: UnderstandingStatus
  // 最後に回答した日時（ISO 8601）。
  answeredAt: string
  // 連続した「わかる」の回数。「まだわからない」で0に戻る。
  knownStreak: number
  // known の語を次に自動選出してよい日時（ISO 8601）。unknown は null。
  nextDueAt: string | null
}

// 記録のない語は「未回答」。未回答を「まだわからない」とは扱わない。
export type UnderstandingMap = Record<string, WordUnderstanding>

// 「わかる」の連続回数ごとの、次に出すまでの日数（暫定値）。1回目1日後、2回目3日後 … 5回目以降は90日後。
export const knownReviewIntervalDays = [1, 3, 7, 30, 90] as const

// 日数は24時間単位で数える（暦日やタイムゾーンは考えない）。
export const dayMilliseconds = 24 * 60 * 60 * 1000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStatus = (value: unknown): value is UnderstandingStatus => value === 'known' || value === 'unknown'

const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))

const isStreak = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

export function getKnownReviewIntervalDays(knownStreak: number): number {
  const index = Math.min(Math.max(knownStreak, 1), knownReviewIntervalDays.length) - 1
  return knownReviewIntervalDays[index]
}

// 回答日時から、連続回数に応じた日数（24時間単位）後の日時。
export function getKnownDueAt(answeredAt: string, knownStreak: number): string {
  return new Date(Date.parse(answeredAt) + getKnownReviewIntervalDays(knownStreak) * dayMilliseconds).toISOString()
}

export function getUnderstanding(map: UnderstandingMap, wordId: string): WordUnderstanding | null {
  return Object.hasOwn(map, wordId) ? map[wordId] : null
}

// 1回の回答を、回答前の記録（base）に当てはめる。
// わかる: 連続回数 +1、次回期日を回答日時から延ばす。まだわからない: 連続回数を0に戻し、期日なし。
export function applyUnderstandingAnswer(
  base: WordUnderstanding | null,
  status: UnderstandingStatus,
  answeredAt: string,
): WordUnderstanding {
  if (status === 'unknown') {
    return { status, answeredAt, knownStreak: 0, nextDueAt: null }
  }
  const knownStreak = (base?.knownStreak ?? 0) + 1
  return { status, answeredAt, knownStreak, nextDueAt: getKnownDueAt(answeredAt, knownStreak) }
}

// 回答を記録する（同じ Encounter かどうかは考えない）。元のデータは変更しない。
export function recordUnderstanding(
  map: UnderstandingMap,
  wordId: string,
  status: UnderstandingStatus,
  answeredAt: string,
): UnderstandingMap {
  return { ...map, [wordId]: applyUnderstandingAnswer(getUnderstanding(map, wordId), status, answeredAt) }
}

// 回答の記録先。語と、その語を表示していた Encounter の通し番号。
export type UnderstandingTarget = { wordId: string; sequence: number }

// Encounter ごとの「その Encounter で最初に回答する前の記録」。メモリ上だけで持ち、保存しない。
export type UnderstandingAnswerBases = Record<number, { wordId: string; base: WordUnderstanding | null }>

// 回答前の記録を覚えておく Encounter の数（古いものから捨てる）。
const answerBaseLimit = 20

export type UnderstandingAnswerResult = {
  map: UnderstandingMap
  bases: UnderstandingAnswerBases
  // 回答後のこの語の記録。
  understanding: WordUnderstanding
}

// 理解度ボタンでの回答。同じ Encounter での連打・訂正は、その Encounter の回答前の記録から計算し直すので、
// 最後の回答だけが1回分として残る（「わかる → まだわからない → わかる」でも連続回数は1つだけ増える）。
export function answerUnderstanding(
  map: UnderstandingMap,
  bases: UnderstandingAnswerBases,
  target: UnderstandingTarget,
  status: UnderstandingStatus,
  answeredAt: string,
): UnderstandingAnswerResult {
  const saved = bases[target.sequence]
  const base = saved !== undefined && saved.wordId === target.wordId ? saved.base : getUnderstanding(map, target.wordId)
  const understanding = applyUnderstandingAnswer(base, status, answeredAt)
  const nextBases: UnderstandingAnswerBases = {}
  for (const [sequence, entry] of Object.entries({ ...bases, [target.sequence]: { wordId: target.wordId, base } })) {
    if (Number(sequence) > target.sequence - answerBaseLimit) {
      nextBases[Number(sequence)] = entry
    }
  }
  return { map: { ...map, [target.wordId]: understanding }, bases: nextBases, understanding }
}

// ボタンを押し始めた時点の語・Encounter（とその時刻）。
export type UnderstandingPress = UnderstandingTarget & { startedAt: number }

// 押し始めた語を記録先として使う時間の上限。これより古い押下情報は使わない（押しかけて離した場合など）。
export const understandingPressMaxMilliseconds = 10000

// ボタンを押し始めたとき（pointerdown）の押下情報。
export function startUnderstandingPress(timeStamp: number, current: UnderstandingTarget): UnderstandingPress {
  return { wordId: current.wordId, sequence: current.sequence, startedAt: timeStamp }
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
  current: UnderstandingTarget,
): { press: UnderstandingPress | null; preventDefault: boolean } {
  if (key !== 'Enter' && key !== ' ') {
    return { press, preventDefault: false }
  }
  if (repeat) {
    return { press, preventDefault: key === 'Enter' }
  }
  return { press: startUnderstandingPress(timeStamp, current), preventDefault: false }
}

// 記録先を決める。高速周回で押下中に表示が変わっても、押し始めた時点の語（と Encounter）に記録する。
// 押し始めの情報がない操作（支援技術からの実行など）は、確定した時点で表示中の語に記録する。
export function resolveUnderstandingTarget(
  press: UnderstandingPress | null,
  answeredAtMilliseconds: number,
  current: UnderstandingTarget,
): UnderstandingTarget {
  if (press === null) {
    return current
  }
  const elapsed = answeredAtMilliseconds - press.startedAt
  return elapsed >= 0 && elapsed <= understandingPressMaxMilliseconds
    ? { wordId: press.wordId, sequence: press.sequence }
    : current
}

// 1語分の保存値を読む。status と answeredAt が正しければ、追加項目は安全な値で補う。
// - version 1 の known（追加項目なし）は「わかる1回目」: 連続回数1、次回期日は answeredAt の1日後。
// - unknown は連続回数0・期日なし。
// - 連続回数・期日が不正なら、status と answeredAt から計算し直す（現在時刻は使わないので、再読み込みで期日が延びない）。
const parseWordUnderstanding = (entry: unknown): WordUnderstanding | null => {
  if (!isRecord(entry) || !isStatus(entry.status) || !isDateString(entry.answeredAt)) {
    return null
  }
  const { status, answeredAt } = entry
  if (status === 'unknown') {
    return { status, answeredAt, knownStreak: 0, nextDueAt: null }
  }
  const knownStreak = isStreak(entry.knownStreak) && entry.knownStreak >= 1 ? entry.knownStreak : 1
  const nextDueAt = isDateString(entry.nextDueAt) ? entry.nextDueAt : getKnownDueAt(answeredAt, knownStreak)
  return { status, answeredAt, knownStreak, nextDueAt }
}

// 保存値を読む（version 1 / 2）。形式が違う語の記録だけを捨て、ほかの語の記録は残す。
// 全体が壊れていても空（全語未回答）になるだけで、学習進捗など他のキーには触れない。
export function parseUnderstanding(value: unknown): UnderstandingMap {
  if (!isRecord(value) || !isRecord(value.words)) {
    return {}
  }

  const map: UnderstandingMap = {}
  for (const [wordId, entry] of Object.entries(value.words)) {
    const understanding = parseWordUnderstanding(entry)
    if (understanding !== null) {
      map[wordId] = understanding
    }
  }
  return map
}

// 読み込みでは保存し直さない（version 2 で書くのは次に回答したとき）。
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
