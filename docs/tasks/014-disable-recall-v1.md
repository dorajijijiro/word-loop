# Task 014: Recall の無効化と、英語・日本語の常時表示 v1

## 目的
英語が消えて日本語だけになる表示（Recall の cue 段階）をなくし、英語・日本語・絵をテンポよく見る基本体験に集中する。
今回の仕様は、Task 011 / Task 013 の「Recall を維持する」方針に優先する。

## 仕様
1. 遠征で Recall を選出・実行しない。英語を隠す cue 段階と、それに続く reveal 段階を発生させない。
2. 通常表示・again では、英語と日本語を常に同時に表示する。
3. Recall 用に確保していた空の Cue 行を取り除き、余白を整理する。語の長さ、ラベルの有無、補助文の ON/OFF で英語の位置を動かさない。
4. 現在の画面で不要になった Recall 専用のラベル・件数表示を整理する。
5. 1遠征105 Encounter、通常選出の 9:1、Attention と again、自動周回、音声、通常 Encounter の報酬計算は維持する。

保存: 既存の localStorage の学習履歴・設定・XP・Gold を保持する。キーの変更、version の更新、データの削除はしない。

今回やらないこと: 「わかる / わからない」ボタンと新しい重み付け、画像の追加・生成、語彙の追加、
Recall 関連コードの大規模な削除・リファクタリング、外部 API・ライブラリの追加。

## 実装

### Recall を予定しない（`src/lib/recall.ts`、`src/lib/encounterEngine.ts`、`src/App.tsx`）
- `recall.ts` に `recallEnabledInExpedition = false` を追加した。
- `SelectionContext` に省略可能な `recallEnabled` を追加した。`false` のとき `startEncounter` は Recall の予定（`recallSchedule`）を作らない。
  予定がないので `advanceEncounter` は Recall を選出せず、Recall の Encounter（`source: 'recall'`）は発生しない。省略時は従来どおり（既存テストのため）。
- App は遠征開始時・前進時の両方で `recallEnabled: recallEnabledInExpedition` を渡す。
- Recall の候補選出・cue → reveal の進行・報酬（`selectRecallWord`、`startRecallStep`、`recall` の XP など）のコードは残した（大規模な削除はしない方針）。
  Recall が発生しないため、App 側の cue / reveal のタイマーも動かない。
  再び有効にする場合は、Task 014 で外したカードの cue / reveal 表示も戻す必要がある（`recall.ts` のコメントに記載）。

### カード表示（`src/App.tsx`、`src/App.css`）
- カードは常に「ラベル → 英語 → 日本語 → 画像 → 補助文 → ヒント」の行で表示する。Recall の cue / reveal 用の表示分岐（日本語を見出しに出す、Cue 行、画像を隠す）を外した。
- Task 013 で確保していた空の Cue 行（約42px）を取り除いた。日本語と画像の間の余白が詰まり、画像以下が上へ寄った。
- 各行の高さは Task 013 のまま固定。英語は固定高さの行の中央にそろえる。補助文 OFF でも補助文の行の高さは残るので、英語・画像の位置は変わらない。
- 不要になった Recall 専用の CSS（`.recall-prompt`、`.recall-cue`、`.recall-xp`、`.encounter-label .is-recall`、reveal のアニメーション、cue 中の画像非表示）を削除した。

### Recall 専用の表示の整理
- 遠征完了画面の内訳から `recall` の件数を外した（encounters / familiar / new / growth / again の5項目）。
- 開発用表示（dev）の `recall` の件数と `recall（bucket）` 表示を外した。
- `ExpeditionState.recallCount`、報酬計算の `recallCount` は型・計算とも残している（常に0）。保存データには含まれない。
- README の機能一覧の Recall の説明を、英語・日本語・絵の常時表示と Recall の無効化に書き換えた。

## 保存への影響
なし。localStorage のキー（`word-loop.learning-progress`、`word-loop.learning-state`、`word-loop.player-progress`）、
形式、version（learning-progress は version 2）は変更していない。Recall の状態はもともと保存していない。

