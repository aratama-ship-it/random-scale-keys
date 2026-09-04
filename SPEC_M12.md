# M12 仕様 — メロディの重力（対位法ルール）／キーの選択／リズムの選択とドラムだけモード（app v0.13.0〜）

作成: 2026-09-04 Claude（設計）。実装: Codex（3部に分けて順に）。検証: Claude → 本人（耳）。

本人要望（2026-09-04）: 「7のあとに4が来ることはメロディ上ほぼない。こういうものを排除して、人間が気持ちいいと思うメロディが自然にできるようにしたい」
「ドラムだけの音源で、ディスコ風・ドラムンベース・ポップスなどをいくつか」「キーも選べたり、ランダムにできるようにしたい」。
本人選択: メロディの重力は **中（対位法の定番ルール）**／ドラムは **アプリ内の「リズム」選択＋「ドラムだけ」モード**、**後日本人が自作した音源も追加する**／
キーは **12キーから選ぶ＋「ランダム」**。

実装順: **C（§1 メロディの重力）→ A（§2 キー）→ B（§3 リズム）**。各部で版を上げる（v0.13.0 / v0.14.0 / v0.15.0）。

## 0. 設計の核（3部共通）

- 正本はイベントログ。各部の設定と結果はログに記録し、再生・WAV・ステム・MIDI が同じ音になる。
- 既定（メロディの重力は **OFF にすれば**前版と同じ。キーは世界の既定・リズム「gravity」）で演奏した音は前版と同じ。重力 ON（既定）は差し替えが起きた打鍵だけ実音が変わる。
- 伴奏の和音規則（M7〜M8）は変えない。

---

## 1. 部C — メロディの重力（`prototype/gravity.mjs` に純粋関数、`app/main.js` の `playCode` で適用）

### 1.1 考え方

キー配置はランダムのまま、**押した鍵の音を直前の音との関係で「隣の音階音まで」差し替える**。差し替えた結果を press イベントの
`degree`／`midi`／`role` に記録する（再生・レンダーは変更不要）。押した鍵の元の音は `keyDegree`／`keyMidi` に残し、差し替えたら `bent: true`。

### 1.2 `melodicGravity(context, pressed, scaleId)` → `{ degree, octave, midi, bent, rule }`

- `context = { previous: { midi, degree } | null, beforePrevious: { midi, degree } | null }`（直前と、その前の**演奏された**リード音。応答音・SFXは含めない）
- `pressed = { degree, octave, midi }`（鍵の割当）
- 音階は `getScale(scaleId)`（リード音階）。「1音階音動かす」= 度数 ±1（N で折り返し、オクターブを繰り上げ／繰り下げ）。
- ルール1 は前処理。ルール2〜4 は上から順に判定し、**最初に該当したルールで確定**（複数は重ねない）。`previous` が無ければそのまま。

| 順 | ルール | 条件 | 差し替え |
|---|---|---|---|
| 1 | オクターブ折返し（**前処理**） | `|pressed.midi − previous.midi| > 12` | 度数はそのまま、オクターブを previous に近い側へ 1 つ寄せる。**折り返した音に対してルール2〜4を続けて判定**し、どれも該当しなければ `rule: "fold"`（2026-09-04 訂正: 折返しで確定すると三全音が残ったため） |
| 2 | 三全音の禁止 | 折返し後の半音差の絶対値が **6**（増四度／減五度） | pressed を **1 音階音下げる**。下げた結果も 6 なら上げる（`rule: "tritone"`。2026-09-04 訂正: 当初「previous に近づく方向」と書いたが具体例と矛盾していたため、実装どおり「下げる→駄目なら上げる」に統一） |
| 3 | 導音の解決 | previous の度数が**主音の半音下（インターバル 11）**で、pressed への半音差の絶対値が **6 以上**、かつ pressed が主音（度数1）でない | previous のすぐ上の主音（度数 1、`previous.midi + 1`）にする（`rule: "leading"`） |
| 4 | 大跳躍の後の順次進行 | `beforePrevious` があり、`previous − beforePrevious` の半音差が **7 以上**（跳躍）で、pressed が**同じ方向へさらに 3 半音以上**動く | previous から**逆方向へ 1 音階音**（`rule: "recover"`） |

