import { businessAdvancedEntries } from './vocabulary/business-advanced.ts'
import { businessBasicEntries } from './vocabulary/business-basic.ts'
import { dailyAdvancedEntries } from './vocabulary/daily-advanced.ts'
import { dailyBasicEntries } from './vocabulary/daily-basic.ts'
import type { VocabularyEntry } from './vocabulary/entry.ts'
import { retiredEntries } from './vocabulary/retired.ts'

// 語彙のランク（Task 018）。大卒社会人の学びなおし向けに、中学レベルの語は含めない。
// daily-basic: 日常基礎（高校基礎〜日常生活でよく使う語） / daily-advanced: 日常応用（ニュース・意見・微妙なニュアンスの語）
// business-basic: ビジネス基礎（メール・会議・社内の定番語） / business-advanced: ビジネス応用（契約・財務・交渉・経営の語）
export type WordRank = 'daily-basic' | 'daily-advanced' | 'business-basic' | 'business-advanced'

// 易しい順。未回答の語はこの順に導入する。
export const wordRanks: WordRank[] = ['daily-basic', 'daily-advanced', 'business-basic', 'business-advanced']

export const wordRankLabels: Record<WordRank, string> = {
  'daily-basic': '日常基礎',
  'daily-advanced': '日常応用',
  'business-basic': 'ビジネス基礎',
  'business-advanced': 'ビジネス応用',
}

// 語彙項目の種類。phrase には chunk・定型表現も含める。
export type WordType = 'word' | 'phrase' | 'phrasal-verb'

export const wordTypes: WordType[] = ['word', 'phrase', 'phrasal-verb']

// 語彙項目（単語に限らず phrase / phrasal verb も含む）。id は保存データのキーなので一度決めたら変えない。
export type Word = {
  id: string
  english: string
  japanese: string
  phrase: string
  // Recall Encounter で英語を隠して出す、日本語の短い概念Cue（1〜2行、改行は \n）。
  // 辞書的な定義ではなく、場面・意図・対比・感覚を思い浮かべやすい説明にする。すべて自作。
  // 未設定の語は Recall の対象にしない（Task 014 以降、遠征では Recall を出さない）。
  recallCue?: string
  rank: WordRank
  type: WordType
  image: {
    id: string
    placeholder: string
    alt: string
  }
}

// 自然な絵文字がない抽象語・phrase 用の、意味を持たないニュートラルな表示。
export const neutralImagePlaceholder = '◌'

// english から id を作る（小文字、空白はハイフン）。
export const toWordId = (english: string) => english.toLowerCase().replaceAll(' ', '-')

const toWord = (rank: WordRank, [english, japanese, phrase, extras = {}]: VocabularyEntry): Word => {
  const id = toWordId(english)
  return {
    id,
    english,
    japanese,
    phrase,
    ...(extras.recallCue === undefined ? {} : { recallCue: extras.recallCue }),
    rank,
    type: extras.type ?? (english.includes(' ') ? 'phrase' : 'word'),
    image: { id, placeholder: extras.placeholder ?? neutralImagePlaceholder, alt: `${japanese}の表示領域` },
  }
}

const entriesByRank: Record<WordRank, VocabularyEntry[]> = {
  'daily-basic': dailyBasicEntries,
  'daily-advanced': dailyAdvancedEntries,
  'business-basic': businessBasicEntries,
  'business-advanced': businessAdvancedEntries,
}

// 出題する語彙。データの並びはランク順（選出はランダムなので、並び順そのものは学習に影響しない）。
export const words: Word[] = wordRanks.flatMap((rank) => entriesByRank[rank].map((entry) => toWord(rank, entry)))

// 中学レベルとして出題から外した語の id（Task 018）。保存済みの学習履歴・回答はこの id のまま残す。
export const retiredWordIds: string[] = retiredEntries.map(([english]) => toWordId(english))

// 語ごとのランクの順番（0 が最も易しい）。未回答の語を導入する順番に使う。
export const wordRankOrder: ReadonlyMap<string, number> = new Map(
  words.map((word) => [word.id, wordRanks.indexOf(word.rank)]),
)
