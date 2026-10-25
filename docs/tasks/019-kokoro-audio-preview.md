# Task 019: Kokoro による英語音声の試作・試聴比較

## 目的
現在のブラウザ読み上げ（Web Speech API）で単語の読み方に誤りがあると感じるため、Kokoro で音声を事前生成し、発音の正確さと聞きやすさを確認する。
今回は約30項目の試作まで。全1,489項目への展開や、本体の音声方式の切り替えは行わない。

## 状態（2026-10-25）

| 項目 | 状態 |
| --- | --- |
| 利用条件の確認 | コード・G2P・依存ツールは一次資料で確認済み。モデルカード（Hugging Face）は接続できず **未確認**（下記） |
| 試作項目・期待する発音 | 33項目（例文6件）を選定し、CMUdict で読みを照合済み |
| 発音記号（G2P）の確認 | 確認済み。品詞違いの誤読7項目を発音指定で修正 |
| 試聴画面 | 実装済み。390×844・320×568、ライト・ダークで確認 |
| **Kokoro 音声の生成** | **未生成**。この作業環境のネットワーク設定で `huggingface.co` が拒否され、公式モデルを取得できない |
| 実際に聴いての評価 | **ユーザー確認待ち**（音声生成後。この環境では音を聴いて評価できない） |
| iPhone 実機 | **未確認** |

音声を生成するには、作業環境の Network access で `huggingface.co`（モデル本体の配信先 `*.hf.co` も）を許可したうえで、`tools/kokoro/README.md` の手順を実行する。
生成すると `public/audio/kokoro-preview/` に MP3 と `manifest.json` ができ、試聴画面の「Kokoro」ボタンが有効になる。

## 1. 利用条件（2026-10-25 確認）

エンジン（コード）のライセンスと、モデルの重み・声データのライセンス、生成した音声の扱いは別のものとして記録する。

### アプリに同梱するもの
| 対象 | 版・ID | 入手元 | ライセンス・条件 | 確認した一次資料 |
| --- | --- | --- | --- | --- |
| 生成した MP3（試聴用 33項目＋例文6件） | — | 本リポジトリで生成 | Apache-2.0 は重み・コードの利用条件で、生成物の利用を制限する条項はない。クレジットを表記する（下記） | Apache License 2.0 本文 |

### 生成時だけ使うもの（アプリ・Git には含めない）
| 対象 | 版・ID | 入手元 | ライセンス | 確認した一次資料 |
| --- | --- | --- | --- | --- |
| Kokoro 推論ライブラリ `kokoro` | 0.9.4 | PyPI / github.com/hexgrad/kokoro | Apache-2.0 | GitHub の LICENSE、PyPI のメタデータ |
| Kokoro-82M モデルの重み | `kokoro-v1_0.pth`（リビジョンは生成時に manifest.json へ記録） | huggingface.co/hexgrad/Kokoro-82M | Apache-2.0（hexgrad/kokoro の README に "Apache-licensed weights" と記載） | GitHub README。**Hugging Face のモデルカードは接続拒否で未確認** |
| 声 `af_heart`（米国英語・女性） | `voices/af_heart.pt` | 同上 | モデルと同じリポジトリで配布（モデルカード・VOICES.md で要確認） | **未確認**（同上） |
| G2P `misaki` | 0.9.4 | PyPI / github.com/hexgrad/misaki | Apache-2.0 | GitHub の LICENSE、PyPI |
| spaCy / 英語モデル `en_core_web_sm` | 3.8.7 / 3.8.0 | PyPI / Explosion 公式 GitHub Releases | MIT / MIT | PyPI、wheel のメタデータ |
| espeak-ng（`espeakng-loader` 0.2.4 経由）、`phonemizer-fork` 3.3.2 | — | PyPI | GPL-3.0 / MIT（loader）/ GPL-3.0 | 各 GitHub の LICENSE・COPYING、PyPI |
| PyTorch、num2words、soundfile（libsndfile・LAME） | 2.14.1 ほか | PyPI | BSD 系 / LGPL / BSD-3・LGPL | PyPI のメタデータ |

