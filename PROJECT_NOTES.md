# random-scale-keys — Project Notes

## 目的

「初見でも曲になる即興体験」。ランダム配置のスケール音を打つだけで、見えない「音階の重力」と「休符」が
即興を30〜60秒の作品に整え、WAV・ステム・MIDIで持ち帰れる。

## 本人決定（2026-09-03〜04）

- 即興体験を優先（練習型の新楽器ではない）
- MVP完成条件＝ブラウザ内で作品完成 ＋ Logicへ素材を渡せる（両方）
- 作品単位＝30〜60秒の一発録り（ループ重ねは第2段階）
- ジャグリング連動はMVPのUIに入れない。イベント契約（juggling-music-reactor の v0）のサブセットで将来接続

- **クオンタイズは既定ON・切替可（2026-09-04）**: touch:wavesで「素人でも音楽を奏でている感」を生んだ核はクオンタイズ。既定8分（touch:wavesの実測と同じ）、OFF／4分／8分／16分を切替。設定はイベントログに記録する

## 進め方（2026-09-03 開始）

1. prototype/ で「音階の重力」規則を音だけで検証（このゲートを通るまでUIを作らない）
2. 実在参照の分解調査（reference-led-ui-design）
3. design-web でトークンシート付き実装計画HTML → MVP実装（Codex）→ Claude検証

## 検証ログ

### 2026-09-03 prototype v0.1.0（Codex実装・Claude検証）

- `node --test tests/` 8/8通過（Claude再実行）。`node --check` 4ファイル構文OK
- 仕様突き合わせ: 役割12/7/7・効果14/4/3/3/2・T係数(−0.30/+0.05/+0.22, 減衰e^(−Δ/8))・和音境界0.3/0.6・
  cutoff 1200→4200・quantize grace 30ms・velocity/length端点・`event.code`判定・`event.repeat`無視・Enter停止 = 仕様どおり
- ログ→WAVのオフライン生成（ブラウザでrender.jsを直接呼び、合成ログ48イベント）: RIFF/WAVE・44.1kHz・2ch・16bit・
  40.40秒（16小節@100BPM＋2秒）・ピーク0.57・毎秒RMS 0.07〜0.11（無音でない）・レンダー約1.1秒
- **不一致1件**: 同一ログの2回レンダーでバイト不一致（ハット/IRの白色ノイズが Math.random 由来）→ seed固定ノイズへ修正をCodexに委譲（下記）
- 実機未確認: 音の良し悪し・16小節自動停止・実ダウンロード（Claude Codeのプレビューはペイン非表示でAudioContextが再開されず、
  「演奏開始」が待機のまま止まる＝環境制約。本人がChromeで確認する）
- 参考: favicon.ico の404のみ（無害。修正委譲に含めた）

### 2026-09-03 修正後の再検証（Codex修正・Claude検証）

- synth.js のIR／ハットのノイズを `mulberry32(seed)`／`(seed+1)` に変更、app.js・render.js から layout.seed／log.seed を渡す。index.html に data URL favicon。テスト8/8
- 同一ログの2回レンダー: 世界A・Bとも差は **3,563,280サンプル中504個が±1LSB**（16bit最小単位、先頭0.011秒から散在）。
  `Math.random` は残っておらず、Chromium の OfflineAudioContext 内部の浮動小数丸めと判断 → **知覚上は決定論的**として受け入れ。
  ビット一致が必要になったら（例: 再演の検証テスト）PCM比較を ±2LSB 許容にする
- 世界B: 45.64秒（16小節@88BPM＋2秒）、ピーク0.51、RMS 0.07。世界A: 40.40秒、ピーク0.58、RMS 0.085
- 未確認のまま本人へ: 音の良し悪し（耳のゲート）、演奏開始→16小節自動停止→ダウンロードの実機フロー（Chrome推奨）

### 2026-09-03 耳のゲート（本人判定）

- 本人: 「ある程度曲っぽくなってます」＝**条件付き通過**
- 足りない点（本人選択・4つ全部）: 単調／フレーズ感がない／伴奏と噛み合わない／音色・空間が安っぽい
- 進め方（本人決定）: **先に音の規則を1回調整**してから UI（M1）へ
- 対応: `prototype/SPEC_gravity_v0.2.md`（差分仕様: 16小節の形＝intro/a/b/outro/終止、基本コードループ＋Tの歪み、
  拍位置アクセント、2小節フレーズの応答音、和音構成音の重み、ダッキング・スネア・スウィング、FM電気ピアノ、
  レゾナンス付きフィルター、ピンポンディレイ、IR3秒＋プリディレイ、コンプ＋ソフトクリップ）→ Codex実装

