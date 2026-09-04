# M8 仕様 — 五音音階の「親音階」ハーモニーと、4小節フレーズの終止（app v0.9.0）

作成: 2026-09-04 Claude（設計）。実装: Codex（2段階）。検証: Claude（測定）→ 本人（耳）。

本人判定（2026-09-04、v0.8.0 を試聴）:
- メジャー（daylight＋ionian）: 「イマイチな点は**トニックへのフレーズ感が薄い**」
- 五音音階: 「**まだ和音が合わない**」「**ベースが合わない・動きが不自然**」
- 五音音階の直し方は **案B（親の7音階の三和音を使う）で確定**

原因（Claude実測）: M6 で音程基準に直したのは第1度（主和音）だけで、第2度以降は今も「音階の1つ飛ばし」で積む。
5音階では三和音にならず sus・四度堆積になる（例: メジャーペンタの「属和音」= G-C-E ＝ C の転回形、「下属」= E-A-D）。
完全五度が無いためベース3拍目の「五度」も第2音（四度）に落ちる。
メジャーのフレーズ感の薄さは、骨格が各フレーズ末（4小節目）を属和音で終えても、次のフレーズ頭が
b では vi、outro では IV で「トニックに着かない」うえ、骨格が +0.6 のバイアスに過ぎず追従で崩れるため。

## 0. 設計の核

1. **ハーモニーは「親の7音階」で作り、リードは元の音階のまま。**
   五音階のリード（キー配分・役割・重力）は一切変えない。和音・ベース・応答音の選択だけが親音階の三和音を使う。
   ペンタトニックの旋律を親調のダイアトニック三和音で伴奏する定石。
2. **4小節ごとに必ず「属→主」で着く。** フレーズ末（終止小節）は属和音か下属和音に限定し、次の小節頭（到達小節）は主和音に固定する。
   その間の2小節は今までどおり弾いた音に追従する。
3. すべて決定論的。同じイベントログからは同じ伴奏。

**2段階で実装し、段階ごとに Claude が検証する。** 段階A（§1）を先に実装して報告、Claude の検証後に段階B（§2）へ進む。

## 1. 段階A — 親音階ハーモニー（`prototype/gravity.mjs` ほか）

### 1.1 親音階の表と関数

```js
const HARMONY_PARENT = Object.freeze({
  major_pentatonic: "ionian",
  minor_pentatonic: "aeolian",
  blues: "aeolian",
  yo: "ionian",
  egyptian: "dorian",
  in_sen: "phrygian",
  hirajoshi: "aeolian",
  ryukyu: "ionian",
});
export function harmonyScaleId(scaleId) // 表にあれば親、無ければ自分自身（7音階12種と whole_tone）
```

親の選択理由（README に1行ずつ書く）: 各五音階が部分集合として含まれる7音階のうち、主和音の長短が M6 の主和音と一致し、
構成音の衝突（半音のぶつかり）が最も少ないもの。表は1か所で、差し替え可。

### 1.2 和音の関数はすべて「ハーモニー音階」で動く

以下は `scaleId`（リードの音階）を受け取り、内部で `harmonyScaleId(scaleId)` に切り替えて計算する。
`degree` 引数・戻り値の「和音の度数」は**ハーモニー音階の度数**（1..7、whole_tone は 1..6）。

- `triadForDegree`, `chordLabel`, `degreeForChordLabel`, `chordPitchClasses`, `chordDegrees`, `chordMidiNotes`, `chordRootMidi`,
  `tonicChordForScale`, `chooseChord`（候補 = ハーモニー音階の全度数）, `chordForBar`/`chordForTension`（prototype 互換）
- `triadForDegree` は常に 1つ飛ばし `[0,2,4]` で積む。`count < 7 && degree === 1` の特例（`tonicDegrees`）は**和音からは外す**
  （whole_tone は 1つ飛ばしでも C-E-G♯ で M6 と同一。`tonicDegrees` は `deriveRoles`（リードの役割）専用として残す）
- `chordDegrees` は 7音階の規則（tonic 1／subdominant 4／dominant = 第7音が 11 なら 5、それ以外は 7／submediant 6）を
  ハーモニー音階に適用する。五音階用の「5・7・9 に最も近い度数」の規則は削除する（whole_tone は現行どおり 1/3/4/5 でよい。
  現行の N<7 規則を whole_tone にだけ残す）

### 1.3 リード側との橋渡し（新設・変更）

- `export function chordRootInterval(scaleId, chordName)` → 和音の根音の主音からの半音数（0..11）
- `chordDegreeNotes(scaleId, chordName)` → **リード音階の度数**（1..N）のうち、ピッチクラスが和音の構成音に含まれるものを昇順で返す。
  五音階では 3 個未満になりうる。空なら `[1]`。
  例: major_pentatonic の "IV"（F-A-C）→ `[1, 5]`（C と A）
