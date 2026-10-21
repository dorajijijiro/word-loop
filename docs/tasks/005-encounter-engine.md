# Task 005: Encounter基盤と再遭遇ロジック

## 目的
単純な順番周回から、「単語に何度も遭遇し、気になった語を自動的に再登場させられる学習エンジン」へ拡張するための基盤を作る。

基本の流れは `見る → 聞く → 流す → また会う`。今回はこの「また会う」を可能にする。

## 仕様

### 1. 単語ごとの学習状態
単語データ（`src/data/words.ts`）とは別に、次の情報を wordId ごとに保持する。

```ts
type WordLearningProgress = {
  wordId: string
  encounterCount: number // 表示された回数
  lastEncounteredAt: string | null // 最後に表示された日時（ISO 8601）
  attentionCount: number // 「もう一度見たい」と意思表示した回数
}
```

### 2. Encounter記録
単語が画面に表示されるたびに Encounter として記録する。

- 対象: 起動時の最初の表示、自動周回、「次へ」、「前へ」、再遭遇による表示
- React StrictMode でも同じ表示が二重加算されないこと

### 3. 「もう一度見る」操作
単語カードをワンタップすると、表示中の単語を再遭遇対象にする。

- 自動周回は停止しない
- 詳細画面は開かない
- `attentionCount` を増やす
- 再遭遇キューへ登録する
- 「〇〇 をもう一度出します」を短時間（約1.2秒）表示する

### 4. 再遭遇キュー
- タップした語は 5 Encounter 後に再登場する（固定値）
- 同一 wordId の予約は1件まで。再遭遇が完了すれば再び予約できる

### 5. 通常周回との共存
- 20語の通常周回を壊さず、期限が来た再遭遇語を途中へ差し込む
- 再遭遇語のために通常周回側の単語を消さない

### 6. 保存
- `WordLearningProgress` は `word-loop.learning-progress` に保存する
- 既存の `word-loop.learning-state`（再開位置・設定）とは責務を分ける
- 壊れたデータは安全な初期状態へ戻す

### 7. 再起動時
- `encounterCount` / `lastEncounteredAt` / `attentionCount` は保持する
- 再遭遇キューは保存せず、起動時は空で開始する

## 実装結果

### ファイル構成
| ファイル | 役割 |
| --- | --- |
| `src/lib/learningProgress.ts` | `WordLearningProgress` の型、記録関数（`recordEncounter` / `recordAttention`）、localStorage 読み書きと検証 |
| `src/lib/encounterEngine.ts` | 次の Encounter の選出（通常周回＋再遭遇キュー）。React に依存しない純粋関数 |
| `src/App.tsx` | エンジンと進捗の呼び出し、カードタップ、フィードバック表示、開発用表示 |
| `src/App.css` | タップ用ボタン、フィードバック、開発用表示のスタイル |

### Encounter の仕組み
- `EncounterSession` は `normalIndex`（通常周回の位置）、`current`（表示中の Encounter）、`reencounterQueue` を持つ。
- `current.sequence` は起動からの通し番号で、表示が変わるたびに1増える。
- `advanceEncounter`（自動周回・次へ）と `retreatEncounter`（前へ）が次のセッションを返す。
- 記録は `App.tsx` の Effect で行い、「最後に記録した sequence」を ref で持つ。StrictMode の Effect 二重実行でも同じ sequence は1回しか記録されない。起動直後の最初の表示も1回として数える。

### 再遭遇の仕組み
- タップ時は `reserveReencounter` が `{ wordId, dueSequence: 現在の sequence + 5 }` をキュー末尾に追加する。同じ wordId がキューにあれば何もしない。
- `advanceEncounter` はキュー先頭の期限（`dueSequence`）が来ていればその語を `source: 'reencounter'` として表示し、`normalIndex` は進めない。これにより通常周回の語は飛ばされない。
- 期限が同時に来た予約は1 Encounter に1件ずつ、予約順に出す。
- 再遭遇語が、ちょうど次の通常語と同じ場合は二重に出さず、通常表示で予約を消化する。
- 「前へ」では再遭遇語を差し込まない。再遭遇語の表示中に「前へ」を押すと、差し込み直前の通常語へ戻る。
- `attentionCount` は1回の表示につき1回まで増える（同じ表示中の連打は1回の意思表示として数える）。

例（apple でタップ）:

```
apple ← タップ
dog
cat
water
sun
apple ← 再登場（5 Encounter 後）
book
car
...
```

### 保存
- キー: `word-loop.learning-progress`
- 形式: `{ "version": 1, "words": { "<wordId>": WordLearningProgress } }`
- 書き込みは約1秒の間引き（最後の変更から最長1秒後）と、`pagehide` 時の即時保存。0.2秒/語の高速周回でも毎表示ごとに書き込まない。
- 読み込み時に壊れた JSON、想定外の型、負数や不正な日時は既定値へ戻す。
- `word-loop.learning-state` の再開位置は通常周回側の単語を保存する（再遭遇語の表示中に閉じても、通常周回の位置から再開する）。

### UI
- 単語カード全体を透明なボタンで覆い、ワンタップで「もう一度見る」にした。
- 画面下部に小さく `開発用 · Encounter: n · Attention: n · 再遭遇予約: n` を表示する（最終UIではない）。再遭遇による表示中は「再遭遇中」と出る。

## 確認内容
- `npm run lint` 成功
- `npm run build` 成功
- 開発サーバー（StrictMode有効）でブラウザ自動操作により確認
  - 起動直後の Encounter が 1（二重加算なし）
  - カードを3回連打しても Attention 1・予約1件
  - 次へ8回で `apple dog cat water sun apple book car tree`（5 Encounter 後に再登場、通常周回は欠けない）
  - 自動周回中のタップで周回が止まらず、5 Encounter 後に再登場
  - localStorage に進捗が保存され、リロード後に復元される
  - 壊れたデータ（不正JSON、配列、不正な値）では初期状態から開始し、既存設定も壊れない

## 今回は実装しない
9:1 の自動選出、105 Encounter、Known / Growth 判定、XP、Gold、HP、全滅、帰還、レベルアップ、RPG演出、AI、詳細説明画面、画像生成、JSONへのデータ移行、15,000語対応、音声終了待ちモード。

## 次のTaskへの課題
- 選出ロジックの拡張: Growth語・Rare語を混ぜる場合、`advanceEncounter` の選出部分を「候補の供給元」単位に分ける。
- 「前へ」の扱い: 現在は通常周回を1つ戻るだけで、表示履歴は持たない。再遭遇語を含めて履歴どおり戻るかは要検討。
- 再遭遇の間隔: 固定5。attentionCount に応じた間隔調整は未対応。
- 進捗データの増加: 15,000語規模では全体を1つのJSONで毎回書き込む方式の見直しが必要。
- 開発用表示の削除時期。
