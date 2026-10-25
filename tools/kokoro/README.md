# Kokoro 試聴音声の生成（Task 019・開発時専用）

`public/audio/kokoro-preview/` の MP3 と `manifest.json` を作るための手順です。
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

## クレジット

音声を同梱する場合は次を表記します。

> Audio generated with Kokoro-82M by hexgrad (Apache License 2.0).
