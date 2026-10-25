# Task 018: 社会人向け語彙とランク分け v1

## 目的
アプリの方針を「大卒の社会人が、日常・ビジネスで困らない語彙を身につける大人の学びなおし」に合わせ、
内蔵語彙を入れ替えてランクに分ける。中学で学ぶ語は既知とみなして出題しない。

今回の範囲は「単語の入れ替えとランク分け」だけ。続けさせる工夫（短い1回・連続日数・ランク別の見える化など）と
猫の扱いは後続タスクで扱う。Task 016 の出題間隔（1/3/7/30/90日、unknown の5語後の再登場）は変えていない。

## 語彙の構成（合計1,489項目）
| ランク | 内容 | 項目数 | word | phrase | phrasal verb |
| --- | --- | --- | --- | --- | --- |
| 日常基礎 `daily-basic` | 高校基礎〜日常生活でよく使う語（appointment, symptom, afford, reliable …） | 398 | 346 | 20 | 32 |
| 日常応用 `daily-advanced` | ニュース・意見・微妙なニュアンスの語（acknowledge, bias, inevitable, take into account …） | 375 | 331 | 21 | 23 |
| ビジネス基礎 `business-basic` | メール・会議・社内の定番語（agenda, deadline, invoice, postpone, at your convenience …） | 339 | 303 | 17 | 19 |
| ビジネス応用 `business-advanced` | 契約・財務・交渉・経営の語（stakeholder, mitigate, due diligence, iron out …） | 377 | 303 | 50 | 24 |

- ランクの境界は目安。同じ語が複数の場面で使われる場合は、主に使われる場面のランクに1回だけ入れた（語の重複なし）。
- phrase / phrasal verb は Task 012 と同じく `Word` として扱い、表示・読み上げ・選出・学習状態に違いはない。

## 中学レベルの語の扱い
- Task 012 の200項目のうち94項目を中学レベルとして出題から外した。
  - 基礎80語（apple, dog … child）
  - 中級のうち6語: environment, experience, explain, reason, necessary, possible
  - phrase / phrasal verb 8項目: little by little, at least, for example, make sure, by the way, take care of, look forward to, give up
- 残り106項目は id・英語・日本語・補助文・Recall Cue をそのまま引き継ぎ、ランクを付けた。
- **学習履歴・回答は削除しない。** `word-loop.understanding` / `word-loop.learning-progress` は外した語の記録もそのまま読み込み・保存し直す
  （出題候補に入らないだけ）。外した語の id は `src/data/vocabulary/retired.ts` に一覧として残し、別の語に使い回さない（テストで確認）。
- 保存済みの再開位置（`currentWordId`）が外した語なら、従来どおり先頭の語（improve）から始める。

## データ構造
- ランクごとに `src/data/vocabulary/{daily-basic,daily-advanced,business-basic,business-advanced}.ts` に分けた。
  1項目は `[english, japanese, phrase, 追加情報?]` の短い形式（`entry.ts`）。id は english から作る（小文字、空白はハイフン）。
- `src/data/words.ts` がそれをまとめて `Word` にする。
  - `rank: WordRank` を追加（必須）。Task 012 の `difficulty`（未使用の目安）はランクに置き換えて削除した。
  - `type` は必須にした（空白を含めば phrase、phrasal verb は明示）。
  - 画像は全項目ニュートラル表示（`◌`）。`recallCue` は引き継いだ106項目だけが持つ（遠征では Recall を出さないため、新しい語には付けていない）。
- `wordRanks`（易しい順）、`wordRankLabels`（日本語名）、`wordRankOrder`（id → 順番）、`retiredWordIds` を export する。

## 選出の変更（1点だけ）
未回答の語を選ぶとき、「過去の表示回数が少ない語から」の次の基準として「ランクの易しい語から」を加えた（`scheduler.ts` の ③）。
- 優先順位（短期予約 → 復習候補 → 未回答）と出題間隔は変えていない。復習候補はランクより先に出る。
- 表示回数を先に見るので、回答せずに流した語ばかりが繰り返されることはなく、日常基礎を一通り見たら次のランクへ進む。
- ランクを渡さない呼び出し（`rankOrder` なし）は従来と同じ動き。
- 初めての遠征（105 Encounter）はすべて日常基礎から出ることをテストで確認した。

## 表示
- カード上部のラベル行に、種類ラベル（new / growth / again）に続けてランク名を小さく表示する（例: `new · 日常基礎`）。
  色は控えめな `--muted`。行の高さは固定のままなので、英語・画像の位置は動かない。

## 訳・補助文の作成と確認方法
- 新しく加えた1,383項目の日本語訳と補助文（短い英語例）は、AI（Claude）が作成した。外部の辞書データ・API は使っていない。
- 訳はその語の主な意味を1〜2個、「 / 」区切りで16文字以内に収めた。ビジネス語はビジネスで使う意味を先に置いた（例: `quote` 見積もり / 引用する）。
- 機械的な確認（`tests/words.test.ts`）: id・英語の重複なし、外した語の id を使い回さない、訳16文字以内、補助文2〜8語・40文字以内、
  phrase / phrasal verb は補助文にその表現を含む、ランクごとの件数。
- 意味の正確さは機械的には確認できない。作成中の見直しで、不自然な補助文・中学レベルの語・重複を手で直した（全項目を辞書と突き合わせたわけではない）。
  使いながら気になる訳があれば、`src/data/vocabulary/*.ts` の該当行を直せばよい（id は english から作るので、english を変えると別の語として扱われる点に注意）。

## 確認結果
- `npm test`: 116件すべて成功（語彙データ・ランク順の導入・既存の出題間隔・猫・Recall 無効化など）
- `npm run lint`: 警告・エラーなし
- `npm run build`: 成功（JS 345.53 kB / gzip 116.23 kB）
- ブラウザ（`vite preview`、Chromium）で 390×844 と 320×568、ライト・ダーク:
  - 最初の語が日常基礎で、ラベル行に `new · 日常基礎` と出る
  - 長い項目（memorandum of understanding, non-disclosure agreement）が1行に収まり、横スクロールなし
  - ビジネス基礎・ビジネス応用・日常応用の語でランク名が切り替わる
  - Task 017 以前のデータ（apple の known・dog の unknown・apple の表示12回、再開位置 apple）を入れて起動 → improve の復習から始まり、
    ✓ で improve の連続回数が 1→2。保存後も apple / dog の回答と apple の進捗はそのまま残る
  - コンソールエラーなし
- スクリーンショット: `/mnt/project-files/task-018/screens/`

## 残課題
- 訳・補助文は AI 作成のため、実際に使いながら違和感のある訳を直していく必要がある。
- 「中学レベル」の線引きは目安（教科書ごとに差がある）。外したい語・戻したい語があればランクファイルと `retired.ts` で調整する。
- ランク別の進み具合の表示、1回を短くする工夫、連続日数などは後続タスク。
- 絵はすべて未設定（ニュートラル表示）。
