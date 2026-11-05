// pitch.js（いまの音の高さを1つに決める係）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePitch, PitchSmoother } from '../js/pitch.js';
import { computeFeatures } from '../js/features.js';
import { SoundClassifier } from '../js/classify.js';
import { noteInfo } from '../js/dsp.js';

const sr = 48000;
const sine = (f, n = 4096, a = 0.3) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / sr));

test('高さを選ぶ：純音はその高さ、静寂と衝撃音は「高さなし」', () => {
  const f = computeFeatures(sine(440), sr);
  const p = choosePitch(f, 'tonal');
  assert.equal(p.kind, 'f0');
  assert.ok(Math.abs(p.hz - 440) < 2, `${p.hz}`);
  assert.equal(choosePitch(f, 'silence'), null);
  assert.equal(choosePitch(f, 'impulse'), null);
});

test('高さを選ぶ：鈴のように倍音が整数倍でない音は、いちばん強い成分（ファ♯5 ≒ 740 Hz）', () => {
  // 740 Hz と、整数倍でない 2.71 倍・5.12 倍の成分（鈴・おりんの響きのまね）
  const n = 4096;
  const ring = Float32Array.from({ length: n }, (_, i) => {
    const t = i / sr;
    return 0.3 * Math.sin(2 * Math.PI * 740 * t) + 0.12 * Math.sin(2 * Math.PI * 740 * 2.71 * t) + 0.06 * Math.sin(2 * Math.PI * 740 * 5.12 * t);
  });
  const cls = new SoundClassifier({ unit: 'dbfs' });
  let p = null;
  for (let k = 0; k < 6; k++) {
    const f = computeFeatures(ring, sr);
    p = choosePitch(f, cls.push(f, f.dbA).id);
  }
  assert.ok(p, '高さが出ない');
  assert.equal(noteInfo(p.hz).en, 'F♯5');
});

test('ちらつき防止：直近3回の中央値。1半音より大きく飛んだら数え直し、高さがなければ忘れる', () => {
  const s = new PitchSmoother();
  const f0 = (hz) => ({ hz, kind: 'f0' });
  assert.equal(s.push(f0(440)).hz, 440);
  assert.equal(s.push(f0(450)).hz, 450, '2つなら新しい方（中央の位置）');
  assert.equal(s.push(f0(300 * 1.47)).hz, 441, '3つの中央値');
  assert.equal(s.push(f0(880)).hz, 880, '1オクターブ飛んだら、前の高さを引きずらない');
  assert.equal(s.push(null), null);
  assert.equal(s.push(f0(523.3)).hz, 523.3, '高さがなかったあとは、新しく数える');
  assert.equal(s.push({ hz: 520, kind: 'peak' }).kind, 'peak', '種類は新しいものを返す');
});
