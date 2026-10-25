# Task 020: 全語彙の Kokoro 音声生成

## 目的
Task 019 の試聴で、ブラウザ標準の読み上げより Kokoro がよいと判断した。まず出題する全語彙の音声をそろえる。
今回は **音声の生成・検証・試聴まで**。通常の遠征の再生方式・周回速度・自動送りは変えていない。

## 状態（2026-10-25）

| 項目 | 状態 |
| --- | --- |
| 対象 | 出題する 1489 項目（Task 018 の語彙。引退した94項目は対象外） |
| 生成 | **1489 / 1489 項目を生成済み**（未解決 0）。ほかに要判断の語の比較用音声 17 件。合計 1506 ファイル・9.2MB |
| 発音指定 | 12 項目（品詞の取り違え10項目、辞書にない語2項目） |
| 要判断 | 17 項目（1項目に読みの違う意味が混在。片方を確認済みにしていない） |
| 自動検査 | 全件実施。警告 3 件（発声が極端に速い） |
| **人が聴いての発音確認** | **0 件（未確認）**。全件を聴いていないので「発音確認済み」ではない |
| 試聴画面 | 全語彙の検索・ランク／状態の絞り込み・再生を実装。390×844・320×568 で確認 |
| iPhone 実機・Safari | **未確認** |

## 1. 仕様

### 対象
- `src/data/words.ts` の `words`（現在出題する語彙）。件数はコードから取得して 1489 項目（日常基礎 398・日常応用 375・ビジネス基礎 339・ビジネス応用 377）で、指定の1,489項目と一致。
- 引退した94項目（`retiredWordIds`）と、全語彙の例文音声は生成しない。Task 019 の例文6件はそのまま残す。

### 音声
- モデル・声・設定は Task 019 と同じ: hexgrad/Kokoro-82M（リビジョン `f3ff3571791e39611d31c381e3a41a3af07b4987` に固定）、声 `af_heart`、米国英語（`lang_code='a'`）、速度 1.0、24kHz モノラル MP3。
  kokoro 0.9.4・misaki 0.9.4。英語の G2P は misaki の辞書だけを使い、espeak-ng による推測（fallback）は使わない。
- 生成はこの開発環境の CPU で実行（約20分）。有料 API・外部推論サービスは使っていない。
- ファイル: `public/audio/kokoro-vocabulary/{wordId}.mp3`。学習用の既存 wordId をそのままファイル名・対応キーにする（wordId は変更していない）。
  要判断の語の比較用の読みは `{wordId}.{key}.mp3`（例: `estimate.verb.mp3`）。

### 音声の一覧（`public/audio/kokoro-vocabulary/manifest.json`）
`tools/kokoro/generate_vocabulary.py` が生成する（手で編集しない）。音声1件ごとに次を記録する。

| 項目 | 内容 |
| --- | --- |
| `wordId` / `key` | 語彙の wordId（比較用の読みは key も） |
| `text` / `input` / `override` | 表示用の英語、Kokoro に渡した入力、発音指定の有無 |
| `phonemes` | Kokoro が実際に使った発音記号（misaki 表記） |
| `revision` / `voice` / `speed` / `engine` | モデルのリビジョン、声、速度、kokoro・misaki の版 |
| `bytes` / `durationMs` / `sha256` | サイズ、長さ、ハッシュ |
| `checks` / `warnings` | 自動検査の測定値と警告 |

全体の値として、モデル・クレジット・対象件数・合計サイズ、生成できなかった項目の一覧（`unresolved`）を持つ。

### 状態の区別
| 状態 | 意味 | 件数 |
| --- | --- | --- |
| 自動検査済み・未試聴 | 自動検査だけを通った。発音は人が聴いていない | 1457 |
| 要確認 | 発音指定をした語（12）と、自動検査で警告が出た語（3）。優先して聴く | 15 |
| 要判断 | 1項目に読みの違う意味が混在。どちらの読みにするか（または語彙を分けるか）の判断が必要 | 17 |
| 試聴済み / 誤読あり | 人が聴いた結果（`src/data/vocabularyAudio/reviews.json`）。聴いた音声のハッシュと一致するときだけ有効 | 0 |
| 未生成 | 生成できなかった・発音指定を変えて作り直していない | 0 |

