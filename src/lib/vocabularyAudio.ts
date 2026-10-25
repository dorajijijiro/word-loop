// Task 020: 全語彙の Kokoro 音声の一覧・状態・検索（試聴画面専用。学習履歴・回答・報酬には一切触れない）。
import pronunciationData from '../data/vocabularyAudio/pronunciations.json' with { type: 'json' }
import reviewData from '../data/vocabularyAudio/reviews.json' with { type: 'json' }
import { words, type Word, type WordRank } from '../data/words.ts'

export const vocabularyAudioDirectory = 'audio/kokoro-vocabulary/'

export type PronunciationAlternative = { key: string; label: string; input: string }

// pronunciations.json の1項目。表示用の英語は変えず、Kokoro に渡す入力だけを指定する。
export type PronunciationSpec = {
  status: 'fixed' | 'needs-decision'
  input: string
  sense: string
  reason: string
  sources: string[]
  alternatives?: PronunciationAlternative[]
}

export type ReviewResult = { result: 'ok' | 'misread'; sha256: string; date: string; note?: string }

export const pronunciationSpecs: Record<string, PronunciationSpec> = pronunciationData.items as Record<
  string,
  PronunciationSpec
>

export const reviewResults: Record<string, ReviewResult> = reviewData.reviews as Record<string, ReviewResult>

// Kokoro に渡す入力。発音指定がなければ表示用の英語をそのまま読ませる。
export const kokoroInputFor = (word: Pick<Word, 'id' | 'english'>) => pronunciationSpecs[word.id]?.input ?? word.english

export type VocabularyClip = {
  wordId: string
  key?: string
  text: string
  input: string
  override: boolean
  phonemes: string
  revision: string
  voice: string
  speed: number
  bytes: number
  durationMs: number
  sha256: string
  warnings: string[]
}

export type UnresolvedAudio = { wordId: string; path: string; reason: string }

