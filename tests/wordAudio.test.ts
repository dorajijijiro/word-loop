// Task 021: 通常の遠征の Kokoro 音声（表示中の語の再生・切り替え・停止・失敗の区別）。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import audioIndex from '../src/data/vocabularyAudio/audio-index.json' with { type: 'json' }
import { words } from '../src/data/words.ts'
import {
  createWordAudioPlayer,
  getWordAudioUrl,
  wordAudioDirectory,
  type AudioElementLike,
  type WordAudioEvent,
} from '../src/lib/wordAudio.ts'

// HTMLAudioElement の偽物。play() の結果とイベントをテストから起こす。
class FakeAudio implements AudioElementLike {
  src = ''
  preload = ''
  paused = true
  loads = 0
  plays: { src: string; resolve: () => void; reject: (error: unknown) => void }[] = []
  private listeners: { type: string; listener: () => void; signal?: AbortSignal }[] = []

  play() {
    this.paused = false
    return new Promise<void>((resolve, reject) => {
      this.plays.push({ src: this.src, resolve, reject })
    })
  }
  pause() {
    this.paused = true
  }
  load() {
    this.loads += 1
  }
  removeAttribute(name: string) {
    if (name === 'src') {
      this.src = ''
    }
  }
  addEventListener(type: string, listener: () => void, options?: { signal?: AbortSignal }) {
    this.listeners.push({ type, listener, signal: options?.signal })
  }
  emit(type: string) {
    for (const entry of this.listeners) {
      if (entry.type === type && entry.signal?.aborted !== true) {
        entry.listener()
      }
    }
  }
}

const versions = { improve: 'aaaa1111', provide: 'bbbb2222' }
const flush = () => new Promise((resolve) => setImmediate(resolve))

const setup = () => {
  const events: WordAudioEvent[] = []
  const created: FakeAudio[] = []
  const player = createWordAudioPlayer({
    createAudio: () => {
      const audio = new FakeAudio()
      created.push(audio)
      return audio
    },
    resolveUrl: (wordId) => getWordAudioUrl(wordId, '/', versions),
    onEvent: (event) => events.push(event),
  })
  return { player, events, created, audio: () => created[0] }
}

const notAllowed = () => Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

test('URL: wordId のファイルにハッシュを付ける。一覧にない語は null（通信しない）', () => {
  assert.equal(getWordAudioUrl('improve', '/', versions), '/audio/kokoro-vocabulary/improve.mp3?v=aaaa1111')
  assert.equal(getWordAudioUrl('improve', '/word-loop/', versions), '/word-loop/audio/kokoro-vocabulary/improve.mp3?v=aaaa1111')
  assert.equal(getWordAudioUrl('unknown', '/', versions), null)
})

test('再生: 表示中の語の音声を読み込んで再生し、再生できたら playing・終われば ended', async () => {
  const { player, events, audio } = setup()
  player.play('improve')
  assert.equal(audio().src, '/audio/kokoro-vocabulary/improve.mp3?v=aaaa1111')
  assert.equal(audio().plays.length, 1)
  audio().emit('playing')
  audio().emit('ended')
  assert.deepEqual(events, [
    { type: 'loading', wordId: 'improve' },
    { type: 'playing', wordId: 'improve' },
    { type: 'ended', wordId: 'improve' },
  ])
})

test('切り替え: 次の語では同じ音声要素を使い、前の語の遅れた結果・イベントは無視する', async () => {
  const { player, events, created, audio } = setup()
  player.play('improve')
  const first = audio().plays[0]
  player.play('provide')
  assert.equal(created.length, 1, '音声要素は1つだけ（重ねて再生しない）')
  assert.equal(audio().src, '/audio/kokoro-vocabulary/provide.mp3?v=bbbb2222')
  // 前の語の play() が遅れて失敗・成功しても、今の語の状態は変わらない
  first.reject(aborted())
  first.resolve()
  await flush()
  audio().emit('playing')
  assert.deepEqual(events, [
    { type: 'loading', wordId: 'improve' },
    { type: 'loading', wordId: 'provide' },
    { type: 'playing', wordId: 'provide' },
  ])
})

test('連打: 同じ語でも読み込み直して先頭から再生する', () => {
  const { player, audio } = setup()
  player.play('improve')
  player.play('improve')
  player.play('improve')
  assert.equal(audio().plays.length, 3)
  assert.equal(audio().loads, 3)
})