- 「自動検査済み」は発音が正しいことを意味しない。全件を聴くまでは「発音確認済み」とは書かない。
- 人が聴いた結果は `reviews.json` に `{"wordId": {"result": "ok" | "misread", "sha256": "…", "date": "…", "note": "…"}}` の形で記録する（今回は0件）。

## 2. 生成・再生成の方法

手順は `tools/kokoro/README.md`。

```bash
.venv-kokoro/bin/python -I tools/kokoro/generate_vocabulary.py            # 全語彙（条件が一致する既存音声は再利用）
.venv-kokoro/bin/python -I tools/kokoro/generate_vocabulary.py --check    # 一致しない・ない音声を調べるだけ
.venv-kokoro/bin/python -I tools/kokoro/generate_vocabulary.py --only estimate,permit   # 指定した語だけ作り直す
```

- 対象語彙は `tools/kokoro/list-vocabulary.ts`（Node）で `src/data/words.ts` から取得する。語彙を増減すれば対象も変わる。
- **再開**: 20件ごとに manifest.json を書き出す。再実行すると、モデルのリビジョン・声・速度・kokoro/misaki の版・入力が一致し、ファイルの SHA-256 も一致する音声は作り直さない。
  2ファイルを消して実行し、その2件だけ生成・残り1,504件を再利用することを確認した。
- **誤読の修正**: `src/data/vocabularyAudio/pronunciations.json` に `[英語](/発音記号/)` 形式の `input` を書いて再実行すると、入力が変わった語だけ作り直される。表示用の英語（語彙データ）は変えない。
- 同じ入力でも再生成すると音声のバイト列は少し変わる（Kokoro の出力は毎回同一ではない）。試聴済みの記録はハッシュで照合するので、作り直した音声は未試聴に戻る。
- 辞書にない語・生成に失敗した語は止めずに `unresolved` に残し、残りの生成を続ける（今回は0件。辞書にない2語は発音指定で解決した）。
- モデル本体・Hugging Face のキャッシュ・Python 環境（`.venv-kokoro`）は Git に含めない（`.gitignore` 済み）。

## 3. 利用条件

Task 019（`docs/tasks/019-kokoro-audio-preview.md` の「1. 利用条件」）で確認したものと同じモデル・声・版を使った。追加した外部サービス・依存はない。
- モデル（Kokoro-82M v1.0）・声 `af_heart`: Apache-2.0。モデルカードと VOICES.md を Task 019 で確認済み。今回もリビジョンを固定し、同じファイルを使った。
- 生成した MP3 を同梱する。クレジット「Audio generated with Kokoro-82M by hexgrad (Apache License 2.0).」を試聴画面と manifest.json に表示する。
- 発音の参照（いずれも照合のみで、同梱・再配布はしない）:
  - **CMUdict**（BSD-2-Clause、github.com/cmusphinx/cmudict）: 異なる読みの有無と、強勢・母音。
  - **misaki の辞書 `us_gold.json`**（Apache-2.0）: 品詞別の読み（DEFAULT / VERB / NOUN / ADJ / ADV）。
  - 辞書サイト（Merriam-Webster、Cambridge、Wiktionary、kaikki.org）は、この作業環境のネットワーク設定で接続を拒否されたため照合できなかった。
    品詞と読みの対応は上の2つと、名詞・動詞で強勢が移る英語の一般的な規則で判断した。辞書音声は取得・同梱していない。
- 法的な助言ではない。一般公開・App Store 配布の前に改めて確認する。

## 4. 意味と発音の対応

### 洗い出しの方法
1. 全項目を misaki で発音記号に変換し、辞書にない語を探した（headcount、breakeven の2語）。
2. 語（句の中の語も含む）ごとに、misaki の辞書に品詞別の読みがあるもの、CMUdict に強勢・母音の違う読みが複数あるものを候補にした。
3. 補助文の中で読ませたときの読み（spaCy の品詞判定つき）と、単語だけで読ませたときの読みが違うものを候補にした。
4. -ate で終わる語、同綴異音語（record、present、close、use、lead、live など）の一覧と語彙を突き合わせた。
5. 候補ごとに、表示する日本語訳・補助文の品詞と読みを照らして、次のように分けた。
   - 単語だけで読ませると意味と違う読みになる → **発音指定**
   - 訳に読みの違う意味が混在する → **要判断**
   - 読みが品詞で変わらない、または米語で複数の読みが通用する → そのまま（下記）

