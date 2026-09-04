# M4 仕様 — ジャグリングのシーンを自動演奏する（app v0.6.0）

作成: 2026-09-04 Claude（設計）。実装: Codex。検証: Claude → 本人。
目的: **共通イベントコアがキーボード以外の入力源でも動くことの実証**。ジャグリング連動の最初の一歩。
前提: M3通過（v0.5.2）。ジャグリング側の編集UI・カメラ・解析はやらない。

## 0. 入力データ（実物を確認済み 2026-09-04）

`apps/utility-app/juggling-coordinate-generator/examples/three-ball-cascade-structural-fixture.json`

- `format: "juggling-motion-scene"`, `schemaVersion: "0.1.0"`
- `timeline: { durationSeconds: 1.8, fpsHint: 30, loopMode: "entity_exact" }`
- `props: [{ id: "ball.A", kind: "ball", ... }]` ×3
- `events: [{ id, t, type: "release"|"catch", propId, performerId, handJoint: "wrist.R"|"wrist.L", confidence }]` ×13
- 実測: 投げ間隔 0.3秒（＝100BPMの8分音符とちょうど一致）、飛行時間はすべて 0.6秒（カスケードなので一定）

**元データは読み取り専用**。coordinate-generator 側を変更・移動しない。

## 1. 素材の扱い（dev-preferences「素材再利用」に従う）

- 公開URL（GitHub Pages）から元フォルダは読めないため、fixture を **1件だけ** `app/scenes/three-ball-cascade.json` に複製する。
- 複製の隣に `app/scenes/PROVENANCE.md` を置き、**出典パス・取得日 2026-09-04・「読み取り専用の複製。改変しない。更新は元ファイルから取り直す」** を明記する。
- 加えて、M3で作った**ファイル選択から Motion Scene も読める**ようにする（下記 §4）。複製はデモ用の既定、実運用は選択で。

## 2. 音への写像（`app/scene-map.mjs` 新規・純粋関数のみ）

**核: 道具1つ＝音1つ。パターンの構造がそのまま聴こえる。**

| シーンの情報 | 音 | 根拠 |
|---|---|---|
| `propId`（ball.A/B/C…） | **スケール度数**。seed から決定論的に割り当て（`createLayout` と同じ mulberry32／`hashSeed`）。役割は `roleForDegree(worldId, degree)` で決まる | 3ボールなら3音が循環し、4ボールなら4音になる。パターンの周期が耳で分かる |
| `type: "catch"` | **発音の瞬間** | キャッチが拍として体感される（2026-09-01計画の判断を踏襲） |
| `type: "release"` | 音は出さない。ログには `kind: "release"` として残す | v1では発音しない。将来の前打音の余地 |
| `handJoint` | `wrist.R` → オクターブ 0／`wrist.L` → オクターブ −1 | 左右の受け渡しが音の高低として出る |
| 飛行時間（同 propId の release→catch） | **音長**。`noteLengthFromInterval(flightSec)` を流用 | 高い投げほど長い音。カスケードでは一定（0.6秒）だが他パターンでは変わる |
| `confidence` | イベントログに保持のみ（音量に使わない） | confidence はシステムの不確かさで、演者の表現強度ではない（2026-09-01計画の原則） |

- エフェクトは `none` 固定（キーボードのランダム性はここでは持ち込まない）。
- 緊張度T・和音・伴奏・セクション・応答音・着地は**キーボードと完全に同じ規則**（`updateTension` 等をそのまま通す）。
- 純粋関数 `sceneToEvents(scene, { worldId, seed, bpm, bars })` → 既存のイベントログ（`gravity-v0` 形式）を返す。
  `sourceId: "motion-scene"`、各イベントに `propId`・`handJoint`・`sceneTime`（元の t）を追加保持する。

## 3. 尺とループ

- シーンの `durationSeconds`（1.8秒）を、テイクの16小節ぶん（世界A: 38.4秒）まで**繰り返す**。`loopMode: "entity_exact"` を前提。
- k 周目のイベント時刻 = `t + k × durationSeconds`。テイク終端を超えるイベントは捨てる。
- **クオンタイズ設定はキーボードと同じものを適用する**（この機能の見どころ）。
  - `OFF` → ジャグリングの生のリズムがそのまま鳴る
  - `8分` → グリッドに吸着（カスケードは元から8分なので、ほぼ同じに聞こえるのが正しい）
- BPMは世界の値をそのまま使う（シーンから推定しない）。README に「カスケードの投げ間隔0.3秒は100BPMの8分と一致する」を1行残す。

## 4. UI（待機画面に1つ足すだけ）

- フォーム行に **「ジャグリングを演奏」** ボタン（二次ボタン、44px）。押すと同梱シーンを読み込み、`sceneToEvents` でログを作り、**`finished` 状態にして完了パネルを出す**（＝すぐ「再生」で聴けて、WAV/ステム/MIDIも書き出せる）。
- 完了パネルに1行: 「ジャグリング: 3ボールカスケード（3球・1.8秒を繰り返し）」。
- M3のファイル選択を拡張: 読み込んだJSONの `format` を見て分岐する。
  - `"gravity-v0"`（`version` フィールド） → 従来のテイク復元
  - `"juggling-motion-scene"` → `sceneToEvents` を通して同じくテイクにする
  - どちらでもない → 「読み込めませんでした（対応していない形式です）」
- ボタンのラベル・説明は具体的に。詩的な語を足さない。版表示 v0.6.0。

## 5. テスト（`node --test app/tests/`）

1. `assignDegrees(propIds, seed, worldId)`: 同じ seed で同じ割当、prop数3で3つ、prop数が度数7を超えても衝突せず全propに割当がある
2. `flightTimes(scene)`: カスケード fixture 相当の入力で propId ごとに release→catch の対応が取れ、対応しない release は除外される
3. `sceneToEvents`: catch の数だけ `kind:"press"` が出る／`release` は音源イベントにならない／`handJoint` が octave に反映される／`sourceId === "motion-scene"`
4. ループ: durationSeconds 1.8・bars 16・bpm 100 で、テイク終端 38.4秒を超えるイベントが無い、周回数が期待どおり
5. `detectFormat(obj)`: gravity-v0／juggling-motion-scene／不明 の3分岐
6. 既存テスト（app 18・prototype 15）不変

## 6. 完了条件

- テスト全通過、`node --check` 全JS、**ブラウザで console error 0（Codex変更後は必ず起動確認する）**
- 「ジャグリングを演奏」→ 完了パネル →「再生」で音が出る／WAV・MIDIが書き出せる
- クオンタイズ OFF と 8分で聴き比べができる
- 元の coordinate-generator フォルダに変更が無い（`git status` 相当で確認）
- 実機未確認の項目は明記
