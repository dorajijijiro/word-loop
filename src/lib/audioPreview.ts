// Task 019: Kokoro 試聴画面のデータ処理（試聴専用。学習履歴・回答・報酬には一切触れない）。
import previewData from '../data/audioPreview/items.json' with { type: 'json' }
import { words, type Word } from '../data/words.ts'

export type AudioPreviewSentence = {
  english: string
  japanese: string
  kokoroInput: string
}

// items.json の1項目。日本語訳・ランクは語彙（wordId）から引く。
export type AudioPreviewItemSource = {
  id: string
  wordId: string
  english: string
  // 同じ綴りで品詞・意味により読みが変わる語の区別（不要なら null）
  sense: string | null
  focus: string
  expected: { ipa: string; cmudict: string; note?: string }
  // Kokoro へ渡す文字列。発音を指定する場合は misaki の [語](/発音記号/) 形式。画面の英語表記には使わない。
  kokoroInput: string
  kokoroFix?: string
  sentence?: AudioPreviewSentence
}

export type AudioPreviewItem = AudioPreviewItemSource & { word: Word }

export const audioPreviewItemSources: AudioPreviewItemSource[] = previewData.items

const wordsById = new Map(words.map((word) => [word.id, word]))

export const audioPreviewItems: AudioPreviewItem[] = audioPreviewItemSources.map((item) => {
  const word = wordsById.get(item.wordId)
  if (word === undefined) {
    throw new Error(`audio preview item ${item.id} refers to unknown word ${item.wordId}`)
  }
  return { ...item, word }
})

export type AudioClipKind = 'word' | 'sentence'

export type AudioPreviewClip = {
  path: string
  text: string
  input: string
  phonemes: string
  bytes: number
  durationMs: number
  sha256: string
}

// tools/kokoro/generate.py が書き出す manifest.json
export type AudioPreviewManifest = {
  generatedAt: string
  model: { repoId: string; revision: string; file: string; license: string }
  voice: { id: string; language: string }
  speed: number
  mimeType: string
  credit: string
  files: Record<string, Partial<Record<AudioClipKind, AudioPreviewClip>>>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isClip = (value: unknown): value is AudioPreviewClip =>
  isRecord(value) &&
  typeof value.path === 'string' &&
  /^[a-z0-9-]+(\.sentence)?\.mp3$/.test(value.path) &&
  typeof value.text === 'string' &&
  typeof value.input === 'string' &&
  typeof value.phonemes === 'string' &&
  typeof value.bytes === 'number' &&
  value.bytes > 0 &&
  typeof value.durationMs === 'number' &&
  typeof value.sha256 === 'string'

// 形が合わない manifest は「未生成」と同じ扱いにする（壊れた一覧から推測で再生しない）。
export const parseAudioPreviewManifest = (value: unknown): AudioPreviewManifest | null => {
  if (
    !isRecord(value) ||
    typeof value.generatedAt !== 'string' ||
    !isRecord(value.model) ||
    !isRecord(value.voice) ||
    typeof value.voice.id !== 'string' ||
    typeof value.speed !== 'number' ||
    typeof value.mimeType !== 'string' ||
    typeof value.credit !== 'string' ||
    !isRecord(value.files)
  ) {
    return null
  }
  const files: AudioPreviewManifest['files'] = {}
  for (const [itemId, entry] of Object.entries(value.files)) {
    if (!isRecord(entry)) {
      return null
    }
    const clips: Partial<Record<AudioClipKind, AudioPreviewClip>> = {}
    for (const kind of ['word', 'sentence'] as const) {
      const clip = entry[kind]
      if (clip === undefined) {
        continue
      }
      if (!isClip(clip)) {
        return null
      }
      clips[kind] = clip
    }
    files[itemId] = clips
  }
  return { ...(value as AudioPreviewManifest), files }
}

// 項目の音声。manifest にない・入力が items.json と食い違う（再生成していない）ものは null（未生成として表示）。
export const getAudioPreviewClip = (
  manifest: AudioPreviewManifest | null,
  item: AudioPreviewItemSource,
  kind: AudioClipKind,
): AudioPreviewClip | null => {
  const clip = manifest?.files[item.id]?.[kind]
  if (clip === undefined) {
    return null
  }
  const input = kind === 'word' ? item.kokoroInput : item.sentence?.kokoroInput
  return clip.input === input ? clip : null
}

export const audioPreviewDirectory = 'audio/kokoro-preview/'

export type VoiceLike = { name: string; lang: string; default: boolean; localService: boolean }

const normalizeLang = (lang: string) => lang.replace('_', '-').toLowerCase()

export type SpeechVoiceReport = {
  // ブラウザの既定の声（言語を問わない）
  defaultVoice: VoiceLike | null
  englishVoices: VoiceLike[]
  // lang = en-US・声の指定なしで読ませたときに使われると考えられる声（ブラウザは実際の声を通知しないため推定）
  likelyVoice: VoiceLike | null
  likelyVoiceIsEnglish: boolean
}

// アプリ本体の読み上げ（utterance.lang = 'en-US'、voice 未指定）で選ばれそうな声を推定する。
// 一般的なブラウザの挙動に合わせ、lang が完全一致する声（既定の声を優先）→ 英語の声 → 既定の声 の順に探す。
export const describeSpeechVoices = (voices: readonly VoiceLike[], lang = 'en-US'): SpeechVoiceReport => {
  const target = normalizeLang(lang)
  const defaultVoice = voices.find((voice) => voice.default) ?? null
  const englishVoices = voices.filter((voice) => normalizeLang(voice.lang).startsWith('en'))
  const exact = voices.filter((voice) => normalizeLang(voice.lang) === target)
  const likelyVoice = exact.find((voice) => voice.default) ?? exact[0] ?? englishVoices[0] ?? defaultVoice
  return {
    defaultVoice,
    englishVoices,
    likelyVoice,
    likelyVoiceIsEnglish: likelyVoice !== null && normalizeLang(likelyVoice.lang).startsWith('en'),
  }
}
