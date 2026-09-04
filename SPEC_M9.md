# M9 仕様 — 1キーでフレーズが出る効果「arpeggio」（app v0.10.0）

作成: 2026-09-04 Claude（設計）。実装: Codex。検証: Claude → 本人（耳）。

本人のアイデア（2026-09-04）: 「キーがたくさんあるので、1つのキーから出る音をフレーズにしてしまう。
例えば3連符で1度・3度・5度を入れる」。

## 0. 設計の核

- 既存の効果（delay／sweep／octave／stutter）と**同じ仕組み**で新効果 `arpeggio` を足す。イベントログの形式は変えない
  （press イベントの `effect: "arpeggio"` だけで、再生・WAV・ステム・MIDI が同じフレーズを再現する）。
- フレーズは**押した度数を起点に、リード音階上の 1度・3度・5度（度数 d, d+2, d+4）を上行**する。音階の音しか出ないので、
  重力（役割・T）の規則はそのまま。緊張度の更新は押した1音ぶんだけ（フレーズの2音目以降は T を動かさない）。
- タイミングは **1拍を3等分した3連符**（`when`, `when + beatSec/3`, `when + 2·beatSec/3`）。クオンタイズは1音目に掛かる（現行どおり）。

## 1. `prototype/gravity.mjs`

- `EFFECT_COUNTS = { none: 11, delay: 4, sweep: 3, octave: 3, stutter: 2, arpeggio: 3 }`（合計 26 は不変）。
  役割のシャッフル→効果のシャッフル→オクターブの順は変えない（同じ seed で度数・役割・オクターブは不変、効果の割当だけ変わる）。
- `export function arpeggioOffsets(scaleId, degree)` → `[0, o3, o5]`（半音）。`o3` は度数 d+2、`o5` は d+4 の音を、
  音階の長さ N で折り返しつつオクターブを足して求める:
  `offset(k) = intervals[(d-1+k) % N] + 12·floor((d-1+k)/N) − intervals[d-1]`（k = 2, 4）。
  例: ionian d=1 → [0,4,7]、d=5 → [0,4,7]（G-B-D）、d=7 → [0,3,6]（B-D-F）。major_pentatonic d=1 → [0,4,9]（C-E-A）、d=5 → [0,5,10]（A-D-G）。
  （2026-09-04 訂正: 当初 §5 に A-C-E と書いていたが式のとおり A-D-G が正しい。Codex が式を優先して実装）
- `export const ARPEGGIO_GAINS = Object.freeze([1, 0.85, 0.75])`。

## 2. `prototype/synth.js` `scheduleLead`

- `scheduleSingle(time, gainScale = 1, midiOffset = 0)` に第3引数を足し、内部の `note.midi` 参照をすべて `note.midi + midiOffset` にする
  （octave の +12 も同様に `note.midi + midiOffset + 12`）。
- `effect === "arpeggio"` のとき: `note.degree` が整数なら `arpeggioOffsets(scaleId, note.degree)` を使い、
  `ARPEGGIO_GAINS[i]` と `when + i·beatSec/3` で3音を予約する。各音の長さは **`Math.max(0.12, beatSec/3 × 0.9)`**（引数の `length` は使わない）。
  `note.degree` が無ければ単音（現行どおり）。
- stutter・delay・sweep・octave の挙動は不変。

## 3. `app/midi.js` `scheduleLead`

- `effect === "arpeggio"` のとき、同じ3時刻・同じ半音オフセット・同じ長さ規則で lead トラックに3音を書く。velocity は `velocity × ARPEGGIO_GAINS[i]`。
  `source.degree` が無ければ単音。

## 4. UI・記録

- `app/main.js` `EFFECT_LABELS` に `arpeggio: "arp"`。`app/index.html` の凡例を `効果: dly / swp / oct / stt / arp / —` に。
- 効果名のホワイトリスト（`app/ui-core.mjs` や `normalizeLoadedLog` などに効果名の検証があれば）に `arpeggio` を追加。
- README: 効果の一覧に arpeggio（押した度数から音階上の1・3・5度を3連符で上行）、同じ seed でも効果の割当が v0.9.0 と変わること（度数・役割・オクターブは同じ）。
- 版表示 **v0.10.0**（`app/index.html` の title と .version、対応するテスト）。ログの `engine` は `accomp-v3` のまま（伴奏は変えない）。

## 5. テスト

1. `EFFECT_COUNTS` の合計 26、`createLayout` の効果数が {11,4,3,3,2,3}。同じ seed の度数・役割・オクターブが v0.9.0 の値と一致することを
   **固定 seed の期待値**（テスト内に v0.9.0 で計算した値を埋め込む。Codex が実装前に `createLayout(42, "daylight")` の degree/role/octave を控えておく）で確認
2. `arpeggioOffsets`: ionian 1→[0,4,7]、5→[0,4,7]、7→[0,3,6]、major_pentatonic 1→[0,4,9]、5（A）→[0,5,10]（A-D-G。音階上の d+2, d+4 を折り返すため）、
   範囲外の degree は RangeError
3. midi recorder: `scheduleLead({ midi: 60, degree: 1 }, 0, 0.3, 0.8, "arpeggio")` で lead に 3 音（60, 64, 67）、時刻 0／beatSec/3／2·beatSec/3、
   velocity が 1／0.85／0.75 倍
4. synth: 既存の記録シンセ（render.test）で arpeggio の press が 1 回の `scheduleLead` 呼び出しになること（フレーズ展開は synth 内部）

## 6. 完了条件

- テスト全通過、`node --check`、**ブラウザ console error 0**、v0.10.0 表示、凡例に arp、タイルに `arp` が 3 枚
- ミックスWAV: arpeggio を含む合成ログのレンダーが例外なく通り、arpeggio の press 1つが lead ステムで 3 音（時間差 beatSec/3）として出る
- 音の良し悪し（3連符の速さ・音量の減衰・3キーという数）は本人判定
