# M16 仕様 — 記号キーまで使う（JIS/US共通の物理キー拡張）（app v0.20.0）

作成: 2026-09-05 Claude（設計）。実装: Codex。検証: Claude → 本人（目・音）。

本人要望（2026-09-05）: 「JISやUSでもキーボードは横に長いので、全部使えるようにしましょう記号まで」。
確認の結果（本人選択）: **記号キーもA〜Zと同じ音階音キーにする**（他用途にしない）／**新しい記号キーもホーム段（効果なし）の対象に含める**。

## 0. 設計の核

- 追加するのは、`event.code`（KeyboardEvent の物理キー識別子。レイアウト非依存）で安定して取れる**8個の記号キー**。
  US/JIS の両方に物理的に存在する位置だけを選ぶ（IntlYen・IntlRo 等 JIS 専用キーは対象外。将来の拡張候補として README に残す）。
- 3段（QWERTYUIOP／ASDFGHJKL／ZXCVBNM）それぞれの**右端に追記**する。段の並び順・既存26キーの位置は変えない。

| 段 | 追加コード | 記号（表示・aria-label用） |
|---|---|---|
| 1段目（Q〜P の右） | `BracketLeft`, `BracketRight`, `Backslash` | `[` `]` `\` |
| 2段目＝ホーム段（A〜L の右） | `Semicolon`, `Quote` | `;` `'` |
| 3段目（Z〜M の右） | `Comma`, `Period`, `Slash` | `,` `.` `/` |

合計 **26 → 34 キー**。数字キー（SFX、Digit1〜0）は対象外（そのまま10キー、変更しない）。

## 1. `prototype/gravity.mjs` の変更

### 1.1 `KEY_ROWS` をコード配列の配列に作り替える

現行 `KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"]`（文字列。`Key+文字`前提）を、**コード文字列の配列の配列**に変える:

```js
export const KEY_ROWS = Object.freeze([
  Object.freeze([..."QWERTYUIOP"].map((l) => `Key${l}`).concat(["BracketLeft", "BracketRight", "Backslash"])),
  Object.freeze([..."ASDFGHJKL"].map((l) => `Key${l}`).concat(["Semicolon", "Quote"])),
  Object.freeze([..."ZXCVBNM"].map((l) => `Key${l}`).concat(["Comma", "Period", "Slash"])),
]);
```

`KEY_CODES` は `KEY_ROWS.flat()` から作る（現行の `Array.from({length:26}, ...)` を置き換え）。順序は行0→行1→行2、各行は左から右（既存26キーの並びと生成順は変えない。新しい8キーは各行の最後に追加される）。

### 1.2 `KEY_LABELS`（新設・表示/aria-label用）

```js
export const KEY_LABELS = Object.freeze(Object.fromEntries([
  ...KEY_CODES.filter((c) => c.startsWith("Key")).map((c) => [c, c.slice(3)]),
  ["BracketLeft", "["], ["BracketRight", "]"], ["Backslash", "\\"],
  ["Semicolon", ";"], ["Quote", "'"],
  ["Comma", ","], ["Period", "."], ["Slash", "/"],
]));
```

### 1.3 `SIMPLE_ROW_CODES`

`[...KEY_ROWS[SIMPLE_ROW_INDEX]]`（もう文字列ではなく配列なので `.map((letter) => ...)` の文字連結は不要。**配列の中身がそのままコード**）。
結果は11キー（`KeyA`〜`KeyL` の9 + `Semicolon`,`Quote`）。

### 1.4 `rowNeighbors(code)` の書き換え

現行は `code.startsWith("Key")` で文字を取り出し、行の中で文字として探している。**コードそのものを行の要素として探す**方式に変える:

```js
export function rowNeighbors(code) {
  const row = KEY_ROWS.find((candidate) => candidate.includes(code));
  if (!row) return [];
  const index = row.indexOf(code);
  return [row[index - 1], row[index + 1]].filter(Boolean);
}
```

### 1.5 `declumpAdjacentDegrees` の書き換え

現行の `adjacentPairs = KEY_ROWS.flatMap((row) => [...row].slice(0, -1).map((letter, index) => [\`Key${letter}\`, \`Key${row[index+1]}\`]))` を、
**行がすでにコード配列なので文字連結せず直接ペアを作る**方式に変える:

```js
const adjacentPairs = KEY_ROWS.flatMap((row) => row.slice(0, -1).map((code, index) => [code, row[index + 1]]));
```

それ以外のロジック（探索・交換の条件）は変更しない。

### 1.6 `EFFECT_COUNTS` の変更

合計を34に合わせる。**特殊効果（delay/sweep/octave/stutter/arpeggio）の枚数は変えず**、`none` だけ増やす:

```js
export const EFFECT_COUNTS = Object.freeze({ none: 19, delay: 4, sweep: 3, octave: 3, stutter: 2, arpeggio: 3 });
```
（合計 19+4+3+3+2+3 = 34。ホーム段11キーが強制 `none` になり、残り23キーのうち8キーが追加の `none`、15キーが特殊効果）

