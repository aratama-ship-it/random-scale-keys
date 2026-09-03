# M1 仕様 — キーボード地形図UI＋4状態（app v0.3.0）

作成: 2026-09-04 Claude（設計）。実装: Codex。検証: Claude（テスト・design-lint・実機プレビュー）→ 本人確認。
前提: `design/TOKEN_SHEET.md`（**数値の正**。ここに無い値をコードに書かない）、`design/IMPLEMENTATION_PLAN_2026-09-03.html` §画面構成。
本人決定（2026-09-04）: M1着手／置き場はこのまま／世界は2つ（daylight・night）。

## 0. 置き場と再利用

- 新規フォルダ `app/`（プロジェクト直下）。**prototype/ のファイルは編集・移動・複製しない**。
  `app/main.js` から `../prototype/gravity.mjs` `../prototype/synth.js` `../prototype/render.js` を import して再利用する。
  prototype 側で足りない振る舞いは app 側に書く（prototype を触らない）。
- ルートの `index.html`（prototype への転送）は **そのまま**。M1通過後に本人判断で app へ切り替える。
- 依存ゼロ・ビルドなし・Webフォント読込なし。GitHub Pages（サブパス配信）で動くよう相対パスのみ。

| ファイル | 役割 |
|---|---|
| `app/index.html` | 4状態を持つ単一画面。左上に `random-scale-keys v0.3.0` |
| `app/style.css` | `:root` にトークンシート §6 の値を**そのまま転記**。`[data-world="night"]` で上書き。マジックナンバー禁止 |
| `app/main.js` | 状態機械・キー入力・スケジューリング（prototype/app.js の演奏ロジックを app 用に再実装。関数は再利用できるものを import） |
| `app/terrain.js` | Canvas 2D の地形描画（背景T追従・着地ブルーム・打鍵図形）。DOMのキータイルは index.html/main.js 側 |
| `app/ui-core.mjs` | **純粋関数**: 色の線形補間、状態遷移、URLパラメータの parse/format、行オフセット計算。DOM/AudioContext禁止 |
| `app/tests/ui-core.test.mjs` | `node --test app/tests/` |

## 1. 画面の3層（デスクトップ 1440×900 基準、コンテナ最大幅 1200px）

1. **上帯 56px**: 左＝版表示（`--fs-small` mono）／中＝「世界 daylight ／ seed 8f3a21 ／ 演奏中 6/16小節」（`--fs-h1` は状態語だけ600）／右＝主ボタン1つ（状態で入替）
2. **地形キャンバス（残り全部）**: `<canvas>` を全面に敷く。背景色は `lerp(--bg, --bg-tense, T)` を `--duration-tense`(600ms) で追従。
   上端に **緊張度バー**（高さ6px、fill `--ink-tension`、幅=T）と右上に**和音名**（`--fs-h1` 600）。
3. **キーボード地形（下部）**: 物理配列3段（QWERTYUIOP／ASDFGHJKL／ZXCVBNM）。タイル `--key-size`（64px、幅<900pxで52px）、ギャップ `--key-gap`。
   段オフセット 0／16px／40px。各タイル: 度数（`--fs-key` mono 600）、下に役割記号＋効果略号（`--fs-key-sub` mono）。
   背景＝役割タイル色（`--role-*`）、文字＝`--text`。**色だけに頼らない**: 記号 ●安定 ◐浮遊 ▲緊張。効果略号 dly／swp／oct／stt／—。
   凡例1行（`--fs-small`、`--text-sub`）をキーボード直下に。

完了時のみ右側に **完了パネル 360px**（幅<900pxでは下に積む）。

## 2. 4状態（`ui-core.mjs` の状態機械 `transition(state, event)`）

| 状態 | 表示 | 主ボタン | 入力 |
|---|---|---|---|
| `idle` | 世界（A/B）・クオンタイズ（OFF/4分/8分/16分、既定8分）・seed＋「振り直し」。タイルは配置を表示 | **演奏開始** | フォーム操作のみ。A〜Zは無視 |
| `countin` | 上帯「カウントイン」。地形中央に拍の数字 4→3→2→1（`--fs-key`×3 相当の大きさ。トークンに無いので `--fs-countin: 84px` を**シートに追記してから**使う） | 停止 (Enter) | A〜Zは無視（prototypeと同じ） |
| `playing` | 上帯「演奏中 n/16小節」。T・和音・打鍵の図形 | 停止 (Enter) | A〜Z＝発音（`event.code`、`repeat`無視）。タイルの pointerdown でも発音（マウス／タッチの代替） |
| `finished` | 完了パネル | もう1テイク | パネルのボタン |

