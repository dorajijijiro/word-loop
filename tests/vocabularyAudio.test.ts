// Task 020: 全語彙の Kokoro 音声（発音指定・音声一覧・状態・検索）。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { retiredWordIds, wordRanks, words } from '../src/data/words.ts'
import {
  buildVocabularyAudioEntries,
  clipPath,
  countByStatus,
  filterVocabularyAudio,
  kokoroInputFor,
  parseVocabularyAudioManifest,
  pronunciationSpecs,
  reviewResults,
  vocabularyAudioPathPattern,
  type VocabularyAudioManifest,
  type VocabularyClip,
} from '../src/lib/vocabularyAudio.ts'

const audioDirectory = new URL('../public/audio/kokoro-vocabulary/', import.meta.url)
const manifestUrl = new URL('manifest.json', audioDirectory)
const wordIds = new Set(words.map((word) => word.id))
const pinnedRevision = 'f3ff3571791e39611d31c381e3a41a3af07b4987'

const specEntries = Object.entries(pronunciationSpecs)

test('発音指定: 出題する語だけを対象にし、[英語](/発音記号/) 形式で表示用の英語を変えない', () => {
  for (const [wordId, spec] of specEntries) {
    const word = words.find((item) => item.id === wordId)
    assert.ok(word !== undefined, `${wordId} は出題する語ではない`)
    assert.ok(!retiredWordIds.includes(wordId), `${wordId} は引退した語`)
    for (const input of [spec.input, ...(spec.alternatives ?? []).map((alternative) => alternative.input)]) {
      const match = /^\[([^\]]+)\]\(\/[^/]+\/\)$/.exec(input)
      assert.ok(match !== null, `${wordId}: ${input} が発音指定の形式ではない`)
      assert.equal(match[1], word.english, `${wordId}: 発音指定の語が英語表記と違う`)
    }
    assert.ok(spec.reason.length > 0 && spec.sense.length > 0, `${wordId}: 理由・意味がない`)
    assert.ok(spec.sources.length > 0, `${wordId}: 参照元がない`)
    assert.equal(kokoroInputFor(word), spec.input)
  }
})

test('発音指定: 要判断の語は比較用の別の読みを持ち、主の読みとは違う入力にする', () => {
  const decisions = specEntries.filter(([, spec]) => spec.status === 'needs-decision')
  assert.ok(decisions.length > 0)
  for (const [wordId, spec] of decisions) {
    const alternatives = spec.alternatives ?? []
    assert.ok(alternatives.length > 0, `${wordId}: 別の読みがない`)
    const keys = alternatives.map((alternative) => alternative.key)
    assert.equal(new Set(keys).size, keys.length)
    for (const alternative of alternatives) {
      assert.match(alternative.key, /^[a-z]+$/)
      assert.notEqual(alternative.input, spec.input, `${wordId}: 別の読みが主の読みと同じ`)
    }
  }
  for (const [wordId, spec] of specEntries.filter(([, item]) => item.status === 'fixed')) {
    assert.equal(spec.alternatives, undefined, `${wordId}: 確定した指定に別の読みがある`)
  }
})

test('発音指定がない語は表示用の英語をそのまま読ませる', () => {
  const word = words.find((item) => pronunciationSpecs[item.id] === undefined)
  assert.ok(word !== undefined)
  assert.equal(kokoroInputFor(word), word.english)
})

test('試聴結果: 出題する語だけを対象にし、結果と音声のハッシュを持つ', () => {
  for (const [wordId, review] of Object.entries(reviewResults)) {
    assert.ok(wordIds.has(wordId), wordId)
    assert.ok(review.result === 'ok' || review.result === 'misread')
    assert.match(review.sha256, /^[0-9a-f]{64}$/)
  }
})

const clip = (wordId: string, input: string, overrides: Partial<VocabularyClip> = {}): VocabularyClip => ({
  wordId,
  text: wordId,
  input,
  override: false,
  phonemes: 'x',
  revision: pinnedRevision,
  voice: 'af_heart',
  speed: 1,
  bytes: 100,
  durationMs: 1000,
  sha256: 'a'.repeat(64),
  warnings: [],
  ...overrides,
})

