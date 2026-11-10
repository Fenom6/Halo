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
import {
  videoType, videoExt, clock, limitReached, VIDEO_TYPES, MAX_SECONDS, MAX_BYTES, VIDEO_BPS,
  recordPlan, estimate, sizeText, audioType, audioExt, LENGTHS, QUALITIES, MAX_BYTES_DESKTOP, AUDIO_BPS, AUDIO_MAX_SECONDS, AUDIO_TYPES,
} from '../js/recorder.js';

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
  assert.equal(clock(MAX_SECONDS), '30:00');
  assert.equal(clock(75), '1:15');
});

test('録画：30 分まで録れる。時間か大きさの上限で自動で止まる', () => {
  assert.equal(MAX_SECONDS, 30 * 60);
  assert.equal(limitReached(0, 0), '');
  assert.equal(limitReached(MAX_SECONDS - 0.1, MAX_BYTES - 1), '', '上限の手前では止めない');
  assert.equal(limitReached(MAX_SECONDS, 0), 'time');
  assert.equal(limitReached(60, MAX_BYTES), 'size');
  // 映像（VIDEO_BPS）と音（多めに見て 192 kbps）を 30 分録っても、大きさの上限におさまる
  assert.ok(((VIDEO_BPS + 192_000) * MAX_SECONDS) / 8 < MAX_BYTES, '30 分の前に、大きさの上限で止まってしまう');
});

test('録画（パソコンなど）：長さと画質を選べる。スマホでは、いつも 30 分・標準', () => {
  assert.deepEqual(LENGTHS, [30, 60, 120]);
  assert.deepEqual(Object.keys(QUALITIES), ['standard', 'high', 'best']);
  // スマホ：何を覚えていても、30 分・標準・600 MB
  const phone = recordPlan({ desktop: false, minutes: 120, quality: 'best' });
  assert.deepEqual([phone.maxSeconds, phone.maxBytes, phone.videoBps], [MAX_SECONDS, MAX_BYTES, VIDEO_BPS]);
  // パソコン：選んだとおり。大きさの上限は 2 GB
  const pc = recordPlan({ desktop: true, minutes: 60, quality: 'high' });
  assert.deepEqual([pc.maxSeconds, pc.maxBytes, pc.videoBps], [3600, MAX_BYTES_DESKTOP, QUALITIES.high.bps]);
  // 知らない値は、はじめの値に戻す
  const odd = recordPlan({ desktop: true, minutes: 7, quality: 'ultra' });
  assert.deepEqual([odd.minutes, odd.quality], [30, 'standard']);
  // 上限は、決まりの値で判定する
  assert.equal(limitReached(1800, 0, pc.maxSeconds, pc.maxBytes), '');
  assert.equal(limitReached(3600, 0, pc.maxSeconds, pc.maxBytes), 'time');
  assert.equal(limitReached(10, MAX_BYTES_DESKTOP, pc.maxSeconds, pc.maxBytes), 'size');
});

test('録画（パソコンなど）：大きさの見積もり。上限に先に届くときは、その時間を答える', () => {
  // 1 時間・高画質：（5,000,000 + 128,000）× 3600 ÷ 8 ≒ 2.3 GB → 2 GB の上限に先に届く
  const big = estimate(recordPlan({ desktop: true, minutes: 60, quality: 'high' }));
  assert.equal(big.capped, true);
  assert.equal(big.bytes, MAX_BYTES_DESKTOP);
  assert.equal(big.seconds, Math.floor(MAX_BYTES_DESKTOP / ((5_000_000 + AUDIO_BPS) / 8)));
  // 30 分・標準：上限におさまる
  const small = estimate(recordPlan({ desktop: true }));
  assert.equal(small.capped, false);
  assert.equal(small.seconds, 1800);
  assert.equal(small.bytes, ((VIDEO_BPS + AUDIO_BPS) / 8) * 1800);
  assert.equal(sizeText(small.bytes), '560 MB');
  assert.equal(sizeText(MAX_BYTES_DESKTOP), '2.0 GB');
});

test('録音：作れる形式を選ぶ（iPhone の M4A を先に）。2 時間録っても、スマホの大きさの上限におさまる', () => {
  const env = (supported) => ({
    MediaRecorder: Object.assign(function MediaRecorder() {}, { isTypeSupported: (t) => supported.includes(t) }),
    MediaStream: function MediaStream() {},
  });
  assert.equal(audioType(env(['audio/mp4', 'audio/webm'])), 'audio/mp4');
  assert.equal(audioType(env(['audio/webm;codecs=opus', 'audio/webm'])), 'audio/webm;codecs=opus');
  assert.equal(audioType(env([])), '');
  assert.equal(audioType({}), '', 'MediaRecorder がない');
  assert.ok(AUDIO_TYPES[0].startsWith('audio/mp4'));
  assert.equal(audioExt('audio/mp4;codecs=mp4a.40.2'), 'm4a');
  assert.equal(audioExt('audio/webm;codecs=opus'), 'webm');
  assert.equal(audioExt('audio/ogg;codecs=opus'), 'ogg');
  assert.equal(AUDIO_MAX_SECONDS, 2 * 60 * 60);
  assert.ok((AUDIO_BPS * AUDIO_MAX_SECONDS) / 8 < MAX_BYTES);
});