### 発音指定（12 項目）
単語だけで読ませると、表示する意味と違う品詞の読みになる語。表示する意味の読みを指定した。

| 英語 | 訳 | 選んだ読み | 生成した発音記号 | 理由 | 参照 |
| --- | --- | --- | --- | --- | --- |
| increase | 増える / 増やす | 動詞（増える / 増やす） | /ɪnkɹˈis/ | 単語だけでは名詞の読み（ˈɪnkɹˌis、前に強勢）になる。訳はどちらも動詞なので、後ろに強勢の動詞の読みを指定 | misaki us_gold.json（品詞別の読み）: DEFAULT ɪnkɹˈis / NOUN ˈɪnkɹˌis ／ CMUdict: IH2 N K R IY1 S（動詞）, IH1 N K R IY2 S（名詞） |
| associate | 結びつけて考える | 動詞（結びつけて考える） | /əsˈOsiˌAt/ | 単語だけでは名詞・形容詞の読み（語尾 -ət）になる。動詞の語尾 -eɪt を指定（Task 019 と同じ） | misaki us_gold.json（品詞別の読み）: DEFAULT əsˈOsiət / VERB əsˈOsiˌAt ／ CMUdict: AH0 S OW1 S IY0 EY2 T ほか |
| complement | 補完する | 動詞（補完する） | /kˈɑmpləmˌɛnt/ | 単語だけでは名詞の読み（語尾が弱い -mənt）になる。動詞の語尾 -ˌment を指定 | misaki us_gold.json（品詞別の読み）: DEFAULT kˈɑmpləmənt / VERB kˈɑmpləmˌɛnt |
| deliberate | 意図的な / 慎重な | 形容詞（意図的な / 慎重な） | /dəlˈɪbəɹət/ | 単語だけでは動詞の読み（語尾 -eɪt）になる。形容詞の語尾 -ət を指定（Task 019 と同じ） | misaki us_gold.json（品詞別の読み）: ADJ dəlˈɪbəɹət / DEFAULT dəlˈɪbəɹˌAt ／ CMUdict: D IH0 L IH1 B ER0 AH0 T（形容詞）, D IH0 L IH1 B ER0 EY2 T（動詞） |
| intimate | 親密な | 形容詞（親密な） | /ˈɪntəmət/ | 単語だけでは動詞の読み（語尾 -eɪt）になる。形容詞の語尾 -ət を指定 | misaki us_gold.json（品詞別の読み）: DEFAULT ˈɪntəmət / VERB ˈɪntəmˌAt ／ CMUdict: IH1 N T AH0 M AH0 T（形容詞）, IH1 N T AH0 M EY2 T（動詞） |
| supplement | 補足 / サプリメント | 名詞（補足 / サプリメント） | /sˈʌpləmənt/ | 単語だけでは動詞の読み（語尾 -ˌment）になる。名詞の語尾が弱い -mənt を指定 | misaki us_gold.json（品詞別の読み）: DEFAULT sˈʌpləmənt / VERB sˈʌpləmˌɛnt ／ CMUdict: S AH1 P L AH0 M AH0 N T（名詞）, S AH2 P L AH0 M EH1 N T（動詞） |
| transfer | 異動させる / 送金する | 動詞（異動させる / 送金する） | /tɹænsfˈɜɹ/ | 単語だけでは名詞の読み（前に強勢 ˈtrænsfɚ）になる。訳はどちらも動詞なので、後ろに強勢の動詞の読みを指定（動詞でも前に強勢で読む人はいる） | CMUdict: T R AE0 N S F ER1（後ろに強勢）, T R AE1 N S F ER0（前に強勢） ／ 名詞・動詞で強勢が移る英語の一般的な規則（record, permit と同じ型） |
| progress | 進捗 / 進歩 | 名詞（進捗 / 進歩） | /pɹˈɑɡɹəs/ | 単語だけでは動詞の読み（prəˈgres、後ろに強勢）になる。名詞の読みを指定 | misaki us_gold.json（品詞別の読み）: DEFAULT pɹˈɑɡɹəs / VERB pɹəɡɹˈɛs ／ CMUdict: P R AA1 G R EH2 S（名詞）, P R AH0 G R EH1 S（動詞） |
| conglomerate | 複合企業 | 名詞（複合企業） | /kənɡlˈɑməɹət/ | 単語だけでは動詞の読み（語尾 -eɪt）になる。名詞の語尾 -ət を指定 | misaki us_gold.json（品詞別の読み）: DEFAULT kənɡlˈɑməɹət / VERB kənɡlˈɑməɹˌAt |
| overhead | 間接費 / 経費 | 名詞（間接費 / 経費） | /ˈOvəɹhˌɛd/ | 単語だけでは副詞の読み（ˌoʊvərˈhed、後ろに強勢）になる。名詞の前に強勢の読みを指定 | misaki us_gold.json（品詞別の読み）: DEFAULT ˌOvəɹhˈɛd / NOUN ˈOvəɹhˌɛd |
| headcount | 人員数 | 名詞（人員数） | /hˈɛdkˌWnt/ | misaki の辞書にない語。推測では読ませず、CMUdict の読みを指定 | CMUdict: HH EH1 D K AW2 N T |
| breakeven | 損益分岐点 | 名詞（損益分岐点） | /bɹˈAkˌivən/ | misaki の辞書にない語。推測では読ませず、CMUdict の読みを指定 | CMUdict: B R EY1 K IY2 V AH0 N |

