// レビューを受けて足したもののテスト：速い観察窓（高い音の光をすばやく）・録画の形式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARM_COUNT,
  KOUHAI_FFT_SIZE,
  KOUHAI_FAST_FFT_SIZE,
  FAST_FROM_HZ,
  FAST_FULL_HZ,
  fastWeight,
  armLevels,
  armBinMap,
  turnToFreq,
  KOUHAI_OCTAVES,
} from '../js/kouhai.js';
import { analyserLikeDb } from '../js/dsp.js';
import { videoType, videoExt, clock, VIDEO_TYPES, MAX_SECONDS } from '../js/recorder.js';

const SR = 48000;

test('速い観察窓の混ぜ方：400 Hz までは細かい窓だけ、800 Hz からは速い窓だけ、あいだは少しずつ', () => {
  assert.equal(fastWeight(65), 0);
  assert.equal(fastWeight(FAST_FROM_HZ), 0);
  assert.equal(fastWeight(FAST_FULL_HZ), 1);
  assert.equal(fastWeight(8000), 1);
  assert.ok(Math.abs(fastWeight(Math.sqrt(FAST_FROM_HZ * FAST_FULL_HZ)) - 0.5) < 1e-9, 'まん中（オクターブの半分）で半々');
  assert.equal(fastWeight(NaN), 0);
  // 速い窓を使う所では、半音の幅が区分（約 11.7 Hz）3つ分より広い
  const semitone = FAST_FROM_HZ * (2 ** (1 / 12) - 1);
  assert.ok(semitone / (SR / KOUHAI_FAST_FFT_SIZE) >= 2, `400 Hz の半音は ${semitone.toFixed(1)} Hz`);
});

test('千本の光の大きさ：速い窓がなければ細かい窓だけ、あれば高い音ほど速い窓の値になる', () => {
  const slow = new Float32Array(KOUHAI_FFT_SIZE / 2).fill(-60);
  const fast = new Float32Array(KOUHAI_FAST_FFT_SIZE / 2).fill(-100);
  const maps = {
    slow: armBinMap(SR / KOUHAI_FFT_SIZE, KOUHAI_FFT_SIZE / 2),
    fast: armBinMap(SR / KOUHAI_FAST_FFT_SIZE, KOUHAI_FAST_FFT_SIZE / 2),
    weight: Float32Array.from({ length: ARM_COUNT }, (_, i) => fastWeight(turnToFreq(((i + 0.5) / ARM_COUNT) * KOUHAI_OCTAVES))),
  };
  const out = new Float32Array(ARM_COUNT);
  assert.equal(armLevels(slow, null, maps, out), -60);
  assert.ok(out.every((v) => v === -60), '速い窓がないときは、細かい窓の値そのまま');
  armLevels(slow, fast, maps, out);
  assert.equal(out[0], -60, 'いちばん内側（低い音）は細かい窓');
  assert.equal(out[ARM_COUNT - 1], -100, 'いちばん外側（高い音）は速い窓');
  const mid = out.findIndex((v) => v < -60 && v > -100);
  assert.ok(mid > 0, 'あいだは2つを混ぜる（つなぎ目を見せない）');
  for (let i = 1; i < ARM_COUNT; i++) assert.ok(out[i] <= out[i - 1] + 1e-4, '外へ行くほど、なめらかに速い窓へ');
});

test('速い観察窓は、音が止まったことに4倍早く気づく（880 Hz を止めて 0.1 秒後）', () => {
  const tone = 880;
  const total = SR; // 1秒
  const stopAt = Math.round(0.5 * SR);
  const x = Float32Array.from({ length: total }, (_, i) => (i < stopAt ? 0.5 * Math.sin((2 * Math.PI * tone * i) / SR) : 0));
  const now = stopAt + Math.round(0.1 * SR); // 止めてから 0.1 秒後
  const peak = (n) => {
    const db = new Float32Array(n / 2);
    analyserLikeDb(x.subarray(now - n, now), n, db);
    return db[Math.round((tone * n) / SR)];
  };
  const slow = peak(KOUHAI_FFT_SIZE);
  const fast = peak(KOUHAI_FAST_FFT_SIZE);
  assert.ok(slow > -40, `細かい窓には、まだ音が残っている（${slow.toFixed(1)} dB）`);
  assert.ok(fast < -100, `速い窓では、もう消えている（${fast.toFixed(1)} dB）`);
  assert.equal(KOUHAI_FFT_SIZE / KOUHAI_FAST_FFT_SIZE, 4);
});

test('録画：作れる形式を選ぶ（iPhone の MP4 を先に）。作れなければ空', () => {
  const env = (supported) => ({
    MediaRecorder: Object.assign(function MediaRecorder() {}, { isTypeSupported: (t) => supported.includes(t) }),
    HTMLCanvasElement: { prototype: { captureStream() {} } },
  });
  assert.equal(videoType(env(['video/mp4', 'video/webm'])), 'video/mp4');
  assert.equal(videoType(env(['video/webm;codecs=vp9,opus', 'video/webm'])), 'video/webm;codecs=vp9,opus');
  assert.equal(videoType(env([])), '');
  assert.equal(videoType({}), '', 'MediaRecorder がない');
  assert.equal(videoType({ MediaRecorder: function () {}, HTMLCanvasElement: { prototype: {} } }), '', 'captureStream がない');
  assert.ok(VIDEO_TYPES[0].startsWith('video/mp4'));
  assert.equal(videoExt('video/mp4;codecs=avc1,mp4a.40.2'), 'mp4');
  assert.equal(videoExt('video/webm;codecs=vp9,opus'), 'webm');
  assert.equal(clock(0), '0:00');
  assert.equal(clock(5.9), '0:05');
  assert.equal(clock(MAX_SECONDS), '0:30');
  assert.equal(clock(75), '1:15');
});
