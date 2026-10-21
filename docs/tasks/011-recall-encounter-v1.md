# Task 011: Recall Encounter v1（Milestone D）

## 目的
word-loop は「見る → 聞く → 再遭遇する → 見慣れる」という低負荷・高速接触型の学習体験になっている。
ここへ、ごく少量だけ「英語を自分の頭から取り出そうとする瞬間」（能動想起）を加える。

Recall Encounter は主役ではなく、通常 Encounter の流れにときどき混ざる短いイベント。
word-loop の核は引き続き「止まらず大量に英語へ接触すること」で、次のことは守る。

- 回答入力・四択・スワイプ判定を求めない
- 正解 / 不正解を判定しない（「わかった」「わからなかった」ボタンもない）
- 分からなくても止めない。失敗感を与えない。長い説明を出さない
- Recall 後は自動的に通常の Encounter へ戻る

```
日本語＋概念Cue → 少し考える → 英語が現れる → 音を聞く → 何事もなかったように次へ
```

## なぜ日本語だけではなく概念Cueを使うか
日本語だけを出すと「日本語単語 → 英単語」の翻訳テストになりやすい。
場面・意図・対比・感覚を添えることで、「言いたい意味・状況は頭にあるが、英語表現だけがまだ出てこない」状態を軽く作る。
実際に英語を話すときの「伝えたい場面がある → 英語を探す」に近い形を目指す。

## Word データ（`src/data/words.ts`）
```ts
type Word = {
  ...
  // Recall Encounter で英語を隠して出す、日本語の短い概念Cue（1〜2行、改行は \n）
  recallCue?: string
}
```
- 名前は既存の `english` / `japanese` / `phrase` に合わせ `recallCue` とした。
- UI に直書きせず単語データに持たせる。将来 15,000 語へ増やしても1語1項目で済む。
- 未設定の語は Recall の対象にしない（`recallCue` がある語だけを App が候補として渡す）。
- 既存20語すべてに自作の Cue を追加した（外部辞書・単語帳・学習サイトの文章は使っていない）。
- 書き方: 辞書的な定義ではなく、頭の中で場面を作りやすい短い説明。1〜2行、1行20文字以内。英字を含めない（答えのヒントにしない）。テストで形式を確認している。

| 語 | Cue |
| --- | --- |
| apple | 赤や緑の丸い果物。／手に持ってかじる場面。 |
| door | 部屋に入ったり出たりするときに／開け閉めするもの。 |
| rain | 空から水滴が降っていて、／傘をさす場面。 |
| water | のどが渇いたときに飲む、／透明な液体。 |
| …（全20語は words.ts） | |

## Recall の対象
`src/lib/recall.ts` の `selectRecallWord`。優先順は次のとおり。

1. growth で、この遠征でまだ Recall していない語
2. new（一度以上見たことがある語）で、まだ Recall していない語
3. growth（Recall 済みを含む）
4. new（Recall 済みを含む）
5. 候補なし → その回の Recall は見送る（0回でも遠征は成立する）

- familiar は対象にしない。「まだ学習途中の語を軽く思い出す」ことが目的のため。
- new のうち一度も表示していない語（encounterCount 0）は除外した。見たことのない英語は思い出せず、ただの知識テストになるため。
- 直前に表示した語は除く（同じ語の連続表示を避ける既存ルールと同じ）。
- 1語につき1遠征1回まで。候補が足りないときだけ重複を許す。

## 最大回数とスケジューリング
- 1遠征 105 Encounter のうち最大4回（`recallMaxPerExpedition = 4`）。
- 遠征開始時（`startEncounter`）に、遠征内の位置を区間ごとにランダムで1つずつ決める（`planRecallPositions`）。

| 区間 | 遠征内の Encounter |
| --- | --- |
| 1 | 15〜30 |
| 2 | 35〜55 |
| 3 | 60〜80 |
| 4 | 85〜100 |

- 位置は通し番号（`Encounter.sequence`）に変換して `EncounterSession.recallSchedule` に持つ。Recall した語は `recalledWordIds`。どちらも遠征内だけの状態で、保存しない。
- 選出の優先順位（`advanceEncounter`）:
  ```
  期限が来た Re-encounter
  ↓
  予定された Recall（予定の通し番号以降で最初の前進）
  ↓
  通常 9:1 選出
  ```
  再遭遇に押し出された Recall は次の前進で出るので、位置が1〜2 Encounter ずれることがある。
- Recall も再遭遇と同じく 9:1 比率の外側として扱い、`plannedCounts` には含めない。
- 遠征終了時（`clearReencounterQueue`）に未消化の予定を破棄する。「前へ」では Recall を出さない。

