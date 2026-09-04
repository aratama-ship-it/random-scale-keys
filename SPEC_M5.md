# M5 仕様 — スケール選択（21種）と残り時間表示（app v0.7.0）

作成: 2026-09-04 Claude（設計・規則は実計算で検証済み）。実装: Codex。検証: Claude → 本人。
本人要望: 「スケールの変更をできるようにしたい。メジャースケールから教会旋法、民族音階まで」「楽曲の残り時間もわかるようにしたい」。

## 0. 何を分解するか

現在「世界（daylight / night）」が **音階＋音色＋テンポ＋配色** を束ねている。ここから**音階を独立した軸**に分ける。

| 軸 | 中身 | 選択肢 |
|---|---|---|
| 世界（既存） | 音色・BPM・配色・ドラム・rootMidi | daylight（100BPM, root C4=60）／night（88BPM, root A3=57） |
| **スケール（新設）** | 音程の並び・役割・和音 | 21種（§2） |

`prototype/gravity.mjs` の `WORLDS` から `scale` / `roles` / `chords` を取り除き、新しい `SCALES` へ移す。
**後方互換**: `getWorld(id).scale` 等を参照している既存コードは `SCALES` 経由に書き換える。世界の既定スケールは daylight→`ionian`、night→`aeolian`。

## 1. 役割（安定・浮遊・緊張）の導出規則 ★この仕様の核

役割を音階ごとに手で決めない。**規則で導出する。** 規則は既存の daylight（Ionian）の表を完全に再現することを確認済み。

1. `tonicTriad` = 音階の第1・3・5度（音階内インデックス。5音音階でも同じ）の半音値の集合。
2. **stable** = 第1・3・5度。
3. **tension** = stable 以外で、半音値が tonicTriad のいずれかと **半音差（±1、mod 12）** にある度数。
4. **floating** = 残り。
5. tension が空になる音階は `gentle: true` とし、**floating の緊張度加算を +0.05 → +0.12 に上げる**（半音の緊張が無い音階では、浮遊音がその役を穏やかに担う）。stable/tension の加算は変えない。

**検証済みの導出結果**（2026-09-04 実計算）:

| 音階 | 安定 | 浮遊 | 緊張 | 備考 |
|---|---|---|---|---|
| ionian | 1,3,5 | 2,6 | 4,7 | **現行 daylight と完全一致** |
| dorian | 1,3,5 | 4,6,7 | 2 | |
| phrygian | 1,3,5 | 4,7 | 2,6 | |
| lydian | 1,3,5 | 2,6 | 4,7 | |
| mixolydian | 1,3,5 | 2,6,7 | 4 | |
| aeolian | 1,3,5 | 4,7 | 2,6 | 現行 night（浮遊2,4／緊張6,7）と2度ぶん異なる → **§1.1** |
| locrian | 1,3,5 | 6,7 | 2,4 | 主和音が減三和音。不安定なのは音階の性質 |
| harmonic_minor | 1,3,5 | 4 | 2,6,7 | |
| melodic_minor | 1,3,5 | 4,6 | 2,7 | |
| whole_tone | 1,3,5 | 2,4,6 | — | gentle |
| blues | 1,3,5 | 2,6 | 4 | |
| major_pentatonic | 1,3,5 | 2,4 | — | gentle |
| minor_pentatonic | 1,3,5 | 2,4 | — | gentle |
| yo（陽音階） | 1,3,5 | 2,4 | — | gentle |
| in_sen（陰音階・都節） | 1,3,5 | — | 2,4 | |
| hirajoshi（平調子） | 1,3,5 | — | 2,4 | |
| ryukyu（琉球音階） | 1,3,5 | 4 | 2 | |
| hijaz | 1,3,5 | 7 | 2,4,6 | |
| hungarian_minor | 1,3,5 | — | 2,4,6,7 | |
| double_harmonic | 1,3,5 | — | 2,4,6,7 | |
| egyptian | 1,3,5 | 2,4 | — | gentle |

### 1.1 既存2音階だけは明示テーブルで固定する

