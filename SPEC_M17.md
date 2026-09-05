# M17 仕様 — 音質パス1: リード音色のステレオ化 ＋ リバーブの初期反射（app v0.21.0）

作成: 2026-09-05 Claude（設計）。実装: Codex。検証: Claude（測定のみ）→ 本人（耳）。

本人方針（2026-09-05）: 「とりあえずはOKだと思います。あとはいい感じで音のクオリティを上げていこうと思います」
「両方しましょう」（= 別途進行中の `synth-engine` と、この app 自体の Web Audio シンセの直接チューニングを並行する）。

## 0. 設計の核

音の善し悪しの最終判定は本人の耳（Claudeは音を聴けない）。そのため今回は**構造的に効果が保証でき、
Claudeが数値で検証できる**2点だけに絞る。どちらも既存の音階・和音・伴奏・重力・リズム・SFX・レイアウトのロジックには触れない。

1. **リード音色のステレオ・ユニゾン化**: `saw`（±6セント2声）と `pluck`（0/+5セント2声）は、
   すでに2声デチューンしているのに**左右ともセンター（pan未指定）**で鳴っている。デチューンした2声をパンで
   左右に振り分ける（例: シンセの "ワイドユニゾン" と呼ばれる定番技法）だけで、時間経過とともに2声の位相が
   ずれていく分がステレオ感として聞こえるようになる。ゲイン・エンベロープ・カットオフ・タイミングは変えない。
2. **メインリバーブの初期反射（early reflections）追加**: 現行の `makeImpulseResponse` はプリディレイ
   （0.02秒の無音）のあと、いきなり白色雑音の指数減衰（拡散テール）が始まる。実際の部屋の反響は
   拡散が始まる前に**数本の離散的な初期反射**が来る（Moorerモデルなど定番のリバーブ設計）。
   このプリディレイの無音区間（0〜0.02秒）に、離散的な減衰パルスを5本差し込む。テール本体・
   `reverbInput`/`reverbOutput` のゲインは変えない。

## 1. `prototype/synth.js` の変更

### 1.1 リード音色のステレオ化（`scheduleSingle` 内、saw と pluck のみ）

現行:
```js
} else if (timbre === "saw") {
  releases.push(voice({ midi: note.midi + midiOffset, type: "sawtooth", detune: -6, gain: ..., ... }));
  releases.push(voice({ midi: note.midi + midiOffset, type: "sawtooth", detune: 6, gain: ..., ... }));
} else if (timbre === "pluck") {
  releases.push(voice({ midi: note.midi + midiOffset, type: "triangle", detune: 0, gain: ..., ... }));
  releases.push(voice({ midi: note.midi + midiOffset, type: "triangle", detune: 5, gain: ..., ... }));
  pluckTransient({ ... });
```

変更後: 各 `voice()` 呼び出しに `pan` を追加する。**負のデチューンに負のpan、正のデチューンに正のpan**を対応させる
（同じ方向にずらすことで自然な広がりになる。逆にすると位相が余計に打ち消し合う）。

- `saw`: detune `-6` の声に `pan: -0.2`、detune `6` の声に `pan: 0.2`。
- `pluck`: detune `0` の声（基準）は `pan: -0.15`、detune `5` の声は `pan: 0.15`。`pluckTransient`（アタックのノイズ音）は
  **パンしない**（トランジェントは1つしかなく、左右に分けると定位がぼやけるため。中央のまま）。

`epiano`・`bell` は**変更しない**（キャリアとオクターブ上のsine層は「ユニゾン」ではなく別倍音の重ねなので、
今回は対象外。将来 M18 以降で別途検討）。

`voice()` はすでに `pan` オプションを受け付ける（`pan !== null` で `StereoPannerNode` を挿入）。関数シグネチャ変更は不要。
ステム分離（`stem: "lead"` など）でも同じ `voice()` を通るので、パンはドライ出力・リバーブ送りの両方に自動的にかかる
（`connectWithReverb` は pan 適用後の `output` を使っているため、変更不要）。

### 1.2 リバーブの初期反射（`makeImpulseResponse`）

現行:
```js
function makeImpulseResponse(context, random) {
  const duration = 3;
  const predelay = 0.02;
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * duration), context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const time = index / context.sampleRate;
      data[index] = time < predelay
        ? 0
        : (random() * 2 - 1) * Math.exp((-6 * (time - predelay)) / (duration - predelay));
    }
  }
  return buffer;
}
```

変更後: 拡散テールを生成する既存の二重ループはそのまま残し、**チャンネルごとのループの最後**に、
プリディレイの無音区間（`time < predelay` の範囲）へ離散パルスを5本加算する処理を追加する。