- 遷移: idle→(演奏開始)→countin→(1小節経過)→playing→(16小節経過 or Enter)→finished→(同じ配置でもう1テイク)→countin／(配置を振り直す)→idle
- 「演奏開始」で AudioContext を生成・resume（初回発音にユーザー操作が必要）。
- `playing` 中はフォーム（select/input）を disabled にし、**フォーカスを body へ戻す**（seed欄に文字が入らないように）。
- キー入力は `document.activeElement` が input/select/textarea のとき無視する。

## 3. 演奏ロジック（prototype/app.js と同じ規則。差分なし）

- クオンタイズ・T・和音・応答音・伴奏・終止・イベントログ（`gravity-v0` 形式＋`quantize`）は prototype v0.2.1 と同一挙動。
  `scheduleRecordedTake` / `renderTakeToWav` / `createSynth` / `createLayout` / `quantize` / `updateTension` 等を import。
- seed は URL の `?world=daylight&seed=xxxx` を初期値にし、「振り直し」で URL を `history.replaceState` で更新（共有リンク）。
  seedは prototype と同じ hashSeed 互換（数値または文字列）。

## 4. 地形の動き（`terrain.js`）

| 出来事 | 描画 | reduced-motion時 |
|---|---|---|
| Tの変化 | 背景色を 600ms で補間。緊張度バー幅を同期 | 色は段階変化（補間なし）。バーは即時 |
| 打鍵 | タイル: 1.5px枠＋2px下方シフト 80ms。キャンバス: タイル中心から円が上昇（半径 8→40px、不透明度 1→0、700ms、色＝役割の `--ink-*`） | 円は出さない。タイルの枠のみ |
| 応答音 | タイル無し。キャンバス下端中央から小さな円（半径 6→24px、`--ink-stable`）。キーボード直下に「応答: 度数n」を1秒 | 文字のみ |
| 着地 | 背景の明度を一瞬上げて戻す（`--duration-bloom` 900ms、最大で白 12% の重ね）。和音名を `--ink-stable` で強調 1拍 | 和音名の強調のみ |
| セクション | 上帯の小節表示の横に intro／a／b／outro を `--text-sub` で | 同じ |
| 終止 | 背景を `--bg` へ 1.5s で戻す | 即時 |

- 描画は `requestAnimationFrame`。`document.hidden` のときは描画停止（音は継続）。
- Canvas は `devicePixelRatio` 対応。リサイズで再計算。

## 5. 完了パネル（文言はこのまま。詩的な語を足さない）

```
テイク完了 38.4秒・16小節・打鍵 142
[WAVを書き出す] [JSONを書き出す]
[同じ配置でもう1テイク] [配置を振り直す]
共有リンク: ?world=daylight&seed=8f3a21（配置だけを共有。テイクはWAV/JSONで）
```
- WAV/JSON は prototype/render.js の `downloadTakeWav` / `downloadTakeJson` を使う（JIT版。所要時間の目安「約4秒」をボタン横に）。
- ステム・MIDIは M2（ボタンを置かない）。

## 6. レスポンシブ・アクセシビリティ

- ブレークポイント 900px（タイル52px）／600px。**幅<600px**: キーボード地形の代わりに「このアプリは物理キーボードで演奏します。PCで開いてください」を表示し、演奏開始を無効化（再生・書き出し機能はM3）。
- 文字と背景は トークンシート の実測値のみ（本文4.5:1↑）。`--text-sub` は T≥0.5 で `--text` に切替（シート §1 の注記）。
- アイコンのみのボタンは作らない（全ボタンにテキスト）。フォーカスリングを消さない。`prefers-reduced-motion` は §4 のとおり。
- 純黒・純白を使わない（シートの値だけ）。

## 7. テスト（`node --test app/tests/`）

1. `lerpColor('#F3EFE6','#EAD9CC',0)` / `(…,1)` / `(…,0.5)` の HEX
2. `transition`: idle→countin→playing→finished→countin／finished→idle、不正遷移は状態不変
3. `parseParams('?world=night&seed=abc')` と `formatParams({world,seed})` の往復、未知の世界は daylight にフォールバック
4. `rowOffsetPx(rowIndex, keySize)`: 64px で 0/16/40、52px では比率維持（0/13/32.5 → 四捨五入 0/13/33）

## 8. 完了条件

- `node --test app/tests/` 全通過、`node --check` 全JS
- `python3 -m http.server 8962` でプロジェクト直下を配信し `http://127.0.0.1:8962/app/` が表示できる（Codexが確認できなければ「実機未確認」と明記）
- 左上に v0.3.0。console error 0。style.css の値がトークンシートと一致（Claudeが design-lint と目視で監査）
- 「これは別のAI生成サービスにもそのまま使える見た目ではないか」に対し、地形図・役割記号・T背景・応答表示の4点で固有性が画面に出ていること
