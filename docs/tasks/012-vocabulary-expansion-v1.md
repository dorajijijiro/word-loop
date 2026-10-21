# Task 012: Vocabulary Expansion v1（Milestone E）

## 目的
内蔵語彙を20語から200項目へ増やし、「既知語・曖昧な語・未知語」が混ざった状態で、
既存の Encounter / Attention / Again / Recall がどう機能するかを確かめられるようにする。

報酬系や新しい学習機能は追加しない。学習アルゴリズムも原則変更しない（例外は下の「選出の修正」1点のみ）。

## 200語にした理由
20語では次の理由で実際の学習体験を評価しにくかった。

- 全単語をすぐ見慣れ、familiar が急速に増える
- 本当に知らない語がほぼなく、Attention（タップ）したくなる語が少ない
- Recall の候補が少なく、挙動を判断しにくい

200項目にすると「知っている → 見たことはある → 意味が少し曖昧 → ほぼ知らない」が1遠征の中に自然に混ざる。
15,000語化はまだ目的にしていない。

## 構成（合計200項目、追加180項目）
| 区分 | 項目数 | 内容 |
| --- | --- | --- |
| 基礎（単語） | 80 | 既存20語 + 日常的でよく使う語60（family, morning, open, close, big, small …） |
| 中級（単語） | 70 | 意味は知っていても瞬時に出にくい語（improve, available, decision, opportunity …） |
| やや難しい（単語） | 30 | 見たことはあるが即座に意味が出にくい語（inevitable, reluctant, ambiguous, deteriorate …）。極端な難語・試験専用語は避けた |
| phrase / chunk | 10 | little by little, in terms of, as a result, at least, for example, in advance, make sure, on purpose, by the way, in the long run |
| phrasal verb | 10 | come up with, deal with, take care of, look forward to, give up, figure out, put off, run out of, turn down, get along with |

`difficulty` は phrase / phrasal verb にも付けた（基礎8・中級11・やや難しい1）。
全体の `difficulty` 内訳は basic 88 / intermediate 81 / advanced 31、`type` 内訳は word 180 / phrase 10 / phrasal-verb 10。

既存20語は id・英語・日本語・補助文・Cue・画像を変更していない（`difficulty: 'basic'`, `type: 'word'` だけ追加）。
データ内の並びは「既存20語 → 基礎 → 中級 → やや難しい → phrase」。選出はランダムなので並び順は学習に影響しない。

## phrase / chunk の扱い
- 語彙項目 = 単一単語とは限らない。phrase / chunk / phrasal verb も同じ `Word` として扱う。
- 表示・読み上げ・選出・学習状態・Recall はすべて単語と同じ（`type` で処理を分けない）。
- 長い項目（look forward to, comprehensive など）は 390px 幅で1行に収まらなかったため、
  英語表示だけ文字数に応じてフォントを縮める CSS を追加した（短い語の表示サイズは従来どおり）。

## データ構造（`src/data/words.ts`）
```ts
type WordDifficulty = 'basic' | 'intermediate' | 'advanced'
type WordType = 'word' | 'phrase' | 'phrasal-verb'

type Word = {
  id: string
  english: string
  japanese: string
  phrase: string
  recallCue?: string
  difficulty?: WordDifficulty // 将来用。選出・学習ロジック・UIでは使わない
  type?: WordType             // 将来用。chunk / 定型表現は 'phrase' に含める
  image: { id; placeholder; alt }
}
```
- 追加フィールドはどちらも省略可能。保存データ（localStorage）の形式は変更していない（`word-loop.learning-progress` version 2 のまま）。既存の保存データは、既存20語の id が変わらないためそのまま使える。
- `category` は今回は追加していない（必要になった時点で検討）。
- id は英語ベースの slug（`apple`, `little-by-little`, `come-up-with`）。保存データのキーになるため、今後は変更しない。

## 日本語訳の方針
- 一瞬で意味を取れる短さを優先（最長15文字、テストで16文字以内を確認）。
- 全意味を並べず、今回の代表的用法を1〜2個（`重要な / 大きな意味を持つ`）。
- 辞書・単語帳の訳語をなぞらず、今回のために自作。

## 補助文（phrase）の方針
- 2〜8語程度の短い英語例（`make a decision`, `deal with the problem`）。文法説明ではなく「使われる感じ」の補助。
- 既存20語の文（`A red apple.` など）はそのまま。追加分は小文字始まり・句点なしの短い語句にした。
- phrase / phrasal verb の補助文には、その表現自体を含める。