- espeak-ng は kokoro の依存として入るが、生成では使わない（辞書にない語の推測読み＝fallback を外した）。GPL のツールを配布物に含めない。
- 期待する発音の参照に使った CMU Pronouncing Dictionary（BSD-2-Clause、github.com/cmusphinx/cmudict）は照合だけに使い、同梱しない。辞書サイトの音声は取得・同梱していない。
- 有料 API、外部推論サービスへの送信、管理者権限、セキュリティ設定の変更は行っていない。

### 商用アプリで配布する場合
- 配布するのは生成した MP3 だけで、モデル・コードは配布しない。Apache-2.0 の再配布条件（ライセンス本文・NOTICE の同梱）はモデルやコードを再配布するときの条件で、生成音声には及ばないと読める。
- それでも出所を明らかにするため、アプリ内（試聴画面）とドキュメントに次のクレジットを表記する。
  > Audio generated with Kokoro-82M by hexgrad (Apache License 2.0).
- **公開前に必ず確認すること**: Hugging Face のモデルカード（ライセンス表記、学習データ、利用上の注意）と VOICES.md の `af_heart` の記載。今回は接続できず確認できていない。条件が不明なままなら採用しない。
- 法的な助言ではない。一般公開・App Store 配布の前に改めて確認する。

## 2. 試作項目（33項目、例文6件）

項目一覧は `src/data/audioPreview/items.json`（試聴専用。学習用語彙には追加していない）。日本語訳・ランクは語彙データから表示する。
4ランクから、短い語・長い語・句動詞・熟語・品詞や意味で読みが変わる語・黙字のある語を選んだ。語彙にない試聴専用の項目は追加していない。
同じ綴りで品詞により読みが変わる permit / advocate / estimate / resume は、品詞ごとに別項目にした。