### 要判断（17 項目）
1項目の訳に、読みの違う意味が混在している。片方を選んで確認済みにはしない。
主の音声（`{wordId}.mp3`）は補助文の意味に合わせて仮に作り、もう一方の読みも比較用に生成した（試聴画面で両方を聴ける）。
どちらの読みを使うか、語彙を意味ごとに分けるか（今回は行わない）の判断が必要。

| 英語 | 訳 | 補助文 | 主の音声（仮） | 比較用の別の読み | 参照 |
| --- | --- | --- | --- | --- | --- |
| permit | 許可する / 許可証 | a parking permit | 名詞：許可証（補助文 a parking permit） /pˈɜɹmɪt/ | 動詞：許可する /pəɹmˈɪt/ | misaki us_gold.json（品詞別の読み）: DEFAULT pˈɜɹmɪt / VERB pəɹmˈɪt ／ CMUdict: P ER0 M IH1 T, P ER1 M IH2 T |
| overall | 全体的な / 全体として | the overall cost | 形容詞：全体的な（補助文 the overall cost） /ˈOvəɹˌɔl/ | 副詞：全体として /ˌOvəɹˈɔl/ | misaki us_gold.json（品詞別の読み）: DEFAULT ˈOvəɹˌɔl / ADV ˌOvəɹˈɔl |
| advocate | 主張する / 支持者 | advocate for change | 動詞：主張する（補助文 advocate for change） /ˈædvəkˌAt/ | 名詞：支持者 /ˈædvəkət/ | misaki us_gold.json（品詞別の読み）: DEFAULT ˈædvəkət / VERB ˈædvəkˌAt ／ CMUdict: AE1 D V AH0 K AH0 T, AE1 D V AH0 K EY2 T |
| conduct | 行う / 行動 | conduct a survey | 動詞：行う（補助文 conduct a survey） /kəndˈʌkt/ | 名詞：行動 /kˈɑndˌʌkt/ | misaki us_gold.json（品詞別の読み）: DEFAULT kˈɑndˌʌkt / VERB kəndˈʌkt ／ CMUdict: K AA1 N D AH0 K T, K AA0 N D AH1 K T |
| elaborate | 精巧な / 詳しく述べる | an elaborate plan | 形容詞：精巧な（補助文 an elaborate plan） /əlˈæbəɹət/ | 動詞：詳しく述べる /əlˈæbəɹˌAt/ | misaki us_gold.json（品詞別の読み）: ADJ əlˈæbəɹət / DEFAULT əlˈæbəɹˌAt ／ CMUdict: IH0 L AE1 B R AH0 T, IH0 L AE1 B ER0 EY2 T |
| rebel | 反抗する / 反逆者 | rebel against rules | 動詞：反抗する（補助文 rebel against rules） /ɹəbˈɛl/ | 名詞：反逆者 /ɹˈɛbᵊl/ | misaki us_gold.json（品詞別の読み）: DEFAULT ɹˈɛbᵊl / VERB ɹəbˈɛl ／ CMUdict: R EH1 B AH0 L, R IH0 B EH1 L |
| resume | 履歴書 / 再開する | send your resume | 名詞：履歴書（補助文 send your resume） /ɹˈɛzəmˌA/ | 動詞：再開する /ɹəzˈum/ | CMUdict: R EH1 Z AH0 M EY2（履歴書）, R IH0 Z UW1 M（再開する） |
| update | 最新情報 / 更新する | a quick update | 名詞：最新情報（補助文 a quick update） /ˈʌpdˌAt/ | 動詞：更新する /ˌʌpdˈAt/ | CMUdict: AH1 P D EY2 T, AH0 P D EY1 T |
| estimate | 見積もり / 見積もる | a rough estimate | 名詞：見積もり（補助文 a rough estimate） /ˈɛstəmət/ | 動詞：見積もる /ˈɛstəmˌAt/ | misaki us_gold.json（品詞別の読み）: DEFAULT ˈɛstəmˌAt / NOUN ˈɛstəmət ／ CMUdict: EH1 S T AH0 M AH0 T, EH1 S T AH0 M EY2 T |
| decrease | 減少 / 減る | a slight decrease | 名詞：減少（補助文 a slight decrease） /dˈikɹˌis/ | 動詞：減る /dəkɹˈis/ | misaki us_gold.json（品詞別の読み）: DEFAULT dˈikɹˌis / VERB dəkɹˈis ／ CMUdict: D IY1 K R IY2 S, D IH0 K R IY1 S |
| delegate | 任せる / 代表者 | delegate tasks | 動詞：任せる（補助文 delegate tasks） /dˈɛləɡˌAt/ | 名詞：代表者 /dˈɛləɡət/ | misaki us_gold.json（品詞別の読み）: DEFAULT dˈɛləɡət / VERB dˈɛləɡˌAt ／ CMUdict: D EH1 L AH0 G EY2 T, D EH1 L AH0 G AH0 T |
| refund | 返金 / 払い戻す | ask for a refund | 名詞：返金（補助文 ask for a refund） /ɹˈifˌʌnd/ | 動詞：払い戻す /ɹəfˈʌnd/ | misaki us_gold.json（品詞別の読み）: DEFAULT ɹəfˈʌnd / NOUN ɹˈifˌʌnd ／ CMUdict: R IY1 F AH2 N D, R IH0 F AH1 N D |
| affiliate | 関連会社 / 提携する | an affiliate company | 名詞：関連会社（補助文 an affiliate company） /əfˈɪliət/ | 動詞：提携する /əfˈɪliˌAt/ | misaki us_gold.json（品詞別の読み）: DEFAULT əfˈɪliət / VERB əfˈɪliˌAt ／ CMUdict: AH0 F IH1 L IY0 AH0 T, AH0 F IH1 L IY0 EY2 T |
| articulate | 明確に述べる / 明快な | articulate your ideas | 動詞：明確に述べる（補助文 articulate your ideas） /ɑɹtˈɪkjəlˌAt/ | 形容詞：明快な /ɑɹtˈɪkjələt/ | misaki us_gold.json（品詞別の読み）: DEFAULT ɑɹtˈɪkjələt / VERB ɑɹtˈɪkjəlˌAt ／ CMUdict: AA0 R T IH1 K Y AH0 L EY2 T, AA0 R T IH1 K Y AH0 L AH0 T |
| aggregate | 合計の / 集計する | aggregate data | 形容詞：合計の（補助文 aggregate data） /ˈæɡɹəɡət/ | 動詞：集計する /ˈæɡɹəɡˌAt/ | misaki us_gold.json（品詞別の読み）: DEFAULT ˈæɡɹəɡət / VERB ˈæɡɹəɡˌAt |
| overhaul | 全面的に見直す / 分解修理 | overhaul the system | 動詞：全面的に見直す（補助文 overhaul the system） /ˌOvəɹhˈɔl/ | 名詞：分解修理 /ˈOvəɹhˌɔl/ | misaki us_gold.json（品詞別の読み）: DEFAULT ˌOvəɹhˈɔl / NOUN ˈOvəɹhˌɔl |
| upgrade | 改良 / 格上げする | a system upgrade | 名詞：改良（補助文 a system upgrade） /ˈʌpɡɹˌAd/ | 動詞：格上げする /ˌʌpɡɹˈAd/ | CMUdict: AH1 P G R EY1 D, AH0 P G R EY1 D |

