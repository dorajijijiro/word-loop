import { useEffect, useMemo, useState } from 'react'
import { wordRankLabels, wordRanks, type WordRank } from './data/words.ts'
import {
  buildVocabularyAudioEntries,
  clipPath,
  countByStatus,
  filterVocabularyAudio,
  parseVocabularyAudioManifest,
  vocabularyAudioDirectory,
  vocabularyAudioStatusLabels,
  type VocabularyAudioManifest,
  type VocabularyAudioStatus,
} from './lib/vocabularyAudio.ts'
import type { Playback, PlaybackKey, PlayRequest } from './lib/previewPlayback.ts'
import { PreviewButtons } from './PreviewButtons.tsx'

// Task 020: 全語彙の Kokoro 音声を英語・日本語で検索し、ランク・状態で絞り込んで試聴する。
// 一覧（manifest.json）だけを最初に読み込み、音声ファイルは再生ボタンを押した項目だけ読み込む。

type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: VocabularyAudioManifest }
  | { status: 'missing' }

// 一度に表示する件数（全項目を一度に描画しない）
const pageSize = 30

const statusOrder: VocabularyAudioStatus[] = [
  'needs-decision',
  'needs-review',
  'missing',
  'misread',
  'auto-verified',
  'listened',
]

const formatMegabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

type Props = {
  speechSupported: boolean
  playback: Playback | null
  errors: Partial<Record<PlaybackKey, string>>
  onPlay: (key: PlaybackKey, request: PlayRequest) => void
  onStop: () => void
}