test('停止: 再生・読み込みをやめ、その後に届いたイベントは無視する', async () => {
  const { player, events, audio } = setup()
  player.play('improve')
  const pending = audio().plays[0]
  player.stop()
  assert.equal(audio().paused, true)
  assert.equal(audio().src, '')
  audio().emit('playing')
  audio().emit('error')
  pending.reject(aborted())
  await flush()
  assert.deepEqual(events, [{ type: 'loading', wordId: 'improve' }, { type: 'stopped' }])
})

test('まだ一度も再生していなければ、停止しても音声要素を作らない', () => {
  const { player, created } = setup()
  player.stop()
  assert.equal(created.length, 0)
})

test('失敗の区別: 一覧にない（missing）・読み込み失敗（load-failed）・自動再生の拒否（blocked）', async () => {
  const { player, events, audio } = setup()
  player.play('unknown')
  assert.deepEqual(events.at(-1), { type: 'failed', wordId: 'unknown', reason: 'missing' })

  player.play('improve')
  audio().emit('error')
  assert.deepEqual(events.at(-1), { type: 'failed', wordId: 'improve', reason: 'load-failed' })

  player.play('provide')
  audio().plays.at(-1)!.reject(notAllowed())
  await flush()
  assert.deepEqual(events.at(-1), { type: 'failed', wordId: 'provide', reason: 'blocked' })

  // 拒否された後に押して再生し直し、再生できたら playing（表示を消す合図）
  player.play('provide')
  audio().emit('playing')
  assert.deepEqual(events.at(-1), { type: 'playing', wordId: 'provide' })
})

test('一覧にない語のときも、前の語の音声は止める', () => {
  const { player, audio } = setup()
  player.play('improve')
  player.play('unknown')
  assert.equal(audio().paused, true)
  assert.equal(audio().src, '')
})

test('遠征用の音声一覧: 出題する全語彙を含み、Task 020 の manifest のハッシュと一致する', () => {
  const files: Record<string, string> = audioIndex.files
  assert.deepEqual(Object.keys(files).sort(), words.map((word) => word.id).sort())
  const manifestUrl = new URL(`../public/${wordAudioDirectory}manifest.json`, import.meta.url)
  assert.ok(existsSync(manifestUrl))
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
    files: Record<string, { wordId: string; key?: string; sha256: string }>
  }
  for (const word of words) {
    const entry = manifest.files[`${word.id}.mp3`]
    assert.ok(entry !== undefined && entry.key === undefined, word.id)
    assert.equal(files[word.id], entry.sha256.slice(0, 8), `${word.id}: 一覧のハッシュが音声と違う（作り直した後に一覧を更新していない）`)
    // 要判断の語も、補助文の意味に合わせた主の音声（{wordId}.mp3）を使う。比較用の別の読みは使わない
    assert.ok(getWordAudioUrl(word.id, '/')!.startsWith(`/${wordAudioDirectory}${word.id}.mp3?v=`))
  }
})

test('非表示の間: 新しい再生を始めず前の音声も止め、表示に戻っても見送った音声を後から再生しない', () => {
  const events: WordAudioEvent[] = []
  let visible = true
  const created: FakeAudio[] = []
  const player = createWordAudioPlayer({
    createAudio: () => {
      const audio = new FakeAudio()
      created.push(audio)
      return audio
    },
    resolveUrl: (wordId) => getWordAudioUrl(wordId, '/', versions),
    onEvent: (event) => events.push(event),
    canPlay: () => visible,
  })
  player.play('improve')
  const audio = created[0]
  assert.equal(audio.plays.length, 1)
  visible = false
  // 自動送りで何度カードが変わっても再生しない
  player.play('provide')
  player.play('improve')
  player.play('provide')
  assert.equal(audio.plays.length, 1)
  assert.equal(audio.paused, true)
  assert.equal(audio.src, '')
  // 非表示の前に始めた再生のイベントが遅れて届いても無視する
  audio.emit('playing')
  assert.deepEqual(
    events.filter((event) => event.type === 'suppressed').map((event) => event.type === 'suppressed' && event.wordId),
    ['provide', 'improve', 'provide'],
  )
  assert.ok(!events.some((event) => event.type === 'playing'))
  // 表示に戻っただけでは何も再生しない。次の再生（カードの切り替え・手動）から通常どおり
  visible = true
  assert.equal(audio.plays.length, 1)
  player.play('improve')
  assert.equal(audio.plays.length, 2)
  assert.equal(audio.src, '/audio/kokoro-vocabulary/improve.mp3?v=aaaa1111')
})