### そのままにした主な語（複数の読みが通用する、または品詞で読みが変わらない）
- 品詞で読みが変わらない: mentor、leverage、mandate、cough、average、current（名詞・動詞・形容詞で同じ読み）
- 表示する意味の読みに、単語だけでもなっている: content（名詞）、refuse・combine・convert・reject・exploit・transform（動詞）、contract・survey・discount・document・research・segment・merchandise（名詞）、
  appropriate・moderate・legitimate・abstract・adequate（形容詞）、implement・coordinate・isolate・nominate・mediate（動詞）、live up to（lɪv）、lead time・take the lead（liːd）、in a row（roʊ）、subject to（形容詞）
- 米語で複数の読みが通用する（どちらも誤読としない）: route、inquiry、candidate、advertisement、hostile、versatile、liaison、prefer、弱い母音の違いだけのもの（reasonable、interest など）

## 5. 試聴画面

- 拠点画面の「音声の試聴（Kokoro）」から開く（URL の `#audio-preview`）。「全語彙」と「Task 019 比較」のタブがある。
- **全語彙**:
  - 英語・日本語の部分一致で検索（英語が前方一致する項目を先に表示）。ランク（4ランク）と状態（要判断・要確認・未生成・誤読あり・自動検査済み・試聴済み）で絞り込める。
  - 一度に30件を表示し、「さらに表示」で30件ずつ増やす。
  - 各項目に英語・訳・ランク・補助文・状態・発音記号・発音指定の理由・自動検査の警告を表示する。「Kokoro」と「現在の読み上げ」で再生でき、要判断の語は「Kokoro（別の読み）」も再生できる。
  - 画面を開いたときは一覧（manifest.json、847KB）だけを読み込み、MP3 は再生ボタンを押した音声だけを読み込む。
