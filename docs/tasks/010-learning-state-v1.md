# Task 010: 学習状態モデル v1（Milestone C）

## 目的
Milestone A/B の暫定分類（familiar / growth の2段階）には次の2つの問題があった。

1. 初回利用時は全語が `growth` 扱いになる（未知語＝苦手語のように見える）
2. 一度でも Attention した語は `attentionCount > 0` のため永遠に `growth` に残る

これを解消し、「初めて見る → 注意が必要 → 見慣れる」という自然な状態変化を作る。
「ユーザーが本当に記憶した」と断定する仕組みは作らない。word-loop は引き続き低負荷の高速接触型学習で、分からない語でも止めない（自動停止・説明・回答要求なし）。

## 3段階の LearningBucket
`type LearningBucket = 'new' | 'growth' | 'familiar'`（`src/lib/wordSelector.ts`）

| bucket | 意味 | 条件（優先順） |
| --- | --- | --- |
| growth | 最近 Attention した、もう少し再遭遇させたい語 | `attentionDebt > 0` |
| new | word-loop 内での観測がまだ少ない語。「知らない」という意味ではない | `encounterCount < 3` |
| familiar | 一定回数接触し、直近で Attention 要求もない語。「覚えた」という意味ではなく「通常周回に置いてよい程度に見慣れている」 | それ以外 |

- 初回タップした語は Encounter 回数が少なくても growth。
- `attentionCount` は履歴として残すが、分類には使わない。過去に何度タップしても debt が 0 なら familiar に戻れる。
- Mastered / Learned / 習得などの表現は使わない。
- 分類は保存せず、選出のたびに最新の progress から計算する（再遭遇の表示 bucket も最新の progress で判定）。

## WordLearningProgress（`src/lib/learningProgress.ts`）
```ts
type WordLearningProgress = {
  wordId: string
  encounterCount: number
  lastEncounteredAt: string | null
  attentionCount: number        // 履歴（分類には使わない）
  lastAttentionAt: string | null // 追加。将来の時間経過による再認識判定用（今回は保存のみ）
  attentionDebt: number          // 追加。あと何回程度「注意対象」として扱いたいか（0〜3）
}
```
`attentionDebt` は内部用の名前で、UIには表示しない（開発用の dev 行にだけ `debt n` を出す）。

### Attention 時（カードタップ）
- `attentionCount += 1`、`lastAttentionAt = 現在時刻`
- `attentionDebt = min(3, attentionDebt + 2)`（`attentionDebtIncrement = 2`、`attentionDebtMax = 3`、`increaseAttentionDebt`）
- 再遭遇予約（約5 Encounter 後、Task 005 のまま）
- 同じ Encounter の連打は1回として数える。従来 App 内の ref で行っていたガードを `encounterEngine.registerAttention` に移し、テストできるようにした（`EncounterSession.attentionSequence`）。

### Encounter 時（回復）
- 表示した時点で `attentionDebt = max(0, attentionDebt - 1)`（`decreaseAttentionDebt`）。
- 同じ表示中にタップされれば、その後 +2 されるので、実質的に「再遭遇してタップされなかったとき」だけ回復する。

```
初回表示   debt 0 → 0（表示）→ タップで 2   … growth
再遭遇     debt 2 → 1（タップなし）          … まだ growth
再遭遇     debt 1 → 0（タップなし）          … 3回以上見ていれば familiar
```

## 9:1 選出（`selectNormalWord`）
- 比率の単位を `SelectionTrack = 'familiar' | 'learning'`（learning = new + growth）にした。familiar 約9割・learning 約1割（`learningTargetRatio = 0.1`）。補正方法は Task 007 と同じ（`chooseTrack`、目標から1回分以上ずれたら補正。候補不足で補った回は狙った枠で数える）。
- learning 枠の中では growth を優先。growth と new の両方に候補があるときは 25% の確率で new を選ぶ（`newShareInLearning = 0.25`）。growth が大量にあっても new の導入は止まらない。
- 候補を探す順:
  - learning 枠: growth（25% で new）→ もう一方 → familiar
  - familiar 枠: familiar → new → growth
  - familiar 枠では、familiar の語が `minimumFamiliarPool = 8` 語未満の間は familiar と new をまとめて1つの候補にする。初回遠征で「先に3回見た数語だけが繰り返され、残りの new がほとんど出ない」状態を防ぐため（実装中のシミュレーションで発見）。
  - growth を familiar 枠の最後にするのは、候補不足の補充でタップした語ばかりが続かないようにするため。
- 直前の語は可能な限り避け、語が1種類しかない場合だけ連続を許す（従来どおり）。
- 期限が来た再遭遇は 9:1 の外側で最優先（従来どおり）。

### 初回遠征
全語 new から始まるため 9:1 にはならない。new を観測しながら3回見た語から familiar に移り、遠征の後半で familiar 中心に近づく。
実測（20語、ブラウザ）: 1回目 familiar 59 / new 44 / growth 1 / again 1、2回目 familiar 95 / new 10 / growth 0 / again 0。

