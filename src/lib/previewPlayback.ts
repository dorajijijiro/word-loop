// Task 019・020: 試聴画面の再生状態の型（どのボタンの音声を再生中か）。
export type Source = 'kokoro' | 'browser'

export type PlaybackKey = string

export type Playback = { key: PlaybackKey; status: 'loading' | 'playing' }

// path は public/ からの相対パス
export type PlayRequest = { source: 'kokoro'; path: string } | { source: 'browser'; text: string }

export const toKey = (prefix: string, source: Source): PlaybackKey => `${prefix}:${source}`