`ionian` は導出と一致するので導出に任せる。**`aeolian` だけは現行の表（浮遊 2,4／緊張 6,7）を明示指定として持たせ、既存の音を変えない**（本人が承認済みの音のため）。
他の19音階はすべて導出。`SCALES` の各レコードは省略可能な `roles` を持てる形にし、指定があればそれを優先する。

## 2. 音階の定義（半音値。root からの相対）

```
ionian            0,2,4,5,7,9,11        dorian          0,2,3,5,7,9,10
phrygian          0,1,3,5,7,8,10        lydian          0,2,4,6,7,9,11
mixolydian        0,2,4,5,7,9,10        aeolian         0,2,3,5,7,8,10
locrian           0,1,3,5,6,8,10        harmonic_minor  0,2,3,5,7,8,11
melodic_minor     0,2,3,5,7,9,11        whole_tone      0,2,4,6,8,10
blues             0,3,5,6,7,10          major_pentatonic 0,2,4,7,9
minor_pentatonic  0,3,5,7,10            yo              0,2,5,7,9
in_sen            0,1,5,7,8             hirajoshi       0,2,3,7,8
ryukyu            0,4,5,7,11            hijaz           0,1,4,5,7,8,10
hungarian_minor   0,2,3,6,7,8,11        double_harmonic 0,1,4,5,7,8,11
egyptian          0,2,5,7,10
```

表示名とグループ（`<optgroup>`）:

- **教会旋法**: イオニアン（メジャー）／ドリアン／フリジアン／リディアン／ミクソリディアン／エオリアン（ナチュラル・マイナー）／ロクリアン
- **短音階の変種**: ハーモニック・マイナー／メロディック・マイナー
- **五音音階・ブルース**: メジャー・ペンタトニック／マイナー・ペンタトニック／ブルース／ホールトーン
- **日本の音階**: 陽音階／陰音階（都節）／平調子／琉球音階
- **その他の民族音階**: ヒジャーズ／ハンガリアン・マイナー／ダブル・ハーモニック／エジプシャン

**注意（README にも書く）**: 日本の音階や民族音階は文献により複数の版がある。ここで採用した半音値は一般に流通する一版であり、
唯一の正解ではない。差し替えられるよう `SCALES` の1か所にまとめる。

## 3. 和音の生成規則（既存2世界を完全再現することを確認済み）

音階の音数を N とする。**和音 = 音階内で1つ飛ばしに3つ積む**:
度数 d の和音の半音値 = `[0,2,4].map(o => intervals[(d-1+o) % N] + 12*floor((d-1+o)/N))`。

**機能する度数**:

```
N >= 7:  tonic=1, subdominant=4, submediant=6,
         dominant = (intervals[N-1] === 11) ? 5 : N     // 導音があれば5度、無ければ最終度
N <  7:  tonic=1, subdominant=3, dominant=4, submediant=2
```

**進行**（主和音の性質で分岐。これで既存2世界を完全再現）:

- 主和音が **長三和音**（第2音が+4, 第3音が+7）: 基本ループ `[tonic, tonic, subdominant, dominant]`
- 主和音が **短三和音**（+3, +7）: 基本ループ `[tonic, tonic, submediant, dominant]`
- それ以外（減・増・その他）: 長三和音と同じ扱い
- 緊張度による変化は現行どおり:
  - T<0.30 → 基本ループ
  - 0.30≤T<0.60 → 2小節目（index 1）を、長なら submediant／短なら subdominant に置換
  - T≥0.60 → 全小節 dominant
  - 着地時は次の拍頭で tonic へ（現行どおり）

**検証済み**: ionian → `I, I, IV, V`／mid `I, vi, IV, V`／high `V`（現行 daylight と一致）。
aeolian → `i, i, VI, VII`／mid `i, iv, VI, VII`／high `VII`（現行 night と一致）。

**和音名の表示**: 度数のローマ数字（I〜VII）に、実際の構成音から求めた性質を付ける。
長=大文字／短=小文字／減=小文字+`°`／増=大文字+`+`／それ以外=大文字+`*`。
（ionian・aeolian の8つの和音名がすべて現行表示と一致することを確認済み）

## 4. キー配分（26キー）

現行は 安定12／浮遊7／緊張7 の固定値。これを規則にする:

