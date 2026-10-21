# Task 007: familiar / growth 分類と 9:1 Encounter 選出（Milestone A）

## 目的
105 Encounter の遠征を「既知語中心＋未定着語少量」で回す。通常 Encounter は familiar 約9割・growth 約1割を目標にし、期限が来た再遭遇は比率の外側で最優先に出す。

## 仕様
- 分類 `type LearningBucket = 'familiar' | 'growth'`
  - 暫定ルール: `encounterCount >= 3` かつ `attentionCount === 0` → familiar、それ以外 → growth
- 選出の優先順位: 期限が来た再遭遇語 → 9:1 通常選出
- 候補不足のときは存在する bucket から補う（アプリを止めない）
- 同じ語の連続表示は可能な限り避ける
- 105 Encounter の上限は維持。再遭遇キューは遠征間で持ち越さない

## 実装結果

### ファイル構成
| ファイル | 役割 |
| --- | --- |
| `src/lib/wordSelector.ts` | 新規。分類（`provisionalBucketRule` / `classifyWord` / `groupWordsByBucket`）、bucket の決定（`chooseBucket`）、通常選出（`selectNormalWord`）。React に依存しない純粋関数で、乱数関数と分類ルールを注入できる |
| `src/lib/encounterEngine.ts` | 20語の順番周回を 9:1 選出に置き換え。`Encounter` に `bucket` を追加。`startEncounter`（遠征開始）を追加し、`restartEncounter` を置き換え |
| `src/App.tsx` | 選出時に最新の学習進捗を渡す。開発用表示に bucket と F/G/R を追加 |

### 分類
- `BucketRule = (progress: WordLearningProgress) => LearningBucket` として分離。ルール変更時は `provisionalBucketRule` を差し替える。
- 分類は選出のたびに最新の学習進捗から計算する（保存はしない）。遠征中に3回目を見た語はその場で familiar になる。

### 9:1 の決め方（`chooseBucket`）
- セッションに「この遠征の通常選出で狙った bucket の回数」（`plannedCounts`）を持つ。
- 期待 growth 数 `(通常選出回数 + 1) × 0.1` と実際の growth 数の差が1以上なら growth、-1以下なら familiar、その間は `random() < 0.1` で決める。乱数だけだと100回でぶれが大きいので、1回分以上ずれたら補正する。
- 候補不足で他方から補った回は「狙った側」で数える。これにより、growth が空の時期に溜まった不足分が後でまとめて growth 連発になることを防ぐ。
- bucket 内の語は一様ランダム。

### 候補不足と連続回避（`selectNormalWord`）
1. 狙った bucket から、直前の語を除いて選ぶ
2. 空なら、もう一方の bucket から直前の語を除いて選ぶ
3. それでも空（語が1種類だけ）なら連続を許して選ぶ
- 戻り値の `bucket` は実際に出した語の分類（帰還画面の Familiar / Growth はこちらで数える）。

### 再遭遇との関係（`advanceEncounter`）
- 期限が来た予約は 9:1 選出より先に出す。再遭遇は `plannedCounts` に含めない。
- 予約語がちょうど表示中の語と同じ場合は連続になるため、1 Encounter だけ後ろへずらす。
- 旧仕様の「次の通常語と同じなら通常表示で消化」は、通常語が順番でなくなったため廃止。

### 遠征開始と「前へ」
- `startEncounter`: 再遭遇予約・履歴・`plannedCounts` をリセットし、最初の語も 9:1 で選ぶ。前の遠征の最後の語とは連続しない（Task 006 の残課題「次の遠征が前遠征の最後の語から始まる」を解消）。
- 「前へ」は通常周回の1つ前ではなく、表示履歴（最大50件）の直前の語を新しい Encounter として表示する。戻れる履歴がなければ何もしない。
- 再開位置（`word-loop.learning-state` の `currentWordId`）は最後に通常表示した語を保存する。現在は待機画面で単語を出さないため、実質「次の遠征の最初の語と連続させない」用途。

## 確認内容
- `npm test`（`tests/wordSelector.test.ts` / `tests/encounterEngine.test.ts`）: 分類、ルール差し替え、9:1（5シードで100回中 growth 8〜12）、候補不足、連続回避、語が1つの場合、再遭遇優先、再遭遇語の連続回避、前へ、遠征開始時のリセット
- ブラウザ（StrictMode、390×844）: 学習進捗を 18 familiar / 2 growth にした状態で3遠征 → Growth 11 / 10 / 10、Re-encounter 2 / 2 / 2、同じ語の連続 0

## 注意（暫定ルールの性質）
- 初回利用時は全語が growth のため、最初の遠征は familiar 候補不足で growth が多くなる（実測 Familiar 49 / Growth 49）。3回見た語から familiar になり、2回目以降の遠征で 9:1 に近づく。
- `attentionCount > 0` の語は暫定ルールでは永久に growth。20語でタップを多用すると familiar の候補が減り、growth 比率が上がる。将来のルール（最終接触からの経過時間など）で解消する想定。

## 今回は実装しない
本格的な Rare 判定、間隔反復スケジュール、15,000語対応。