### 1.7 触らないもの

- `allocateKeys`、`balancedDegrees`、`degreeTargets`（M15）は `KEY_CODES.length` を参照しているだけなので**変更不要**（34に自動対応する）。
  M15 のとおり、7音階の目標配分は `base = floor(34/7)=4`、余り6 → 度数1〜6が+1、度数7を1に抑えた分（4-1=3）を度数1・2・3に再配分し、
  最終的に **`{1:6,2:6,3:6,4:5,5:5,6:5,7:1}`（合計34）**になる（Claude が実装後に実測して確認する）。
  五音・六音音階は `allocateKeys`/`balancedDegrees` が `KEY_CODES.length` ベースで自動的に34キー分へ比例配分する。
- `createLayout` 本体のロジック（度数プールのシャッフル→`roleForDegree`→効果・オクターブ）は変更不要。`KEY_CODES.forEach` が34件回るだけ。
- 和音・伴奏・メロディの重力・リズム・SFX・音色の規則は変更しない。

## 2. `app/main.js` の変更

### 2.1 キーボード描画（`renderLayout`）

現行:
```js
KEY_ROWS.forEach((letters, rowIndex) => {
  ...
  for (const letter of letters) {
    const code = `Key${letter}`;
    ...
    key.setAttribute("aria-label", `${letter}、度数${assignment.degree}、...`);
```
を、`KEY_ROWS` が既にコード配列であることに合わせて書き換える:
```js
KEY_ROWS.forEach((codes, rowIndex) => {
  ...
  for (const code of codes) {
    const assignment = layout.keys[code];
    ...
    key.setAttribute("aria-label", `${KEY_LABELS[code]}、度数${assignment.degree}、...`);
```
（`KEY_LABELS` を `prototype/gravity.mjs` から import する）

### 2.2 `updateContourGeometry` のフォールバック配置

同様に `[...letters].forEach((letter, columnIndex) => keyRects.set(\`Key${letter}\`, ...))` を
`codes.forEach((code, columnIndex) => keyRects.set(code, ...))` に変える（`KEY_ROWS[0].length` 等の行の長さ参照はそのまま動く）。

### 2.3 触らないもの

- `handleKeyDown`／`playCode`／keyup は `layout.keys[event.code]` で汎用的に引いているので**変更不要**（ブラウザが送る `event.code` が
  `Semicolon` 等になるだけで、既存コードがそのまま動く）。
- Shift 検出・長押し・SFX（数字キー）は無関係、変更不要。

## 3. CSS・レイアウト（`app/style.css`）

- 1段目が13キーになり横幅が伸びる。既存のブレークポイント（`--key-size` 縮小）で収まるはずだが、**Claude が実機で確認**し、
  1440px 幅で1段目がはみ出す場合だけ `--key-size` の縮小閾値を調整する（Codex は触らなくてよい。Claude が design-lint 相当で見る）。

## 4. 版・記録

- 版表示 **v0.20.0**（`app/index.html` の title と `.version`、対応するテスト）。`engine` は `accomp-v5` のまま。
- README: 追加した8キーの表（コード・記号・所属段）、ホーム段が11キーに拡張されたこと、IntlYen/IntlRo 等 JIS専用キーは
  今回未対応（将来拡張候補）であることを1行。

## 5. テスト（既存のうち 26 や 9 を固定値で書いているものは新しい値に更新。削除しない）

1. `KEY_CODES.length === 34`、`KEY_ROWS` の各行の長さが `[13, 11, 10]`。
2. `SIMPLE_ROW_CODES.length === 11`、内容が `KeyA`〜`KeyL` の9つ＋`Semicolon`,`Quote`。
3. `KEY_LABELS` が34件すべてに対応し、`Semicolon→";"` 等が正しい。
4. `rowNeighbors("BracketLeft")` が `["KeyP", "BracketRight"]`（またはそれに準ずる仕様どおりの隣接）。
5. 21音階×2世界×5 seed（`[1, 42, 777, 12345, 99999]`）で `createLayout` を呼び:
   - 全34キーに割当がある
   - `EFFECT_COUNTS` の内訳と一致
   - ホーム段11キーが全部 `none`
   - 7音階で度数配分が `{1:6,2:6,3:6,4:5,5:5,6:5,7:1}` と一致、度数7が1キー（`hijaz` は例外のまま）
   - 行内隣接の同度数が0件（M14 の declump が34キーでも機能すること）
   - 決定論（同じ seed で2回呼んで完全一致）
6. `app/tests/ui-core.test.mjs` の版表示テストを v0.20.0 に更新。

## 6. 完了条件

- テスト全通過、`node --check`、**ブラウザ console error 0**、v0.20.0 表示
- Claude 実測: 34キー化後の①度数配分が上記の目標と一致 ②隣接同度数0件 ③画面で1段目13キーが正しく表示され、
  新しい記号キーを実際に押して発音すること（`event.code` が正しく `layout.keys` に存在すること）
- 音の良し悪しは対象外（配置のみの変更。既存の音階・和音・伴奏・音色は不変）