- **Task 019 比較**: Task 019 の33項目（名詞／動詞の比較を含む）と例文6件をそのまま聴ける。
- 再生の切り替え時は前の音声を止める（重ねて再生しない）。再生中のボタンをもう一度押すと止まる。
- 未生成・再生の失敗は項目の下に表示し、ブラウザの読み上げへは自動で切り替えない。
- 試聴画面は学習状態・回答・XP・Gold・猫の処理を読み込まず、保存もしない。localStorage のキー・version・保存データは変更していない。

## 6. ファイル

| ファイル | 内容 |
| --- | --- |
| `public/audio/kokoro-vocabulary/` | 生成した MP3（1506 件）と `manifest.json` |
| `src/data/vocabularyAudio/pronunciations.json` | 発音指定・要判断（表示用の英語とは別に管理） |
| `src/data/vocabularyAudio/reviews.json` | 人が聴いた結果（今回は空） |
| `src/lib/vocabularyAudio.ts` | manifest の検証、状態の判定、検索・絞り込み |
| `src/VocabularyAudioPanel.tsx`、`src/PreviewButtons.tsx`、`src/lib/previewPlayback.ts` | 全語彙の試聴、再生ボタン（Task 019 と共用）、再生状態の型 |
| `src/AudioPreview.tsx`、`src/AudioPreview.css`、`src/App.tsx` | タブの追加、リンク名を「音声の試聴（Kokoro）」に変更 |
| `tools/kokoro/generate_vocabulary.py`、`tools/kokoro/list-vocabulary.ts`、`tools/kokoro/README.md` | 生成・再開・部分再生成・自動検査、対象語彙の取得、手順 |
| `tests/vocabularyAudio.test.ts` | 発音指定・状態・検索・生成済み音声の照合 |

## 7. 検証結果

### 自動検査（`generate_vocabulary.py`。全 1506 ファイル）
MP3 を読み戻して測った。

| 検査 | 基準 | 結果 |
| --- | --- | --- |
| 形式 | MP3・24kHz・モノラル | 全件一致 |
| 長さ | 0.3〜6秒 | 0.78〜2.25秒（最長は memorandum of understanding） |
| 無音・音量 | 最大振幅 0.1 以上、平均音量（RMS）0.01〜0.3 | 最大振幅 0.24〜0.78、RMS 0.034〜0.052 |
| クリッピング | 振幅 0.999 以上のサンプルがない | 0 件 |
| 途中の長い無音 | 0.7秒を超える無音がない | 最長 0.16秒 |
| 発声の速さ | 前後の無音を除いた発声部分が、発音記号1文字あたり 45〜160ms（中央値 約73ms） | 3件が 45ms 未満（下記） |

