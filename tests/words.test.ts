import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wordDifficulties, words, wordTypes } from '../src/data/words.ts'

// Milestone A〜D で使っていた20語。id は保存データのキーなので残し続ける。
const originalWordIds = [
  'apple', 'dog', 'cat', 'water', 'sun', 'book', 'car', 'tree', 'house', 'hand',
  'bird', 'fish', 'flower', 'moon', 'chair', 'shoe', 'cup', 'door', 'bread', 'rain',
]

const countBy = <T extends string>(values: T[]) =>
  values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {})

test('語彙データ: 約200項目あり、既存20語をそのまま含む', () => {
  assert.ok(words.length >= 190 && words.length <= 220, `${words.length}`)
  const ids = new Set(words.map((word) => word.id))
  for (const id of originalWordIds) {
    assert.ok(ids.has(id), id)
  }
})

test('語彙データ: id と english が重複しない', () => {
  assert.equal(new Set(words.map((word) => word.id)).size, words.length)
  assert.equal(new Set(words.map((word) => word.english.toLowerCase())).size, words.length)
})

test('語彙データ: id は english から作った小文字の slug（phrase は単語をハイフンでつなぐ）', () => {
  for (const word of words) {
    assert.match(word.id, /^[a-z]+(-[a-z]+)*$/, word.id)
    assert.equal(word.id, word.english.toLowerCase().replaceAll(' ', '-'), word.id)
  }
})

test('語彙データ: english / japanese / phrase / recallCue が空でない', () => {
  for (const word of words) {
    assert.ok(word.english.trim().length > 0, word.id)
    assert.ok(word.japanese.trim().length > 0, word.id)
    assert.ok(word.phrase.trim().length > 0, word.id)
    assert.ok((word.recallCue ?? '').trim().length > 0, word.id)
  }
})

test('語彙データ: 日本語訳は一瞬で読める短さ、phrase は短い英語例（2〜8語）', () => {
  for (const word of words) {
    assert.ok(word.japanese.length <= 16, `${word.id}: ${word.japanese}`)
    const phraseWords = word.phrase.trim().split(/\s+/)
    assert.ok(phraseWords.length >= 2 && phraseWords.length <= 8, `${word.id}: ${word.phrase}`)
    assert.ok(word.phrase.length <= 40, `${word.id}: ${word.phrase}`)
  }
})

test('語彙データ: recallCue は1〜2行で極端に長くなく、日本語訳の繰り返しでもない', () => {
  for (const word of words) {
    const cue = word.recallCue ?? ''
    assert.ok(cue.length <= 40, `${word.id}: ${cue}`)
    assert.notEqual(cue.replaceAll('\n', ''), word.japanese, word.id)
    // 答えの英語をそのまま含めない
    assert.ok(!cue.toLowerCase().includes(word.english.toLowerCase()), word.id)
  }
})

test('語彙データ: image は id が項目と一致し、placeholder と alt がある', () => {
  for (const word of words) {
    assert.equal(word.image.id, word.id)
    assert.ok(word.image.placeholder.trim().length > 0, word.id)
    assert.ok(word.image.alt.trim().length > 0, word.id)
  }
})

test('語彙データ: difficulty / type は定義済みの値だけ', () => {
  for (const word of words) {
    assert.ok(word.difficulty === undefined || wordDifficulties.includes(word.difficulty), word.id)
    assert.ok(word.type === undefined || wordTypes.includes(word.type), word.id)
  }
})

test('語彙データ: phrase / phrasal verb は複数語で、id が一意、phrase 例にその表現を含む', () => {
  const multiWordItems = words.filter((word) => word.type === 'phrase' || word.type === 'phrasal-verb')
  assert.ok(multiWordItems.length >= 15, `${multiWordItems.length}`)
  assert.equal(new Set(multiWordItems.map((word) => word.id)).size, multiWordItems.length)
  for (const word of multiWordItems) {
    assert.ok(word.english.includes(' '), word.id)
    assert.ok(word.phrase.toLowerCase().includes(word.english), word.id)
  }
  // 単語の項目には空白を含めない
  for (const word of words.filter((item) => item.type === 'word')) {
    assert.ok(!word.english.includes(' '), word.id)
  }
})

test('語彙データ: 難易度構成が基礎・中級・やや難しいの3層に分かれている', () => {
  const singleWords = words.filter((word) => word.type === 'word')
  const counts = countBy(singleWords.map((word) => word.difficulty ?? 'unknown'))
  assert.equal(counts.unknown, undefined)
  assert.ok(counts.basic >= 70 && counts.basic <= 90, JSON.stringify(counts))
  assert.ok(counts.intermediate >= 60 && counts.intermediate <= 80, JSON.stringify(counts))
  assert.ok(counts.advanced >= 25 && counts.advanced <= 35, JSON.stringify(counts))
})
