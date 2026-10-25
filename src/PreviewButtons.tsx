// Task 019・020: 試聴画面の再生ボタン（Kokoro・現在の読み上げ）と、未生成・失敗の表示。
import { toKey, type Playback, type PlaybackKey, type PlayRequest, type Source } from './lib/previewPlayback.ts'

type PreviewButtonsProps = {
  // 再生中の判定・エラー表示に使うキーの前半（画面内で一意）
  keyPrefix: string
  label: string
  text: string
  // public/ からの相対パス。null なら Kokoro ボタンを無効にし、missingMessage を表示する
  clipPath: string | null
  missingMessage: string | null
  kokoroLabel?: string
  showBrowser?: boolean
  speechSupported: boolean
  playback: Playback | null
  errors: Partial<Record<PlaybackKey, string>>
  onPlay: (key: PlaybackKey, request: PlayRequest) => void
  onStop: () => void
}

// 1つの音声の「Kokoro」「現在の読み上げ」ボタンと、未生成・失敗の表示
export function PreviewButtons({
  keyPrefix,
  label,
  text,
  clipPath,
  missingMessage,
  kokoroLabel = 'Kokoro',
  showBrowser = true,
  speechSupported,
  playback,
  errors,
  onPlay,
  onStop,
}: PreviewButtonsProps) {
  const kokoroKey = toKey(keyPrefix, 'kokoro')
  const browserKey = toKey(keyPrefix, 'browser')
  const message = errors[kokoroKey] ?? errors[browserKey] ?? (clipPath === null ? missingMessage : null)

  const button = (key: PlaybackKey, source: Source, request: PlayRequest | null) => {
    const active = playback?.key === key
    const sourceLabel = source === 'kokoro' ? kokoroLabel : '現在の読み上げ'
    return (
      <button
        type="button"
        className={`preview-play is-${source}${active ? ' is-active' : ''}`}
        aria-pressed={active}
        aria-label={`${label}を${sourceLabel}で${active ? '停止' : '再生'}`}
        disabled={request === null}
        onClick={() => (active ? onStop() : request !== null && onPlay(key, request))}
      >
        <span aria-hidden="true" className="preview-play-icon">
          {active ? '■' : '▶'}
        </span>
        <span>{sourceLabel}</span>
        {active && playback?.status === 'loading' && <span className="preview-play-state">…</span>}
      </button>
    )
  }

  return (
    <>
      <div className={`preview-buttons${showBrowser ? '' : ' is-single'}`}>
        {button(kokoroKey, 'kokoro', clipPath === null ? null : { source: 'kokoro', path: clipPath })}
        {showBrowser && button(browserKey, 'browser', speechSupported ? { source: 'browser', text } : null)}
      </div>
      {message !== null && (
        <p className="preview-message" role="status">
          {message}
        </p>
      )}
    </>
  )
}