### 2026-09-04 prototype v0.2.0（Codex実装・Claude検証）

- `node --test tests/` 13/13（既存8＋追加5）、`node --check` 全通過。仕様関数 sectionForBar/chordForBar/accentForBeat/answerDegree/chordToneWeight を確認
  （セクション境界 intro/a/b/outro/outro-last、基本ループ I-I-IV-V、T0.4で2小節目vi、応答音 7→1・4→3）
- 本人サーバー（python http.server 8962）経由でブラウザ検証。console error 0
- 合成ログ128イベントのオフラインレンダー: A 42.40秒・ピーク0.879 ／ B 47.64秒・ピーク0.852（目標0.85〜0.95に収まる）。
  小節RMSは A 0.19→0.23→0.20→終止0.10、B 0.18→0.20→0.18→0.08（打鍵が連続する合成ログなのでintroの差は小さい）
- **課題**: レンダー時間が v0.1 の約1秒から **約27〜28秒**（42秒の音声）に増加。コンプ＋WaveShaper 2x＋3秒IR＋FM声部の影響と推測（未特定）。
  試聴には影響しないが、MVPの「WAV書き出し」ではUX上の問題 → M1着手前に原因を切り分ける
- 未検証: v0.2での同一ログ2回レンダーの±2LSB（レンダーが遅く45秒のJS制限に掛かる。ノイズseed固定の仕組みは不変）
- 未確認のまま本人へ: 4項目（単調／フレーズ感／噛み合い／音色）が改善したか

### 2026-09-04 レンダー28秒の切り分け（ブラウザ内で差し替え計測・ファイル未変更）

| 条件 | 時間 |
|---|---|
| 4小節・32打鍵（基準） | 1.7s |
| 同・コンプ素通し | 1.8s（差なし） |
| 同・WaveShaper素通し | 1.6s（差なし） |
| 8小節・0打鍵 | 2.9s |
| 8小節・64打鍵 | 6.1s |
| 16小節・0打鍵 | 7.4s |
| 16小節・128打鍵 | 約28s |

- コンプ／ソフトクリップは無関係。**打鍵数×尺に比例して超線形に増える** → OfflineAudioContext では全ボイスのノードを
  開始前に一括生成するため、鳴る前・鳴った後のノードも全区間で処理される（推定。数値の増え方と整合）
- 対策（次のCodex委譲）: render.js の scheduleRecordedTake を小節ごとに分割し、`OfflineAudioContext.suspend(小節頭−0.1s)`
  → その小節のノードを生成 → `resume()` の just-in-time 方式にする。オンライン再生は既に逐次生成なので対象外

### 2026-09-04 prototype v0.2.1 クオンタイズ設定（Codex実装・Claude検証）

- 設定 select: OFF／4分／8分／16分、**既定8分**。演奏中は無効化。takeLog.quantize {enabled, division} に記録
- 打鍵時刻: OFF→即時、それ以外→ quantize(now, takeStart, bpm, division, 0.03)。応答音は拍頭のまま
- `node --test tests/` 14/14（吸着位置テスト追加）。左上表示 v0.2.1

### 2026-09-04 WAV書き出しの高速化（Codex実装・Claude検証）

- render.js: イベントを小節単位に分割する純粋関数 partitionEventsByBar、scheduleRecordedTake の [fromBeat,toBeat) 対応、
  OfflineAudioContext.suspend/resume による小節ごとの just-in-time 生成。テスト15/15（境界の予約漏れ・二重予約テスト追加）
- 実測（16小節・128打鍵・世界A）: **28秒 → 3.7秒**。従来の一括予約（同ページで手動レンダー）は18.3秒
- 出力差: JIT版と一括版の差は最大 ±1LSB（2,727サンプル、±2LSB超え0）＝出力音は同じ。尺42.40秒・ピーク0.879 は不変

### 2026-09-04 GitHub公開（本人依頼）

- repo: https://github.com/aratama-ship-it/random-scale-keys （public）。Pages: https://aratama-ship-it.github.io/random-scale-keys/ （main / root、`/` は `prototype/` へ転送）
- git dir は iCloud外 `~/git-repos/random-scale-keys`（`--separate-git-dir`）。コミット者 ARATA URAWA <circusarata@gmail.com>（repoローカル設定）
- 公開対象: prototype/・README・PROJECT_NOTES・index.html。`design/`（判断用HTML等）は .gitignore で除外
- 運用: `git add -A` はフックで禁止。更新時はパスを明示して add → commit → `git push origin main`
