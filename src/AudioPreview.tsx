import { useCallback, useEffect, useRef, useState } from 'react'
import './AudioPreview.css'
import { wordRankLabels } from './data/words.ts'
import {
  audioPreviewDirectory,
  audioPreviewItems,
  describeSpeechVoices,
  getAudioPreviewClip,
  parseAudioPreviewManifest,
  type AudioClipKind,
  type AudioPreviewClip,
  type AudioPreviewManifest,
  type VoiceLike,
} from './lib/audioPreview.ts'

// Task 019: Kokoro の事前生成音声と、現在の読み上げ（ブラウザの音声合成）を聴き比べる試聴画面。
// 学習状態・回答・XP・Gold・猫には触れない（保存処理を一切 import しない）。
// 音声はボタンを押したときだけ再生し、別のボタンを押したら前の音声を止める。失敗しても別の方式へは切り替えない。

type Source = 'kokoro' | 'browser'

type PlaybackKey = `${string}:${AudioClipKind}:${Source}`

type Playback = { key: PlaybackKey; status: 'loading' | 'playing' }

type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: AudioPreviewManifest }
  | { status: 'missing' }

const toKey = (itemId: string, kind: AudioClipKind, source: Source): PlaybackKey => `${itemId}:${kind}:${source}`

// アプリ本体と同じ指定（lang だけ指定し、声は選ばない）
const browserSpeechLang = 'en-US'

const formatKilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

const describeVoice = (voice: VoiceLike | null) =>
  voice === null ? 'なし' : `${voice.name}（${voice.lang}${voice.localService ? '' : '・オンライン'}）`