## 遠征集計・UI
- `ExpeditionState.newCount` を追加。`familiarCount + newCount + growthCount + reencounterCount = encounterCount` を保証（再遭遇は bucket に関係なく again で数える）。
- 遠征完了の内訳: encounters / familiar / new / ● growth / ↻ again（5列に変更）。
- Encounter ラベル: familiar は無表示、new は `new`（muted 色・細め、記号なし）、growth は `● growth`（アクセント色）、再遭遇は `↻ again`（従来どおり）。ラベル枠は高さ固定のままなので、英単語の位置は動かない。
- dev 行: `debt n` と `F/N/G/R` を表示。

## XP / Gold / PlayerProgress
- `EncounterRewardKind` に `new` を追加。XP は familiar 1 / new 5 / growth 5 / again 10（new は暫定的に growth と同じ）。
- Gold は `100 + (new + growth) × 2 + again × 5`。旧仕様では new 相当の語も growth として数えていたため、実質的な変化はない（`growthEncounterGold` を `learningEncounterGold` に改名）。
- PlayerProgress（totalXp / gold / completedExpeditions）と Level 計算は変更なし。

## 旧データ互換
- storage key は `word-loop.learning-progress` のまま。保存 version を 1 → 2 に上げた。
- 読み込みは version を問わず、`lastAttentionAt` / `attentionDebt` がない・壊れている場合は `null` / `0` とする（debt は上限3で丸める）。既存の encounterCount / attentionCount はそのまま保持し、データの削除・初期化はしない。
- 旧仕様で永久に growth だった語（`attentionCount > 0`）は、debt 0 として読み込まれるので、3回以上見ていれば familiar になる。
- 次回の保存から version 2 の形式で書き込まれる。

## テスト（`npm test`、38件）
- Progress（`tests/learningProgress.test.ts` 新規）: 旧データ読み込みと version 2 での再保存、新フィールドがない/壊れている場合の fallback、Attention で debt +2・上限3、lastAttentionAt 保存、Encounter で debt 減少・0 未満にならない、new → growth → familiar の状態変化
- Bucket（`tests/wordSelector.test.ts`）: 未遭遇・1〜2回は new、debt ありは growth、3回以上 + debt 0 は familiar、attentionCount があっても debt 0 なら familiar
- Selector: familiar 中心で learning 約1割（5シード）、growth 優先かつ new も枯れない、growth がなければ new、初回は全語 new で growth にしない、familiar が少ない間は new を混ぜる、候補不足で停止しない、同一語連続回避、語が1つ
- Encounter（`tests/encounterEngine.test.ts`）: 同一 Encounter の連打は1回、再遭遇の bucket は最新 progress
- Expedition（`tests/rewards.test.ts`）: 初回から2遠征をシミュレーションし、内訳合計 = Encounter 数、105上限、XP が内訳と一致（二重加算なし）、タップした語が debt 0 に戻る、2回目は familiar 中心

## ブラウザ確認（Playwright / Chromium、390×844、StrictMode の dev サーバー）
1. 新規状態から開始 → 初回 Encounter は `new`
2. 同じ語を数回見る → 3回目以降はラベルなし（familiar）
3. カードタップ（3回連打）→ Attention 1・debt 2、再遭遇予約1件
4. 次に通常選出で出たとき `● growth`、タップ5 Encounter 後に `↻ again`
5. その後タップしなければ debt 2 → 1 → 0、ラベルなし（familiar）に戻る（attentionCount 1 は残る）
6. 0.25秒/語の自動周回で継続 → 105 Encounter で完了。内訳合計 105、XP / Gold が内訳の計算と一致
7. 帰還 → LEVEL UP Lv.1 → Lv.2、次の遠征 → 完了（familiar 95 / new 10）
8. リロード後も Level・XP・Gold・Expeditions・学習進捗を保持。localStorage のキーは従来の3つのみ
9. 旧形式（version 1、新フィールドなし）の学習進捗と player-progress を用意して起動 → クラッシュなし、遠征後に version 2 で保存され、encounterCount（14 → 23）・attentionCount（3）を保持。旧仕様で growth 固定だった語は familiar として出る
10. ダークモードでも new ラベルが静かに表示される。コンソールエラーなし

## 今後の拡張余地
- bucket は `LearningBucket` と `provisionalBucketRule`、選出順（`candidatePools`）だけで決まるので、`stable` / `fluent` などは bucket を足してルールと選出順を変えれば追加できる。
- `lastAttentionAt` と `lastEncounteredAt` が揃ったので、数時間後・翌日・1週間後の再認識価値（XP や分類）を時間経過で計算する土台がある。
- 今回は stable / fluent / mastered、日単位の間隔反復、忘却曲線、SM-2 / FSRS、正誤入力・クイズ類、AI・外部API は実装していない。

## 残課題
- 数値（debt +2・上限3、new 判定3回、learning 1割、new 25%、familiar 最小8語）はすべて暫定。
- 20語では1回目の遠征で全語が出ないことがある（例: 18 / 20 語）。残りは2回目以降の learning 枠で出る。
- タップした語は「通常選出の growth」と「再遭遇」の両方で出るため、debt +2 は1〜2回の再接触で消化される。もう少し長く growth に残したい場合は increment を調整する。
- 「前へ」も新しい Encounter として debt を1減らす（Encounter として数える既存仕様に合わせた）。
- XP / Gold のバランス、iOS 実機確認は従来どおり未対応。
