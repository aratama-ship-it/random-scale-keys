# 音階の重力 v0.2 — 耳のゲート（2026-09-03）を受けた差分仕様

本人判定: 「ある程度曲っぽい」。足りないのは ①単調 ②フレーズ感がない ③伴奏と噛み合わない ④音色・空間が安っぽい。
本書は `SPEC_gravity_v0.md` への**差分**。書いていない値は v0 のまま。バージョン表示は `v0.2.0` に上げる。
純粋な規則は `gravity.mjs` に関数として足し、`tests/gravity.test.mjs` にテストを追加する（純粋関数にDOM/AudioContext禁止は不変）。

## A. 単調への対策 — 16小節に「形」を持たせる

### A1. セクション `sectionForBar(barIndex)`（0始まり）
| 小節 | セクション | 伴奏の状態 |
|---|---|---|
| 0–3 | `intro` | パッド＋キック（1拍3拍）のみ。ハット無し。ベースは各小節1拍目だけ |
| 4–7 | `a` | 全部入り（v0の伴奏＋スネア） |
| 8–11 | `b` | 全部入り＋パッドを1オクターブ上に重ねる（gain 0.5倍）。リードのcutoff下限を1800Hzに |
| 12–14 | `outro` | ハット無し。スネア無し。ベース1拍目のみ。パッドは通常 |
| 15 | `outro-last` | 4拍目でキック・ベース停止。パッドのみ |
| 16（テイク終了直後の1拍目） | `end` | 終止: 主和音（パッド）＋リード主音(octave 0)＋ベースroot を同時に1発。release 2.5s。テイクの尺はこの終止を含めるため **レンダー尺 = 16小節 + 4秒** に変更 |

### A2. 和音は「基本ループ」を持ち、Tがそれを歪める `chordForBar(worldId, barIndex, tension)`
- 基本ループ（4小節周期、`barIndex % 4`）: daylight `I – I – IV – V` ／ night `i – i – VI – VII`
- T<0.30: 基本ループそのまま
- 0.30≤T<0.60: 2小節目(%4==1)を daylight `vi`／night `iv` に置換（浮遊感）
- T≥0.60: 4小節目以外を daylight `V`／night `VII` に置換（引っ張り）。4小節目は基本ループどおり
- 着地時の「次の拍でIへ」（v0 §5）は維持。`chordForTension` は残してよいが使用箇所を `chordForBar` に置換

### A3. 打鍵の位置で音長・強さに階層 `accentForBeat(beatInBar)`（beatInBar = 0〜3.999）
- 拍頭（小数部が0）かつ1拍目または3拍目: 音長 ×1.6、gain ×1.15
- それ以外の拍頭: 音長 ×1.2、gain ×1.0
- 裏（8分の裏、16分）: 音長 ×0.85、gain ×0.9

## B. フレーズ感 — 2小節フレーズと応答

### B1. 応答音 `answerDegree(worldId, lastDegree, chordName)`
- 2小節ごとの境界（beat 8, 16, 24 …）の直前1拍以内に打鍵があり、その最後の打鍵が `stable` でない場合、
  境界の拍頭に**応答音**を1つ自動で鳴らす: 現在の和音の構成音のうち lastDegree に最も近い度数（同距離なら低い方）、
  octave 0、gain 0.45、音長 0.6s、エフェクト none、応答音はイベントログに `kind: "answer"`, `sourceId: "gravity"` で記録する
- 最後の打鍵が stable なら応答音は鳴らさない（本人の着地を邪魔しない）
- テイク中に応答音は最大8回まで

### B2. 沈黙のあとの「戻り」
- 4拍以上の沈黙後の最初の打鍵は、gain ×1.2、音長 ×1.5（v0のリバーブ復帰は維持）

## C. 伴奏と噛み合わせる