自動検査の警告（要確認。途中が欠けていないか聴いて確認する）:

| 英語 | 訳 | 発音記号 | 警告 |
| --- | --- | --- | --- |
| instruction | 指示 / 説明書 | /ɪnstɹˈʌkʃən/ | 発音記号の長さに対して発声が極端に短い・長い（43ms/音） |
| individual | 個々の / 個人 | /ˌɪndəvˈɪʤəwəl/ | 発音記号の長さに対して発声が極端に短い・長い（43ms/音） |
| intervene | 介入する | /ˌɪntəɹvˈin/ | 発音記号の長さに対して発声が極端に短い・長い（38ms/音） |

### テスト（`npm test`）
- 対象語彙と音声一覧の対応（全語彙＋比較用の読み）、欠損、空ファイル、サイズ・SHA-256 の一致、MP3 の形式（先頭バイト）、長さ、
  ハッシュの重複（同じ音声が別の語に入っていない）、余分なファイル、引退した語の音声がないこと、モデルのリビジョン・声・速度、発音指定の形式。
- 状態の判定（未生成・自動検査済み・要確認・要判断・試聴済み、再生成後は未試聴に戻る、入力が古い音声は使わない）と検索・絞り込み。

### 聴かなければ判断できないこと（未確認）
- 発音が正しいか、聞き取りやすいか、不自然な抑揚・雑音がないか。自動検査は形式・長さ・音量だけを見ており、発音の正しさは判定できない。
- 発音記号（G2P）が正しくても、音声で正しく聞こえるとは限らない。
- 音声認識による照合は行っていない（追加のモデルが必要なため。また、文字が一致しても発音の正しさの保証にはならない）。

### ブラウザ確認（`vite preview`・Playwright の Chromium）
390×844（ライト）と 320×568（ダーク）で確認した。
- 全語彙タブ: 「生成済み 1489 / 1489 項目・MP3 合計 9.2MB」、状態の件数を表示。画面を開いた時点で MP3 の読み込みは0件、描画は30件。
- 代表項目を検索して再生し、最後まで再生されることを確認:
  読み分けが必要な語（estimate、permit、headcount）、短い語（debt、owe）、長い語（entrepreneur、memorandum of understanding、non-disclosure agreement）、
  句・句動詞（come up with、iron out、in a row）、自動検査の警告がある語（intervene）。
- 日本語「見積」で estimate が出る。ランク「ビジネス応用」で377件、状態「要判断」で17件、「要確認」で15件。「さらに表示」で60件。
- 要判断の estimate で主の読み → 別の読み（動詞）へ切り替えると、前の音声は停止し、同時に再生している音声はない。再生中のボタンをもう一度押すと停止する。
- MP3 が 404 のとき「再生できませんでした。」と表示し、ブラウザの読み上げは呼ばない。一覧から1件消した応答では「未生成」と理由を表示し、Kokoro ボタンは無効。
- Task 019 比較タブ: 33項目・例文6件を表示し、例文を再生できる。
- 横スクロールなし、コンソールエラーなし。学習データがある状態で試聴画面を操作しても localStorage は変わらない。
- **iPhone 実機・Safari: 未確認**（この環境にない）。

## 今回は実装しない
- 通常の遠征の音声方式・速度・自動送りの変更（遠征は今もブラウザの読み上げ）
- 全例文の音声化、画像生成
- 語彙・出題・報酬・猫の仕様変更、要判断の語の分割や訳の書き換え
- localStorage のキー・version・保存データの変更、Web アプリの依存の追加
- 外部公開・デプロイ・マージ

## 未解決・次の手順
1. **要判断 17 項目**: どちらの読みにするか、語彙を意味ごとに分けるかを決める（試聴画面の状態「要判断」で一覧できる）。
2. **要確認 15 項目**を優先して聴き、続けて全項目を聴いて、結果を `reviews.json` に記録する。誤読があれば `pronunciations.json` で直して `--only` で作り直す。
3. iPhone Safari での MP3 再生を確認する。
4. 発音の確認が進んだら、遠征の再生を Kokoro 音声に切り替える（別タスク）。
5. 辞書サイトに接続できる環境で、要判断・発音指定の語を辞書と照合する（今回は接続拒否で未照合）。