- `answerDegree` は上記の新 `chordDegreeNotes` の上でロジック不変（空にならないので常に返る）
- `chordToneWeight` は変更なし（新 `chordDegreeNotes` を受け取る）
- `scoreChord` の `fit`: 記憶の度数（リード）を `scale.intervals[degree-1] % 12` でピッチクラスに直し、
  和音のピッチクラス集合に含まれれば +1.0、含まなければ −0.5（重み付けは M7 のまま）
- `approachDegree(nextRootSemitone, scale)` の候補は**ハーモニー音階**の音。呼び出し側（`app/main.js`, `prototype/render.js`）は
  `nextRootSemitone = chordRootInterval(scaleId, nextChord)`、`scale = getScale(harmonyScaleId(scaleId))` を渡す
  （メジャーペンタで C へ向かう経過音が D/B♭ ではなく B になる）
- `app/midi.js`, `prototype/synth.js` の `chordMidiNotes` 利用は変更不要（親の三和音が自然に出る）

### 1.4 変えないもの（検証条件）

- `deriveRoles`, `tonicDegrees`, `allocateKeys`, `createLayout`, `SCALES[*].roles`: 21音階すべてで v0.8.0 と同一
  （同じ seed で同じ配置）
- **7音階12種と whole_tone**: 同じログに対する `accompanimentPlan` の和音列・声部、`scheduleRecordedTake` のベース列が v0.8.0 と完全一致
  （Claude が `design/verify/chord-baseline.mjs` の出力を段階A の前後で比較する。Codex はこの検証をしなくてよい）
- 音色・音量（`synth.js`）は段階A では触らない

### 1.5 段階A のテスト（`prototype/tests/gravity.test.mjs` に追加・更新）

1. `harmonyScaleId`: 表の8件が親を返し、ionian と whole_tone は自分自身
2. major_pentatonic の和音: I = C-E-G、IV = F-A-C、V = G-B-D、vi = A-C-E（`chordMidiNotes` のピッチクラスで確認）、
   `chordDegrees` = {1,4,5,6}、`chordLabel` に `*` が付かない
3. in_sen: tonic = i（C-E♭-G）、subdominant = iv（F-A♭-C）。hirajoshi: dominant = VII（B♭-D-F）
4. `chordDegreeNotes("major_pentatonic", "IV")` = `[1, 5]`、`chordDegreeNotes("major_pentatonic", "vii°")` = `[2]`（B-D-F のうち D）
5. `chordRootInterval("major_pentatonic", "V")` = 7、`approachDegree(0, getScale("ionian"))` = 11
6. `scoreChord` の fit: major_pentatonic で度数 5（A）だけを弾いた記憶に対し、vi（A-C-E）が IV（F-A-C）より高く、V（G-B-D）より高い
7. 既存テスト「all nine five- and six-note scales use the specified interval-based tonic and function roots」は
   **役割（roles）の検証だけ残し**、和音の主張は新仕様に更新する（削除しない）
8. 21音階すべてで `chooseChord` と `chordMidiNotes` が全度数で例外なく動く

## 2. 段階B — 4小節フレーズの終止（全音階が対象）

### 2.1 骨格 v2（`FUNCTION_PATTERN`）

| セクション | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `intro` | tonic | tonic | subdominant | **dominant** |
| `a` | tonic | tonic | subdominant | **dominant** |
| `b` | **tonic** | submediant | subdominant | **dominant** |
| `outro` | **tonic** | subdominant | **dominant** | tonic |

すべてのフレーズが属和音で終わり、次のフレーズ頭（小節 4・8・12）と最終小節 15 が主和音になる。
b の色（vi）は 2小節目に移す。

### 2.2 終止小節と到達小節（`chooseChord`）

- **終止小節** = 骨格の機能が `dominant` の位置（intro/a/b は位置3、outro は位置2）
- **到達小節** = 終止小節の次の小節（4・8・12・15）
- 終止小節の候補は **{dominant, subdominant} の2つに限定**し、採点（fit・声部連結・反復・緊張）で選ぶ。
  functionBias は dominant に +0.6（表どおり）
- 到達小節は **無条件に tonic**（着地と同じ扱い）
- それ以外の位置（各フレーズの 2・3 小節目、b の vi）は M7 のまま全候補から採点
- 小節0 は従来どおり tonic。着地（resolution）の tonic 強制も従来どおり

補助関数として `export function phraseRole(section, sectionBar)` → `"cadence" | "arrival" | "free"` を用意し、
`chooseChord` と §2.3〜2.5 の呼び出し側で共有する。

