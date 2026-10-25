# Kokoro 音声の生成（Task 019・020・開発時専用）

`public/audio/kokoro-preview/`（Task 019 の試作）と `public/audio/kokoro-vocabulary/`（Task 020 の全語彙）の MP3 と `manifest.json` を作るための手順です。
アプリは生成済みのファイルを再生するだけで、Kokoro 本体・モデル・この Python 環境はブラウザへ配布しません。
Web アプリの依存（`package.json`）とは分けています。モデルや生成環境は Git に入れません（`.gitignore` 済み）。

## 必要なもの

- Python 3.12（kokoro 0.9.4 は 3.10〜3.12 に対応）
- `uv`（または `python -m venv` と `pip`）
- インターネット接続: PyPI、GitHub（spaCy 英語モデル）、Hugging Face（`huggingface.co` と、モデル本体の配信先 `*.hf.co`）
- GPU は不要（CPU で数分）。有料 API・外部推論サービス・管理者権限は使いません。

## 手順

リポジトリのルートで実行します。

```bash
uv venv .venv-kokoro -p 3.12
VIRTUAL_ENV=.venv-kokoro uv pip install -r tools/kokoro/requirements.txt

# 1. モデルなしで発音記号だけ確認する（misaki の辞書。推測読みはしない）
.venv-kokoro/bin/python -I tools/kokoro/generate.py --phonemes-only

# 2. 音声を生成する（初回は Hugging Face から約330MBのモデルと声データを取得し、~/.cache/huggingface に保存）
.venv-kokoro/bin/python -I tools/kokoro/generate.py

# 3. ファイルの欠損・空・項目との対応を確認する
npm test
```

同じモデルで作り直すときは、`manifest.json` の `model.revision` を `--revision` に渡します。

## 何をしているか

- 入力は `src/data/audioPreview/items.json`。単語・句は `kokoroInput`、例文は `sentence.kokoroInput` を読ませます。
- 発音を直すときは、`kokoroInput` を misaki の `[語](/発音記号/)` 形式にします。画面の英語表記（`english`）は変えません。
- 声は `af_heart`（米国英語）、速度 1.0、24kHz モノラルの MP3（iPhone Safari を含む主要ブラウザで再生できる形式）。
- 辞書にない語を espeak-ng で推測させる機能（fallback）は外しています。辞書にない語があればエラーで止まります。
- 生成した発音記号が `--phonemes-only` と食い違えば止まります。
- 自動生成が成功しても、発音が正しいとは限りません。必ず試聴画面で聴いて確認します（`docs/tasks/019-kokoro-audio-preview.md`）。

## 全語彙の音声（Task 020）

出題する全語彙（引退した語を除く）の音声を `public/audio/kokoro-vocabulary/` に作ります。モデル・声・速度・形式は Task 019 と同じです（リビジョンは `generate_vocabulary.py` の `PINNED_REVISION` に固定）。

```bash
# 全語彙を生成する（CPU で約20分。既にある音声は条件が一致すれば再利用する）
.venv-kokoro/bin/python -I tools/kokoro/generate_vocabulary.py

# 生成せず、既存の音声が今の設定・発音指定と一致するかだけ調べる
.venv-kokoro/bin/python -I tools/kokoro/generate_vocabulary.py --check

# 指定した語だけ作り直す（誤読を直したとき）
.venv-kokoro/bin/python -I tools/kokoro/generate_vocabulary.py --only estimate,permit

npm test
```

- 対象の語彙は `tools/kokoro/list-vocabulary.ts`（Node）で `src/data/words.ts` から取得します。ファイル名は wordId（`{wordId}.mp3`）です。
- 同時に、通常の遠征が読む軽い一覧 `src/data/vocabularyAudio/audio-index.json`（wordId → 音声ハッシュの先頭8文字。Task 021）も書き出します。音声を作り直したら、この一覧も一緒にコミットします（`npm test` で manifest との一致を確認）。
- 発音を直すときは `src/data/vocabularyAudio/pronunciations.json` に `[英語](/発音記号/)` 形式の `input` を書き、上の `--only` で作り直します。表示用の英語（語彙データ）は変えません。
  入力が変わった語は、`--only` を付けなくても次の実行で自動的に作り直されます（モデル・声・速度・入力・ハッシュが一致する音声だけ再利用）。
- 途中で止めても、20件ごとに `manifest.json` を書き出しているので、もう一度実行すれば残りから再開します。
- 辞書にない語・生成に失敗した語は止めずに `manifest.json` の `unresolved` に残し、残りの生成を続けます。
- 自動検査（形式・長さ・無音・音量・クリッピング・途中の長い無音）で気になった音声は `warnings` に記録され、試聴画面で「要確認」と表示されます。
- 人が聴いた結果は `src/data/vocabularyAudio/reviews.json` に、聴いた音声の `sha256`（manifest.json の値）と一緒に記録します。音声を作り直すと「未試聴」に戻ります。

## クレジット

音声を同梱する場合は次を表記します。

> Audio generated with Kokoro-82M by hexgrad (Apache License 2.0).
