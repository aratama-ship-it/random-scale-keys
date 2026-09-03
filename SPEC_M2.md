# M2 仕様 — 出口の両立: ステム3本＋MIDIファイル（app v0.4.0）

作成: 2026-09-04 Claude（設計）。実装: Codex。検証: Claude（テスト・ブラウザでのバイト検査）→ 本人（Logic Proで読み込み・整列の確認＝M2のゲート）。
前提: M1通過（本人 2026-09-04「全部大丈夫そう」）。正本はイベントログ。**同じログから ミックスWAV／ステム3本／SMF を生成する。**

## 0. 原則と例外

- 音のスケジュールは `prototype/render.js` の `scheduleRecordedTake` **ただ一つ**を通す（WAV・ステム・MIDIで分岐しない）。
- **例外（M1の「prototype/ を触らない」を今回だけ緩める）**: ステムに必要なバス制御は `prototype/synth.js` に
  **後方互換の省略可能オプション**として追加してよい。既定値では従来と完全に同じ動作・同じ出力であること
  （prototype のテスト15件が通り、既存の renderTakeToWav の出力が変わらない）。`gravity.mjs`・`app.js`（prototype）は触らない。
- 依存ゼロ・ビルドなし。GitHub Pages のサブパス配信で動く相対パスのみ。

## 1. ステム3本（`app/stems.js` 新規）

| ステム | 含むもの | ファイル名 |
|---|---|---|
| `lead` | リード（打鍵音・応答音・スタッター・オクターブ重ね）の**ドライ**成分 | `rsk_<world>_<seed>_<yyyymmdd-hhmm>_lead.wav` |
| `accomp` | パッド・ベース・キック・スネア・ハット・カウントインを除く終止のドライ成分 | `..._accomp.wav` |
| `fx` | リバーブとディレイの**リターン**（全ソース由来） | `..._fx.wav` |
| （既存） | ミックス | `..._mix.wav` |

- 実装: `createSynth(context, { ..., stem: null | "lead" | "accomp" | "fx" })`。`stem` 指定時は該当バス以外の出力 gain を 0 にする
  （ノードは作る。**スケジュール経路は同一**）。`fx` はリバーブ／ディレイのリターンだけを master に通す。
- マスターのコンプレッサー／サチュレーターは非線形なので **ステム時はバイパス**し、代わりに `MASTER_INPUT_GAIN` と同じ入力ゲインだけ掛ける。
  （したがって「3本の和 ≠ ミックス」になる。READMEにその旨を書く。ミックスは従来どおりコンプ経由）
- 3本は同じ尺・同じ開始位置（0秒＝テイク開始。カウントインは含めない）。JIT レンダー（`renderTakeToWav` と同じ suspend/resume 方式）。
- 完了パネルのボタン「ステム3本を書き出す」→ 順にレンダーして3ファイルをダウンロード。進捗を「ステム 1/3 をレンダー中…」で表示。
  1本あたり約4秒の見込みなので、ボタン横に「約12秒」。

## 2. MIDIファイル（`app/midi.js` 新規、純粋関数中心）

- **記録用シンセ**: `scheduleRecordedTake(context, recorder, log, 0)` に、`createSynth` と同じインターフェイスを持つ **記録オブジェクト**を渡し、
  `scheduleLead / schedulePad / scheduleBass / scheduleKick / scheduleSnare / scheduleHat / scheduleResolution / scheduleClick / setReverbSend`
  等の呼び出しを `{ track, midi, when, length, velocity }` として蓄積する（`beatSec`・`bpm` プロパティも持たせる）。
  音を鳴らす経路と**同じ関数**からノートを得るので、MIDIは音と一致する。`context` は時刻計算にしか使わないため、
  `{ currentTime: 0, sampleRate: 44100 }` のようなダミーで足りるなら実 AudioContext を作らない。
- **SMF Format 1、480 PPQ**。トラック構成:

| # | トラック名 | ch | 内容 |
|---|---|---|---|
| 0 | `tempo` | — | テンポ（BPM）、拍子 4/4、トラック名 |
| 1 | `lead` | 1 | 打鍵音・応答音。velocity = round(clamp(velocity,0,1)×126)+1。音長はスケジュールの length |
| 2 | `pad` | 2 | 和音（構成音3つ）。小節頭で切り替わる。終止の和音も含む |
| 3 | `bass` | 3 | ベース |
| 4 | `drums` | 10 | GM: キック36、スネア38、クローズドハット42、オープンハット46。長さ 1/16 |

- カウントインのクリックは入れない。時刻0＝テイク開始。スタッターは3ノートに展開。オクターブ重ねは lead に +12 のノートとして入れる。
- 変換の数値: tick = round(seconds ÷ (60/BPM) × 480)。同時刻の NoteOff は NoteOn より先に並べる。末尾に End of Track。
- ファイル名 `rsk_<world>_<seed>_<yyyymmdd-hhmm>.mid`。完了パネルに「MIDIを書き出す」。
- Web MIDI ライブ送信は **やらない**（対応環境依存。M3以降の任意機能）。

## 3. 完了パネル（追記のみ。既存文言は変えない）

```
テイク完了 38.4秒・16小節・打鍵 142
[WAVを書き出す] [ステム3本を書き出す] [MIDIを書き出す] [JSONを書き出す]
WAVの生成は約4秒／ステムは約12秒
[同じ配置でもう1テイク] [配置を振り直す]
共有リンク: …
```
- 書き出し中は他の書き出しボタンを disabled にし、完了で戻す。失敗時は「書き出しに失敗しました（理由）」を同じ場所に表示。
- 版表示を v0.4.0 に。

## 4. テスト（`node --test app/tests/`）

1. `midi.js`: 可変長数量 `vlq(0)=[0]`, `vlq(127)=[127]`, `vlq(128)=[0x81,0x00]`, `vlq(480)=[0x83,0x60]`
2. `midi.js`: ヘッダ `MThd` 長さ6・format 1・PPQ 480、トラック数 5、各 `MTrk` の長さフィールドが本文長と一致、末尾が `FF 2F 00`
3. `midi.js`: テンポメタ `FF 51 03` の値が round(60,000,000 / BPM)、拍子メタ `FF 58 04 04 02 18 08`
4. `midi.js`: 変換 — BPM100 で 0.6秒 → tick 480、velocity 0→1、1→127、同時刻の NoteOff が NoteOn より前
5. `stems.js`: ファイル名生成（world/seed/日時/種別）
6. 既存テスト（app 4件・prototype 15件）が不変

## 5. 完了条件

- テスト全通過、`node --check` 全JS
- `renderTakeToWav`（ミックス）の出力が M1 時点と ±2LSB 以内（Claudeがブラウザで比較）
- ステム3本の尺がミックスと一致し、`lead` 単独レンダーの RMS が 0 でない／`fx` は打鍵の無い区間でも減衰が続く（Claude検査）
- SMF が上記テストを通り、Logic Pro で読み込めて WAV と頭が揃う（**本人確認＝M2ゲート**）
- 実機未確認の項目は明記
