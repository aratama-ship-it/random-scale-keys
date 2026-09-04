# M10 仕様 — SFX（数字キーの効果音＋伴奏の自動効果音）（app v0.11.0）

作成: 2026-09-04 Claude（設計）。実装: Codex。検証: Claude → 本人（耳）。

本人決定（2026-09-04）: 「SFXみたいなのも入れたい」→ **A: SFX専用キー（数字キー 0〜9。A〜Zは音階のまま）＋ B: 伴奏側の自動SFX**。
種類は **インパクト／ザップ（ピッチ落ち）／グリッチ・テープストップ**。

## 0. 設計の核

- **数字キーは固定配置**（ランダムにしない）。SFXは「覚えて狙って打つ合いの手」なので位置が動かない方が使える。
  A〜Zのランダム配置・役割・効果は一切変えない。
- SFXは**音階の重力に関わらない**: 緊張度 T・記憶（noteMemory）・応答音・無音判定（lastPressBeat）を動かさない。
- 正本はイベントログ。SFX押下は `kind: "sfx"` のイベントとして記録し、再生・WAV・ステム・MIDI が同じ音を再現する。
- **決定論**: SFXのノイズは**イベントごとに seed 固定**（`mulberry32(hashSeed(log.seed) + 101 + Math.round(beat × 1000))`）。
  ドラムの `drumRandom` を消費しない（オンラインとオフラインで予約順が違っても音が変わらないため）。
- 自動SFXは伴奏の一部（accomp）。SFXキーは演奏者の音（lead）。ステムの帰属もそれに従う。

## 1. 数字キーの割当（`prototype/gravity.mjs` に `SFX_KEYS`）

| code | type | variant | 音（§3） |
|---|---|---|---|
| Digit1 | impact | 0 | 低い落下音（55→30Hz）＋低域ノイズ、0.30s |
| Digit2 | impact | 1 | 中（90→40Hz）＋ノイズ、0.25s |
| Digit3 | impact | 2 | 高く短い（140→60Hz）＋ノイズ、0.18s |
| Digit4 | zap | 0 | 1800→200Hz、0.15s |
| Digit5 | zap | 1 | 1200→120Hz、0.22s |
| Digit6 | zap | 2 | 600→60Hz、0.32s |
| Digit7 | glitch | 0 | 60ms のゲートノイズ |
| Digit8 | glitch | 1 | 180ms のゲートノイズ＋矩形波の落下（200→50Hz） |
| Digit9 | tapestop | 0 | 0.5s |
| Digit0 | tapestop | 1 | 1.0s |

```js
export const SFX_KEYS = Object.freeze({ Digit1: { type: "impact", variant: 0 }, … Digit0: { type: "tapestop", variant: 1 } });
export const SFX_LABELS = Object.freeze({ impact: "imp", zap: "zap", glitch: "glt", tapestop: "tape" });
export function sfxNoiseSeed(logSeed, beat) // hashSeed(logSeed) + 101 + Math.round(beat * 1000)
```

## 2. イベント（`app/main.js`）

- `handleKeyDown`: `SFX_KEYS[event.code]` があり `state === "playing"` なら `playSfx(event.code)`（`event.repeat` は無視、`preventDefault`）。
  A〜Zと同じく打鍵時刻は現行のクオンタイズ設定に従う（OFF なら即時）。
- 記録するイベント:
  ```js
  { time, beat, kind: "sfx", code, sfx: type, variant, velocity, section, sourceId: "keyboard" }
  ```
  `velocity` は A〜Zと同じ `velocityFromInterval`（直前の**SFX**打鍵からの間隔。A〜Zの間隔とは独立）。
  `midi`／`degree`／`role`／`effect`／`tBefore`／`tAfter`／`resolution` は持たない。
- T・記憶・応答音・`lastPressBeat`・`lastPressEvent` は更新しない。完了パネルの打鍵数（`presses`）には数えない。
- 発音: `synth.scheduleSfx(type, variant, when, velocity, { noiseSeed: sfxNoiseSeed(takeLog.seed, beat), stemRole: "lead" })`。
- 再生（replay）と `normalizeLoadedLog`／`audibleTakeLog`: `kind === "sfx"` を通す（`audibleTakeLog` のフィルタに sfx を追加）。
  `normalizeLoadedLog` は sfx イベントに `effect`/`tBefore` 等を足さなくてよい（`kind` で分岐）。
- `app/ui-core.mjs` `validateTakeLog`: `kind === "sfx"` のイベントは必須項目を `time, beat, kind, code, sfx, variant, velocity` にする
  （現行の `midi, degree, role` 必須は press/answer のみ）。

## 3. 音（`prototype/synth.js` `scheduleSfx(type, variant, when, velocity = 1, options = {})`）

共通: `options.stemRole` が `"accomp"` なら accompBus（ステム accomp）、それ以外は leadBus（ステム lead）。
リバーブ・ディレイには送らない。ノイズは `mulberry32(options.noiseSeed ?? 1)` で生成する。`gain` は `velocity ×` 下の値。