const sampleManifest = (files: Record<string, VocabularyClip>, unresolved: VocabularyAudioManifest['unresolved'] = []) =>
  ({
    generatedAt: '2026-10-25T00:00:00+00:00',
    model: { repoId: 'hexgrad/Kokoro-82M', revision: pinnedRevision, license: 'Apache-2.0' },
    voice: { id: 'af_heart', language: 'en-US' },
    speed: 1,
    credit: 'Audio generated with Kokoro-82M by hexgrad (Apache License 2.0).',
    targetCount: words.length,
    fileCount: Object.keys(files).length,
    totalBytes: 100,
    unresolved,
    files,
  }) satisfies VocabularyAudioManifest

test('manifest: 形が正しければ読み、壊れていれば未生成扱い（null）', () => {
  const manifest = sampleManifest({ 'improve.mp3': clip('improve', 'improve') })
  assert.ok(parseVocabularyAudioManifest(manifest) !== null)
  assert.equal(parseVocabularyAudioManifest(null), null)
  assert.equal(parseVocabularyAudioManifest({ ...manifest, files: { '../x.mp3': clip('improve', 'improve') } }), null)
  assert.equal(parseVocabularyAudioManifest({ ...manifest, files: { 'improve.mp3': { ...clip('improve', 'improve'), bytes: 0 } } }), null)
  assert.equal(parseVocabularyAudioManifest({ ...manifest, unresolved: undefined }), null)
})

test('状態: 未生成・自動検査済み・要確認（発音指定・警告）・要判断・試聴済みを区別する', () => {
  const fixedId = specEntries.find(([, spec]) => spec.status === 'fixed')![0]
  const decisionId = specEntries.find(([, spec]) => spec.status === 'needs-decision')![0]
  const sha = 'b'.repeat(64)
  const manifest = sampleManifest(
    {
      'improve.mp3': clip('improve', 'improve'),
      'provide.mp3': clip('provide', 'provide', { warnings: ['途中に長い無音（800ms）'] }),
      [clipPath(fixedId)]: clip(fixedId, pronunciationSpecs[fixedId].input),
      [clipPath(decisionId)]: clip(decisionId, pronunciationSpecs[decisionId].input),
      'reduce.mp3': clip('reduce', 'reduce', { sha256: sha }),
      'situation.mp3': clip('situation', 'situation'),
    },
    [{ wordId: 'decision', path: 'decision.mp3', reason: '生成に失敗: テスト' }],
  )
  const reviews = {
    reduce: { result: 'ok' as const, sha256: sha, date: '2026-10-25' },
    // 聴いた後に再生成された（ハッシュが違う）ものは未試聴に戻る
    situation: { result: 'ok' as const, sha256: 'c'.repeat(64), date: '2026-10-25' },
  }
  const entries = buildVocabularyAudioEntries(manifest, reviews)
  const statusOf = (wordId: string) => entries.find((entry) => entry.word.id === wordId)!.status
  assert.equal(entries.length, words.length)
  assert.equal(statusOf('improve'), 'auto-verified')
  assert.equal(statusOf('provide'), 'needs-review')
  assert.equal(statusOf(fixedId), 'needs-review')
  assert.equal(statusOf(decisionId), 'needs-decision')
  assert.equal(statusOf('reduce'), 'listened')
  assert.equal(statusOf('situation'), 'auto-verified')
  assert.equal(statusOf('decision'), 'missing')
  assert.ok(entries.find((entry) => entry.word.id === 'decision')!.notes.includes('生成に失敗: テスト'))
  // 発音指定を変えた後、再生成していない（入力が古い）音声は使わない
  const stale = buildVocabularyAudioEntries(sampleManifest({ [clipPath(fixedId)]: clip(fixedId, fixedId) }), {})
  assert.equal(stale.find((entry) => entry.word.id === fixedId)!.status, 'missing')
  // manifest がなければすべて未生成
  assert.equal(countByStatus(buildVocabularyAudioEntries(null)).missing, words.length)
})

