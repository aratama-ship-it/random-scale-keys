# M11 仕様 — SFXのリバーブ、長押しサステイン、音色の選択とShift切替（app v0.12.0）

作成: 2026-09-04 Claude（設計）。実装: Codex。検証: Claude → 本人（耳）。

本人判定（2026-09-04、v0.11.0）: 「**FX系がリバーブが足りなくて浮いている**」「**キーボードを長押しでサステインを付けたい**」
「**音色の選択**もできるとよい。**音色をキーボードの左右もしくはShiftキーで変えて、1曲の中でいろいろ使いたい**」「他は全体的には大丈夫」。

Claude の選択: 音色の切替は **Shift 長押し**で行う（左右分割はキーが13ずつに減り、「同じ位置を使い続けるとモチーフになる」遊びが痩せるため。
判定後に左右分割を追加することは可能）。

## 0. 設計の核

- 3件とも**イベントログで再現できる形**にする（`timbre`・`length`・`held` を press イベントに記録。再生・WAV・ステム・MIDI が同じ音）。
- 既定のまま（音色を変えず、長押しせず）演奏した音は v0.11.0 と同じ（SFX のリバーブ量だけ変わる）。
- 伴奏の規則（和音・ベース・ドラム・自動SFX）は変えない。`engine` は `accomp-v4` のまま。

## 1. SFX のリバーブ（`prototype/synth.js`）— 2026-09-04 改訂（実測後）

第1案（SFXバス→`reverbInput` への送り）は 2.0 倍でも 6.0 倍でも残響がほぼ増えなかった（fx ステムで zap 後の残響 RMS 0.0137→0.0143、
impact 後 0.0045→0.0048）。原因: 主リバーブは `reverbHighpass` 200Hz・`reverbLowpass` 3.8kHz を通るため、低域中心の impact は残らず、
zap／glitch は短すぎて残響エネルギーが乗らない。→ **SFX 専用の短い部屋を SFX バスにインラインで足す**。

- `SFX_REVERB_SEND = 6.0` の主リバーブ送りは残す（tapestop・zap の長い尾用）。
- **`sfxRoom`**: ConvolverNode。IR は `makeSfxRoomImpulse(context, mulberry32(seed + 7))` で生成: 2ch、長さ **1.4s**（当初 0.9s→実測で延長）、プリディレイ 10ms、
  `exp(−t / 0.30)`（当初 0.18→実測で延長）の指数減衰 × 白色ノイズ、ch ごとに別乱数。ハイパス・ローパスは**入れない**（低域の「部屋鳴り」を残す）。
- 経路: `leadSfxBus → sfxRoomSendLead(gain SFX_ROOM_SEND) → sfxRoom → sfxRoomWetLead(gain SFX_ROOM_WET) → leadSfxBus の出力先と同じ先`
  （`isStem ? leadDryOutput : master`）。accomp 側も同様に `accompSfxBus → … → accompDryOutput/master`。
  部屋は1つの ConvolverNode を共有してよいが、**出力先を lead／accomp で分けるため送りと戻りは2系統**（Convolver は2つ作ってよい。決定論のため IR は同一）。
- 定数: `SFX_ROOM_SEND = 1.0`、`SFX_ROOM_WET = 1.0`（当初 0.6。Claude が実測して調整。目標: impact 直後 0.3〜1.0s の lead ステム RMS が
  SFX 無しの同区間の 1.5 倍以上、かつミックスのピーク ≤ 0.95）。
- 主リバーブ（`reverbInput` 以降）と lead／伴奏の音は変えない。

## 2. 長押しサステイン

### 2.1 `prototype/synth.js` `scheduleLead`

- 戻り値を**ハンドル**にする: 効果が `none`／`delay`／`sweep`／`octave` のとき `{ release(whenSec) }` を返す。`stutter`／`arpeggio` は `null`（長押し非対応）。
  **★2026-09-04 追記（v0.16.0 で修正）**: ハンドルを返さない効果は、`options.hold === "open"` でも**開いたエンベロープにしてはいけない**。
  release が呼ばれず `HOLD_MAX_SECONDS`（16秒）鳴り続ける。`supportsHold = effect !== "stutter" && effect !== "arpeggio"` で常に `length` で閉じる。