## Encounter の種別
```ts
type EncounterSource = 'normal' | 'reencounter' | 'recall'
type Encounter = { sequence; wordId; source; bucket }
```
- Recall の `bucket` には Recall 直前の bucket（`new` / `growth`、型は `RecallSourceBucket`）を入れる。将来の報酬や分析に使える。
- Recall も1 Encounter として数え、sequence は1増える。再遭遇・Recall を含めて 105 で遠征終了し、106 以上にはならない。

## Cue / Reveal
| フェーズ | 表示 | 表示しないもの |
| --- | --- | --- |
| cue | 小さな `recall` ラベル、日本語、recallCue | 英語、画像、英語の補助文、音声 |
| reveal | 英単語（最も大きく、短いフェードイン）、日本語、recallCue（小さく）、画像、補助文（ON のときのみ）、`+10 XP` | — |

- ラベルは new と同じ静かな色の小さな `recall` だけ。問題番号・QUIZ・CHALLENGE・派手な色は使わない。
- 通常 Encounter のレイアウト・テンポは変えていない。Recall の XP 表示は HUD ではなくカード内（reveal 時）に出す。
- 画像は答えを直接示しやすいため cue 中は出さない（画像を Cue に使うモードは将来別途検討）。

### 時間
`src/lib/recall.ts`（速度設定 `intervalSeconds` から計算）

| 速度 | cue（想起時間） | reveal |
| --- | --- | --- |
| 計算式 | clamp(interval × 2, 0.8, 1.5) 秒 | clamp(interval × 1.5, 0.6, 1.2) 秒 |
| 0.25秒/語 | 0.8秒 | 0.6秒 |
| 0.5秒/語 | 1.0秒 | 0.75秒 |
| 1秒/語 | 1.5秒 | 1.2秒 |
| 3秒/語 | 1.5秒 | 1.2秒 |

0.25秒設定でも一瞬で答えを出さず、3秒設定でも待たせすぎない。

## Timer 制御（自動周回との共存）
進行は UI から切り離した小さな状態機械（`RecallStep = { sequence, phase, durationMilliseconds }`）。
`startRecallStep` → `nextRecallStep`（cue → reveal → null）を App のタイマーが呼ぶだけ。

- Recall の Encounter を表示した瞬間（`showEncounter`）に `recallStepRef` を同期的にセットする。直後に通常の `setInterval` が発火しても、`changeWord` が `recallStepRef` を見て何もしないため、Cue / Reveal を飛ばしたり2語進んだりしない。
- Recall 中は自動周回の `setInterval` 自体を止める（Effect の依存に `recallStep`）。
- Recall 側の `setTimeout` が cue → reveal → 次の Encounter を進め、終わったら `recallStep = null` に戻して通常の自動周回を再開する（次の語から設定速度ぶん表示）。
- 自動周回を止めている（手動操作）ときも、Recall は自動で次の Encounter へ進む。
- Recall 中は「前へ」「次へ」を無効にする。自動周回の停止ボタンは使える（Recall を見せ終えたあと止まる）。
- 105語目が Recall だった場合は reveal まで見せてから遠征完了へ進む（完了の Effect も `recallStep` を待つ）。
- Recall 中（cue / reveal とも）はカードタップの Attention を受け付けない（タップ用の透明ボタン自体を出さない）。Recall 自体が特別な接触のため。

## 音声
- cue 中は英語を読み上げない（前の語の読み上げも止める）。「再生」ボタンも cue 中は無効。
- reveal で、音声 ON なら英単語を1回読み上げる。
- 読み上げは既存の自動周回と同じくタイマーから呼ぶので、Web Speech API の制限は悪化させていない。

## 学習状態への影響
- Recall は通常 Encounter と同じく `recordEncounter` だけを行う（encounterCount +1、lastEncounteredAt 更新、attentionDebt −1）。
- Recall だからといって familiar へ昇格させたり、特別な状態にしたりしない。Mastered 等の状態もない。
- localStorage の形式は変更していない（`word-loop.learning-progress` version 2 のまま）。Recall 専用の永続データはない。

## XP / Gold（`src/lib/rewards.ts`、値は暫定・定数）
| 種別 | XP | Gold |
| --- | --- | --- |
| familiar | 1 | 0 |
| new / growth | 5 | 2 |
| re-encounter | 10 | 5 |
| recall | 10（`encounterXpTable.recall`） | 5（`recallGold`） |

- 正誤判定はないので「思い出せた報酬」ではなく「Recall Encounter を経験した報酬」。
- Gold は Re-encounter と同等に扱った。帰還時 Gold = 100 + (new + growth) × 2 + again × 5 + recall × 5。
- XP は Encounter ごとに通し番号で1回だけ加算（既存の二重加算防止をそのまま使う）。