test('検索: 英語・日本語の部分一致、ランク・状態で絞り込み、英語の前方一致を先に並べる', () => {
  const entries = buildVocabularyAudioEntries(null)
  const all = { query: '', rank: 'all' as const, status: 'all' as const }
  assert.equal(filterVocabularyAudio(entries, all).length, words.length)
  assert.equal(filterVocabularyAudio(entries, { ...all, query: 'Estimate' })[0].word.id, 'estimate')
  // 'act' は act で始まる語と、途中に act を含む語（impact など）の両方がある
  const act = filterVocabularyAudio(entries, { ...all, query: 'act' })
  const starts = act.map((entry) => entry.word.english.startsWith('act'))
  assert.ok(starts.includes(true) && starts.includes(false), '前方一致と部分一致の両方を含む')
  assert.deepEqual(starts, [...starts].sort((x, y) => Number(y) - Number(x)), '前方一致が先')
  assert.ok(filterVocabularyAudio(entries, { ...all, query: '見積' }).some((entry) => entry.word.id === 'estimate'))
  assert.ok(filterVocabularyAudio(entries, { ...all, query: ' 見積 ' }).length > 0, '前後の空白は無視する')
  for (const rank of wordRanks) {
    const ranked = filterVocabularyAudio(entries, { ...all, rank })
    assert.equal(ranked.length, words.filter((word) => word.rank === rank).length)
  }
  assert.equal(filterVocabularyAudio(entries, { ...all, status: 'listened' }).length, 0)
  assert.equal(filterVocabularyAudio(entries, { ...all, query: 'zzzz' }).length, 0)
})

const manifestExists = existsSync(manifestUrl)

test('生成済み音声: 出題する全語彙と要判断の比較用音声がそろい、欠損・空・余分・重複がない', { skip: !manifestExists }, () => {
  const raw: unknown = JSON.parse(readFileSync(manifestUrl, 'utf8'))
  const manifest = parseVocabularyAudioManifest(raw)
  assert.ok(manifest !== null, 'manifest.json の形が正しくない')
  assert.equal(manifest.model.revision, pinnedRevision, 'Task 019 と同じモデルのリビジョン')
  assert.equal(manifest.voice.id, 'af_heart')
  assert.equal(manifest.speed, 1)
  assert.equal(manifest.targetCount, words.length)

  const expected = new Map<string, { wordId: string; input: string }>()
  for (const word of words) {
    expected.set(clipPath(word.id), { wordId: word.id, input: kokoroInputFor(word) })
    for (const alternative of pronunciationSpecs[word.id]?.alternatives ?? []) {
      expected.set(clipPath(word.id, alternative.key), { wordId: word.id, input: alternative.input })
    }
  }
  const unresolved = new Set(manifest.unresolved.map((item) => item.path))
  const hashes = new Map<string, string>()
  let total = 0
  for (const [path, target] of expected) {
    const entry = manifest.files[path]
    if (entry === undefined) {
      assert.ok(unresolved.has(path), `${path} が manifest にも未解決一覧にもない`)
      continue
    }
    assert.equal(entry.wordId, target.wordId, path)
    assert.equal(entry.input, target.input, `${path}: 入力が今の発音指定と違う（再生成していない）`)
    assert.equal(entry.revision, pinnedRevision, path)
    assert.equal(entry.voice, 'af_heart', path)
    assert.equal(entry.speed, 1, path)
    const file = new URL(path, audioDirectory)
    assert.ok(existsSync(file), `${path} がない`)
    const data = readFileSync(file)
    assert.ok(data.length > 0, `${path} が空`)
    assert.equal(data.length, entry.bytes, `${path} のサイズが一覧と違う`)
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, `${path} の内容が一覧と違う`)
    // MP3: ID3 タグか MPEG フレームの同期ワードで始まる
    assert.ok(data.subarray(0, 3).toString('latin1') === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0), `${path} が MP3 ではない`)
    assert.ok(entry.durationMs >= 300 && entry.durationMs <= 6000, `${path} の長さ ${entry.durationMs}ms`)
    const duplicate = hashes.get(entry.sha256)
    assert.equal(duplicate, undefined, `${path} と ${duplicate} が同じ音声`)
    hashes.set(entry.sha256, path)
    total += entry.bytes
  }
  assert.deepEqual(Object.keys(manifest.files).filter((path) => !expected.has(path)), [], '対象外の音声が一覧にある')
  assert.equal(manifest.totalBytes, total)
  const onDisk = readdirSync(audioDirectory).filter((name) => name !== 'manifest.json')
  for (const name of onDisk) {
    assert.match(name, vocabularyAudioPathPattern)
    assert.ok(manifest.files[name] !== undefined, `${name} が一覧にない（余分なファイル）`)
  }
  for (const id of retiredWordIds) {
    assert.ok(!onDisk.includes(clipPath(id)), `引退した語 ${id} の音声がある`)
  }
})
