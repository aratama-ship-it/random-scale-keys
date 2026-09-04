# 引き継ぎプロンプト — random-scale-keys（2026-09-04 時点）

新しいセッションの冒頭にこのファイルの「## プロンプト本文」以下を貼るか、
「`apps/music-plugins/random-scale-keys/HANDOFF.md` を読んで続きをやって」と言えば再開できる。

## プロンプト本文

`apps/music-plugins/random-scale-keys/` の続きをやります。まず次の3つを読んでください。

1. `apps/music-plugins/random-scale-keys/PROJECT_NOTES.md`（決定事項と検証ログの正本。末尾から遡ると速い）
2. `apps/music-plugins/random-scale-keys/README.md`（起動方法・公開URL・トークンシート外の値）
3. `apps/music-plugins/random-scale-keys/SPEC_M8.md`・`SPEC_M9.md`・`SPEC_M10.md`（直近の仕様。M1〜M7も同フォルダ）

### これは何か

PCキーボードのA〜Zにスケール音とエフェクトをランダムに割り当て、タイピングのように打つだけで
30〜60秒の即興作品ができるブラウザアプリ。作品はWAV・ステム3本・MIDIで持ち帰れる（Logic Pro連携）。
起点は友人に教わった touch:waves（https://sascacci.com）。企画の正本は
`obsidian-vault/ideas/2026-09-03_ランダム鍵盤で曲になるアプリ_ブレスト.md`。

### いまの状態（2026-09-04）

- **app v0.11.0 を公開中**（M8: 五音音階は親7音階の三和音、4小節ごとに属→主で着く終止／M9: 1キーで3連符アルペジオの効果 arp／M10: 数字キー0〜9のSFXと伴奏の自動SFX）: https://aratama-ship-it.github.io/random-scale-keys/
- repo: https://github.com/aratama-ship-it/random-scale-keys （public、Pages=main/root）
- M1〜M10 まで完了。M8（親音階ハーモニー＋4小節の終止）・M9（arpeggio 効果）・M10（SFX）を公開した直後で、**本人の試聴判定を待っている**状態

### 直近の宿題（ここから始める）

本人が v0.8.0 を聴いて、次を判定する:
1. メジャー（daylight+イオニアン）の伴奏が良くなったか
2. 五音音階（エジプシャン・平調子など）の伴奏が合うようになったか

物足りなければ、和音の追従の強さ（`noteMemory` の重み、`scoreChord` の各項）と
ベースの動きを微調整する。数値は `prototype/gravity.mjs` と `prototype/synth.js` の定数に集約してある。

### 作り方の約束（守ること）

- **思考はClaude、コーディングはCodex**。仕様を確定してから `codex exec` に投げ、Claudeが必ず検証して報告する
  （`_claude-rules/codex-delegation.md`）。Codexの「できました」を鵜呑みにしない
- **★Codex変更後は必ずブラウザで console error を確認する**。`node --test` が通っても、
  存在しない export を import してアプリ全体が起動しない事故が実際に起きた（v0.5.2）
- **★`git add -A` はフックで禁止**。パスを明示して add する
- git本体は iCloud外の `~/git-repos/random-scale-keys`（`--separate-git-dir`）
- `design/` は `.gitignore` で非公開（判断用HTML・トークンシート・参照メモ）
- デザインの数値は `design/TOKEN_SHEET.md` が正。コードに直書きしない
- 音の規則の数値は `prototype/gravity.mjs` / `synth.js` の定数に集約。SPECと食い違ったらSPECを直す

### 検証のやり方（実績のある手順）

- ローカル配信: `.claude/launch.json` の `random-scale-keys`（8962番）。本人が自分で
  `python3 -m http.server 8962` を起動していることがあるのでポート衝突に注意
- 音の検証はブラウザで `render.js` の `renderTakeToWav` を直接呼び、WAVのピーク・RMS・尺・
  バイト差を測る（Claude Codeのプレビューでは音は聴けない。**音の良し悪しの判定は必ず本人**）
- 既存の音を変えていないかは、同じログのミックスWAVを基準サンプルと比較して ±2LSB 以内かで見る
- 画面は `design-lint` で監査:
  `~/.venvs/design-lint/bin/python "<ws>/web-projects/design-lint/design_lint.py" "<URL>"`

### 押さえておく設計の核

- **音階の重力**: 度数を安定／浮遊／緊張に分け、緊張度Tで伴奏・音色が裏で変わり、着地で開く。
  役割は音階ごとに手で決めず**規則で導出**する（安定=第1,3,5度／緊張=主和音の半音隣／残り浮遊）。
  この規則はイオニアンの表とキー配分12/7/7を完全再現する
- **伴奏は弾いた音に追従する**（M7）。直近8拍の度数ヒストグラムで候補和音を採点し、
  セクション別の骨格・声部連結・反復ペナルティ・緊張度を足して選ぶ
- **正本はイベントログ**。同じログから再生・WAV・ステム・MIDIを生成する（分岐を作らない）
- **クオンタイズは既定8分**。本人いわく「素人でも音楽を奏でている感覚」の核
- 本人のキーボードは**同時押し4キーまで**（実測）
- ジャグリング連動は `apps/utility-app/juggling-music-reactor/` と所有境界を分ける。
  本アプリは Motion Scene v0 のサブセットを読むだけで、あちらのフォルダは読み取り専用

### 次の候補（本人判断が要る）

- 伴奏の微調整（上記の宿題しだい）
- ルート音の選択（現在は世界ごとに固定。daylight=C4、night=A3）
- 録画したジャグリング動画の解析結果に音を付ける（オフラインなので遅延問題なし）