各役割に `26 × (その役割の度数の数) ÷ N` を割り当て、**小数を切り捨て、余りを 安定→浮遊→緊張 の順に1つずつ配る**
（度数が0個の役割は飛ばす）。**ionian でちょうど 12/7/7 になることを確認済み。**
例: 五音音階（安定3・浮遊2・緊張0）→ 16/10/0。ハーモニック・マイナー（3/1/3）→ 12/3/11。

エフェクトの配分（none 14／delay 4／sweep 3／octave 3／stutter 2）は音階に関係なく現行どおり。

## 5. 残り時間の表示

- **上帯**に「残り 23秒」を追加（`--fs-small`、`--text-sub`）。**小数は出さない**（整数＋単位）。
  - `countin`: 「まもなく開始」（残り時間は出さない）
  - `playing` / `replay`: 「残り n秒」（テイク終端まで。0秒で消える）
  - `idle` / `finished`: 出さない
- **進捗バー**: ビューポート最上端に高さ `--progress-height`（3px）の帯。左→右に伸びる。
  トラック＝`--text` の 12%、フィル＝`--ink-floating`。`countin` 中は伸ばさない。
  `prefers-reduced-motion` でも表示する（動きではなく状態表示のため）。ただし遷移アニメーションは付けない。
- 更新は既存の描画ループ内（`updateDisplay`）で行い、タイマーを増やさない。

## 6. UI・データの変更

- 待機画面のフォーム行に **「スケール」** の `<select>`（`<optgroup>` でグループ分け、§2）。既定は世界の既定スケール
  （daylight→イオニアン、night→エオリアン）。**世界を切り替えてもスケールの選択は保持する**（既定に戻さない）。
- 演奏中は他のフォームと同様に無効化。
- URL 共有パラメータに `scale` を追加（例 `?world=night&scale=hirajoshi&seed=...`）。未知の値は世界の既定へフォールバック。
- イベントログに `scaleId` を追加。**`scaleId` の無い古いログを読んだときは世界の既定スケールとして扱う**（daylight→ionian、night→aeolian）。
- 完了パネルの1行に音階の表示名を出す（例「スケール: 平調子」）。
- 版表示 v0.7.0。

## 7. テスト（`node --test`）

1. `deriveRoles(intervals)`: ionian で `{stable:[1,3,5],floating:[2,6],tension:[4,7]}`、major_pentatonic で tension 空かつ `gentle`
2. `SCALES.ionian` の実効役割が導出と一致し、`SCALES.aeolian` は明示テーブル（浮遊2,4／緊張6,7）が使われる
3. `allocateKeys(roles)`: ionian で 12/7/7、major_pentatonic で 16/10/0、合計が常に26
4. `chordDegrees(scaleId)`: ionian → tonic1/sub4/dom5/submed6、aeolian → tonic1/sub4/dom7/submed6
5. `chordForBar`: ionian で T=0 のとき `[I,I,IV,V]`、T=0.4 で index1 が vi、T=0.7 で全 dominant。aeolian で `[i,i,VI,VII]` / index1 が iv
6. `chordLabel`: ionian の4和音が `I, IV, V, vi`、aeolian が `i, iv, VII, VI`
7. `gentle` 音階で floating の緊張度加算が 0.12、通常音階で 0.05
8. 全21音階について: 度数がすべていずれかの役割に入る／`allocateKeys` の合計が26／和音の構成音が3つ／例外を投げない
9. `remainingSeconds(now, takeStart, takeEnd)`: 開始前・途中・終端で 整数秒（負にならない）
10. 既存テスト（app 24・prototype 15）が通ること。**aeolian と ionian の既存挙動が変わらないこと**を明示的に確認する

## 8. 完了条件

- 全テスト通過、`node --check` 全JS/MJS、**ブラウザで console error 0（起動確認を必ず行う）**
- 21音階すべてを選んで「演奏開始」が例外なく通る（Claudeがブラウザで全数確認する）
- daylight+ionian と night+aeolian で、同じ seed・同じ打鍵列のミックスWAVが M1 基準と ±2LSB 以内（＝既存の音が変わっていない）
- 残り時間と進捗バーが演奏中に減っていく
- 実機未確認の項目は明記
