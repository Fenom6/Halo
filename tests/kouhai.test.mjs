// kouhai.js（光背：音の高さを螺旋に並べる見方）の、位置の計算のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARM_COUNT,
  KOUHAI_OCTAVES,
  KOUHAI_FMIN,
  freqToTurn,
  turnToFreq,
  spiralPoint,
  pointToFreq,
  armBinMap,
} from '../js/kouhai.js';
import { midiToFreq } from '../js/dsp.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} 期待 ${b} ±${tol}、実際 ${a}`);

test('螺旋の周回：いちばん内側がド C2、1周で1オクターブ（周波数が2倍）', () => {
  near(KOUHAI_FMIN, 65.406, 0.001, 'C2');
  near(freqToTurn(KOUHAI_FMIN), 0, 1e-12);
  near(freqToTurn(midiToFreq(48)), 1, 1e-12, 'C3 で1周');
  near(freqToTurn(440), 2.75, 1e-12, 'ラ A4 は2周と 9/12');
  near(turnToFreq(freqToTurn(1234.5)), 1234.5, 1e-9);
});

test('向き：12時がド、時計回りに半音ずつ（3時がレ♯、6時がファ♯、9時がラ）', () => {
  const size = 300;
  const at = (semitone) => spiralPoint(1 + semitone / 12, size);
  const c = at(0);
  near(c.x, 0, 1e-9, 'ド：真上');
  assert.ok(c.y < 0);
  const ds = at(3);
  near(ds.y, 0, 1e-9, 'レ♯：真横');
  assert.ok(ds.x > 0, 'レ♯は右（時計回り）');
  const fs = at(6);
  near(fs.x, 0, 1e-9, 'ファ♯：真下');
  assert.ok(fs.y > 0);
  const a = at(9);
  near(a.y, 0, 1e-9, 'ラ：真横');
  assert.ok(a.x < 0, 'ラは左');
  // 同じ音名は同じ向き、外側ほど遠い
  const a4 = spiralPoint(freqToTurn(440), size);
  const a5 = spiralPoint(freqToTurn(880), size);
  near(Math.atan2(a4.y, a4.x), Math.atan2(a5.y, a5.x), 1e-9, 'ラ4 とラ5 は同じ向き');
  assert.ok(a5.r > a4.r);
});

test('絵に触れた点から、もとの高さに戻せる', () => {
  const size = 320;
  for (const f of [70, 110, 261.6, 440, 739.99, 1000, 2960, 8000]) {
    const p = spiralPoint(freqToTurn(f), size);
    near(pointToFreq(p.x, p.y, size), f, f * 0.001, `${f} Hz`);
    // 少しずれた所に触れても、いちばん近い高さを返す（半音の 1/3 以内）
    const q = pointToFreq(p.x * 1.01, p.y * 1.01, size);
    assert.ok(Math.abs(12 * Math.log2(q / f)) < 0.34, `${f} Hz の近く → ${q}`);
  }
});

test('千本の光の受け持ち：低い音は補間、高い音は範囲の最大値。ビンの番号ははみ出さない', () => {
  const sr = 48000;
  const n = 4096;
  const map = armBinMap(sr / n, n / 2);
  assert.equal(map.mode.length, ARM_COUNT);
  assert.equal(map.mode[0], 0, 'いちばん低い光は、隣のビンと補間');
  assert.equal(map.mode[ARM_COUNT - 1], 1, 'いちばん高い光は、範囲の最大値');
  for (let i = 0; i < ARM_COUNT; i++) {
    assert.ok(map.a[i] >= 0 && map.a[i] <= n / 2 - 1);
    if (map.mode[i] === 1) assert.ok(map.b[i] >= map.a[i] && map.b[i] <= n / 2 - 1);
  }
  // 最後の光の受け持ちは、C9（約 8,372 Hz）のあたり
  near((map.b[ARM_COUNT - 1] * sr) / n, midiToFreq(36 + 12 * KOUHAI_OCTAVES), sr / n + 1, 'C9');
});