## Recall Cue の方針
- すべての項目に自作の Cue を付けた。1〜2行、1行20文字以内。英字を含めない（答えのヒントにしない）。
- 辞書的な説明ではなく、場面・意図・感覚を頭に浮かべるもの。
  - 具体語: `bed` → 夜に横になって、／布団をかけて眠る場所。
  - 抽象語: `reluctant` → やった方がいいとは分かっているけれど、／乗り気になれない感じ。
  - phrase: `little by little` → 一気にではなく、／一歩ずつ積み重ねていく感じ。
  - phrasal verb: `come up with` → 考えをめぐらせた末に、／新しい案がぽんと浮かぶ。
- `japanese` は即座の意味確認、`recallCue` は場面・概念、と役割を分けた。同じ文を二重に入れない
  （例えば little by little の訳「少しずつ」は Cue に使っていない）。

## 著作権・生成方針
- 英単語・表現の選定、日本語訳、補助文、Recall Cue はすべて今回のために自作した。
- 市販単語帳・辞書・学習サイト・他社アプリ・有料教材からコピーしていない。特定教材の収録順や説明文も再現していない。
- 外部 API、Web スクレイピング、外部データの取り込みは行っていない。

## 画像
- `image` フィールドの形式は変更していない（`{ id, placeholder, alt }`）。画像ファイルは追加していない。
- 具体物で自然な絵文字がある61項目（既存20語を含む）は絵文字。
- 抽象語・phrase など139項目は、意味を持たないニュートラルな `◌`（`neutralImagePlaceholder`）。無理に意味の合わない絵文字は割り当てない。
  画面では薄く小さく表示する（`.image-area span.is-neutral`）。

## 選出の修正（語彙数増加で生じた偏り）
200語で動かすと、2遠征目以降に **familiar が8語に達した瞬間から、familiar 枠（約9割）をその8語だけが占める** 偏りが起きた
（1遠征で同じ語が10回以上、unique 語数が40前後に落ちる）。
これは「familiar が少ない間は familiar 枠に new を混ぜ、少数語の繰り返しを避ける」（Task 010、`minimumFamiliarPool = 8`）が20語前提の値だったため。

そこで閾値だけを語彙数に合わせて増やした（`getMinimumFamiliarPool`）。

```
最低語数 = clamp(ceil(語彙数 × 0.15), 8, 30)
20語 → 8（従来と同じ） / 100語 → 15 / 200語 → 30 / 15,000語 → 30
```
1遠征の familiar 枠は約95回なので、30語あれば1語あたり3回前後に収まる。
9:1 の比率、new / growth / familiar の判定、attentionDebt、Again、Recall、XP / Gold / Level は変更していない。

シミュレーション（実際の選出ロジック・学習状態更新、5シード、localStorage 初期状態から3遠征、難しい語ほどタップする想定）:

| | 2遠征目 unique（平均） | 3遠征目 unique（平均） | 1遠征内の最多繰り返し |
| --- | --- | --- | --- |
| 修正前（8固定） | 47 | 39 | 13回 |
| 修正後 | 71 | 61 | 7回 |

## テスト（`npm test`、70件）
既存57件は維持（Recall の Word データテストは「20語」固定の件数チェックを「全項目」に変更）。13件を追加。

- `tests/words.test.ts`（10件）: 約200項目・既存20語を含む、id / english の重複なし、id が english の slug、english / japanese / phrase / recallCue が空でない、日本語16文字以内・補助文2〜8語・40文字以内、Cue 40文字以内で日本語訳の繰り返しでなく答えの英語を含まない、image の id・placeholder・alt、difficulty / type が定義済みの値、phrase / phrasal verb の id 一意・複数語・補助文に表現を含む、難易度構成
- `tests/wordSelector.test.ts`（3件）: 最低語数が語彙数に応じて増える、200語で familiar 10語の間は new を混ぜる、200語で familiar 30語以上なら 9:1 に戻る
- 既存の Recall Cue 形式テスト（1〜2行、1行20文字以内、英字なし）が200項目すべてに適用される

`npm run lint`、`npm run build` も成功。

## ブラウザ確認（Playwright / Chromium、390×844、dev サーバー）
localStorage を初期化し、0.5秒/語の自動周回で2回遠征した。タップは「難しい語ほどタップする」想定で自動化
（やや難しい 60%、phrase 30%、中級 12%、基礎 0%、again 中はその半分）。speechSynthesis はスタブ。

