// dsp.js のテスト：答えがわかっている「作った信号」を入れて、計算が正しいか確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fft,
  rms,
  ampToDb,
  powerToDb,
  powerSpectrum,
  weightedLevelDb,
  aWeightingDb,
  aWeightTable,
  yinPitch,
  noteInfo,
  freqToMidi,
  midiToFreq,
  spectralCentroid,
  bandFlatness,
  peakFrequency,
  analyserLikeDb,
} from '../js/dsp.js';

/** 種（seed）を決めた乱数（毎回同じ数の並びになる） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SR = 48000;

function sine(freq, seconds = 0.1, amp = 1, sr = SR) {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

function noise(n, seed = 1, amp = 0.3) {
  const r = mulberry32(seed);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (r() * 2 - 1) * amp;
  return x;
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} 期待 ${b} ±${tol}、実際 ${a}`);

test('FFT：1つのサイン波は、その周波数のビンだけに現れる', () => {
  const n = 64;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
  fft(re, im);
  const mag = Array.from(re, (r, k) => Math.hypot(r, im[k]));
  near(mag[5], n / 2, 1e-9, 'ビン5');
  near(mag[n - 5], n / 2, 1e-9, '鏡のビン');
  for (let k = 0; k < n; k++) if (k !== 5 && k !== n - 5) near(mag[k], 0, 1e-9, `ビン${k}`);
});

test('FFT：長さが 2 のべき乗でないとエラーにする', () => {
  assert.throws(() => fft(new Float64Array(6), new Float64Array(6)));
});

test('RMS と dB：振幅1のサイン波の RMS は 1/√2（約 -3 dB）', () => {
  const x = sine(1000, 0.1);
  near(rms(x), Math.SQRT1_2, 1e-3);
  near(ampToDb(rms(x)), -3.01, 0.02);
  near(ampToDb(2) - ampToDb(1), 6.02, 0.01, '振幅2倍は約 +6 dB');
  near(powerToDb(2) - powerToDb(1), 3.01, 0.01, 'エネルギー2倍は約 +3 dB');
});

test('パワースペクトルの合計は、元の音の平均二乗に一致する（パーセバルの定理）', () => {
  const x = sine(997, 4096 / SR, 0.5);
  const p = powerSpectrum(x, 4096);
  near(powerToDb(p.reduce((a, b) => a + b, 0)), ampToDb(rms(x)), 0.1);
  const y = noise(4096, 3);
  const q = powerSpectrum(y, 4096);
  near(powerToDb(q.reduce((a, b) => a + b, 0)), ampToDb(rms(y)), 0.5, '雑音');
});

test('A特性：1 kHz で 0 dB、100 Hz で約 -19 dB、低い音ほど小さく見積もる', () => {
  near(aWeightingDb(1000), 0, 0.05);
  near(aWeightingDb(100), -19.1, 0.2);
  near(aWeightingDb(10000), -2.5, 0.2);
  assert.ok(aWeightingDb(50) < aWeightingDb(200));
  const n = 4096;
  const lo = powerSpectrum(sine(100, n / SR, 0.5), n);
  const mid = powerSpectrum(sine(1000, n / SR, 0.5), n);
  const w = aWeightTable(n, SR);
  near(weightedLevelDb(mid, w) - weightedLevelDb(mid, null), 0, 0.3, '1 kHz はほぼそのまま');
  near(weightedLevelDb(lo, w) - weightedLevelDb(lo, null), -19.1, 0.8, '100 Hz は約 -19 dB');
});

test('YIN：サイン波・倍音を含む音の高さを 0.5% 以内で当てる', () => {
  for (const f of [82.4, 110, 220, 440, 880, 1760, 3000]) {
    const { freq, clarity } = yinPitch(sine(f, 2048 / SR, 0.5), SR, { fMin: 60, fMax: 4000 });
    near(freq, f, f * 0.005, `${f} Hz`);
    assert.ok(clarity > 0.9, `${f} Hz の周期性 ${clarity}`);
  }
  // 基本の高さより倍音のほうが強い音でも、基本の高さを答える
  const n = 2048;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    x[i] = 0.3 * Math.sin(2 * Math.PI * 150 * t) + 0.6 * Math.sin(2 * Math.PI * 300 * t) + 0.4 * Math.sin(2 * Math.PI * 450 * t);
  }
  near(yinPitch(x, SR, { fMin: 60, fMax: 4000 }).freq, 150, 1.5, '倍音が強い音');
});

test('YIN：雑音や無音は「高さがはっきりしない」', () => {
  assert.ok(yinPitch(noise(2048, 9), SR).clarity < 0.6, '雑音');
  assert.equal(yinPitch(new Float32Array(2048), SR).freq, 0, '無音');
});

test('音名：440 Hz はラ（A4）、261.63 Hz はド（C4）、セントのずれも出る', () => {
  assert.equal(noteInfo(440).en, 'A4');
  assert.equal(noteInfo(440).ja, 'ラ');
  assert.equal(noteInfo(261.63).en, 'C4');
  assert.equal(noteInfo(261.63).ja, 'ド');
  assert.equal(noteInfo(466.16).en, 'A♯4');
  assert.equal(noteInfo(440 * Math.pow(2, 10 / 1200)).cents, 10);
  near(midiToFreq(freqToMidi(523.25)), 523.25, 1e-9);
  assert.equal(noteInfo(0), null);
});

test('スペクトルの特徴：重心・平坦度・ピーク', () => {
  const n = 4096;
  const binHz = SR / n;
  const tone = powerSpectrum(sine(2000, n / SR, 0.5), n);
  near(spectralCentroid(tone, binHz, 50, 16000), 2000, 40, '純音の重心');
  near(peakFrequency(tone, binHz), 2000, 2, 'ピーク');
  const wn = powerSpectrum(noise(n, 5), n);
  assert.ok(bandFlatness(wn, binHz) > 0.4, `白色雑音の平坦度 ${bandFlatness(wn, binHz)}`);
  assert.ok(bandFlatness(tone, binHz) < 0.05, `純音の平坦度 ${bandFlatness(tone, binHz)}`);
});

test('AnalyserNode と同じ方式の dB：振幅1のサイン波のピークは約 -13.5 dB（Blackman 窓）', () => {
  const n = 4096;
  const f = (100 * SR) / n; // ちょうどビン100に乗る周波数
  const db = analyserLikeDb(sine(f, n / SR, 1), n);
  near(db[100], 20 * Math.log10(0.21), 0.1);
});

test('倍音のそろい具合：整数倍の音は高く、鐘のような整数倍でない音は低い', async () => {
  const { harmonicity } = await import('../js/dsp.js');
  const n = 4096;
  const binHz = SR / n;
  const make = (parts) => {
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) for (const [f, a] of parts) x[i] += a * Math.sin((2 * Math.PI * f * i) / SR);
    return powerSpectrum(x, n);
  };
  const voiceLike = make([[150, 1], [300, 0.7], [450, 0.5], [600, 0.4], [750, 0.3], [900, 0.2]]);
  const bellLike = make([[110, 1], [182, 0.55], [256, 0.5], [345, 0.32], [470, 0.2], [612, 0.12]]);
  assert.ok(harmonicity(voiceLike, binHz, 150) > 0.8, `声のような音 ${harmonicity(voiceLike, binHz, 150)}`);
  assert.ok(harmonicity(bellLike, binHz, 88) < 0.4, `鐘のような音 ${harmonicity(bellLike, binHz, 88)}`);
  assert.equal(harmonicity(voiceLike, binHz, 0), 0);
});