- `options.hold === "open"` のとき（ライブ演奏用）:
  - エンベロープは attack → decay → sustain まで予約し、**release を予約しない**。`oscillator.stop` は `when + HOLD_MAX_SECONDS(16) + envelope.release + 0.02`。
  - `release(whenSec)`: 各声部の gain に `cancelAndHoldAtTime(whenSec)`（無ければ `cancelScheduledValues(whenSec)` + `setValueAtTime(param.value, whenSec)`）→
    `exponentialRampToValueAtTime(MIN_GAIN, whenSec + envelope.release)`。2回目以降の呼び出しは無視。
  - `whenSec` が `when + HOLD_MAX_SECONDS` を超える場合はその時刻で release する。
- `options.hold` が無いとき（再生・レンダー・応答音）は現行どおり `length` で release まで予約（ハンドルは返すが release は no-op でよい）。
- `scheduleEnvelope` は変えず、release を予約しない版 `scheduleOpenEnvelope(param, when, attack, decay, sustain, peak)` を追加する。

### 2.2 `app/main.js`

- `activeHolds: Map<code, { handle, when, length, event }>`。`playCode` で `hold: "open"` で予約し、ハンドルが非 null なら登録する。
- `keyup`（`event.code` が登録済み）／タイルの `pointerup`・`pointercancel`・`pointerleave`:
  `{ releaseAt, length, held } = holdRelease(when, naturalLength, now, HOLD_MAX_SECONDS)` → `handle.release(releaseAt)`、
  ログの press イベントの `length` を更新し、`held` が true なら `event.held = true` を付ける。登録を消す。
- `holdRelease(pressWhen, naturalLength, nowSec, maxHoldSec)` は `app/ui-core.mjs` の純粋関数:
  `releaseAt = min(max(nowSec, pressWhen + naturalLength), pressWhen + maxHoldSec)`、`length = releaseAt − pressWhen`、`held = length > naturalLength + 1e-6`。
- テイク終了（`takeEnd` 到達、Enter 停止）時に残っている保持は `releaseAt = min(now, takeEnd)` で全部 release し、length を更新する。
- 再生（replay）は `hold` を使わず `length` で鳴らす（現行の経路）。
- `event.repeat` は従来どおり無視（押しっぱなしで連打にならない）。
- 音色ごとの sustain レベルは変えない（電気ピアノは 20%、ソウは 30% で伸びる）。物足りなければ判定後に `HOLD_SUSTAIN_FLOOR` を検討する。

### 2.3 `prototype/render.js`・`app/midi.js`

- 変更不要（`event.length` をそのまま使う。`held` は記録用）。`validateTakeLog` は `timbre`（string）と `held`（boolean）を**任意項目**として受理する。

## 3. 音色の選択と Shift 切替

### 3.1 定義（`prototype/gravity.mjs`）

```js
export const LEAD_TIMBRES = Object.freeze(["epiano", "saw", "pluck", "bell"]);
export const TIMBRE_LABELS = Object.freeze({ epiano: "電気ピアノ", saw: "ソウ", pluck: "プラック", bell: "ベル" });
export function defaultTimbres(worldId) // daylight → { main: "epiano", shift: "bell" }、night → { main: "saw", shift: "pluck" }
```

### 3.2 音（`prototype/synth.js` `scheduleLead` の `options.timbre`。既定は `defaultTimbres(worldId).main`）

| timbre | 作り（gain は velocity × gainScale × 値） |
|---|---|
| epiano | **現行の daylight の音そのまま**（`fmElectricPiano` ＋ +12 の sine 0.2×0.18、envelope {0.005, 0.35, 0.2, 0.25}） |
| saw | **現行の night の音そのまま**（sawtooth ±6 detune ×2、gain 0.12、filter envelope、envelope {0.008, 0.5, 0.3, 0.6}） |
| pluck | triangle ×2（detune 0 / +5）gain 0.18、envelope {0.003, 0.28, 0.12, 0.12}、lowpass を `cutoff × 2.2 → cutoff` に 0.15s で落とす（Q 0.7）。＋ 6ms のノイズ transient（gain 0.08、`mulberry32(3)` で synth 生成時に1回だけ作る buffer を使い回す） |
| bell | FM: carrier sine、modulator sine **ratio 3.5**、modulationIndex `220 × velocity` → 40 に 0.6s で減衰、envelope {0.002, 1.2, 0.05, 0.6}、gain 0.16。＋ +12 の sine gain 0.04。lowpass は `cutoffForTension` のまま |