- 該当なしなら `bent: false, rule: null`。
- 音階に「インターバル 11」が無い音階（ミクソリディアン・五音階など）ではルール 3 は発生しない。
- 参考: ionian で B(7)→F(4) は 6 半音 → ルール 2 で F を E(3) に。F(4)→B(7) も 6 → B を A(6) に（1 音階音下げる）。
  B(7)→D(2 下、9 半音下）はルール 3 → C(1) に。C→G（7 上）→ 次に B（4 上）はルール 4 → G の下の F… ではなく **逆方向へ 1 音階音** = F(4)。

### 1.3 `app/main.js`

- 設定行に **メロディの重力**（`#melody`）: `on`（既定）／`off`。idle／finished で有効。`takeLog.melody = "gravity" | "off"` を記録。
- `playCode` で、`assignment` から `pressed` を作り、`melody === "gravity"` なら `melodicGravity` を通す。`degree`／`midi`／`octave` は結果の値を使い、
  **役割（role）と T の更新は結果の度数の役割**（`roleForDegree`）で行う。効果（delay 等）は鍵の割当のまま。arpeggio は結果の度数から積む。
- press イベントに `keyDegree`／`keyMidi`（鍵の元の値）と `bent`／`rule`（差し替え時のみ）を追加。`validateTakeLog` はこれらを任意項目として受理。
- 直前の演奏音の記憶（`previous`／`beforePrevious`）は press だけを対象にし、テイク開始でリセット。
- 表示: 差し替えが起きたら、既存の応答表示（`showAnswer` と同じ場所）に `→ 3` のように**鳴った度数**を短く出す（`--fs-small`）。
- Motion Scene（ジャグリング）の変換にも同じ規則を適用する（`app/scene-map.mjs` の press 生成で `melodicGravity` を通し、`melody` を記録）。
  scene fixture のテストは期待値を更新する（削除しない）。

### 1.4 テスト（`prototype/tests/gravity.test.mjs`、`app/tests/`）

1. ionian: 7→4（B4→F4: 71→65）は E（度数3、64）に、4→7（F4→B4: 65→71）は A（度数6、69）に、`rule: "tritone"`
2. ionian: 7（71）→2（62、9 半音下）は C5（72、度数1）に `rule: "leading"`。7→1 はそのまま。7→5（67、4 半音下）はそのまま
3. ionian: C4→G4（7 上）の後に B4（さらに 4 上）は F4（65、度数4）に `rule: "recover"`。C4→G4 の後に A4（2 上）はそのまま
4. 折返し: previous 60、pressed 76（16 上）→ 64（同じ度数、1 オクターブ下）`rule: "fold"`
5. `previous` 無し → そのまま。ミクソリディアンでルール 3 が起きない
6. `melody: "off"` のログでは差し替えが起きない（main.js の分岐の純粋部分をテスト）
7. render.test: `bent` 付きイベントも従来どおり `midi` で鳴る

### 1.5 版

- v0.13.0。README に「メロディの重力（中）」の4ルールと OFF の方法、`keyDegree`／`bent` の意味。

---

## 2. 部A — キー（ルート音）の選択（v0.14.0）

### 2.1 定義（`prototype/gravity.mjs`）

- `export const KEY_NAMES = ["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"]`（ピッチクラス 0..11）。
- `export function resolveRootMidi(worldId, keyChoice, seed)`:
  `keyChoice` は `0..11` の整数、または `"random"`／`undefined`。`"random"` は `hashSeed(seed) % 12`。`undefined` は世界の既定ピッチクラス
  （daylight = 0 (C)、night = 9 (A)）。戻り値は **世界の基準（daylight 60 / night 57）に最も近いオクターブ**の MIDI:
  `base + (((pc − base % 12) + 18) % 12) − 6`（daylight: 54〜65、night: 51〜62）。
- `createLayout(seed, worldId, scaleId, keyChoice)` → `layout.rootMidi` と `layout.key`（ピッチクラス）を持つ。`midiForDegree` は `rootMidi` を引数に取る形に
  **変更せず**、新しく `midiForDegreeFromRoot(rootMidi, scaleId, degree, octave)` を追加して `createLayout` はそれを使う。

### 2.2 `rootMidi` の伝搬（`world.rootMidi` の参照 29 か所を置き換える）

- ログに `rootMidi` と `key` を記録。**`world.rootMidi` を読んでいる箇所はすべて `log.rootMidi ?? getWorld(worldId).rootMidi`（レンダー）／
  `layout.rootMidi`（ライブ）に置き換える**: `prototype/render.js`（tonicPitchClass・resolution・七度・経過音）、`app/main.js`（同）、
  `prototype/synth.js`（`createSynth` に `rootMidi` オプションを追加。tapestop・ending が使う）、`app/midi.js`（`createMidiRecorder` に `rootMidi`）、
  `app/scene-map.mjs`、`app/stems.js`（synth 生成時に渡す）。
- `chordMidiNotes(worldId, scaleId, chordName, octave)`／`chordRootMidi` は `rootMidi` を受け取る版 `chordMidiNotesFromRoot(rootMidi, …)`／
  `chordRootMidiFromRoot(rootMidi, …)` を追加し、呼び出し側を置き換える（旧関数は prototype/app.js 互換のため残す）。
- 古いログ（`rootMidi` 無し）は世界の既定で鳴る（音は不変）。

### 2.3 UI

- 設定行に **キー**（`#key`）select: `ランダム` ＋ C〜B の 12 個。既定は `ランダム`… ではなく **世界の既定（daylight=C／night=A）**。
  `ランダム` を選ぶと振り直し（seed 変更）ごとにキーが変わる。上帯の状態行に `キー C` を表示。URL パラメータ `key`（0..11 または random）。
- 世界を変えたら既定に戻す。

### 2.4 テスト

`resolveRootMidi` の 12 キー×2 世界の範囲、random の決定論、既定の不変（daylight→60、night→57）。同じ seed・既定キーの `createLayout` が旧版と同一の midi。
render.test で `rootMidi` 付きログの tonicPitchClass が変わること。

---

## 3. 部B — リズムの選択とドラムだけモード（v0.15.0）

### 3.1 リズム定義（`prototype/rhythms.mjs` 新設。**データ駆動**。後日、本人の自作音源を差し込める構造）

```js
export const RHYTHMS = Object.freeze({
  gravity: { label: "重力（現行）", bpm: null /* 世界の既定 */, source: "rules" },   // 現行の kickForStep/snareForStep/hatForStep をそのまま使う
  disco:   { label: "ディスコ", bpm: 118, source: "pattern", swing: 0, pattern: { … } },
  dnb:     { label: "ドラムンベース", bpm: 172, source: "pattern", swing: 0, pattern: { … } },
  pops:    { label: "ポップス", bpm: 100, source: "pattern", swing: 0, pattern: { … } },
  hiphop:  { label: "ヒップホップ", bpm: 90, source: "pattern", swing: 0.12, pattern: { … } },
});
```

`pattern` は 1小節16分×16 の配列を **セクション別**（`intro` / `a` / `b` / `outro`）に持つ:
`{ kick: number[16], snare: number[16], hatClosed: number[16], hatOpen: number[16] }`（値は velocity 0〜1、0 は休み）。
`intro`／`outro` は疎に（例: ハット無し、キックのみ）。終止小節のピックアップ・到達小節のオープンハット（M8）は**全リズム共通で上書き**。
緊張度 T によるハットの密度変化は pattern リズムでは **T ≥ 0.6 でオープンハットを step 4/12 に追加**するだけに簡略化する。

型（16分の index、velocity）:
- **disco**: kick 0,4,8,12 (1.0)／snare 4,12 (0.9)／hatOpen 2,6,10,14 (0.7)／hatClosed 0,4,8,12 (0.5)。b では hatClosed を全 8 分に。
- **dnb**: kick 0,10 (1.0)／snare 4,12 (1.0) ＋ ghost 7,15 (0.35)／hatClosed 全 8 分 (0.5)、b は 16 分 (0.4)。
- **pops**: kick 0,6,8 (0.9)／snare 4,12 (0.9)／hatClosed 全 8 分 (0.55)。
- **hiphop**: kick 0,7,10 (1.0)／snare 4,12 (0.95)／hatClosed 全 8 分 (0.5) with swing 0.12（奇数 16 分を `beatSec/4 × swing` 遅らせる）。

- **将来の自作音源**: `source: "loop"` を予約（`{ url, bars, bpm, gain }`。1〜2小節の WAV を bpm に合わせて 16 小節ループ）。**今回は実装しない**が、
  `RHYTHMS` の読み手（`drumStepsForBar` の呼び出し側）が `source` で分岐できる形にしておく。README に「自作音源の追加方法（予定）」を書く。

### 3.2 `drumHitsForStep(rhythmId, section, stepInBar, tension)` → `[{ type: "kick"|"snare"|"hatClosed"|"hatOpen", velocity }]`

- `gravity` は現行関数（`kickForStep`／`snareForStep`／`hatForStep`）を包む。pattern リズムは §3.1 の表から。
- `app/main.js`・`prototype/render.js` のドラム予約をこの関数経由に統一（M8 のピックアップ・オープンハットはその後に上書き）。
- `synth.scheduleKick(when, velocity)`／`scheduleHat(when, open, velocity)` に velocity 引数を追加（既存呼び出しは 1）。MIDI も velocity を反映。
- **BPM**: リズムの `bpm` が null でなければテイクの bpm はそれ（世界の bpm を上書き）。ログの `bpm` に記録済みなので再生側は変更不要。
  16小節は変えない（dnb は約 22 秒、hiphop は約 43 秒）。

### 3.3 ドラムだけモード

- 設定 **伴奏**（`#accompaniment`）: `フル`（既定）／`ドラムだけ`。`takeLog.accompaniment = "full" | "drums"`。
- `drums` のときパッドとベースを**予約しない**（和音の選択・応答音・着地の表示・自動SFXは従来どおり動く。終止のスネアピックアップ等も動く）。
  `scheduleEnding` はドラムだけモードではベース／パッドを鳴らさず、キックだけ（`synth.scheduleEnding(when, { drumsOnly: true })`）。
- ステム: accomp ステムにドラムと自動SFXだけ入る。MIDI: pad／bass トラックが空。

### 3.4 UI・記録

- 設定行に **リズム**（`#rhythm`）と **伴奏**（`#accompaniment`）。`takeLog.rhythm`。上帯に BPM を表示（`♩=118`）。
- 古いログ（`rhythm` 無し）は `gravity`／`full`。
- 版 v0.15.0、`engine: "accomp-v5"`。README にリズム表・BPM・ドラムだけモード・自作音源の予定。

### 3.5 テスト

`RHYTHMS` の全リズムで 4 セクション×16 ステップの配列長、velocity 0〜1／`drumHitsForStep("gravity", …)` が現行関数と一致／
disco の kick が 4 つ打ち、dnb の snare が 4・12／render.test: `accompaniment: "drums"` で pad・bass の予約が 0、ending がキックだけ／
bpm がリズムで決まる（main.js の純粋部分）。

---

## 4. 完了条件（各部）

- テスト全通過、`node --check`、**ブラウザ console error 0**、版表示
- Claude 実測: C＝合成ログで差し替え率と規則別件数を出し、7→4 が 0 件になること／A＝キー D のログで tonicPitchClass が 2、ミックスが例外なし／
  B＝5 リズム×2 世界でレンダー例外なし、ドラムだけモードの accomp ステムに 100Hz 以下のベース成分が無い（低域 RMS が full の 1/3 以下）、
  決定論 ±2LSB（複数×3回）
- 音の良し悪し（差し替えの違和感、各リズムの質感、BPM）は本人判定