| # | 英語 | ランク | 品詞・意味 | 期待する発音 | CMUdict | 確認点 | Kokoro 入力 | 例文 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | content | 日常基礎 | 名詞：内容 | /ˈkɑːntent/ | K AA1 N T EH0 N T | 品詞で強勢が変わる | — |  |
| 2 | permit | 日常基礎 | 動詞：許可する | /pərˈmɪt/ | P ER0 M IH1 T | 動詞は後ろに強勢 | 指定 | あり |
| 3 | permit | 日常基礎 | 名詞：許可証 | /ˈpɝːmɪt/ | P ER1 M IH2 T | 名詞は前に強勢 | — | あり |
| 4 | refuse | 日常基礎 | 動詞：断る | /rɪˈfjuːz/ | R IH0 F Y UW1 Z | 品詞で読みが変わる | — |  |
| 5 | moderate | 日常基礎 | 形容詞：適度な | /ˈmɑːdərət/ | M AA1 D ER0 AH0 T | 形容詞の語尾は弱い -ət | — |  |
| 6 | vehicle | 日常基礎 | — | /ˈviːəkəl/ | V IY1 IH0 K AH0 L | h はほぼ発音しない | — |  |
| 7 | come up with | 日常基礎 | — | /kʌm ˈʌp wɪð/ | K AH1 M / AH1 P / W IH1 DH | 句動詞：up に強勢 | — |  |
| 8 | in a row | 日常基礎 | 熟語：連続で | /ɪn ə ˈroʊ/ | IH0 N / AH0 / R OW1 | row の読み分け | — | あり |
| 9 | conduct | 日常応用 | 動詞：行う | /kənˈdʌkt/ | K AA0 N D AH1 K T | 動詞は後ろに強勢 | 指定 |  |
| 10 | deliberate | 日常応用 | 形容詞：意図的な | /dɪˈlɪbərət/ | D IH0 L IH1 B ER0 AH0 T | 形容詞の語尾は弱い -ət | 指定 |  |
| 11 | associate | 日常応用 | 動詞：結びつけて考える | /əˈsoʊʃieɪt/ | AH0 S OW1 SH IY0 EY2 T | 動詞の語尾は -eɪt | 指定 |  |
| 12 | advocate | 日常応用 | 動詞：主張する | /ˈædvəkeɪt/ | AE1 D V AH0 K EY2 T | 動詞の語尾は -eɪt | — |  |
| 13 | advocate | 日常応用 | 名詞：支持者 | /ˈædvəkət/ | AE1 D V AH0 K AH0 T | 名詞の語尾は弱い -ət | 指定 |  |
| 14 | chaos | 日常応用 | — | /ˈkeɪɑːs/ | K EY1 AA0 S | 「カオス」ではなく ˈkeɪ- | — |  |
| 15 | subtle | 日常応用 | — | /ˈsʌtəl/ | S AH1 T AH0 L | b を発音しない | — |  |
| 16 | take it for granted | 日常応用 | — | /teɪk ɪt fər ˈɡræntɪd/ | T EY1 K / IH0 T / F ER0 / G R AE1 N T IH0 D | 長めの熟語のつながり | — |  |
| 17 | unprecedented | 日常応用 | — | /ʌnˈpresɪdentɪd/ | AH0 N P R EH1 S IH0 D EH2 N T IH0 D | 長い語の強勢位置 | — |  |
| 18 | estimate | ビジネス基礎 | 名詞：見積もり | /ˈestɪmət/ | EH1 S T AH0 M AH0 T | 名詞の語尾は弱い -ət | — | あり |
| 19 | estimate | ビジネス基礎 | 動詞：見積もる | /ˈestɪmeɪt/ | EH1 S T AH0 M EY2 T | 動詞の語尾は -eɪt | 指定 | あり |
| 20 | minutes | ビジネス基礎 | 名詞：議事録 | /ˈmɪnɪts/ | M IH1 N AH0 T S | 議事録は「分」と同じ読み | — |  |
| 21 | colleague | ビジネス基礎 | — | /ˈkɑːliːɡ/ | K AA1 L IY0 G | 「カリーグ」に近い。前に強勢 | — |  |
| 22 | receipt | ビジネス基礎 | — | /rɪˈsiːt/ | R IH0 S IY1 T | p を発音しない | — |  |
| 23 | debt | ビジネス基礎 | — | /ˈdet/ | D EH1 T | 短い語。b を発音しない | — |  |
| 24 | resume | ビジネス基礎 | 名詞：履歴書 | /ˈrezəmeɪ/ | R EH1 Z AH0 M EY2 | 履歴書は ˈrez- で始まる | 指定 | あり |
| 25 | resume | ビジネス基礎 | 動詞：再開する | /rɪˈzuːm/ | R IH0 Z UW1 M | 動詞は後ろに強勢 | — |  |
| 26 | schedule | ビジネス基礎 | — | /ˈskedʒuːl/ | S K EH1 JH UW0 L | 米国英語は ˈsk-（英国英語は ˈʃ- もある） | — |  |
| 27 | look forward to hearing | ビジネス基礎 | — | /lʊk ˈfɔːrwərd tə ˈhɪrɪŋ/ | L UH1 K / F AO1 R W ER0 D / T AH0 / HH IH1 R IH0 NG | 長い定型表現 | — |  |
| 28 | lead time | ビジネス応用 | 名詞：リードタイム | /ˈliːd taɪm/ | L IY1 D / T AY1 M | lead の読み分け | — |  |
| 29 | hierarchy | ビジネス応用 | — | /ˈhaɪərɑːrki/ | HH AY1 ER0 AA2 R K IY0 | ˈhaɪər- で始まる長めの語 | — |  |
| 30 | entrepreneur | ビジネス応用 | — | /ˌɑːntrəprəˈnɝː/ | AA2 N T R AH0 P R AH0 N ER1 | フランス語由来の長い語。最後に強勢 | — |  |
| 31 | iron out | ビジネス応用 | — | /ˈaɪərn ˈaʊt/ | AY1 ER0 N / AW1 T | 句動詞：iron は ˈaɪərn | — |  |
| 32 | memorandum of understanding | ビジネス応用 | — | /ˌmeməˈrændəm əv ˌʌndərˈstændɪŋ/ | M EH2 M ER0 AE1 N D AH0 M / AH0 V / AH2 N D ER0 S T AE1 N D IH0 NG | 最も長い項目 | — |  |
| 33 | cost-effective | ビジネス応用 | — | /ˌkɔːst ɪˈfektɪv/ | K AO1 S T / IH0 F EH1 K T IH0 V | ハイフンでつながる語 | — |  |