- 世界による分岐（`worldId === "daylight"` で音を変えている箇所）を **timbre による分岐**に置き換える。既定の timbre は世界の既定なので音は不変。
- 効果（delay 送り／sweep／octave の +12／stutter／arpeggio）と `cutoffForTension`・`filter.q` は timbre に関係なく現行どおり掛ける
  （`filter.q` は night 用の 4 を **saw のときだけ**、`filter.envelope` も saw のときだけ）。

### 3.3 UI と記録（`app/main.js`、`app/index.html`）

- 設定行に select を2つ追加: **音色**（`#timbre`）と **Shift時の音色**（`#timbre-shift`）。選択肢は `LEAD_TIMBRES`（表示は `TIMBRE_LABELS`）。
  世界を変えたら両方を `defaultTimbres(world)` に戻す。idle／finished で有効、演奏中は無効（既存の `.performance-setting` と同じ扱い）。
- `takeLog.timbres = { main, shift }` を記録。press イベントに `timbre`（打鍵時に `event.shiftKey` なら shift、そうでなければ main）。
  タイルのクリック演奏は main。Motion Scene（ジャグリング）は main。
- Shift を押している間、`#keyboard` に `shift` クラスを付け、タイルの枠を `--text-sub` にする（視覚の手がかり。新色は作らない）。
  `Shift` の keydown/keyup を `handleKeyDown`／keyup で見る（`event.key === "Shift"`）。Shift 自体は音を出さない。
- `playCode` → `synth.scheduleLead(..., { …, timbre, hold: "open" })`。応答音は main の音色。
- `prototype/render.js`: `synth.scheduleLead(event, …, { …, timbre: event.timbre })`（無ければ既定）。
- `app/midi.js`: 使われた音色が 1 種類なら従来どおり `lead` トラック。2 種類以上なら `lead:<timbre>` トラックに分ける（チャンネルはすべて 0）。
- `normalizeLoadedLog`: `timbres` が無い古いログは `defaultTimbres(worldId)`、イベントの `timbre` は無ければ付けない（既定で鳴る）。

## 4. 版・記録

- 版表示 **v0.12.0**（title／.version／対応テスト）。`engine` は `accomp-v4` のまま。
- README: SFX のリバーブ、長押しサステイン（対応する効果／上限16秒／stutter・arpeggio は非対応）、音色4種と Shift 切替、MIDI の lead トラック分割。

## 5. テスト

1. `scheduleLead` が none で `{ release }` を返し、stutter／arpeggio で null（既存の記録シンセではなく、`createSynth` を最小のモック context で動かすのが難しければ、
   ハンドル生成の純粋部分を切り出してテストする。判断は Codex に任せるが、削除はしない）
2. `holdRelease`: 自然長より早い keyup → 自然長で release／遅い keyup → その時刻／上限16秒で頭打ち／`held` の真偽
3. `defaultTimbres` の2世界、`LEAD_TIMBRES` が4種、`TIMBRE_LABELS` が全種を持つ
4. render.test の記録シンセ: press イベントの `timbre` が `scheduleLead` の options に渡る／無ければ undefined
5. midi: 2音色のログで `lead:epiano` と `lead:bell` の2トラック、1音色なら `lead` のまま
6. `validateTakeLog`: `timbre`／`held` 付きイベントを受理
7. 既存テストは削除せず更新

## 6. 完了条件

- テスト全通過、`node --check`、**ブラウザ console error 0**、v0.12.0 表示、音色 select 2つ、Shift で `#keyboard.shift`
- Claude 実測: ①fx ステムで SFX 直後の残響が増えている（v0.11.0 の fx ピーク 0.089 との比較）②長押し相当（length 2.0s）の lead ステムが 1.5s 後も鳴っている
  ③pluck／bell を含むログが例外なくレンダーし、決定論 ±2LSB（複数音階×3回）④既定音色・既定長のログは v0.11.0 とミックスが一致（SFX を含まないログで ±2LSB）
- 音の良し悪し（リバーブ量、サステインの伸び、pluck／bell の質感）は本人判定
