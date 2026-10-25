// ランク別語彙ファイルの1項目。[english, japanese, phrase, 追加情報?]
// type を省くと、english に空白があれば 'phrase'、なければ 'word' として扱う（phrasal verb だけ明示する）。
// placeholder を省いた項目は、画像未設定のニュートラル表示にする。
export type VocabularyEntry = [
  english: string,
  japanese: string,
  phrase: string,
  extras?: {
    type?: 'phrasal-verb'
    recallCue?: string
    placeholder?: string
  },
]
