# Task 009: ゲーム体験の可視化とUI刷新（Milestone B）

## 目的
Milestone A で成立した「遠征 → 105 Encounter → XP / Gold → 帰還」を、見て触って自然にゲームとして理解できる状態にする。
学習ロジック（選出・分類・XP / Gold 計算・保存形式）は変更しない。

## デザイン思想
- 英単語が主役。UIは英単語より目立たない。
- ゲーム感は装飾ではなく、数字・蓄積・状態遷移から出す。RPG風の装飾・名称・フォントは使わない。
- 色は背景・文字・罫線・アクセント2色（growth / again）だけ。外部フォント・画像・アイコンライブラリは使わない（Unicode の ● ↻ ▶ ❚❚ のみ）。
- 数字は `tabular-nums` で揃え、大きく細く見せる。ラベルは小さな英字（eyebrow）、文章とボタンは日本語。
- 高速周回（0.25秒/語）でも学習テンポを止めない。アニメーションは opacity / transform の 120〜400ms のみ。
- `prefers-color-scheme: dark` と `prefers-reduced-motion` に対応。
- 参考サイト（80億分の1）からは「数字が主・ラベルが従」「一つの画面に一つの主題」「静かな文体」という考え方だけを参考にし、レイアウト・文章・配色・素材は使っていない。

## Level 計算（`src/lib/level.ts`）
- Lv.n に到達する累積XP = `100 × (n - 1)²`（Lv.1: 0 / Lv.2: 100 / Lv.3: 400 / Lv.4: 900 …）。
  `level = floor(sqrt(totalXp / 100)) + 1` と同じで、浮動小数点誤差を整数の閾値で補正している。
- `getLevelProgress(totalXp): LevelProgress`
  - `level`、`currentLevelXp`（現レベルに入ってからのXP）、`nextLevelXp`（現レベル→次レベルの必要XP幅）、`progressRatio`（0〜1）
  - 表示用に `levelStartTotalXp` / `nextLevelTotalXp` も返す（画面の「420 / 900 XP」はこちら）
- `getLevelChange(beforeTotalXp, afterTotalXp)` で `{ from, to, leveledUp }` を返す。
- Level は保存しない。`word-loop.player-progress` の `totalXp` から毎回算出する。localStorage の形式・キーは変更なし。
- 1回目の遠征は約200XP（初回は growth 比率が高い）なので、最初の帰還で Lv.2 になる。以後はおよそ1〜3遠征ごとに上がる。係数は `levelXpUnit` で調整できる。

## 拠点（待機画面）
`WORD LOOP` / Lv（大きな数字）/ 累積XP と次レベル閾値・細いバー・「Lv. n まで ◯ XP」/ Gold・Expeditions / Next expedition `0 / 105` / 「遠征を始める」。
1タップで開始し、確認ダイアログはない。

## 遠征中 HUD
- 上部に `Lv. n`（左）と `37 / 105`（右）、その下に2pxの進行ライン、右下に今回の遠征XP合計。
- 単語カードの順序: ラベル枠 → 英単語（最大）→ 日本語 → 画像プレースホルダー → 補助文 → 「タップでもう一度」。
- ラベル枠・日本語・補助文・ヒントは高さ固定。ラベルの有無や補助文ON/OFFで英単語の位置は動かない（自動確認で英単語の top が全周回で一定）。
- 操作は下部に集約: 前へ / 自動周回（押下中は塗り）/ 次へ、速度プリセット（0.25s / 0.5s / 1s / 2s、aria-label に従来名）、速度スライダー、音声・補助文・再生。
- 単語・語数（`単語 n/20`）、Encounter、Attention、再遭遇予約、bucket、F/G/R は最下部の小さな `dev` 行へ移した。

