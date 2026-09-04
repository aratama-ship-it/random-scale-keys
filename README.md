# random-scale-keys（仮称）— ランダム配置のスケール鍵盤で即興が曲になるアプリ

PCキーボードのA〜Zに、スケール音とエフェクトをランダムに割り当て、タイピングのように打つだけで
30〜60秒の即興作品ができるPC専用ブラウザアプリ。作品はWAV・ステム・MIDIとして持ち帰れる（Logic Pro連携）。

- 企画の正本: `obsidian-vault/ideas/2026-09-03_ランダム鍵盤で曲になるアプリ_ブレスト.md`
- 関連（所有境界を分ける）: `apps/utility-app/juggling-music-reactor/`（ジャグリング動作→音楽。イベント契約v0の正本）。
  本アプリは同契約のサブセットを使う。相互にファイルを書き換えない。
- 状態（2026-09-04）: **app v0.11.0 のM10実装までローカルで完了**。21種のスケール選択、数字キーSFX、残り時間と進捗表示、
  16小節の演奏、Motion SceneとテイクJSONの読み込み、テイクの再生、ミックスWAV、ステム3本、SMF Format 1、JSON書き出しに対応。
- 試聴用の公開（GitHub Pages）: https://aratama-ship-it.github.io/random-scale-keys/ （`prototype/` へ転送）。
  公開リポジトリには `prototype/`・README・PROJECT_NOTES だけを載せ、`design/`（判断用HTML・トークンシート・参照メモ）は
  `.gitignore` で除外する（tonescoreの前例に倣う）。
- 置き場は仮。`apps/music-plugins/` に置いた理由は「音楽制作の道具」だから。本人判断で移動可。

## フォルダ

- `prototype/` — 音だけの30秒プロトタイプ（規則が「曲に聞こえるか」の最初のゲート）。仕様は `prototype/SPEC_gravity_v0.md`
- `PROJECT_NOTES.md` — 決定事項・検証結果の記録

## 起動（prototype）

```sh
cd "apps/music-plugins/random-scale-keys"
python3 -m http.server 8962 --bind 127.0.0.1
```

`http://127.0.0.1:8962/prototype/` を開き「演奏開始」→ A〜Zを打つ。テストは `prototype/` で `node --test tests/`。
実装計画（判断用HTML）: `http://127.0.0.1:8962/design/IMPLEMENTATION_PLAN_2026-09-03.html`
（Claude Codeのプレビューでは `.claude/launch.json` の `random-scale-keys`＝同じ8962番で配信。`/` は `/prototype/` へ）

## 起動（app v0.11.0、PC専用）

上記と同じローカルサーバーを起動し、`http://127.0.0.1:8962/app/` を開く。

同梱の3ボールカスケードは投げ間隔0.3秒で、100BPMの8分音符と一致する。

効果は delay／sweep／octave／stutter／arpeggio。arpeggio は押した度数を起点に、音階上の1・3・5度を
1拍3等分の3連符で上行する。v0.10.0では効果の配分が変わるため、同じseedでもv0.9.0とは効果の割当が変わるが、
度数・役割・オクターブは変わらない。

数字キーのSFXは固定配置で、A〜Zのランダム配置には影響しない。

| キー | SFX | バリエーション |
|---|---|---|
| 1 / 2 / 3 | impact | 低 / 中 / 高く短い |
| 4 / 5 / 6 | zap | 1800→200Hz / 1200→120Hz / 600→60Hz |
| 7 / 8 | glitch | 60ms / 180ms＋矩形波 |
| 9 / 0 | tapestop | 0.5秒 / 1.0秒 |

伴奏の自動SFXは、`bar 4/8/12` の step 0（5/9/13小節目の頭）に impact、`bar 3/7/11` の step 15（4/8/12小節目の末尾）に glitch が入る。
数字キーSFXは lead ステム、自動SFXは accomp ステムに収録され、リバーブ／ディレイの fx ステムには送られない。
MIDIにはチャンネル3の `sfx` トラックを追加し、impact=36/37/38、zap=40/41/42、glitch=44/45、tapestop=47/48を使う。

## 音階の定義について