```js
const EARLY_REFLECTION_TIMES = Object.freeze([0.005, 0.009, 0.013, 0.016, 0.019]); // 秒。全て predelay(0.02) 未満
const EARLY_REFLECTION_DECAY = 0.7; // 1本ごとのゲイン倍率

function makeImpulseResponse(context, random) {
  const duration = 3;
  const predelay = 0.02;
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * duration), context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const time = index / context.sampleRate;
      data[index] = time < predelay
        ? 0
        : (random() * 2 - 1) * Math.exp((-6 * (time - predelay)) / (duration - predelay));
    }
    EARLY_REFLECTION_TIMES.forEach((tapTime, tapIndex) => {
      const sampleIndex = Math.round(tapTime * context.sampleRate);
      if (sampleIndex >= data.length) return;
      const sign = random() < 0.5 ? -1 : 1;
      data[sampleIndex] += sign * EARLY_REFLECTION_DECAY ** tapIndex;
    });
  }
  return buffer;
}
```

- 乱数消費: 拡散テールのループ（既存）→ 5本のタップの符号決定（新規、チャンネルごとに5回）の順。**同じ `impulseRandom`
  ストリームを使い続ける**（新しい乱数源を作らない）。これにより `seed` が同じなら常に同じIRになる決定論は保たれる
  （消費順が変わるだけで、同一 seed → 同一結果という性質自体は変わらない）。
- L/R で `random()` を別々に呼ぶので、5本のタップの符号はチャンネルごとに独立 → 実際にステレオ差が生まれる
  （初期反射が左右非対称になるのは実際の部屋の反響でも自然な性質）。
- `sfxRoomImpulse`（`makeSfxRoomImpulse`、SFX専用の別関数）は**変更しない**（対象は main reverb のみ）。

## 2. 版・記録

- 版表示 **v0.21.0**（`app/index.html` の `title` と `.version`、対応するテスト）。`engine` は `accomp-v5` のまま
  （和音・伴奏ロジックは無変更のため）。
- README: 「リード音色（saw/pluck）はステレオユニゾン」「メインリバーブに初期反射5本を追加」を1行ずつ追記。

## 3. テスト（`prototype/tests/synth.test.mjs` に追加。既存テストは変更しない）

1. **ステレオ化**: `createSynth` でモック `AudioContext`（既存のテストダブルを流用）を使い、`scheduleLead` を
   `timbre: "saw"` と `timbre: "pluck"` それぞれで1回呼び、生成された `StereoPannerNode`（またはモックの相当ノード）の
   `pan.value` が saw で `[-0.2, 0.2]`、pluck で `[-0.15, 0.15]` になっていることを確認する。`epiano`・`bell` では
   `StereoPannerNode` が**増えていない**こと（今回変更していないことの回帰確認）。
2. **初期反射**: `makeImpulseResponse` を `mulberry32(1)` などの既知seedで直接呼び、`EARLY_REFLECTION_TIMES` に対応する
   サンプル位置が両チャンネルとも非ゼロであること、`predelay` より後（拡散テール本体）の統計的な性質
   （RMSや最大値のオーダー）が**変更前と大きく変わらない**こと（初期反射の追加分がテール全体を破壊していないことの確認）。
3. **決定論**: 同じ `seed` で `makeImpulseResponse` を2回呼び、bufferの中身が完全一致すること。
4. **クリップなし**: 21音階×2 seed 程度で1テイク分の合成レンダリング（既存の `design/verify/measure.html` 相当、
   もしくは軽量な同等チェックがすでに `prototype/tests/synth.test.mjs` にあればそれを流用）を行い、
   lead・fxステムのピークが1.0を超えないこと（パン追加でチャンネルごとの合算が増えていないか確認。
   理論上はパンで振るだけなのでLR個別のピークはむしろ下がる方向のはずだが、念のため実測する）。
5. `app/tests/ui-core.test.mjs` の版表示テストを v0.21.0 に更新。

## 4. 完了条件

- テスト全通過、`node --check` 全ファイル、**ブラウザ console error 0**、v0.21.0 表示。
- Claude 実測: ①saw/pluckの2声が指定どおりのpan値でステレオに分かれていること ②初期反射5本がIRの
  プリディレイ区間に存在し、L/Rで独立していること ③既存の決定論（同一seedで2回レンダーして±2LSB以内、
  複数音階×3回以上）が壊れていないこと ④lead/fxステムにクリップがないこと。
- 音の良し悪し（広がりが心地よいか、初期反射が自然に聞こえるか）は**本人の判断**。Claudeは「構造どおり実装され、
  既存の音階・和音・伴奏・レイアウトが壊れていないこと」までを保証する。

## 5. やらないこと

- メロディ・和音・伴奏・リズム・SFX・キーレイアウト・度数配分のロジック変更（一切なし）。
- epiano・bell のステレオ化（今回は対象外。本人の耳判定後、必要なら M18 で検討）。
- リバーブのテール本体（拡散アルゴリズム自体）やSFX専用ルームリバーブの変更。
- ゲイン構成・コンプレッサー・サチュレーターの調整。