| type | 作り |
|---|---|
| impact | sine を f0→f1 に `exponentialRampToValueAtTime` で落とす（表の周波数・長さ）。gain 0.55、release は長さの 60%。＋ 白色ノイズを lowpass 900Hz（Q 0.7）で 0.12s、gain 0.22。＋ `duckForKick(when)` |
| zap | sawtooth を f0→f1 に指数で落とす（表の長さ）。lowpass 3200→400Hz を同じ時間で落とす、Q 6。gain 0.20。エンベロープ attack 0.002、release 0.05 |
| glitch | 白色ノイズをゲート（6ms 鳴る／6ms 止める の繰り返し、ゲートは buffer 生成時に掛ける）。bandpass 2500Hz Q 1。gain 0.30。variant 1 は 180ms で、square 200→50Hz（gain 0.10）を下に足す |
| tapestop | 世界の根音（`world.rootMidi`）の sawtooth ×2（detune ±7）と1オクターブ下の sine。周波数を表の時間で **1/8 に指数で落とし**、lowpass 2200→250Hz、gain 0.22 → 0 に線形フェード |

すべて `stop` は終了時刻 +0.02s。ノイズ長は必要最小限（buffer は都度生成でよい。0.3s 以下）。

## 4. 自動SFX（`app/main.js` `scheduleAccompanimentStep` と `prototype/render.js` `scheduleRecordedTake`。両方で同じ結果）

| 位置 | SFX | velocity | 条件 |
|---|---|---|---|
| 到達小節（4・8・12）の step 0 | impact variant 1 | `0.45 + 0.4 × T`（その時点の `currentTension`） | セクション a・b・outro（bar 0 と 15 は無し） |
| 終止小節 3・7・11 の step 15（最後の16分） | glitch variant 0 | 0.35 | bar 14 は無し（最後の終止は素のまま） |

`stemRole: "accomp"`、`noiseSeed: sfxNoiseSeed(log.seed, beat)`。終止（`scheduleEnding`）には SFX を足さない（テープストップは本人判定後の候補）。

## 5. MIDI（`app/midi.js`）

- 新トラック `sfx`（`trackChunk("sfx", 3, …)`、チャンネル 3）。ノート番号: impact 36/37/38（variant順）、zap 40/41/42、glitch 44/45、tapestop 47/48。
  長さは §1 の秒数、velocity はイベントの velocity。自動SFXも同じトラック。
- `createMidiRecorder` に `scheduleSfx(type, variant, when, velocity)` を追加。

## 6. UI（`app/main.js` `renderKeyboard`、`app/style.css`、`app/index.html`）

- キーボードの**最上段に数字キー 10 枚**（"1234567890"）。`data-code="Digit1"…"Digit0"`、`class="key key-sfx"`、
  `key-degree` にキーの文字（1〜0）、`key-meta` に `SFX_LABELS[type]`。行の `marginLeft` は 0、既存3段のオフセットは変えない。
  クリック／タップでも鳴る（既存の pointerdown と同じ）。
- 見た目（トークン外の新色は作らない）: 背景 `--bg`、枠 1.5px `--text-sub`、文字 `--text`。押下は既存 `.pressed` と同じ。
  `design/TOKEN_SHEET.md` に「SFXタイル: bg＋text-sub枠（新色なし）」を1行追記（design/ は Claude が書く。Codex は触らない）。
- `app/terrain.js` `press(rect, role)`: role `"sfx"` のとき色は `--text-sub`。数字キーは等高線の源（`contourSources`）に**含めない**。
- 凡例に `SFX: 1-3 imp / 4-6 zap / 7-8 glt / 9-0 tape` を1行追加（`--fs-small`）。待機・演奏中とも表示。
- 同時押し診断は変更なし。

## 7. 版・記録

- 版表示 **v0.11.0**、ログ `engine: "accomp-v4"`（自動SFXで伴奏が変わる。`app/main.js` 2か所と `app/scene-map.mjs`、対応テスト）。
- README: SFXキーの表、自動SFXの位置、ステムの帰属（キー=lead／自動=accomp）、MIDIの sfx トラックとノート番号、
  v0.10.0 以前の JSON は自動SFXぶん伴奏が変わること。

## 8. テスト

1. `SFX_KEYS` が 10 キー、type が4種、`sfxNoiseSeed` が同じ入力で同じ値・beat が違えば違う値
2. `validateTakeLog`: sfx イベント（midi/degree/role 無し）を受理、sfx で `sfx`／`variant` が欠けると拒否
3. render.test の記録シンセに `scheduleSfx` を足し、16小節ログで bar 4/8/12 の step 0 に impact（variant 1、stemRole accomp）、
   bar 3/7/11 の step 15 に glitch（variant 0）、bar 0/14/15 には無いこと。ログの sfx イベントが `scheduleSfx(type, variant, …, stemRole "lead")` になること
4. midi: sfx イベント→ sfx トラックにノート 1つ（番号は §5）、自動SFXも同トラック
5. main.js の `EFFECT_COUNTS`・`createLayout` は不変（既存テストで担保）
6. 決定論: 同じ noiseSeed で `scheduleSfx` の生成するノイズ buffer が一致（buffer 生成関数を純粋関数に切り出してテスト）

## 9. 完了条件

- テスト全通過、`node --check`、**ブラウザ console error 0**、v0.11.0 表示、数字キー段が出て `imp/zap/glt/tape` の略号が見える
- Claude 実測: SFXキー各種を含む合成ログのミックスがピーク ≤ 0.95、lead ステムに impact の低域（30〜90Hz）が出る、
  同じログの2回レンダーが ±2LSB（複数音階×3回）
- 音の良し悪し（各SFXの質感・音量・自動SFXの多さ）は本人判定
