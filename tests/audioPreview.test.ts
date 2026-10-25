// Task 019: Kokoro 試聴用の項目一覧・音声一覧（manifest）・現在の読み上げの声の推定。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import {
  audioPreviewItems,
  describeSpeechVoices,
  getAudioPreviewClip,
  parseAudioPreviewManifest,
  type AudioPreviewManifest,
} from '../src/lib/audioPreview.ts'
import { wordRanks, words } from '../src/data/words.ts'

const audioDirectory = new URL('../public/audio/kokoro-preview/', import.meta.url)
const manifestUrl = new URL('manifest.json', audioDirectory)

test('項目: 約30項目、id は一意で、すべて既存の語彙を参照し英語表記が一致する', () => {
  assert.ok(audioPreviewItems.length >= 28 && audioPreviewItems.length <= 36, `${audioPreviewItems.length} 項目`)
  assert.equal(new Set(audioPreviewItems.map((item) => item.id)).size, audioPreviewItems.length)
  for (const item of audioPreviewItems) {
    assert.match(item.id, /^[a-z0-9-]+$/)
    assert.equal(item.word.english, item.english, item.id)
  }
})

test('項目: 4ランクすべて、phrase と phrasal verb を含み、例文は5項目以上', () => {
  assert.deepEqual(new Set(audioPreviewItems.map((item) => item.word.rank)), new Set(wordRanks))
  const types = new Set(audioPreviewItems.map((item) => item.word.type))
  assert.ok(types.has('phrase') && types.has('phrasal-verb') && types.has('word'))
  assert.ok(audioPreviewItems.filter((item) => item.sentence !== undefined).length >= 5)
})

test('項目: 同じ語を品詞で分けた項目には区別の表示があり、発音指定は [語](/記号/) 形式で英語表記を変えない', () => {
  const counts = new Map<string, number>()
  for (const item of audioPreviewItems) {
    counts.set(item.wordId, (counts.get(item.wordId) ?? 0) + 1)
  }
  for (const item of audioPreviewItems) {
    if ((counts.get(item.wordId) ?? 0) > 1) {
      assert.ok(item.sense !== null, `${item.id} に品詞・意味の区別がない`)
    }
    for (const input of [item.kokoroInput, item.sentence?.kokoroInput ?? '']) {
      for (const match of input.matchAll(/\[([^\]]+)\]\(\/[^/]+\/\)/g)) {
        assert.equal(match[1], item.english, `${item.id}: 発音指定の語が英語表記と違う`)
      }
    }
    if (item.kokoroInput !== item.english) {
      assert.ok(item.kokoroFix, `${item.id}: 発音を指定した理由がない`)
    }
  }
})

test('試聴項目は学習用語彙を増やさない（語彙の総数は Task 018 のまま）', () => {
  assert.equal(words.length, 1489)
})

const sampleManifest = (): AudioPreviewManifest => ({
  generatedAt: '2026-10-25T00:00:00+00:00',
  model: { repoId: 'hexgrad/Kokoro-82M', revision: 'abc', file: 'kokoro-v1_0.pth', license: 'Apache-2.0' },
  voice: { id: 'af_heart', language: 'en-US' },
  speed: 1,
  mimeType: 'audio/mpeg',
  credit: 'credit',
  files: {
    'permit-verb': {
      word: { path: 'permit-verb.mp3', text: 'permit', input: '[permit](/pəɹmˈɪt/)', phonemes: 'pəɹmˈɪt', bytes: 100, durationMs: 500, sha256: 'x' },
    },
  },
})

test('manifest: 形が正しければ読み、壊れていれば未生成扱い（null）', () => {
  assert.ok(parseAudioPreviewManifest(sampleManifest()) !== null)
  assert.equal(parseAudioPreviewManifest(null), null)
  assert.equal(parseAudioPreviewManifest({ ...sampleManifest(), files: [] }), null)
  const emptyFile = sampleManifest()
  emptyFile.files['permit-verb'].word!.bytes = 0
  assert.equal(parseAudioPreviewManifest(emptyFile), null)
  const badPath = sampleManifest()
  badPath.files['permit-verb'].word!.path = '../secret.mp3'
  assert.equal(parseAudioPreviewManifest(badPath), null)
})

test('manifest: 入力が items.json と違う音声（再生成していない）は使わない', () => {
  const manifest = parseAudioPreviewManifest(sampleManifest())
  const item = audioPreviewItems.find((entry) => entry.id === 'permit-verb')!
  assert.equal(getAudioPreviewClip(manifest, item, 'word')?.path, 'permit-verb.mp3')
  assert.equal(getAudioPreviewClip(manifest, item, 'sentence'), null)
  assert.equal(getAudioPreviewClip(null, item, 'word'), null)
  const changed = { ...item, kokoroInput: 'permit' }
  assert.equal(getAudioPreviewClip(manifest, changed, 'word'), null)
})

test('生成済み音声: manifest があれば全項目・例文がそろい、空ファイル・欠損・余分なファイルがない', (t) => {
  if (!existsSync(manifestUrl)) {
    t.skip('Kokoro 音声は未生成（public/audio/kokoro-preview/manifest.json がない）')
    return
  }
  const manifest = parseAudioPreviewManifest(JSON.parse(readFileSync(manifestUrl, 'utf8')))
  assert.ok(manifest !== null, 'manifest.json の形が正しくない')
  const expectedFiles = new Set<string>(['manifest.json'])
  for (const item of audioPreviewItems) {
    for (const kind of ['word', 'sentence'] as const) {
      if (kind === 'sentence' && item.sentence === undefined) {
        continue
      }
      const clip = getAudioPreviewClip(manifest, item, kind)
      assert.ok(clip !== null, `${item.id} ${kind} の音声がない、または入力が古い`)
      const data = readFileSync(new URL(clip.path, audioDirectory))
      assert.ok(data.length > 0, `${clip.path} が空`)
      assert.equal(data.length, clip.bytes, `${clip.path} のサイズが一覧と違う`)
      assert.equal(createHash('sha256').update(data).digest('hex'), clip.sha256, `${clip.path} の内容が一覧と違う`)
      expectedFiles.add(clip.path)
    }
  }
  assert.deepEqual(new Set(readdirSync(audioDirectory)), expectedFiles)
})

const voice = (name: string, lang: string, isDefault = false) => ({ name, lang, default: isDefault, localService: true })

test('現在の読み上げ: en-US の声を推定し、英語の声がなければ既定の声（日本語など）を警告できる', () => {
  const report = describeSpeechVoices([voice('Kyoko', 'ja-JP', true), voice('Daniel', 'en-GB'), voice('Samantha', 'en-US')])
  assert.equal(report.likelyVoice?.name, 'Samantha')
  assert.equal(report.defaultVoice?.name, 'Kyoko')
  assert.equal(report.englishVoices.length, 2)
  assert.equal(report.likelyVoiceIsEnglish, true)

  assert.equal(describeSpeechVoices([voice('Daniel', 'en_GB'), voice('Kyoko', 'ja-JP', true)]).likelyVoice?.name, 'Daniel')

  const japaneseOnly = describeSpeechVoices([voice('Kyoko', 'ja-JP', true)])
  assert.equal(japaneseOnly.likelyVoice?.name, 'Kyoko')
  assert.equal(japaneseOnly.likelyVoiceIsEnglish, false)

  assert.equal(describeSpeechVoices([]).likelyVoice, null)
})
