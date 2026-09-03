# 音階の重力 v0 — 音だけの30秒プロトタイプ 仕様書

作成: 2026-09-03 Claude（設計）。実装: Codex。検証: Claude → 最終判定は本人の耳。
目的: 「ランダム配置のスケール音を打つだけで曲に聞こえるか」を、UIを作らずに音だけで判定する。
依存ゼロ・ビルドなし・素のHTML/ES Modules。外部ネットワーク参照なし。音はすべてWeb Audioの合成音（サンプル不使用）。

## 0. ファイル構成（すべてこのフォルダ直下）

| ファイル | 役割 |
|---|---|
| `index.html` | 最小UI（無装飾でよい。デザインは対象外） |
| `app.js` | キー入力・状態・スケジューリング・UI更新 |
| `gravity.mjs` | **純粋関数のみ**（乱数配置・緊張度・和音選択・クオンタイズ・ベロシティ・休符）。DOM/AudioContext禁止 |
| `synth.js` | 音源とエフェクト。`BaseAudioContext` を引数で受け取り、**オンライン(AudioContext)とオフライン(OfflineAudioContext)で同じコードを使う** |
| `render.js` | イベントログ→OfflineAudioContextで再生成→WAV(RIFF/PCM16/44.1kHz/stereo)化→ダウンロード |
| `tests/gravity.test.mjs` | `node --test` で走る純粋関数テスト |

## 1. 用語

- **世界(world)**: スケール＋テンポ＋音色＋伴奏パターンの組。v0は2つ（A/B）。
- **役割(role)**: スケール度数の分類。`stable`(安定)／`floating`(浮遊)／`tension`(緊張)。
- **緊張度 T**: 0〜1。直近の打鍵の役割で上下し、時間で減衰する。伴奏・音色を裏で変える主役。
- **着地(resolution)**: Tが高い状態から安定音で急落した瞬間。景色が開く演出を出す。
- **テイク(take)**: 1小節カウントイン＋16小節の一発録り。終了後にWAV/JSONを書き出せる。

## 2. 世界の定義

| | 世界A "daylight" | 世界B "night" |
|---|---|---|
| スケール | Cメジャー（C D E F G A B） | Aナチュラルマイナー（A B C D E F G） |
| BPM | 100 | 88 |
| 役割 | stable={1,3,5} floating={2,6} tension={4,7} | stable={1,3,5} floating={2,4} tension={6,7} |
| 和音表 | I=[1,3,5] vi=[6,1,3] IV=[4,6,1] V=[5,7,2] | i=[1,3,5] VI=[6,1,3] iv=[4,6,1] VII=[7,2,4] |
| リード音色 | triangle+sine(1oct上, 0.25) 、attack 5ms、decay 0.35s、sustain 0.2、release 0.25s、lowpass | sawtooth 2本(±6cent)、attack 8ms、decay 0.5s、sustain 0.3、release 0.6s、lowpass |
| パッド | triangle 3本（root/3rd/5th）、attack 0.8s、release 1.5s、gain 0.12 | sine+triangle 各3本、attack 1.2s、release 2.0s、gain 0.10 |
| ベース | sine(root, oct2)+square(0.15)、8分刻み [x . x . x . x .] | sine(root, oct2)、付点 [x . . x . . x .] |
| ドラム | kick=sine 150→50Hz/0.12s、hat=白色ノイズ highpass 7kHz/0.04s | 同じ、hat gainを0.7倍 |

度数はスケール内1〜7。MIDI番号: 世界A root=C4(60)、世界B root=A3(57)。
オクターブはリード用に3段（root-12 / root / root+12）。

## 3. 乱数配置 `createLayout(seed, worldId)`

- PRNGは mulberry32（seedは32bit整数。文字列seedは FNV-1a 32bit でハッシュ）。**同じseed＝同じ配置**。
- 対象キー: `KeyA`〜`KeyZ` の26個（`event.code` で判定。配列依存を避ける）。
- 役割の割当数: stable 12 / floating 7 / tension 7（合計26）。各役割内では度数を均等に回してから残りを乱数で。
- オクターブ: 0(中央) 50% / −1 25% / +1 25%。
- エフェクト（キーごとに1つ）: `none` 14 / `delay` 4 / `sweep` 3 / `octave` 3 / `stutter` 2。
  - `delay`: フィードバックディレイ（付点8分、feedback 0.35、wet 0.35）へこの音だけ送る
  - `sweep`: その音のlowpass cutoffを 400Hz→4000Hz へ 0.3s で上昇
  - `octave`: +12のsine を gain 0.3 で重ねる
  - `stutter`: 32分音符間隔で3回リトリガー（ベロシティ 1.0/0.7/0.5）
- 出力: `{ seed, worldId, keys: { KeyA: { degree, octave, midi, role, effect }, ... } }`

## 4. 緊張度 T `tension.mjs 相当（gravity.mjs内）`

- 初期値 0。
- 打鍵時: まず減衰 `T = T * exp(-(Δbeats)/8)`（Δbeats＝前回更新からの拍数）、次に役割で加算:
  stable −0.30 ／ floating +0.05 ／ tension +0.22。 [0,1] にクランプ。
- 小節頭でも減衰だけ適用する（打鍵なしで下がる）。
- **着地判定** `isResolution(prevT, nextT, role)`: `role==='stable' && prevT >= 0.5 && nextT < 0.25`。

## 5. Tが裏で変えるもの

