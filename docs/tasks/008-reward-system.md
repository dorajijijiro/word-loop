# Task 008: 遠征結果・XP / Gold・累積成長（Milestone A）

## 目的
「105語見た → 帰還した → 成長した」流れを作る。学習結果を XP / Gold としてゲームの成長に返す基盤で、値はすべて暫定。

## 仕様
- 遠征完了時に Encounter / Familiar / Growth / Re-encounter / XP / Gold を表示
- XP（暫定）: familiar +1、growth +5、re-encounter +10。同じ Encounter を重複加算しない
- Gold（暫定）: 最後まで完了して帰還した報酬。基本100 + growth 1回につき+2 + re-encounter 1回につき+5
- 累積: `PlayerProgress { totalXp, gold, completedExpeditions }` を `word-loop.player-progress` に保存
- 帰還画面: 今回のXP / Gold、累積XP、所持Gold、完了遠征数。「次の遠征へ」で再出発

## 実装結果

### ファイル構成
| ファイル | 役割 |
| --- | --- |
| `src/lib/rewards.ts` | 新規。XP表・Gold定数、`calculateEncounterXp`、`calculateReturnGold`、`getEncounterRewardKind` |
| `src/lib/playerProgress.ts` | 新規。`PlayerProgress` の型、`applyExpeditionRewards`、localStorage 読み書きと検証 |
| `src/lib/expedition.ts` | 内訳（familiar / growth / reencounter）、`xp`、`lastRecordedSequence`、`rewards` を追加。状態に `returned` を追加 |
| `src/App.tsx` | 完了時の報酬確定と保存、遠征完了画面・帰還画面、待機画面に累積表示 |
| `src/App.css` | 帰還画面のスタイル（仮UI） |

### XP
- `recordExpeditionEncounter` が Encounter を記録するたびに `calculateEncounterXp({ kind })` を加算する。
- `lastRecordedSequence` より小さいか同じ通し番号の Encounter は無視するため、同じ Encounter は二重加算されない（StrictMode の二重実行でも同様）。
- 将来「初回未知語」「数時間後・翌日・1週間後の再認識」「日本語なし認識」で XP を変える場合は、`EncounterRewardInput` に判定材料（記録前の `WordLearningProgress` など）を足し、`calculateEncounterXp` だけを変える。
- 「前へ」で戻った語も1 Encounter として、その時点の分類で XP を得る（Task 006 の数え方に合わせた）。

### Gold
- `completeExpedition`（105語目を表示し終えた時点）で `calculateReturnGold(counts, true)` を計算し、`rewards` に確定させる。未完了の遠征には Gold を与えない（現在は途中終了の手段がない）。

### 報酬の確定と保存
- 105語目の表示後に「遠征完了」へ切り替わる瞬間に、`applyExpeditionRewards` で累積へ加算し、すぐ `word-loop.player-progress` に保存する。帰還ボタンを押す前に再読み込みしても報酬は失われない。
- `running → completed` の切り替えは1回だけなので、報酬は二重に加算されない。
- 保存形式: `{ "version": 1, "player": { "totalXp", "gold", "completedExpeditions" } }`
- 壊れた JSON、オブジェクト以外、負数・小数などは項目ごとに 0 へ戻す。
- `word-loop.learning-state` / `word-loop.learning-progress` とは別キーで、既存データには触れない。

### 画面の流れ（仮UI）
1. 待機: 「遠征を開始」。1回以上完了していれば累積XP・所持Gold・完了遠征数を小さく表示
2. 遠征中: 従来どおり。開発用表示に現在の bucket、F/G/R、今回のXP
3. 遠征完了: Encounter / Familiar / Growth / Re-encounter と XP / Gold、「帰還する」
4. 帰還: 「105 語に出会い、無事に帰還しました。」、今回の獲得（+XP / +Gold）、これまでの成長（累積XP / 所持Gold / 完了遠征）、「次の遠征へ」
- 「次の遠征へ」で 105 Encounter を再開。学習履歴・XP・Gold は累積し、再遭遇キューは持ち越さない。
- 遠征途中・帰還画面の状態は保存しない（再読み込みで待機に戻る。累積値は保持）。

## 確認内容
- `npm test`（`tests/rewards.test.ts`）: XP表、同一 Encounter の重複加算なし、Gold計算と未完了0、105上限（200回進めても105で止まり内訳の合計が105、XP・Gold が式どおり、二重完了なし）、累積、壊れたデータ、localStorage 往復
- ブラウザ（StrictMode、390×844）:
  - 遠征開始 → 手動で105 → 「遠征完了」に Familiar / Growth / Re-encounter / XP / Gold → 帰還 → 次の遠征へ、を2回。累積XP・Gold・完了遠征数が加算される
  - 例: Familiar 92 / Growth 11 / Re-encounter 2 → XP 167（92+55+20）、Gold 132（100+22+10）
  - 自動周回（超高速）でも105で完了し、完了直後に保存済み
  - 再読み込み後も待機画面に累積値が表示される。学習進捗の Encounter 合計は2遠征で210
  - 壊れた `word-loop.player-progress` では初期値（累積表示なし）から開始
  - コンソールエラーなし

## 今回は実装しない
HP、全滅、Gold半減、装備、アイテム、エリアマップ、ボス、レベルアップ演出、Goldの使い道、遠征履歴の保存。