export function AudioPreview() {
  const speechSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const [manifestState, setManifestState] = useState<ManifestState>({ status: 'loading' })
  const [voices, setVoices] = useState<VoiceLike[]>([])
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [errors, setErrors] = useState<Partial<Record<PlaybackKey, string>>>({})
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // 再生のたびに増やし、止めた後に届く古いイベントを無視する
  const tokenRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}${audioPreviewDirectory}manifest.json`, { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => {
        const manifest = json === null ? null : parseAudioPreviewManifest(json)
        if (!cancelled) {
          setManifestState(manifest === null ? { status: 'missing' } : { status: 'ready', manifest })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setManifestState({ status: 'missing' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!speechSupported) {
      return
    }
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices())
    updateVoices()
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', updateVoices)
  }, [speechSupported])

  const stopAll = useCallback(() => {
    tokenRef.current += 1
    const audio = audioRef.current
    if (audio !== null) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
    }
    if (speechSupported) {
      window.speechSynthesis.cancel()
    }
  }, [speechSupported])

  useEffect(() => stopAll, [stopAll])

  const finish = (token: number, key: PlaybackKey, error?: string) => {
    if (token !== tokenRef.current) {
      return
    }
    setPlayback(null)
    if (error !== undefined) {
      setErrors((current) => ({ ...current, [key]: error }))
    }
  }

  const start = (key: PlaybackKey) => {
    stopAll()
    setErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setPlayback({ key, status: 'loading' })
    return tokenRef.current
  }

  const playKokoro = (key: PlaybackKey, path: string) => {
    const token = start(key)
    const audio = new Audio(`${import.meta.env.BASE_URL}${audioPreviewDirectory}${path}`)
    audioRef.current = audio
    audio.addEventListener('playing', () => {
      if (token === tokenRef.current) {
        setPlayback({ key, status: 'playing' })
      }
    })
    audio.addEventListener('ended', () => finish(token, key))
    audio.addEventListener('error', () => finish(token, key, '音声ファイルを読み込めませんでした。'))
    audio.play().catch((error: unknown) => {
      const name = error instanceof DOMException ? error.name : ''
      finish(token, key, name === 'NotAllowedError' ? 'ブラウザが再生を許可しませんでした。' : '再生できませんでした。')
    })
  }

  const playBrowser = (key: PlaybackKey, text: string) => {
    if (!speechSupported) {
      setErrors((current) => ({ ...current, [key]: 'このブラウザは音声合成に対応していません。' }))
      return
    }
    const token = start(key)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = browserSpeechLang
    utterance.addEventListener('start', () => {
      if (token === tokenRef.current) {
        setPlayback({ key, status: 'playing' })
      }
    })
    utterance.addEventListener('end', () => finish(token, key))
    utterance.addEventListener('error', (event) => {
      // 別のボタンで止めたときの interrupted / canceled は失敗として出さない
      finish(token, key, `読み上げに失敗しました（${event.error}）。`)
    })
    window.speechSynthesis.speak(utterance)
  }

  const stop = () => {
    stopAll()
    setPlayback(null)
  }

  const play = (key: PlaybackKey, request: PlayRequest) => {
    if (request.source === 'kokoro') {
      playKokoro(key, request.path)
    } else {
      playBrowser(key, request.text)
    }
  }

  const manifest = manifestState.status === 'ready' ? manifestState.manifest : null
  const voiceReport = describeSpeechVoices(voices, browserSpeechLang)
  const totalBytes =
    manifest === null
      ? 0
      : Object.values(manifest.files).reduce(
          (sum, clips) => sum + (clips.word?.bytes ?? 0) + (clips.sentence?.bytes ?? 0),
          0,
        )

  return (
    <main className="audio-preview">
      <header className="preview-header">
        <a className="preview-back" href="#">
          ← 戻る
        </a>
        <h1>音声の試聴（Kokoro 試作）</h1>
        <p className="note">
          {audioPreviewItems.length} 項目。ボタンを押したときだけ再生します。試聴は学習の記録・XP・Gold・猫に影響しません。
        </p>
      </header>

      <section className="preview-panel" aria-labelledby="preview-kokoro-title">
        <h2 id="preview-kokoro-title" className="eyebrow">
          Kokoro
        </h2>
        {manifestState.status === 'loading' && <p className="note">音声の一覧を読み込み中…</p>}
        {manifestState.status === 'missing' && (
          <p className="preview-warning" role="status">
            Kokoro の音声はまだ生成されていません（音声の一覧 manifest.json がありません）。現在の読み上げだけ再生できます。
          </p>
        )}
        {manifest !== null && (
          <dl className="preview-facts">
            <div>
              <dt>モデル</dt>
              <dd>
                {manifest.model.repoId}（{manifest.model.license}）
              </dd>
            </div>
            <div>
              <dt>声</dt>
              <dd>
                {manifest.voice.id}（{manifest.voice.language}・速度 {manifest.speed}）
              </dd>
            </div>
            <div>
              <dt>音声</dt>
              <dd>
                MP3・合計 {formatKilobytes(totalBytes)}・{manifest.generatedAt.slice(0, 10)} 生成
              </dd>
            </div>
          </dl>
        )}
        {manifest !== null && <p className="note">{manifest.credit}</p>}
      </section>

      <section className="preview-panel" aria-labelledby="preview-browser-title">
        <h2 id="preview-browser-title" className="eyebrow">
          現在の読み上げ
        </h2>
        {!speechSupported ? (
          <p className="preview-warning">このブラウザは音声合成に対応していません。</p>
        ) : (
          <>
            <dl className="preview-facts">
              <div>
                <dt>指定</dt>
                <dd>言語 {browserSpeechLang}・声は指定なし（アプリ本体と同じ）</dd>
              </div>
              <div>
                <dt>使われそうな声</dt>
                <dd>
                  {describeVoice(voiceReport.likelyVoice)}
                  {voiceReport.likelyVoice !== null && !voiceReport.likelyVoiceIsEnglish && (
                    <strong className="preview-alert">　英語の声ではありません</strong>
                  )}
                </dd>
              </div>
              <div>
                <dt>既定の声</dt>
                <dd>{describeVoice(voiceReport.defaultVoice)}</dd>
              </div>
              <div>
                <dt>英語の声</dt>
                <dd>{voiceReport.englishVoices.length} 件</dd>
              </div>
            </dl>
            <p className="note">
              ブラウザは実際に使った声を知らせないため、「使われそうな声」は一覧からの推定です。
              {voices.length === 0 && ' 声の一覧が空です（読み込み前か、このブラウザが一覧を出さない場合があります）。'}
            </p>
            {voiceReport.englishVoices.length > 0 && (
              <details className="preview-voices">
                <summary>英語の声の一覧</summary>
                <ul>
                  {voiceReport.englishVoices.map((voice) => (
                    <li key={`${voice.name}-${voice.lang}`}>
                      {describeVoice(voice)}
                      {voice.default ? '・既定' : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      <ol className="preview-list">
        {audioPreviewItems.map((item) => (
          <li key={item.id} className="preview-item">
            <p className="preview-meta">
              <span>{wordRankLabels[item.word.rank]}</span>
              <span>{item.focus}</span>
            </p>
            <h2 className="preview-english" lang="en">
              {item.english}
            </h2>
            <p className="preview-japanese">{item.word.japanese}</p>
            {item.sense !== null && <p className="preview-sense">{item.sense}</p>}
            <p className="preview-ipa">
              期待する発音 <span lang="en">/{item.expected.ipa}/</span>
            </p>
            <PreviewButtons
              itemId={item.id}
              kind="word"
              label={item.english}
              text={item.english}
              clip={getAudioPreviewClip(manifest, item, 'word')}
              manifestLoading={manifestState.status === 'loading'}
              speechSupported={speechSupported}
              playback={playback}
              errors={errors}
              onPlay={play}
              onStop={stop}
            />
            {item.sentence !== undefined && (
              <div className="preview-sentence">
                <p className="preview-sentence-english" lang="en">
                  {item.sentence.english}
                </p>
                <p className="preview-sentence-japanese">{item.sentence.japanese}</p>
                <PreviewButtons
                  itemId={item.id}
                  kind="sentence"
                  label="例文"
                  text={item.sentence.english}
                  clip={getAudioPreviewClip(manifest, item, 'sentence')}
                  manifestLoading={manifestState.status === 'loading'}
                  speechSupported={speechSupported}
                  playback={playback}
                  errors={errors}
                  onPlay={play}
                  onStop={stop}
                />
              </div>
            )}
          </li>
        ))}
      </ol>

      <footer className="preview-footer">
        <a className="preview-back" href="#">
          ← 戻る
        </a>
      </footer>
    </main>
  )
}

type PlayRequest = { source: 'kokoro'; path: string } | { source: 'browser'; text: string }

type PreviewButtonsProps = {
  itemId: string
  kind: AudioClipKind
  label: string
  text: string
  clip: AudioPreviewClip | null
  manifestLoading: boolean
  speechSupported: boolean
  playback: Playback | null
  errors: Partial<Record<PlaybackKey, string>>
  onPlay: (key: PlaybackKey, request: PlayRequest) => void
  onStop: () => void
}

// 1つの音声（単語・句または例文）の「Kokoro」「現在の読み上げ」ボタンと、未生成・失敗の表示
function PreviewButtons({
  itemId,
  kind,
  label,
  text,
  clip,
  manifestLoading,
  speechSupported,
  playback,
  errors,
  onPlay,
  onStop,
}: PreviewButtonsProps) {
  const kokoroKey = toKey(itemId, kind, 'kokoro')
  const browserKey = toKey(itemId, kind, 'browser')
  const message =
    errors[kokoroKey] ?? errors[browserKey] ?? (!manifestLoading && clip === null ? 'Kokoro 音声は未生成です。' : null)

  const button = (key: PlaybackKey, source: Source, request: PlayRequest | null) => {
    const active = playback?.key === key
    const sourceLabel = source === 'kokoro' ? 'Kokoro' : '現在の読み上げ'
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
      <div className="preview-buttons">
        {button(kokoroKey, 'kokoro', clip === null ? null : { source: 'kokoro', path: clip.path })}
        {button(browserKey, 'browser', speechSupported ? { source: 'browser', text } : null)}
      </div>
      {message !== null && (
        <p className="preview-message" role="status">
          {message}
        </p>
      )}
    </>
  )
}