## テスト（`npm test`、77件）
既存72件はすべて維持（Recall エンジン自体のテストは、従来どおり Recall を有効にした context で動く）。`tests/disableRecall.test.ts` に5件を追加した。

- 遠征では Recall を有効にしない設定（`recallEnabledInExpedition === false`）になっている
- `recallEnabled: false` で遠征を開始すると Recall の予定が空になる
- App と同じ context（全200項目、Recall 候補が十分にある進捗）で8シード分の遠征を進めても、Recall が1回も出ず、`recallCount` は0、105 Encounter で完了し、最後の語は設定速度ぶん見せてから完了する（Recall の待ちなし）
- Attention した語が again として 5〜7 Encounter 後に再登場し、again の件数も正しく数えられる
- Recall を有効にした場合は従来どおり Recall が出る（エンジン側の機能は残っている）

`npm run lint`（警告・エラーなし）、`npm run build`（成功）、`git diff --check`（問題なし）。

## ブラウザ確認（Playwright / Chromium、dev サーバー、speechSynthesis はスタブ）
1. **実際の遠征（自動周回）**: 390×844（ライト・ダーク）、320×568（ライト・ダーク）で、localStorage を初期化してから1遠征ずつ最後まで進めた。
   途中で3回タップ（Attention）し、補助文を OFF → ON に切り替えた。表示を約60msごとに計測した。
   - 4回とも105 Encounter で遠征完了画面になった。Recall のカード（cue / reveal）は1回も出ず、英語が非表示になった瞬間、日本語が空の瞬間はなかった。
   - 所要時間は、超高速（0.25秒/語）で約26.3秒（105 × 0.25秒）、標準（1秒/語）で約105秒（105 × 1秒）。Recall の待ち時間は発生していない。
   - タップした語は again として再登場し、完了画面の again は3。完了画面に recall の項目は出ない。
   - 英語の中心、日本語・画像・補助文の上端は、new / growth / again / ラベルなし、補助文 ON / OFF、長い語句を通して1つの値だった
     （ページ上の位置。390×844: 英語中心 170.3px、画像上端 251.5px。320×568: 英語中心 159.3px、画像上端 240.5px）。
   - 英語がカードの幅からはみ出した瞬間はなかった。コンソールエラーなし。
2. **全200項目の流し込み**（390px・320px 幅）: 英語・訳・補助文は全項目ではみ出さず、訳と補助文は1行に収まり、英語の中心・画像の上端は全項目で同じ値だった。
3. **既存データの引き継ぎ**: master（Task 013 以前、Recall あり）で1遠征（Recall の cue / reveal が出ることを確認）して作った localStorage を、
   新しいコードの画面に入れて起動した。
   - 起動直後、3つのキーの内容は変化しなかった。拠点画面に引き継いだ Level・XP（545）・Gold（322）・遠征数（1）が表示された。
   - そのまま1遠征すると Recall は出ず105 Encounter で完了し、XP・Gold・遠征数は加算された（1042 / 618 / 2）。
     learning-progress は version 2 のまま、既存の74語の encounterCount / attentionCount は減らずに引き継がれた（遠征後は118語）。
   - 設定（速度 0.25秒/語・音声・補助文）も引き継がれた。localStorage のキーは従来の3つのまま。

スクリーンショットはプロジェクトファイルの `task-014/` に保存した。

## 残課題
- iPhone 実機（Safari）では確認していない。
- Recall 関連のコード（選出・進行・報酬・テスト）は無効のまま残している。今後も使わないと決まった時点で整理するかを検討する。
- Recall の Encounter（1回 +10 XP / +5 Gold、1遠征最大4回）が通常の Encounter に置き換わるため、1遠征の報酬は以前より少し減ることがある。報酬の値は見直していない。
- カードの下（画像・補助文の下）と操作部の間の余白が、Cue 行を除いた分だけ広くなった。カードは上から積む配置（英語の位置を固定するため）なので、余白は下側に集まる。
- 320px 幅では操作部の「自動周回」ボタンの文字が2行に折り返す（Task 013 から。カードの外のため今回も変更していない）。