// tools/kokoro/generate_vocabulary.py が書き出す manifest.json
export type VocabularyAudioManifest = {
  generatedAt: string
  model: { repoId: string; revision: string; license: string }
  voice: { id: string; language: string }
  speed: number
  credit: string
  targetCount: number
  fileCount: number
  totalBytes: number
  unresolved: UnresolvedAudio[]
  files: Record<string, VocabularyClip>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const vocabularyAudioPathPattern = /^[a-z0-9-]+(\.[a-z]+)?\.mp3$/

const isClip = (path: string, value: unknown): value is VocabularyClip =>
  vocabularyAudioPathPattern.test(path) &&
  isRecord(value) &&
  typeof value.wordId === 'string' &&
  typeof value.input === 'string' &&
  typeof value.phonemes === 'string' &&
  typeof value.bytes === 'number' &&
  value.bytes > 0 &&
  typeof value.durationMs === 'number' &&
  typeof value.sha256 === 'string' &&
  Array.isArray(value.warnings)

// 形が合わない manifest は「未生成」と同じ扱いにする（壊れた一覧から推測で再生しない）。
export const parseVocabularyAudioManifest = (value: unknown): VocabularyAudioManifest | null => {
  if (
    !isRecord(value) ||
    typeof value.generatedAt !== 'string' ||
    !isRecord(value.model) ||
    !isRecord(value.voice) ||
    typeof value.speed !== 'number' ||
    typeof value.credit !== 'string' ||
    typeof value.totalBytes !== 'number' ||
    !Array.isArray(value.unresolved) ||
    !isRecord(value.files)
  ) {
    return null
  }
  for (const [path, clip] of Object.entries(value.files)) {
    if (!isClip(path, clip)) {
      return null
    }
  }
  return value as VocabularyAudioManifest
}

export const clipPath = (wordId: string, key?: string) => `${wordId}${key === undefined ? '' : `.${key}`}.mp3`

// 音声の状態。
// listened: 人が試聴済み（reviews.json。聴いた音声と今の音声のハッシュが一致するもの）
// misread: 人が聴いて誤読・聞き取りにくいと判断した
// needs-decision: 要判断（読みの違う意味が混在）
// needs-review: 要確認（発音指定あり、または自動検査で警告）
// auto-verified: 自動検査済み（未試聴）
// missing: 未生成・生成失敗・入力が今の指定と食い違う
export type VocabularyAudioStatus = 'listened' | 'misread' | 'needs-decision' | 'needs-review' | 'auto-verified' | 'missing'

export const vocabularyAudioStatusLabels: Record<VocabularyAudioStatus, string> = {
  listened: '試聴済み',
  misread: '誤読あり',
  'needs-decision': '要判断',
  'needs-review': '要確認',
  'auto-verified': '自動検査済み・未試聴',
  missing: '未生成',
}

export type VocabularyAudioEntry = {
  word: Word
  input: string
  spec: PronunciationSpec | null
  clip: VocabularyClip | null
  alternatives: { alternative: PronunciationAlternative; clip: VocabularyClip | null }[]
  status: VocabularyAudioStatus
  // 状態の理由（未生成の理由、自動検査の警告、発音指定の理由など）
  notes: string[]
}

// manifest の音声のうち、今の入力と一致するものだけを使う（指定を変えて再生成していない音声は使わない）。
const currentClip = (manifest: VocabularyAudioManifest | null, wordId: string, input: string, key?: string) => {
  const clip = manifest?.files[clipPath(wordId, key)]
  return clip !== undefined && clip.wordId === wordId && clip.input === input ? clip : null
}

export const buildVocabularyAudioEntries = (
  manifest: VocabularyAudioManifest | null,
  reviews: Record<string, ReviewResult> = reviewResults,
  specs: Record<string, PronunciationSpec> = pronunciationSpecs,
  vocabulary: Word[] = words,
): VocabularyAudioEntry[] =>
  vocabulary.map((word) => {
    const spec = specs[word.id] ?? null
    const input = spec?.input ?? word.english
    const clip = currentClip(manifest, word.id, input)
    const alternatives = (spec?.alternatives ?? []).map((alternative) => ({
      alternative,
      clip: currentClip(manifest, word.id, alternative.input, alternative.key),
    }))
    const notes: string[] = []
    let status: VocabularyAudioStatus
    const review = reviews[word.id]
    if (clip === null) {
      status = 'missing'
      const unresolved = manifest?.unresolved.find((item) => item.wordId === word.id && item.path === clipPath(word.id))
      notes.push(unresolved?.reason ?? (manifest === null ? '音声の一覧がありません' : '今の発音指定の音声がありません'))
    } else if (review !== undefined && review.sha256 === clip.sha256) {
      status = review.result === 'ok' ? 'listened' : 'misread'
      if (review.note !== undefined) {
        notes.push(review.note)
      }
    } else if (spec?.status === 'needs-decision') {
      status = 'needs-decision'
    } else if (spec?.status === 'fixed' || clip.warnings.length > 0) {
      status = 'needs-review'
    } else {
      status = 'auto-verified'
    }
    if (clip !== null) {
      notes.push(...clip.warnings)
    }
    if (spec !== null) {
      notes.push(spec.reason)
    }
    return { word, input, spec, clip, alternatives, status, notes }
  })

export type VocabularyAudioFilter = {
  query: string
  rank: WordRank | 'all'
  status: VocabularyAudioStatus | 'all'
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().trim()

// 英語・日本語の部分一致で検索し、ランク・状態で絞り込む。英語が前方一致する項目を先に並べる。
export const filterVocabularyAudio = (entries: VocabularyAudioEntry[], filter: VocabularyAudioFilter) => {
  const query = normalize(filter.query)
  const matches = entries.filter(
    (entry) =>
      (filter.rank === 'all' || entry.word.rank === filter.rank) &&
      (filter.status === 'all' || entry.status === filter.status) &&
      (query === '' ||
        normalize(entry.word.english).includes(query) ||
        normalize(entry.word.japanese).includes(query)),
  )
  if (query === '') {
    return matches
  }
  const starts = (entry: VocabularyAudioEntry) => (normalize(entry.word.english).startsWith(query) ? 0 : 1)
  return matches
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => starts(a.entry) - starts(b.entry) || a.index - b.index)
    .map(({ entry }) => entry)
}

export const countByStatus = (entries: VocabularyAudioEntry[]) => {
  const counts: Record<VocabularyAudioStatus, number> = {
    listened: 0,
    misread: 0,
    'needs-decision': 0,
    'needs-review': 0,
    'auto-verified': 0,
    missing: 0,
  }
  for (const entry of entries) {
    counts[entry.status] += 1
  }
  return counts
}