### C1. 和音構成音の重み `chordToneWeight(chordDegrees, degree)`
- 打鍵した度数が現在の和音の構成音なら gain ×1.12、非構成音（経過音）なら gain ×0.8 かつ音長 ×0.8

### C2. ダッキングとスネア
- キック発音時にパッドとリードのバス gain を 0.7 へ 10ms で下げ、150ms で 1.0 に戻す（グルー）
- スネア: `a`/`b` セクションの2拍4拍。白色ノイズ(bandpass 1.8kHz, Q 0.8) 0.12s gain 0.35 ＋ sine 180→120Hz 0.08s gain 0.3
- ハット: 16分にスウィング 8%（裏の16分を 16分長×0.08 遅らせる）。daylightのみ。nightは 0%

### C3. ベースをキックと同期
- daylight: [1, 2.5, 3, 4.5] 拍（8分裏を追加）。night: 付点のまま。いずれもキックのある拍は gain 0.9、それ以外 0.7

## D. 音色・空間

### D1. リード
- daylight: **FM電気ピアノ**。carrier sine、modulator sine（比 2:1）、modulation index = 300Hz×velocity を 0.25s で 40Hz へ指数減衰（modulator→gain→carrier.frequency へ接続）。＋sine +12（gain 0.18）。lowpass は v0 どおり
- night: saw 2本（±6cent）→ lowpass **Q=4**、cutoff にエンベロープ（打鍵時 cutoffForTension×1.8 → 0.4s で cutoffForTension へ指数減衰、上限 8000Hz）
- 両世界: 2本のリード発音（=同時押し）は互いに独立（v0どおり）

### D2. パッド
- 2ボイスを ±0.3 にパン（StereoPanner）。daylight は triangle→lowpass 2500Hz。night は sine+triangle→lowpass 1800Hz。attack/release は v0 どおり

### D3. リバーブ・ディレイ
- IR: 3.0s、プリディレイ 20ms（先頭 0.02s を無音）。リターンに highpass 200Hz → lowpass 3800Hz
- ディレイ: ピンポン（L→R交互）。delayTime 付点8分、feedback 0.35、wet 0.30。リターンにも lowpass 3000Hz

### D4. マスター
- 順序: 各バス → DynamicsCompressor(threshold −14dB, knee 6, ratio 3, attack 0.005, release 0.15) → WaveShaper(tanh、入力×1.4、oversample "2x") → destination
- ピーク目標: 書き出しWAVのピークが 0.85〜0.95。超える／届かない場合は compressor 前段の master gain で調整（定数1か所）

### D5. ドラム
- キック: sine 150→50Hz/0.12s に、クリック（白色ノイズ 5ms gain 0.5）を重ねる
- ハット: gain を v0 の 0.8倍、pan +0.2

## E. UI（最小のまま）
- 左上表示を `random-scale-keys prototype v0.2.0` に
- 演奏状態に「セクション: intro/a/b/outro」を1行追加
- 応答音が鳴ったときはキー配置の下に「応答: 度数n」と1秒表示

## F. テスト追加（`node --test tests/`）
1. `sectionForBar` 0/3/4/7/8/11/12/14/15 の境界
2. `chordForBar` 基本ループ4小節・T=0.4での2小節目置換・T=0.7での4小節目維持、両世界
3. `accentForBeat` 0 / 2 / 1 / 0.5 / 0.25
4. `answerDegree` daylight: lastDegree=7, chord "I"([1,3,5]) → 1（7と1は距離1、5は距離2）／lastDegree=4, "I" → 3 と 5 が同距離→低い 3
5. `chordToneWeight` 構成音／非構成音
6. 既存8件は不変

## G. 完了条件
- テスト全通過。`node --check` 全ファイル
- 同一ログの2回レンダーは ±2LSB 以内（Chromium丸めのため厳密一致は不要）
- 書き出しWAVの尺 = 16小節＋4秒。ピークが 0.85〜0.95
- 実機未確認なら明記