| 対象 | T<0.30 | 0.30≤T<0.60 | T≥0.60 |
|---|---|---|---|
| 伴奏和音（小節頭で決定） | I | vi と IV を小節の偶奇で交互 | V（世界BではVII） |
| ハイハット | 8分 | 16分の裏抜き [x.xx x.xx] | 16分＋2拍4拍にオープン気味(0.12s) |
| リード lowpass cutoff | 1200Hz | 線形補間 | 4200Hz |
| パッド detune | 0 cent | 線形補間 | ±12 cent |

- 和音は小節頭でのみ切り替える（途中で変えない）。ただし**着地時は次の拍頭でIへ切り替える**。
- 着地演出: パッド gain ×1.5 を1拍で元に戻す／リバーブ send を 0.8 にして2拍で通常値へ／ベースにroot(oct1)のsine 0.4s を1発。

## 6. 休符が音場を変える

- `silenceBeats` ＝ 最後の打鍵からの拍数。
- リバーブ send: `0.2 + 0.6 * clamp((silenceBeats - 1) / 3, 0, 1)`（1拍までは通常、4拍で最大）。次の打鍵で通常へ（0.5拍で戻す）。
- 8拍以上無音でハイハットを止めキックのみ。次の打鍵で復帰。
- リバーブは ConvolverNode。IRは起動時に生成（白色ノイズ×指数減衰 2.2s、ステレオ）。

## 7. クオンタイズ・ベロシティ・音長

- グリッド＝16分音符。`quantize(nowSec, startSec, bpm, division=4, graceSec=0.03)`:
  次のグリッド時刻を返す。ただし直前のグリッドから 30ms 以内なら「今すぐ」（= nowSec）。
- ベロシティ `velocityFromInterval(dtSec)`: dt≥0.5→1.0、dt≤0.08→0.5、間は線形。
- 音長 `noteLengthFromInterval(dtSec)`: dt≥0.5→0.5s、dt≤0.08→0.12s、間は線形。
- 同一キーの `event.repeat===true` は無視。同時押しは各キー独立に発音。

## 8. テイクとイベントログ

- 「演奏開始」ボタンでAudioContextを生成/resume（初回発音にユーザー操作が必要なため）。
- 開始→1小節カウントイン（クリック音4回）→16小節の伴奏→自動停止。Enterで途中停止。
- イベントログ（正本）:
  ```json
  { "version": "gravity-v0", "worldId": "daylight", "seed": 123456, "bpm": 100, "bars": 16,
    "events": [ { "time": 1.234, "beat": 2.06, "kind": "press", "code": "KeyF", "midi": 64,
                  "degree": 3, "role": "stable", "effect": "none", "velocity": 0.9, "length": 0.4,
                  "tBefore": 0.55, "tAfter": 0.25, "resolution": false, "sourceId": "keyboard" } ] }
  ```
  `time` はテイク開始（カウントイン終了）を0とする秒。`beat` は拍（小数）。
- 「JSON書き出し」でダウンロード。「再演」で同じログをオンラインで再生（打鍵と同じ経路）。
- 「WAV書き出し」: `render.js` がログから OfflineAudioContext(2ch, 44100, 尺=16小節+2秒) で再生成し、
  PCM16 WAVをダウンロード。**オンライン再生と同じ synth.js を使う**（分岐禁止）。

## 9. 最小UI（index.html。無装飾で可。CSSは最低限）

- 左上に `random-scale-keys prototype v0.1.0`（バージョン表示は全開発共通ルール）。
- 世界の選択（A/B）、seed入力＋「振り直し」（新しい乱数seed）、「演奏開始」「停止」「再演」「WAV書き出し」「JSON書き出し」。
- キー配置表示: 物理配列3段（QWERTYUIOP / ASDFGHJKL / ZXCVBNM）で各キーに `度数(オクターブ) 役割 効果` を文字で表示。
  役割は3色（stable=緑系、floating=青系、tension=橙系。値は任意）。押下中は反転。
- 現在の T（0〜100の横バー）、小節/拍カウンタ、現在の和音名、イベント数。
- 文言は具体的に（詩的な見出しやスローガンは入れない）。

## 10. テスト（`node --test tests/`）

1. 同一seed・同一worldで `createLayout` が完全一致、seed違いで不一致
2. 役割の個数が 12/7/7、エフェクトが 14/4/3/3/2、26キー全部に割当
3. 減衰と加算の数値（例: T=0.5, 8拍経過, stable → 0.5*e^-1 −0.30 = clamp → 0）
4. `chordForTension` の境界値 0.29/0.30/0.59/0.60、偶奇の交互
5. `quantize` の grace 動作（グリッド直後 20ms は即時、40ms は次グリッド）
6. `velocityFromInterval` / `noteLengthFromInterval` の端点と中点
7. `isResolution` の真偽4ケース
8. `reverbSendFromSilence` の 0/1/2.5/4/10拍

## 11. 完了条件

- `node --test tests/` 全通過
- `python3 -m http.server 8962 --bind 127.0.0.1` でこのフォルダを配信し、ブラウザで「演奏開始」→打鍵で音が鳴り、
  16小節で自動停止、WAVとJSONがダウンロードできる（Codexはブラウザ確認できなければ「実機未確認」と明記）
- console error ゼロ

## 12. 制約

- 依存パッケージ・ビルド・外部CDN・フォント読込を追加しない
- ファイルの削除・移動はしない。このフォルダ外へ書かない
- 数値は本仕様の値をそのまま使い、変えたい場合はコード内定数にまとめて `SPEC_gravity_v0.md` の値からの差分をREADME末尾に列挙する