## Encounter 表示
- familiar: ラベルなし（何も出ない＝普通）。
- growth: `● growth`（アクセント色）。
- 再遭遇: `↻ again`（別の色）。記号と文字で区別し、色だけに依存しない。
- XP: HUD の遠征XP合計の左に `+1` / `+5` / `+10` を短く表示。幅固定のインライン要素を Encounter ごとに `key` で作り直し、CSS アニメーション（表示時間 = 速度の90%、160〜700ms）で消すため、残像・重なり・レイアウト移動がない。familiar は薄く、growth / again はそれぞれの色。スクリーンリーダーには読ませない（合計XPは aria-label で提供）。
- カードタップ（再遭遇予約）は維持。押下中にわずかに縮み、`↻ apple をもう一度出します`（role=status）を控えめに表示。

## 遠征完了
`EXPEDITION COMPLETE` / 遠征完了 / `+XP` と `+Gold` を最大の数字で / 罫線 / encounters・familiar・growth・again を小さく / 「帰還する」。

## 帰還
`RETURNED` / 「105 語に出会い、帰還しました」/（レベルアップ時のみ LEVEL UP）/ 現在の Level 進捗 / This expedition（XP・Gold）と Total（XP・Gold・Expeditions）/ 「次の遠征へ」/ 小さく「拠点に戻る」。
「次の遠征へ」は確認なしで次の105 Encounterを始める。前の遠征を自動周回のまま終えていれば、次の遠征も自動周回で始まる（テンポ優先。停止中に終えた場合は停止のまま）。

## Level Up
- 遠征開始時の累積XP（画面状態として保持、保存しない）と報酬反映後の累積XPを `getLevelChange` で比較。
- 上がった場合のみ、帰還画面で上下に細い罫線を引いた `LEVEL UP / Lv. 3 → Lv. 4` を 400ms のフェードで表示。遠征中には出さない。

## ブラウザ確認（Playwright / Chromium、390×844、StrictMode の dev サーバー）
1. 初回起動 → 拠点（Lv.1、0 / 100 XP、Gold 0、Expeditions 0）
2. 遠征開始 → 単語表示、HUD `1 / 105`
3. カードタップ → `↻ cat をもう一度出します`、数語後に `↻ again` 表示
4. `● growth` 表示、XP フィードバック表示
5. 自動周回 1秒/語・0.5秒/語・0.25秒/語: 英単語の top 位置は常に一定、`.xp-gain` は常に1個以下、横スクロールなし
6. HUD が `105 / 105` を表示（105語目が実際に表示される）→ 遠征完了（例: XP +226 / Gold +161、familiar 76 / growth 28 / again 1）
7. 完了時点で `word-loop.player-progress` に保存済み
8. 帰還 → LEVEL UP `Lv. 1 → Lv. 2`、226 / 400 XP、累積表示
9. 次の遠征へ → 自動周回のまま即開始（HUD は Lv. 2）→ 0.25秒/語で105まで → 帰還（レベル変化なしの場合は LEVEL UP を出さない）
10. リロード → 拠点に Lv.2・累積XP・Gold・Expeditions 2 を保持。localStorage のキーは従来の3つのみ
11. ダークモード、PC幅（1280×800、中央寄せ）も確認。コンソールエラーなし

## 自動テスト
`tests/level.test.ts` を追加（5件）: XP 0 で Lv.1・壊れた値、境界値（100 / 400 / 900 と Lv.200 までの全閾値）、次レベル必要XP と progressRatio、Level が逆行せず ratio が 0〜1、PlayerProgress からの再現とレベルアップ判定（複数レベル上昇含む）。既存18件と合わせて23件。

## 残課題
- 初回遠征は全語 growth から始まるため growth 比率が高い（例: 28 / 105）。UIは破綻しないが、学習アルゴリズム改善フェーズで扱う。
- `attentionCount > 0` の語が growth に残り続ける暫定仕様は未変更。
- 「前へ」も新しい Encounter として XP 対象（既存仕様のまま）。
- 0.25秒/語では音声が次の語に切られる（従来どおり）。iOS 実機での音声・表示は未確認。
- 単語カードの `aria-live` は高速周回では読み上げが追いつかない（従来どおり）。
- Level 係数・XP / Gold は暫定値。Gold の使い道は未実装。
- 遠征途中・帰還画面の状態は保存しない（再読み込みで拠点に戻る。累積値は保持）。