- 期待する発音は CMUdict の読み（複数ある場合は品詞・意味に対応するもの）と、一般的な米語辞書の品詞別の記載に基づく。辞書サイトにはこの環境から接続できず、品詞と読みの対応は CMUdict の異読と照合した。
- 複数の正しい読みがある語（vehicle の h、associate の s / sh、entrepreneur の語尾、resume〔履歴書〕の強勢）は、どちらも誤読としない。
- 例文はすべて自作。

## 3. 発音の確認

### G2P（文字→発音記号）の確認：確認済み
Kokoro は misaki で発音記号に変換してから音声にするため、まず発音記号を期待する読みと照合した（`tools/kokoro/generate.py --phonemes-only`）。
単語・句だけを読ませると品詞が決まらず、次の7項目が意味と違う読みになっていた。misaki の `[語](/発音記号/)` 形式で発音を指定して直した（画面の英語表記は変えていない）。

| 項目 | 指定前 | 指定後 |
| --- | --- | --- |
| permit（動詞） | pˈɜɹmɪt（名詞の読み） | pəɹmˈɪt |
| conduct（動詞：行う） | kˈɑndˌʌkt（名詞の読み） | kəndˈʌkt |
| deliberate（形容詞） | dəlˈɪbəɹˌAt（動詞の読み） | dəlˈɪbəɹət |
| associate（動詞） | əsˈOsiət（名詞の読み） | əsˈOsiˌAt |
| advocate（名詞） | ˈædvəkˌAt（動詞の読み） | ˈædvəkət |
| estimate（動詞） | ˈɛstəmət（名詞の読み） | ˈɛstəmˌAt |
| resume（名詞：履歴書） | ɹəzˈum（動詞の読み。"send your resume" でも同じ） | ɹˈɛzəmˌA（例文内も指定） |

例文では文脈から品詞が決まり、permit（動詞・名詞）・estimate（動詞・名詞）は指定なしで正しい読みになった。resume は文中でも動詞の読みになるため、例文でも指定した。
発音記号の表記は misaki のもの（A = eɪ、I = aɪ、O = oʊ、W = aʊ、ᵊ・ᵻ = 弱い母音、T = 弾音の t）。

指定後の全項目の発音記号（`--phonemes-only` の出力）:

```
content word  content  →  kˈɑntɛnt
permit-verb word  [permit](/pəɹmˈɪt/)  →  pəɹmˈɪt
permit-verb sentence  The rules do not permit smoking inside.  →  ðə ɹˈulz dˈu nˌɑt pəɹmˈɪt smˈOkɪŋ ɪnsˈId.
permit-noun word  permit  →  pˈɜɹmɪt
permit-noun sentence  You need a permit to park here.  →  jˌu nˈid ɐ pˈɜɹmɪt tə pˈɑɹk hˈɪɹ.
refuse word  refuse  →  ɹəfjˈuz
moderate word  moderate  →  mˈɑdəɹət
vehicle word  vehicle  →  vˈiəkᵊl
come-up-with word  come up with  →  kˈʌm ˌʌp wɪð
in-a-row word  in a row  →  ɪn ɐ ɹˈO
in-a-row sentence  It rained for three days in a row.  →  ˌɪt ɹˈAnd fɔɹ θɹˈi dˈAz ɪn ɐ ɹˈO.
conduct-verb word  [conduct](/kəndˈʌkt/)  →  kəndˈʌkt
deliberate word  [deliberate](/dəlˈɪbəɹət/)  →  dəlˈɪbəɹət
associate word  [associate](/əsˈOsiˌAt/)  →  əsˈOsiˌAt
advocate-verb word  advocate  →  ˈædvəkˌAt
advocate-noun word  [advocate](/ˈædvəkət/)  →  ˈædvəkət
chaos word  chaos  →  kˈAˌɑs
subtle word  subtle  →  sˈʌTᵊl
take-it-for-granted word  take it for granted  →  tˈAk ɪt fɔɹ ɡɹˈæntᵻd
unprecedented word  unprecedented  →  ˌʌnpɹˈɛsədəntᵻd
estimate-noun word  estimate  →  ˈɛstəmət
estimate-noun sentence  Can you give me a rough estimate?  →  kˌæn ju ɡˈɪv mˌi ɐ ɹˈʌf ˈɛstəmət?
estimate-verb word  [estimate](/ˈɛstəmˌAt/)  →  ˈɛstəmˌAt
estimate-verb sentence  We estimate the cost at five thousand dollars.  →  wˌi ˈɛstəmˌAt ðə kˈɔst æt fˈIv θˈWzᵊnd dˈɑləɹz.
minutes word  minutes  →  mˈɪnəts
colleague word  colleague  →  kˈɑliɡ
receipt word  receipt  →  ɹəsˈit
debt word  debt  →  dˈɛt
resume-noun word  [resume](/ɹˈɛzəmˌA/)  →  ɹˈɛzəmˌA
resume-noun sentence  Please send your [resume](/ɹˈɛzəmˌA/) by Friday.  →  plˈiz sˈɛnd jʊɹ ɹˈɛzəmˌA bI fɹˈIdˌA.
resume-verb word  resume  →  ɹəzˈum
schedule word  schedule  →  skˈɛʤˌul
look-forward-to-hearing word  look forward to hearing  →  lˈʊk fˈɔɹwəɹd tə hˈɪɹɪŋ
lead-time word  lead time  →  lˈid tˈIm
hierarchy word  hierarchy  →  hˈIəɹˌɑɹki
entrepreneur word  entrepreneur  →  ˌɑntɹəpɹənˈʊɹ
iron-out word  iron out  →  ˈIəɹn ˈWt
memorandum-of-understanding word  memorandum of understanding  →  mˌɛməɹˈændəm ʌv ˌʌndəɹstˈændɪŋ
cost-effective word  cost-effective  →  kˌɔstəfˈɛktɪv
```

### 音声の確認：ユーザー確認待ち
- Kokoro 音声は未生成のため、実際の音は聴いていない。発音記号が正しくても、音声で正しく聞こえるとは限らない。
- 生成後、試聴画面で各項目を聴き、期待する発音と比べて判断してもらう。音声認識で文字が一致するだけでは合格にしない。
- 聴いて誤読があれば、`kokoroInput` の発音指定で直し、再生成する。

### 現在の読み上げ（ブラウザの音声合成）の調査
- アプリ本体は `utterance.lang = 'en-US'` だけを指定し、声（`utterance.voice`）は選んでいない（`src/App.tsx` の `speak`）。どの声で読むかはブラウザ・OS に任されている。
- 試聴画面では、ブラウザの声の一覧から「使われそうな声」（en-US の既定の声 → en-US の声 → 英語の声 → 既定の声の順に推定）、既定の声、英語の声の数を表示し、英語以外の声が選ばれそうなら警告する。ブラウザは実際に使った声を通知しないため、推定であることを画面に明記した。
- この確認環境（ヘッドレス Chromium）は声が0件で、読み上げは `synthesis-failed` になった。英語の声が選ばれるか、iPhone でどの声になるかは **実機で確認待ち**。
- 現在の読み上げも単語だけを読むため、品詞で読みが変わる語（permit、estimate、resume など）はブラウザ側でも一方の読みになると考えられる（推測。実機で聴いて確認）。

## 4. 試聴画面

- 拠点画面の「遠征を始める」の下にある「音声の試聴（Kokoro 試作）」から開く（URL の `#audio-preview`）。「← 戻る」で拠点画面へ戻る。
- 各項目に英語、日本語訳、ランク、確認点、品詞・意味の区別（必要な項目のみ）、期待する発音を表示する。例文がある項目は例文と和訳も表示する。
- 「Kokoro」「現在の読み上げ」をボタンで再生する。タップしたときだけ再生し、自動周回はしない。
- 別の再生ボタンを押すと前の音声（MP3・読み上げとも）を止める。再生中のボタンをもう一度押すと止まる。
- 未生成は「Kokoro 音声は未生成です。」、再生失敗・ブラウザ非対応はその旨を項目の下に表示する。失敗しても別の音声方式へは切り替えない。
- `manifest.json` の入力（`input`）が `items.json` と食い違う音声は、古い音声として使わない（未生成扱い）。
- ボタンは2列・高さ48px以上（320px 幅では文字が折り返して56px）。
- 現在の読み上げはアプリ本体と同じ指定（lang = en-US、声の指定なし）で読む。
- 試聴画面は学習状態・理解度・XP・Gold・猫の処理を読み込まず、保存もしない。localStorage のキー・version・保存データは変更していない。