日本の音階や民族音階には、文献によって異なる複数の版がある。このアプリの半音値は一般に流通する一版であり、
唯一の正解ではない。採用値は差し替えられるよう `prototype/gravity.mjs` の `SCALES` にまとめている。

五音音階のリード配置と役割は元の音階のまま保ち、伴奏だけ次の親7音階のダイアトニック三和音を使う。
親は元音階との共通音を優先し、主和音の長短と構成音の半音衝突を基準に選んでいる。

- `major_pentatonic` → `ionian` — 全構成音を含み、主和音を長三和音 C-E-G にする親メジャー。
- `minor_pentatonic` → `aeolian` — 全構成音を含み、主和音を短三和音 C-E♭-G にする親マイナー。
- `blues` → `aeolian` — ブルーノート以外を含み、主和音を短三和音 C-E♭-G にする親マイナー。
- `yo` → `ionian` — 全構成音を含み、主和音を長三和音 C-E-G にする親メジャー。
- `egyptian` → `dorian` — 全構成音を含み、主和音を短三和音 C-E♭-G にする親モード。
- `in_sen` → `phrygian` — 全構成音を含み、主和音を短三和音 C-E♭-G にする親モード。
- `hirajoshi` → `aeolian` — 全構成音を含み、主和音を短三和音 C-E♭-G にする親マイナー。
- `ryukyu` → `ionian` — 全構成音を含み、主和音を長三和音 C-E-G にする親メジャー。

その他の7音階12種と `whole_tone` は、それぞれ自分自身をハーモニー音階として使う。
画面の和音名はハーモニー音階上のローマ数字で表示するため、五音音階でも従来の `*` 表記は付かない。

4小節の骨格 v2 は次のとおり。終止小節を属または下属に限定し、その次の到達小節を主和音に固定する。

| セクション | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `intro` | tonic | tonic | subdominant | dominant |
| `a` | tonic | tonic | subdominant | dominant |
| `b` | tonic | submediant | subdominant | dominant |
| `outro` | tonic | subdominant | dominant | tonic |

## 演奏のコツ（本人の発見 2026-09-04）

- 同じキー付近を使い続けると、ループ感・楽曲感が出る。近いキーは近い音なので、モチーフの反復になる。
- 曲を展開したいときは、使うキーボードの位置を少しずつずらしていく。
- 普通の楽器でも同じことだが、ランダム配置でも同じ感覚が得られる。

完了したテイクはミックスWAV、ドライのlead/accomp、全ソース由来のfxリターン、MIDI、JSONとして書き出せる。
ミックスWAVには従来どおりマスターのコンプレッサー／サチュレーターが掛かる一方、ステムは後段処理のために
それらをバイパスする。そのため、ステム3本の単純な和とミックスWAVは一致しない。

v0.10.0以前に書き出したJSONも読み込めるが、再生時はv0.11.0の伴奏規則で自動SFXが加わるため、リードは同じでも伴奏は変わる。

## トークンシートに無い値

`design/TOKEN_SHEET.md` に未収録で、M1仕様に指定された描画値は `app/terrain.js` の `VISUAL` に集約している。

- 打鍵円: 半径 8→40px、700ms
- 応答円: 半径 6→24px（時間は打鍵円と共通）
- 着地ブルーム: 世界ごとの明色トークンを最大12%合成
- Canvasの描画線: 1.5px（打鍵タイルの押下枠と共通）
- 打鍵円の上昇距離: 描画半径の2倍
- 終止時の背景復帰: 1500ms
- disabledボタンの不透明度: 0.45
- 等高線の平坦域除外閾値: |標高| 0.04

等高線の格子8px、標高レベル−0.6〜1.0（0.2刻み）、σ係数1.2は `SPEC_M3.md` と
`design/TOKEN_SHEET.md` §4b の指定値であり、同じ `VISUAL` に集約している。同時押し診断の計測時間3秒は
`SPEC_M3.md` §5 の指定値で、`app/main.js` の `PERFORMANCE` に集約している。

## 同時押しについて

同時押しの上限はキーボード機種と接続方式に依存する。画面の「同時押しを診断」で、この端末からブラウザへ
同時に届く物理キー数を確認できる。