| | unique | familiar | new | growth | again | recall | タップ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 第1遠征 | 70 | 1 | 84 | 6 | 10 | 4 | 11 |
| 第2遠征 | 60 | 7 | 70 | 7 | 17 | 4 | 18 |

参考: 同じ手順を20語版（master）で行った結果（基礎語のみなのでタップなし）

| | unique | familiar | new | growth | again | recall |
| --- | --- | --- | --- | --- | --- | --- |
| 第1遠征 | 18 | 61 | 40 | 0 | 0 | 4 |
| 第2遠征 | 20 | 90 | 11 | 0 | 0 | 4 |

- 1遠征の難易度別の遭遇数（第1 / 第2）: 基礎 50 / 39、中級 24 / 24、やや難しい 18 / 31、phrase 4 / 2、phrasal verb 9 / 9
- 1語の最多繰り返しは第1遠征 deteriorate ×8、第2遠征 tentative ×9（いずれもタップ → again → Recall で繰り返した語）
- 基礎語・中級語・やや難しい語・phrase・phrasal verb、new / growth / familiar / again / recall のすべてが同じ遠征内に共存することを確認
- 長い項目（look forward to, comprehensive など200項目すべて）が 390px・320px 幅で横にはみ出さないことを確認
- コンソールエラーなし。localStorage のキーは従来の3つのみ（learning-progress は2遠征後で約17KB）
- 初期表示・選出・自動周回・Recall 候補選出に体感できる遅れはなし（選出は毎回200語を1回走査する O(n)）

スクリーンショットはプロジェクトファイルの `milestone-e/` に保存。

## 20語版との体験差（所感）
- 20語版は第2遠征で familiar 90 / unique 20 となり、「知っている語が同じ順番感で回り続けるデモ」に近かった。タップしたくなる語もなかった。
- 200語版は第2遠征でも unique 60 前後で、基礎語が流れる中に inevitable / tentative / hesitate のような「一瞬止まる語」が数語おきに混ざる。タップ（Attention）→ 約5語後の again → 遠征後半の Recall、という既存の流れが初めて自然に回った。
- 一方で、word-loop 上の familiar（3回見た語）は2遠征ではほとんど増えない。表示ラベルはほぼ `new` になり、「本当は知っている基礎語」も new と表示される。ユーザーの既知・未知と word-loop の new / familiar がずれている点は、今後の観察ポイント。

## 将来15,000語にするときの課題
- **データ形式**: TS 配列のままではバンドルが大きくなる（200項目で JS が約50KB増、gzip 後は約13KB増）。JSON 分割・遅延読み込み・必要範囲だけ読む仕組みが必要。
- **選出の計算量**: 毎回全語を bucket 分けしている（O(n)）。15,000語では bucket ごとの索引を持つなどの工夫が要る。
- **保存サイズ**: learning-progress は遭遇した語ごとに保存する。15,000語すべてに遭遇すると数MB規模になり、localStorage の上限に近づく。
- **new の導入速度**: 今の選出では未遭遇語がランダムに大量に出る。15,000語ではほぼすべてが一度きりの new になるため、導入する語の範囲（難易度・頻度・カテゴリ）を絞る仕組みが必要。`difficulty` / `type` はそのための足場。
- **既知語の扱い**: 本当に知っている基礎語も new から始まる。既知語の早期 familiar 化（初回判定など）を検討する余地がある（今回は未実装）。
- **報酬バランス**: new は XP 5 / Gold 2 のため、200語では1遠征の XP が約600（Milestone D の20語版の記録では約170）に増えた。Level の伸びが速くなる。値の見直しは別タスク。
- **データ品質**: 日本語訳・補助文・Cue の自作を15,000項目へ広げるには、作成・レビューの手順と機械チェック（今回のテスト）をさらに整える必要がある。
- **画像**: 抽象語・phrase は placeholder のまま。画像を付けない前提の画面設計にするかを決める必要がある。

## 今回やらないこと
15,000語化、AI API、外部辞書 API、Web スクレイピング、市販単語帳の取り込み、音声・画像ファイルの大量追加、正誤判定・クイズ・回答入力、報酬系の刷新、Rare Encounter、Salience 演出、未知語判定、学習アルゴリズムの変更（上記の閾値修正を除く）。