## 遠征集計
`ExpeditionState.recallCount` を追加。Recall は元 bucket（new / growth）には数えず、別の種別として数える。

```
encounters 105 = familiar + new + growth + again + recall
```
遠征完了画面に `recall` を追加し、内訳を3列 × 2段にした。dev 行にも `recall n` を表示する。

## テスト（`npm test`、55件）
既存38件は維持（`tests/rewards.test.ts` の内訳合計・XP・Gold の式に recall を足した）。`tests/recall.test.ts` に17件を追加。

- Recall scheduling: 1遠征最大4回で各区間に分散（5シード）、予定位置がランダムに揺らぐ、growth 優先、growth を Recall し終えたら new も候補、familiar と未遭遇語は対象外、familiar のみなら Recall 0回でも105で完了、同じ語を重複 Recall しない（候補1語なら重複を許す・直前の語は出さない）
- Encounter: Re-encounter が Recall より優先され Recall は次へずれる、Recall が通常選出より優先され 9:1 比率に含めない、候補なしなら見送って通常選出、Recall でも sequence が1ずつ増え105を超えない
- State: Recall でも encounterCount +1・attentionDebt −1、Recall だけで familiar に昇格しない
- Rewards: Recall XP 10・元 bucket に数えない・二重加算なし・Gold、遠征集計の合計 = 105 と XP の一致
- Cue / Reveal: cue → reveal → 終了の遷移、速度ごとの想起時間
- Word データ: 20語すべてに1〜2行の Cue があり英字を含まない

`npm run lint`、`npm run build` も成功。

## ブラウザ確認（Playwright / Chromium、390×844、StrictMode の dev サーバー）
DOM の変化を MutationObserver で時刻付きに記録し、speechSynthesis はスタブで呼び出しを記録して確認した。

1. 拠点 → 遠征開始 → 通常 Encounter（new / growth / again ラベル）
2. Recall Cue 発生: `recall` ラベル・日本語・Cue のみ。cue 中は `.english` と画像が DOM に存在しない
3. 約0.8秒（0.25秒/語）/ 1.0秒（0.5秒/語）/ 1.5秒（1秒/語）後に英語が Reveal、Reveal と同時に英単語を1回読み上げ。cue 中の読み上げなし
4. Reveal 0.6 / 0.75 / 1.2 秒後に自動で次の Encounter（カウント +1）へ戻り、通常の自動周回が続く
5. 序盤にカードをタップして Re-encounter（again）を作った遠征でも共存（again 6・recall 4）
6. 0.25秒 / 0.5秒 / 1秒の自動周回で、カウントの飛び（2語進む）・Cue / Reveal の飛ばしなし
7. 1遠征の Recall は最大4回（0.25秒: 4回、0.5秒: 2〜3回）。Recall 位置は 18 / 37 / 68 / 92 など区間内
8. 105語目を表示して遠征完了。内訳合計 105（例: familiar 84 / new 0 / growth 11 / again 6 / recall 4）、XP・Gold が式どおり（例: 0.5秒の遠征 XP 168 = 93 + 9×5 + 3×10、Gold 133 = 100 + 9×2 + 3×5）
9. 帰還 → 次の遠征も同様に動作
10. 手動操作（自動周回 OFF）で「次へ」を押して Recall に入ると、「次へ」が無効・タップ不可になり、cue → reveal の後に自動で1つだけ進む
11. 3回目の遠征（全語 familiar）では Recall 0回で問題なく進行
12. ダークモードでも cue / reveal が静かに表示される。コンソールエラーなし。localStorage のキーは従来の3つのみ

スクリーンショットはプロジェクトファイルの `milestone-d/` に保存。

## 残課題
- **iOS Safari**: Reveal 時の読み上げはタイマーから呼ぶため、ユーザー操作の直後でないと iOS Safari では再生されない可能性がある（既存の自動周回の読み上げと同じ制限）。実機確認は未実施。
- 全語が familiar になり、タップもしない状態では Recall の候補がなく Recall は発生しない（仕様どおり）。familiar の長期再確認を Recall に含めるかは今後検討。
- Recall 中も自動周回の停止ボタンは使えるが、Recall 自体は最後まで進む。一時停止・スキップなどの操作は未実装。
- Recall の XP は Encounter 表示時に加算されるため、HUD の累計 XP は cue の時点で増える（+10 XP の表示は reveal 時）。
- 数値（最大4回、区間、cue / reveal 時間、XP 10、Gold 5）はすべて暫定。
- 正誤判定、回答ボタン、入力、四択、Recall 成功率、画像を Cue にするモード、15,000語化、stable / fluent は実装していない。
