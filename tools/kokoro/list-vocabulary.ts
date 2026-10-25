// Task 020: 音声生成の対象（現在出題する語彙）を JSON で標準出力に書き出す。
// tools/kokoro/generate_vocabulary.py が呼び出す（Python から TypeScript の語彙データを直接読めないため）。
import { retiredWordIds, words } from '../../src/data/words.ts'

const items = words.map(({ id, english, japanese, phrase, rank, type }) => ({ id, english, japanese, phrase, rank, type }))
process.stdout.write(`${JSON.stringify({ items, retiredWordIds })}\n`)
