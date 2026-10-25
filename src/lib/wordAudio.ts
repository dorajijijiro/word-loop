// Task 021: 通常の遠征で、表示中の語の Kokoro 音声（Task 020 で生成）を再生する。
// ブラウザの音声合成（speechSynthesis）は使わない。試聴画面の再生とは別に、遠征に必要な最小限の処理だけを持つ。
// - 音声要素は1つだけを使い回す（iPhone Safari では、ユーザー操作で一度再生した要素ならタイマーからも再生できる）。
// - 新しい語を再生するときは前の音声を止め、先頭から再生する。古い読み込み・再生の結果は通し番号で無視する。
// - 失敗しても遠征・タイマーには触れない。別の音声方式へも切り替えない。
import audioIndexData from '../data/vocabularyAudio/audio-index.json' with { type: 'json' }

export const wordAudioDirectory = 'audio/kokoro-vocabulary/'

// wordId → 音声ファイルの SHA-256 の先頭8文字。全語彙の MP3 は読み込まず、この一覧だけを持つ。
const audioVersions: Readonly<Record<string, string>> = audioIndexData.files

// 再生する音声の URL（base は import.meta.env.BASE_URL）。音声がない語は null。
// ハッシュを付けて、作り直した音声をブラウザのキャッシュから古いまま再生しないようにする。
export const getWordAudioUrl = (wordId: string, base = '/', versions: Readonly<Record<string, string>> = audioVersions) => {
  const version = versions[wordId]
  return version === undefined ? null : `${base}${wordAudioDirectory}${wordId}.mp3?v=${version}`
}

// 再生できなかった理由。
// missing: 一覧に音声がない（通信しない） / load-failed: 読み込み・デコードに失敗 / blocked: ブラウザが自動再生を拒否
export type WordAudioFailure = 'missing' | 'load-failed' | 'blocked'

export type WordAudioEvent =
  | { type: 'loading'; wordId: string }
  | { type: 'playing'; wordId: string }
  | { type: 'ended'; wordId: string }
  | { type: 'failed'; wordId: string; reason: WordAudioFailure }
  | { type: 'stopped' }
  // 画面が非表示などで再生を見送った（前の音声も止めている）
  | { type: 'suppressed'; wordId: string }

// HTMLAudioElement のうち使う部分（テストでは偽物に差し替える）
export type AudioElementLike = {
  src: string
  preload: string
  play: () => Promise<void>
  pause: () => void
  load: () => void
  removeAttribute: (name: string) => void
  addEventListener: (type: string, listener: () => void, options?: { signal?: AbortSignal }) => void
}

export type WordAudioPlayer = {
  play: (wordId: string) => void
  stop: () => void
}

export const createWordAudioPlayer = (options: {
  createAudio: () => AudioElementLike
  resolveUrl: (wordId: string) => string | null
  onEvent: (event: WordAudioEvent) => void
  // false の間は新しい再生を始めない（画面が非表示の間など）。省略時は常に再生する。
  canPlay?: () => boolean
}): WordAudioPlayer => {
  let audio: AudioElementLike | null = null
  // 再生のたびに増やす。止めた後・次の語に移った後に届く古いイベントや Promise の結果を無視する。
  let token = 0
  let listeners: AbortController | null = null

  const detach = () => {
    listeners?.abort()
    listeners = null
  }

  const release = (element: AudioElementLike) => {
    element.pause()
    element.removeAttribute('src')
    element.load()
  }

  const stop = () => {
    token += 1
    detach()
    if (audio !== null) {
      release(audio)
    }
    options.onEvent({ type: 'stopped' })
  }

  const play = (wordId: string) => {
    token += 1
    const current = token
    detach()
    if (options.canPlay !== undefined && !options.canPlay()) {
      // 見送る。前の音声も止め、後でまとめて再生することもしない（次の操作・カードの切り替えで改めて再生する）
      if (audio !== null) {
        release(audio)
      }
      options.onEvent({ type: 'suppressed', wordId })
      return
    }
    const url = options.resolveUrl(wordId)
    if (url === null) {
      if (audio !== null) {
        release(audio)
      }
      options.onEvent({ type: 'failed', wordId, reason: 'missing' })
      return
    }
    audio ??= options.createAudio()
    const element = audio
    element.pause()
    const controller = new AbortController()
    listeners = controller
    const isCurrent = () => current === token
    const fail = (reason: WordAudioFailure) => {
      if (isCurrent()) {
        detach()
        options.onEvent({ type: 'failed', wordId, reason })
      }
    }
    element.addEventListener('playing', () => isCurrent() && options.onEvent({ type: 'playing', wordId }), {
      signal: controller.signal,
    })
    element.addEventListener(
      'ended',
      () => {
        if (isCurrent()) {
          detach()
          options.onEvent({ type: 'ended', wordId })
        }
      },
      { signal: controller.signal },
    )
    element.addEventListener('error', () => fail('load-failed'), { signal: controller.signal })
    element.preload = 'auto'
    // 同じ語でも src を設定し直して load() するので、連打しても先頭から再生し直す
    element.src = url
    element.load()
    options.onEvent({ type: 'loading', wordId })
    element.play().catch((error: unknown) => {
      const name = error instanceof Error || error instanceof DOMException ? error.name : ''
      // AbortError は次の語・停止で読み込みを打ち切ったときにも起きる（isCurrent で無視される）
      fail(name === 'NotAllowedError' ? 'blocked' : 'load-failed')
    })
  }

  return { play, stop }
}

// 画面に出す控えめな表示（英語の位置を動かさない小さな表示）
export const wordAudioFailureLabels: Record<WordAudioFailure, { short: string; description: string; retry: boolean }> = {
  missing: { short: '音声なし', description: 'この語の音声はありません', retry: false },
  'load-failed': { short: '音声エラー', description: '音声を読み込めませんでした。押すと再試行します', retry: true },
  blocked: { short: '▶ 音声', description: 'ブラウザが自動再生を止めました。押すと発音を再生します', retry: true },
}