## 5. 実装・保存

| ファイル | 内容 |
| --- | --- |
| `src/data/audioPreview/items.json` | 試聴項目の一覧（アプリと生成スクリプトが共通で読む） |
| `src/lib/audioPreview.ts` | 項目と語彙の対応、manifest の検証、現在の読み上げの声の推定 |
| `src/AudioPreview.tsx`, `src/AudioPreview.css` | 試聴画面 |
| `src/Root.tsx`, `src/main.tsx` | `#audio-preview` のときだけ試聴画面を表示 |
| `src/App.tsx`, `src/App.css` | 拠点画面に試聴画面へのリンクを追加 |
| `tools/kokoro/` | 生成スクリプト・依存（Python、Web アプリとは別）・再生成手順 |
| `public/audio/kokoro-preview/` | 生成した MP3 と `manifest.json`（未生成） |
| `tests/audioPreview.test.ts` | 項目の整合性、manifest の検証、音声ファイルの欠損・空・余分・内容の照合、声の推定 |

- 形式は MP3（24kHz モノラル）。iPhone Safari を含む主要ブラウザが再生できる形式を選んだ。iPhone 実機では未確認。
- 合計サイズは生成後に試聴画面と `manifest.json` に表示される（33項目＋例文6件で数百KBの見込み）。
- モデル本体・生成環境（`.venv-kokoro`、Hugging Face のキャッシュ）は Git に入れない。
- `tsconfig.app.json` に `resolveJsonModule` を追加した（items.json の読み込み）。

## 6. 確認結果

- `npm test`: 130件成功、1件スキップ（生成済み音声の照合テスト。manifest.json がないため）。
  仮の MP3 と manifest.json を一時的に置いて照合テストが通ること、1ファイル消すと失敗することを確認した（仮ファイルは削除済み）。
- `npm run lint`: 警告・エラー 0。
- `npm run build`: 成功。
- ブラウザ（Playwright・Chromium）、390×844 と 320×568、ライト・ダーク:
  - 未生成の状態で、Kokoro ボタンが無効になり、全39件に「未生成」と表示される。
  - 再生切り替え・停止は、**UI 確認専用の仮の音（440Hz の MP3。リポジトリには含めない）** をネットワーク応答で差し替えて確認した。
    再生中のボタンは1つだけ、別のボタンで前の音声を pause・読み上げを cancel、同じボタンで停止、再生終了でボタンが元に戻る。
  - MP3 の読み込み失敗（404）で「再生できませんでした。」と表示し、読み上げへは切り替えない。
  - 現在の読み上げは、この環境に声がなく `synthesis-failed` の表示を確認（成功時の動作は実機で確認待ち）。
  - 試聴画面を開いて戻っても localStorage の内容は変わらない。横スクロールなし、コンソールエラーなし。
- `requirements.txt` から新しい Python 環境を作り、`--phonemes-only` が同じ結果になることを確認した。音声生成は Hugging Face への接続拒否で止まることを確認した。

## 今回は実装しない
- 全1,489項目の音声生成
- 通常の遠征の音声方式や速度制御の変更
- 人の録音への差し替え
- 語彙・出題・報酬・猫の仕様変更
- クラウド同期、外部 API、大規模リファクタリング

## 未解決・次の手順
1. 作業環境で `huggingface.co`（と `*.hf.co`）を許可し、モデルカード・VOICES.md の利用条件を確認してから音声を生成する。
2. 試聴画面で全項目を聴き、発音と聞きやすさを評価する（ユーザー確認）。誤読があれば発音指定で直す。
3. iPhone Safari で MP3 の再生と、現在の読み上げで選ばれる声を確認する。