### 2.3 ベース（終止小節だけ追加。`app/main.js`, `prototype/render.js`）

| 位置 | 音 | gain |
|---|---|---|
| 1拍目（step 0） | 根音 | 0.9（到達小節では **1.0**） |
| 3拍目（step 8） | 五度／T≥0.3 でオクターブ上（M7 のまま） | 0.75 |
| **4拍目（step 12）・終止小節のみ** | **和音の七度**（ハーモニー音階で根音の度数 +6 の音。whole_tone は +5） | 0.7 |
| 4拍裏（step 14） | 次の根音への経過音（M7 のまま。候補はハーモニー音階） | 0.7 |

七度の MIDI は `nearestMidiForPitchClass(七度のピッチクラス, thirdBeatBass)`。
ionian の V なら G . D F B | C（属七の歩き）。`export function chordSeventhInterval(scaleId, chordName)` を `gravity.mjs` に追加する。

### 2.4 パッドとドラムの区切り

- 到達小節の頭のパッドは**根音を最低声部に置く**（基本形）。`voiceLead(previousVoices, chordSemitones, { rootPosition: true })`
  → 候補のうち `voices[0] % 12 === 根音のピッチクラス` のものだけから最小移動を選ぶ（該当なしなら従来の最小移動）。
  第3引数は省略可（既定 false）で既存の呼び出しは不変
- 終止小節の step 14 に**スネアのピックアップ**（gain ×0.7）。全セクションの終止小節（bar 3・7・11・14）。
  `synth.scheduleSnare(when, gainScale = 1)` に第2引数を追加（既存呼び出しは不変）
- 到達小節の step 0 にオープンハット（ハットが鳴るセクション a・b のみ。既存 `hatForStep` の結果を上書き）

### 2.5 応答音（`scheduleAnswerAtBoundary`）

到達小節の頭（`beat % 16 === 0`、beat > 0）に応答音が出る条件を満たしたときは、度数を **1（主音）** にする
（他の境界は従来どおり `answerDegree`）。

### 2.6 版・記録

- 版表示 **v0.9.0**。ログ `engine: "accomp-v3"`。古いログは分岐せず新規則で再生（M7 と同じ方針）
- README: 親音階の表と理由、骨格 v2、和音名がハーモニー音階のローマ数字になったこと（五音階の `*` 表記が消える）、
  v0.8.0 以前の JSON は伴奏が変わること（1行）

### 2.7 段階B のテスト

1. `phraseRole`: intro/a/b の位置3 と outro の位置2 が cadence、位置0 と outro 位置3 が arrival、他は free
2. `chooseChord` 終止小節: 記憶が vi（A）を強く支持していても、選ばれるのは V か IV（vi にならない）
3. `chooseChord` 到達小節: 記憶が IV を強く支持していても tonic
4. 骨格の既存テスト（`chord degrees, labels, and section skeletons reproduce ionian and aeolian`、
   `short-scale chord choices use the shared section skeleton`）を v2 に更新（削除しない）
5. `chordSeventhInterval("ionian", "V")` = 5（F）、`("aeolian", "VII")` = 8（A♭）
6. `voiceLead` の `rootPosition`: 前声部 [60,64,67] → {5,9,0}（F）で最低声部が F（65 または 53 は窓外なので 65）
7. `scheduleRecordedTake`（render.test の記録シンセ）: 16小節ログで、bar 3 の step 12 にベース（gain 0.7）と
   snare（gainScale 0.7）が step 14 に予約される。bar 4 の step 0 のベース gain が 1.0
8. 応答音: beat 16 に条件を満たす応答は degree 1

## 3. 音量の測定目標（Claude が実測。M7 §5 と同じ）

16小節・128打鍵の標準ログ（daylight+ionian）で lead ピーク 0.55〜0.75／accomp 0.45〜0.65／ミックス 0.85〜0.95（0.815 は既に受け入れ済）。
ベースの追加音とスネアのピックアップで accomp が上振れしたら `ACCOMP_BUS_GAIN` だけで合わせる。

## 4. 完了条件（段階ごと）

- 段階A: テスト全通過、`node --check`、**ブラウザ console error 0**、§1.4 の不変条件（Claude が比較）
- 段階B: テスト全通過、`node --check`、**ブラウザ console error 0**、21音階で例外なくレンダー、同じログの2回レンダーが ±2LSB
  （検証時の注記: daylight/ionian の1点で Chromium のコンプレッサー境界による 15LSB・43ms の2状態が見つかった。規則は決定論的で可聴差なしのため
  受け入れ。詳細は PROJECT_NOTES 2026-09-04 M8 段階B）、§3 の測定
- 実機未確認の項目（音の良し悪し）は明記して本人へ
