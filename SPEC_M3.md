# M3 仕様 — 待機画面の地形・再生・JSON読み込み・同時押し診断（app v0.5.0）

作成: 2026-09-04 Claude（設計）。実装: Codex。検証: Claude → 本人。
本人決定（2026-09-04）: 等高線の地形＋中央寄せ／完了パネルに「再生」／JSON読み込みで再生・書き出し／同時押し診断。
前提: M2通過（v0.4.0）。数値の正は `design/TOKEN_SHEET.md`（等高線用トークンを追記済み）。

## 0. 原則

- 音のスケジュール経路は `prototype/render.js` の `scheduleRecordedTake` ただ一つ（再生も同じ）。prototype/・design/・ルート index.html は触らない。
- 依存ゼロ・ビルドなし・相対パス。文言は具体的に。版表示 v0.5.0。

## 1. 待機画面: 等高線の地形（`app/terrain.js` に追加、純粋計算は `app/ui-core.mjs`）

「地形図」の比喩を待機時から見せる。**配置そのものを地形にする**（見た目のための模様ではない）。

- 標高場: 各キータイル中心 (x_i, y_i) を源とし、役割で標高 `roleElevation(role)`: tension **+1.0**（尾根）／floating **+0.3**／stable **−0.6**（谷）。
  `fieldAt(x, y) = Σ_i elevation_i · exp(−d_i² / (2σ²))`、σ = 1.2 × `--key-size`。
- 等高線: レベル −0.6, −0.4, −0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0。マーチングスクエア（格子 8px）で線分を求め、キャンバス全面（上帯の下からキーボードの下端まで）に描く。
  線色は `--text`、不透明度 `--contour-alpha`（0.10）、太さ `--contour-width`（1px）。レベル ≥ 0.6 の線だけ `--ink-tension` で `--contour-alpha-ridge`（0.16）。
- 計算は配置変更・世界変更・リサイズ時のみ（オフスクリーンキャンバスにキャッシュし、毎フレームは転写だけ）。
- 演奏中も等高線は残す（背景のT追従色の上に重ねる）。着地ブルームは等高線の上。reduced-motion では静止画のまま（元から動かない）。
- 純粋関数（テスト対象）: `roleElevation(role)`、`fieldAt(x, y, sources, sigma)`、`marchingSquares(grid, cols, rows, level, cellSize)` → 線分配列。

## 2. 中央寄せ

- フォーム行・キーボード地形・凡例を、コンテナ（最大幅 `--layout-max` 1200px）の**中央**に置く。上帯はそのまま。
- 完了パネルが出るときは、キーボード＋パネルの合計幅を中央に（幅<900pxでは縦積み、従来どおり）。

## 3. 完了パネルの「再生」

```
テイク完了 38.4秒・16小節・打鍵 142
[再生] [WAVを書き出す] [ステム3本を書き出す] [MIDIを書き出す] [JSONを書き出す]
```
- 「再生」→ 状態 `replay`。上帯「再生中 n/16小節」、主ボタン「停止 (Enter)」。オンラインの AudioContext で `scheduleRecordedTake(context, synth, log, start)` を呼ぶ
  （prototype の再演と同じ）。**再生中はログの打鍵時刻に合わせてタイルの押下表示と打鍵の円を出す**（見た目も再現）。応答音・着地・Tの表示も同じ。
- 終了（尺経過 or Enter）→ `finished` に戻る。再生中は書き出しボタンを disabled。
- 状態機械（ui-core.mjs）に `replay` を追加: finished→(REPLAY)→replay→(REPLAY_END|STOP)→finished。他からの REPLAY は不変。

## 4. JSON読み込み（待機画面）

- 待機画面のフォーム行に「JSONを読み込む」（`<input type="file" accept="application/json,.json">` をボタン風に）。
- 検証 `validateTakeLog(obj)`（純粋関数、テスト対象）: `version === "gravity-v0"`、`worldId ∈ {daylight, night}`、`seed` 数値、`bpm` 数値、`bars` 整数、
  `events` 配列で各要素に `time, beat, kind, midi, degree, role, velocity, length` がある、`quantize` オブジェクト。失敗時は `{ ok:false, reason }`。
- 成功: 世界・seed・配置をログから復元（`createLayout(seed, worldId)`）、`takeLog` に設定し **状態 `finished`** に。完了パネルに「読み込んだテイク: <ファイル名>」を1行。
  失敗: フォーム行の下に「読み込めませんでした（理由）」。
- **幅<600px**: 「PCで開いてください」の案内は残しつつ、「JSONを読み込む」と完了パネルの「再生／書き出し」は使えるようにする（演奏開始だけ無効）。
  読み込んだテイクの再生ではキーボード地形を出さず、キャンバスの等高線と上帯だけ。

## 5. 同時押し診断（待機画面）

- フォーム行の右端に小さなテキストボタン「同時押しを診断」。押すとキーボード地形の上に1行のパネル:
  「3秒のあいだ、押せるだけ同時にキーを押してください」→ 押下中（keydown で追加、keyup で削除）の物理キー数の**最大値**を計測。
  3秒後に「同時に n キーまで届きました（最大 <キー名の並び>）」。「閉じる」で消す。
- 計測中は A〜Z の発音をしない（状態は idle のまま、フラグで抑止）。純粋関数 `pressTracker()`（add/remove/max）をテスト対象に。
- 保存しない。診断結果は README の注意書き（「同時押しの上限はキーボード機種に依存」）へのリンクだけ添える。

## 6. テスト（`node --test app/tests/`）

1. `roleElevation`: tension 1.0 / floating 0.3 / stable −0.6、未知は 0
2. `fieldAt`: 源1つの中心で elevation と一致、σ の距離で e^(−0.5) 倍
3. `marchingSquares`: 2×2 格子で片側だけ高い場合に線分が1本、全て同じ値なら 0 本
4. `transition`: finished→REPLAY→replay→REPLAY_END→finished、idle→REPLAY は不変
5. `validateTakeLog`: 正常ログ ok、version 違い・events 欠落・world 未知で reason 付き失敗
6. `pressTracker`: add a,b,c → max 3、remove b → 現在2、max 3 のまま
7. 既存テスト（app 10・prototype 15）不変

## 7. 完了条件

- テスト全通過、`node --check` 全JS。design-lint NG 0（Claude実行）。
- ブラウザ: 待機画面に等高線が出る（配置を振り直すと変わる）／中央寄せ／再生で上帯が「再生中」になりタイルが光る／JSON読み込みで完了パネルが出る／
  診断で最大同時押し数が表示される（Claudeのブラウザでは物理キーが届かないので、ここは本人確認）
- 実機未確認の項目は明記