export function VocabularyAudioPanel({ speechSupported, playback, errors, onPlay, onStop }: Props) {
  const [manifestState, setManifestState] = useState<ManifestState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [rank, setRank] = useState<WordRank | 'all'>('all')
  const [status, setStatus] = useState<VocabularyAudioStatus | 'all'>('all')
  const [limit, setLimit] = useState(pageSize)

  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}${vocabularyAudioDirectory}manifest.json`, { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => {
        const manifest = json === null ? null : parseVocabularyAudioManifest(json)
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

  const manifest = manifestState.status === 'ready' ? manifestState.manifest : null
  const entries = useMemo(() => buildVocabularyAudioEntries(manifest), [manifest])
  const counts = useMemo(() => countByStatus(entries), [entries])
  const results = useMemo(() => filterVocabularyAudio(entries, { query, rank, status }), [entries, query, rank, status])
  const generated = entries.length - counts.missing

  // 条件を変えたら先頭から表示し直し、見えなくなる項目の再生を止める
  const changeFilter = (update: () => void) => {
    onStop()
    update()
    setLimit(pageSize)
  }

  return (
    <>
      <section className="preview-panel" aria-labelledby="vocabulary-audio-title">
        <h2 id="vocabulary-audio-title" className="eyebrow">
          全語彙の Kokoro 音声
        </h2>
        {manifestState.status === 'loading' && <p className="note">音声の一覧を読み込み中…</p>}
        {manifestState.status === 'missing' && (
          <p className="preview-warning" role="status">
            全語彙の音声の一覧（manifest.json）を読み込めませんでした。音声は未生成として表示します。
          </p>
        )}
        {manifest !== null && (
          <dl className="preview-facts">
            <div>
              <dt>生成済み</dt>
              <dd>
                {generated} / {entries.length} 項目・MP3 合計 {formatMegabytes(manifest.totalBytes)}
              </dd>
            </div>
            <div>
              <dt>モデル・声</dt>
              <dd>
                {manifest.model.repoId}・{manifest.voice.id}（{manifest.voice.language}・速度 {manifest.speed}）
              </dd>
            </div>
            <div>
              <dt>状態</dt>
              <dd>
                {statusOrder
                  .filter((key) => counts[key] > 0)
                  .map((key) => `${vocabularyAudioStatusLabels[key]} ${counts[key]}`)
                  .join('・')}
              </dd>
            </div>
          </dl>
        )}
        <p className="note">
          「自動検査済み」は形式・長さ・音量などの機械的な検査だけを通ったもので、発音は人が聴いて確認していません。
          「要判断」は1項目に読みの違う意味が混ざっている語です。
        </p>
        {manifest !== null && <p className="note">{manifest.credit}</p>}
      </section>

      <section className="preview-filters" aria-label="検索と絞り込み">
        <label className="preview-field">
          <span>検索（英語・日本語）</span>
          <input
            type="search"
            value={query}
            placeholder="例: estimate / 見積"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(event) => {
              const value = event.target.value
              changeFilter(() => setQuery(value))
            }}
          />
        </label>
        <div className="preview-selects">
          <label className="preview-field">
            <span>ランク</span>
            <select
              value={rank}
              onChange={(event) => {
                const value = event.target.value as WordRank | 'all'
                changeFilter(() => setRank(value))
              }}
            >
              <option value="all">すべて</option>
              {wordRanks.map((key) => (
                <option key={key} value={key}>
                  {wordRankLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="preview-field">
            <span>状態</span>
            <select
              value={status}
              onChange={(event) => {
                const value = event.target.value as VocabularyAudioStatus | 'all'
                changeFilter(() => setStatus(value))
              }}
            >
              <option value="all">すべて</option>
              {statusOrder.map((key) => (
                <option key={key} value={key}>
                  {vocabularyAudioStatusLabels[key]}（{counts[key]}）
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="note" role="status">
          {results.length} 件{results.length > limit ? `（${limit} 件を表示）` : ''}
        </p>
      </section>

      <ol className="preview-list">
        {results.slice(0, limit).map((entry) => (
          <li key={entry.word.id} className="preview-item" data-word-id={entry.word.id}>
            <p className="preview-meta">
              <span>{wordRankLabels[entry.word.rank]}</span>
              <span className={`preview-status is-${entry.status}`}>{vocabularyAudioStatusLabels[entry.status]}</span>
              {entry.spec?.status === 'fixed' && <span>発音指定あり</span>}
            </p>
            <h3 className="preview-english" lang="en">
              {entry.word.english}
            </h3>
            <p className="preview-japanese">{entry.word.japanese}</p>
            <p className="preview-sense" lang="en">
              {entry.word.phrase}
            </p>
            {entry.clip !== null && (
              <p className="preview-ipa">
                発音記号 <span lang="en">/{entry.clip.phonemes}/</span>
                {entry.spec !== null && `（${entry.spec.sense}）`}
              </p>
            )}
            {entry.notes.length > 0 && (
              <ul className="preview-notes">
                {entry.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
            <PreviewButtons
              keyPrefix={`vocabulary:${entry.word.id}`}
              label={entry.word.english}
              text={entry.word.english}
              clipPath={entry.clip === null ? null : `${vocabularyAudioDirectory}${clipPath(entry.word.id)}`}
              missingMessage={manifestState.status === 'loading' ? null : 'Kokoro 音声は未生成です。'}
              speechSupported={speechSupported}
              playback={playback}
              errors={errors}
              onPlay={onPlay}
              onStop={onStop}
            />
            {entry.alternatives.map(({ alternative, clip }) => (
              <div key={alternative.key} className="preview-sentence">
                <p className="preview-sentence-japanese">
                  比較用の別の読み：{alternative.label}
                  {clip !== null && (
                    <>
                      {' '}
                      <span lang="en">/{clip.phonemes}/</span>
                    </>
                  )}
                </p>
                <PreviewButtons
                  keyPrefix={`vocabulary:${entry.word.id}:${alternative.key}`}
                  label={`${entry.word.english}（${alternative.label}）`}
                  text={entry.word.english}
                  clipPath={clip === null ? null : `${vocabularyAudioDirectory}${clipPath(entry.word.id, alternative.key)}`}
                  missingMessage={manifestState.status === 'loading' ? null : 'Kokoro 音声は未生成です。'}
                  kokoroLabel="Kokoro（別の読み）"
                  showBrowser={false}
                  speechSupported={speechSupported}
                  playback={playback}
                  errors={errors}
                  onPlay={onPlay}
                  onStop={onStop}
                />
              </div>
            ))}
          </li>
        ))}
      </ol>
      {results.length === 0 && <p className="note">該当する項目はありません。</p>}
      {results.length > limit && (
        <button type="button" className="preview-more" onClick={() => setLimit((current) => current + pageSize)}>
          さらに表示（残り {results.length - limit} 件）
        </button>
      )}
    </>
  )
}
