import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retiredWordIds, wordRankOrder, wordRanks, words, wordTypes } from '../src/data/words.ts'

// Milestone A〜D で使っていた20語。Task 018 で中学レベルとして出題から外したが、id は保存データのキーなので残し続ける。
const originalWordIds = [
  'apple', 'dog', 'cat', 'water', 'sun', 'book', 'car', 'tree', 'house', 'hand',
  'bird', 'fish', 'flower', 'moon', 'chair', 'shoe', 'cup', 'door', 'bread', 'rain',
]

// Task 012 の語のうち、Task 018 でも出題を続ける語の例（id・訳・補助文・Cue をそのまま引き継ぐ）。
const keptWordIds = [
  'improve', 'available', 'opportunity', 'inevitable', 'ambiguous', 'consensus', 'threshold',
  'in-terms-of', 'in-the-long-run', 'come-up-with', 'put-off', 'turn-down',
]

// 中学で学ぶ語の例。大人の学びなおし向けなので出題しない。
const juniorHighWords = [
  'family', 'school', 'morning', 'friend', 'money', 'happy', 'buy', 'help', 'learn', 'child',
  'experience', 'explain', 'reason', 'necessary', 'possible', 'environment',
  'for-example', 'by-the-way', 'give-up', 'look-forward-to', 'take-care-of', 'make-sure',
]

const countBy = <T extends string>(values: T[]) =>
  values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {})

test('語彙データ: 約1,500項目あり、4ランクそれぞれに十分な語がある', () => {
  assert.ok(words.length >= 1400 && words.length <= 1600, `${words.length}`)
  const counts = countBy(words.map((word) => word.rank))
  assert.deepEqual(Object.keys(counts), wordRanks)
  for (const rank of wordRanks) {
    assert.ok(counts[rank] >= 300 && counts[rank] <= 420, JSON.stringify(counts))
  }
})

test('語彙データ: 中学レベルの語は出題せず、外した語の id を一覧として残す', () => {
  const ids = new Set(words.map((word) => word.id))
  const retired = new Set(retiredWordIds)
  for (const id of [...originalWordIds, ...juniorHighWords]) {
    assert.ok(!ids.has(id), id)
  }
  for (const id of originalWordIds) {
    assert.ok(retired.has(id), id)
  }
  for (const id of keptWordIds) {
    assert.ok(ids.has(id), id)
  }
  // Task 012 の200項目は、出題する語か外した語のどちらかに必ず残っている
  assert.equal(retired.size, retiredWordIds.length)
  assert.equal(retiredWordIds.length, 94)
  assert.equal(words.filter((word) => word.recallCue !== undefined).length, 200 - 94)
  // 外した語の id を別の語に使い回さない
  for (const id of retiredWordIds) {
    assert.ok(!ids.has(id), id)
  }
})

test('語彙データ: 引き継いだ語は Task 012 の訳・補助文をそのまま持つ', () => {
  const byId = new Map(words.map((word) => [word.id, word]))
  assert.equal(byId.get('improve')?.japanese, '改善する / 良くする')
  assert.equal(byId.get('improve')?.phrase, 'improve my English')
  assert.equal(byId.get('come-up-with')?.type, 'phrasal-verb')
  assert.equal(byId.get('in-terms-of')?.type, 'phrase')
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

test('語彙データ: english / japanese / phrase が空でない', () => {
  for (const word of words) {
    assert.ok(word.english.trim().length > 0, word.id)
    assert.ok(word.japanese.trim().length > 0, word.id)
    assert.ok(word.phrase.trim().length > 0, word.id)
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

test('語彙データ: recallCue があれば1〜2行で極端に長くなく、日本語訳の繰り返しでもない', () => {
  for (const word of words.filter((item) => item.recallCue !== undefined)) {
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

test('語彙データ: rank / type は定義済みの値だけで、ランクの順番は易しい順', () => {
  for (const word of words) {
    assert.ok(wordRanks.includes(word.rank), word.id)
    assert.ok(wordTypes.includes(word.type), word.id)
    assert.equal(wordRankOrder.get(word.id), wordRanks.indexOf(word.rank), word.id)
  }
  assert.deepEqual(wordRanks, ['daily-basic', 'daily-advanced', 'business-basic', 'business-advanced'])
})

test('語彙データ: phrase / phrasal verb は複数語で、phrase 例にその表現を含む', () => {
  const multiWordItems = words.filter((word) => word.type === 'phrase' || word.type === 'phrasal-verb')
  assert.ok(multiWordItems.length >= 150, `${multiWordItems.length}`)
  for (const word of multiWordItems) {
    assert.ok(word.english.includes(' '), word.id)
    assert.ok(word.phrase.toLowerCase().includes(word.english), word.id)
  }
  // 単語の項目には空白を含めない
  for (const word of words.filter((item) => item.type === 'word')) {
    assert.ok(!word.english.includes(' '), word.id)
  }
})

test('語彙データ: レビューで直した訳・補助文（innocent / turn out / signature）', () => {
  const byId = new Map(words.map((word) => [word.id, word]))
  assert.equal(byId.get('innocent')?.japanese, '無実の / 悪意のない')
  assert.equal(byId.get('innocent')?.phrase, 'an innocent mistake')
  assert.equal(byId.get('turn-out')?.japanese, '結果的に～になる / ～とわかる')
  assert.equal(byId.get('turn-out')?.phrase, 'it may turn out fine')
  assert.equal(byId.get('signature')?.phrase, 'add your signature here')
  assert.equal(byId.get('signature')?.rank, 'business-basic')
})
