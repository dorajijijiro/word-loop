# Task 006: 105 Encounter 遠征ループ

## 目的
単語が無限に周回する状態から、「1回の学習セッション＝1遠征」という区切りを持たせる。

`遠征開始 → 105 Encounter → 帰還` を1単位として動かす。今回は遠征という単位だけを実装し、RPG演出・XPなどは追加しない。

## 仕様

### 1. 遠征の長さ
- 1遠征は 105 Encounter（基本100＋再遭遇などの追加分 最大5程度）
- 厳密な 90:10 選出や追加5枠の固定は今回は実装しない。105回表示されたら終了する
- 通常語・再遭遇語のどちらも1 Encounterとして数える

### 2. 遠征状態
```ts
type ExpeditionState = {
  encounterCount: number
  encounterLimit: number // 105固定
  status: 'idle' | 'running' | 'completed'
}
```

### 3. 開始
- 初期状態は待機（idle）。「遠征を開始」ボタンを表示する
- 開始すると `encounterCount = 0`、`status = running`、現在の単語から開始する
- 開始した瞬間ではなく、単語が表示された時点から Encounter を数える

### 4. 遠征中
- 画面上部に `遠征 23 / 105` を表示する。既存の単語位置は `単語 3 / 20` として区別する
- 自動周回は遠征中のみ可能。手動の「次へ」でも Encounter は進む

### 5. 105 Encounter 到達時
- 自動周回を停止し、`status = completed` にする。それ以上単語を進めない
- 帰還画面（遠征完了 / Encounter / 再遭遇 / 帰還する）を表示する。XP・Gold・レベルは表示しない

### 6. 帰還
- 「帰還する」で待機状態へ戻り、「次の遠征を開始」できる
- 学習履歴（`encounterCount` / `attentionCount` / `lastEncounteredAt`）は消さずに累積する

### 7. 再遭遇との関係
- Task 005 の再遭遇機能は維持する
- 105 到達時点で再遭遇予約が残っていても、その遠征は105で終了する
- 未消化の再遭遇キューは遠征終了時に破棄し、次の遠征へ持ち越さない

### 8. 保存
- 遠征途中の復元は行わない。再読み込み時は遠征＝待機、再遭遇キュー＝空から始める
- 既存の学習進捗・設定保存は維持する

## 実装結果

### ファイル構成
| ファイル | 変更内容 |
| --- | --- |
| `src/lib/expedition.ts` | 新規。`ExpeditionState` の型と、開始・Encounter記録・帰還の純粋関数。React に依存しない |
| `src/lib/encounterEngine.ts` | `restartEncounter`（遠征開始時に現在の通常語を新しい Encounter として表示し、キューを空にする）、`clearReencounterQueue` を追加 |
| `src/App.tsx` | 遠征状態の保持、待機画面・帰還画面、進行度表示、遠征外での操作無効化 |
| `src/App.css` | 遠征パネル・進行度・無効ボタンのスタイル（仮UI） |
| `README.md` | できることに遠征を追記 |

### 遠征状態の管理
- `ExpeditionState` に `encounterCount` / `encounterLimit` / `status` に加え、帰還画面用の `reencounterCount` を持つ。
- 将来の XP・Gold・HP・帰還報酬は、この型と `recordExpeditionEncounter` を拡張して追加する想定。
- App では `useState` と ref（`expeditionRef`）で持つ。自動周回のタイマーからも最新の状態を同期的に参照するため。
- 保存はしない（再読み込みで待機に戻る）。

### Encounter の数え方と終了判定
- 新しい Encounter を表示する処理を `showEncounter` に集約し、表示と同時に `recordExpeditionEncounter` で1進める。
  - 対象: 遠征開始時の最初の単語、「次へ」、「前へ」、自動周回、再遭遇語の差し込み
- `recordExpeditionEncounter` は `encounterCount` が `encounterLimit` に達した時点で `status = completed` にし、以降は何も数えない。
- `changeWord`（自動周回・次へ・前へ）は、遠征中（`isExpeditionRunning`）でなければ何もしない。タイマーが余分に1回発火しても 105 を超えない。
- 完了時に `setIsLooping(false)` で自動周回を止め、`clearReencounterQueue` で未消化の再遭遇予約を破棄する。
- 起動直後（sequence 0）は待機画面で単語を表示しないため、学習進捗の Encounter にも記録しない。開始時は `restartEncounter` で新しい sequence を作るので、学習進捗と遠征の両方に1回ずつ記録される。

### UI（仮）
- 待機: 「待機中」「105 Encounter で1回の遠征です。」と「遠征を開始」（2回目以降は「次の遠征を開始」）
- 遠征中: ヘッダーに `遠征 n / 105` と `単語 n / 20` を2行で表示。単語カードは従来どおり
- 完了: 「遠征完了」「Encounter: 105」「再遭遇: n」「帰還する」
- 待機中・完了時は単語カードを出さず、自動周回・前へ・次へのボタンを無効化する。音声・補助文・速度の設定は常に変更できる

## 確認内容
- `npm run lint` 成功
- `npm run build` 成功
- 開発サーバー（StrictMode有効、390×844）でブラウザ自動操作により確認
  - 起動直後は待機画面。自動周回・前へ・次へは無効、学習進捗の Encounter 合計は 0
  - 遠征開始で `遠征 1 / 105`、現在の単語（apple）から表示
  - 手動で進め、4語目でタップ → 5 Encounter 後に再登場（`sun book car tree water house`）。再遭遇語も1 Encounterとして数えられる
  - 0.2秒/語の自動周回で 105 に到達すると自動停止し、帰還画面に `Encounter 105 / 再遭遇 1`。その後待っても 105 を超えない
  - 1遠征後の学習進捗の Encounter 合計は 105（StrictMode でも二重加算なし）
  - 帰還 → 「次の遠征を開始」で `遠征 1 / 105` から再開
  - 103 Encounter 目でタップして予約を残したまま 105 に到達 → 遠征終了、再遭遇予約は 0
  - 2遠征後の Encounter 合計は 210（学習履歴は遠征をまたいで累積）
  - 再読み込みで待機状態に戻り、学習進捗・単語位置は保持
  - コンソールエラーなし

## 今回は実装しない
90:10 / 9:1 の語彙選出、Known / Growth / Rare 判定、XP、Gold、HP、全滅、レベル、エリア、ボス、装備、RPGアニメーション、AI、15,000語対応、詳細画面、遠征途中の復元。

## 次のTaskへの課題
- 105 の内訳（基本100＋追加5）の厳密化: 現在は再遭遇の数に上限がなく、すべて105の中で数える。追加枠を設けるなら `recordExpeditionEncounter` で通常語と追加語を別カウントにする。
- 遠征開始位置: 「現在の単語から開始」のため、次の遠征は前の遠征の最後の通常語から始まる（その語を1回多く見る）。次の語から始めるべきかは要検討。
- 「前へ」も1 Encounterとして数えている（Task 005 の Encounter 定義に合わせた）。遠征の進行度に含めるかは要検討。
- 帰還画面の項目追加（XP・Gold・報酬など）と、遠征結果の履歴保存の要否。
- 開発用表示と仮UIの整理。
