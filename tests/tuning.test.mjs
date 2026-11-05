// tuning.js（世界の音楽に合わせる設定：基準の高さ・音名の表し方・主音・四分音）のテスト
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NAMINGS, A4_CHOICES, DEFAULT_TUNING, tuning, setTuning, onTuning, pcName, isAccidental, hourOf, baseMidi, describe, midiHz } from '../js/tuning.js';
import { syncSpiral, freqToTurn, spiralPoint, pointToMidi, ringOf, KOUHAI_OCTAVES } from '../js/kouhai.js';
import { midiToFreq } from '../js/dsp.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} 期待 ${b} ±${tol}、実際 ${a}`);

afterEach(() => {
  setTuning({ ...DEFAULT_TUNING });
  syncSpiral();
});

test('ふだんの設定：ラ＝440 Hz・ドレミ・12時がド', () => {
  assert.deepEqual({ ...DEFAULT_TUNING }, { a4: 440, tonic: 0, naming: 'ja', quarter: false });
  const n = describe(440);
  assert.equal(n.name, 'ラ');
  assert.equal(n.en, 'A4');
  assert.equal(n.cents, 0);
  assert.equal(n.hour, 9);
  assert.equal(n.octave, 4);
  near(n.target, 440, 1e-9);
  assert.equal(describe(0), null);
  assert.equal(describe(-5), null);
});

test('基準の高さ：442 Hz の基準で 440 Hz を聞くと、約 8 セント低い', () => {
  setTuning({ a4: 442 });
  const n = describe(440);
  assert.equal(n.name, 'ラ');
  // 1200 × log2(440 ÷ 442) ≒ −7.85
  assert.equal(n.cents, -8);
  near(n.target, 442, 1e-9);
  near(midiHz(69), 442, 1e-9, '鳴らす高さも基準どおり');
  near(midiHz(57), 221, 1e-9, '1オクターブ下');
  // バロックの 415 Hz なら、440 Hz はほぼ半音上の「ラ♯」
  setTuning({ a4: 415 });
  const b = describe(440);
  assert.equal(b.name, 'ラ♯');
  near(b.cents, 1, 1, '415 × 2^(1/12) ≒ 439.7');
});

test('基準の高さ：おかしな値は無視する。選べる値はどれも受け付ける', () => {
  assert.equal(setTuning({ a4: 0 }), false);
  assert.equal(setTuning({ a4: NaN }), false);
  assert.equal(setTuning({ a4: 1000 }), false);
  assert.equal(tuning.a4, 440);
  for (const hz of A4_CHOICES) {
    setTuning({ a4: hz });
    assert.equal(tuning.a4, hz);
  }
  assert.equal(setTuning({ naming: 'klingon' }), false);
  assert.equal(setTuning({ naming: 'toString' }), false, '名前の一覧にない名前');
});

test('音名の表し方：どれも12個そろっていて、説明が日本語・英語の両方ある', () => {
  for (const [key, n] of Object.entries(NAMINGS)) {
    const lists = Array.isArray(n.names) ? [n.names] : Object.values(n.names);
    for (const names of lists) {
      assert.equal(names.length, 12, key);
      assert.equal(new Set(names).size, 12, `${key}：同じ名前が2つない`);
    }
    for (const field of ['title', 'where']) for (const lang of ['ja', 'en']) assert.ok(n[field][lang], `${key}.${field}.${lang}`);
  }
});

test('ドイツ式：シは H、シ♭は B、ファ♯は Fis', () => {
  setTuning({ naming: 'de' });
  assert.equal(pcName(11), 'H');
  assert.equal(pcName(10), 'B');
  assert.equal(pcName(6), 'Fis');
  assert.equal(isAccidental(10), true, 'B（シ♭）は黒鍵');
  assert.equal(isAccidental(11), false);
  assert.equal(describe(493.88).name, 'H');
});

test('固定ド（ラテン式）と英語：ドがいつも C', () => {
  setTuning({ naming: 'solfege', tonic: 7 });
  assert.equal(pcName(0), 'Do', '主音を変えても、Do は C のまま');
  assert.equal(pcName(7), 'Sol');
  setTuning({ naming: 'en' });
  assert.equal(pcName(9), 'A');
  assert.equal(isAccidental(1), true);
  assert.equal(isAccidental(2), false);
});

test('サルガム：主音がサ（Sa）。主音をレ（D）にすると、レが Sa・ラが Pa、12時に Sa', () => {
  setTuning({ naming: 'sargam', tonic: 2 });
  assert.equal(pcName(2), 'Sa');
  assert.equal(pcName(9), 'Pa');
  assert.equal(pcName(4), 'Re');
  assert.equal(pcName(3), 're', 'コーマル（低めの）レ');
  assert.equal(pcName(8), 'Ma′', 'ティーヴラ（高めの）マ');
  assert.equal(hourOf(2), 12);
  assert.equal(hourOf(9), 7, 'Pa（5度）は7時');
  assert.equal(isAccidental(3), true);
  assert.equal(isAccidental(4), false);
  assert.equal(describe(293.66).name, 'Sa');
});

test('移動ドと数字譜：主音がド・1', () => {
  setTuning({ naming: 'movable', tonic: 7 });
  assert.equal(pcName(7), 'ド');
  assert.equal(pcName(11), 'ミ');
  assert.equal(pcName(5), 'シ♭', 'ソの調の ファ は、主音から短7度');
  setTuning({ naming: 'jianpu', tonic: 9 });
  assert.equal(pcName(9), '1');
  assert.equal(pcName(0), '♭3', 'ラが主音なら、ドは短3度');
  assert.equal(pcName(4), '5');
});

test('主音を12時に：時計の向きは、主音から時計回りに半音ずつ', () => {
  assert.equal(hourOf(0), 12);
  assert.equal(hourOf(9), 9);
  setTuning({ tonic: 9 });
  assert.equal(hourOf(9), 12);
  assert.equal(hourOf(0), 3, 'ラが12時なら、ドは3時');
  assert.equal(hourOf(8), 11);
  assert.equal(setTuning({ tonic: 21 }), false, '21 は 9 と同じ（12 で割った余り）');
  setTuning({ tonic: -1 });
  assert.equal(tuning.tonic, 11);
});

test('螺旋のいちばん内側：主音から始まり、C2 から半オクターブ以内', () => {
  assert.equal(baseMidi(0), 36);
  assert.equal(baseMidi(6), 42);
  assert.equal(baseMidi(7), 31);
  assert.equal(baseMidi(11), 35);
  for (let t = 0; t < 12; t++) {
    const b = baseMidi(t);
    assert.ok(Math.abs(b - 36) <= 6, `主音 ${t}`);
    assert.equal(((b % 12) + 12) % 12, t);
  }
});

test('主音を変えると螺旋が回る：主音は整数の周回（12時）、主音の真上に触れると主音が鳴る', () => {
  setTuning({ tonic: 9 });
  syncSpiral();
  near(freqToTurn(55), 0, 1e-12, 'いちばん内側はラ A1');
  near(freqToTurn(220), 2, 1e-12, 'ラ A3 は 2周ちょうど（12時）');
  near(freqToTurn(261.63), 2.25, 1e-4, 'ド C4 は3時の向き');
  const size = 400;
  for (let k = 0; k <= KOUHAI_OCTAVES; k++) {
    const p = spiralPoint(k, size);
    near(p.x, 0, 1e-9, '12時の向き（まっすぐ上）');
    assert.ok(p.y < 0);
    assert.equal(pointToMidi(p.x, p.y, size), 33 + 12 * k, `${k} 周目の主音`);
  }
  assert.equal(ringOf(57), 3);
  assert.equal(ringOf(56), 2);
});

test('基準の高さを変えると、螺旋もその分だけずれる（442 Hz の基準で 442 Hz がラの向き）', () => {
  setTuning({ a4: 442 });
  syncSpiral();
  near(freqToTurn(442), 2.75, 1e-12);
  const p = spiralPoint(2.75, 400);
  assert.equal(pointToMidi(p.x, p.y, 400), 69);
});

test('四分音：半音のまん中の音は、上の音から「四分音低い」と呼ぶ', () => {
  setTuning({ quarter: true });
  const eHalfFlat = describe(midiToFreq(63.5)); // ミ♭ と ミ のまん中（アラブ音楽のスィーカ）
  assert.equal(eHalfFlat.quarter, true);
  assert.equal(eHalfFlat.name, 'ミ−¼');
  assert.equal(eHalfFlat.en, 'E−¼4');
  assert.equal(eHalfFlat.hour, 4);
  assert.equal(eHalfFlat.cents, 0);
  near(eHalfFlat.target, midiToFreq(63.5), 1e-9);
  const sharp = describe(midiToFreq(63.6));
  assert.equal(sharp.name, 'ミ−¼');
  assert.equal(sharp.cents, 10);
  // 半音にいちばん近いときは、ふつうの名前
  const e = describe(midiToFreq(63.8));
  assert.equal(e.quarter, false);
  assert.equal(e.name, 'ミ');
  assert.equal(e.cents, -20);
  // 四分音を出さないときは、半音までで丸める（同じ音が ±50 セント）
  setTuning({ quarter: false });
  const off = describe(midiToFreq(63.6));
  assert.equal(off.name, 'ミ');
  assert.equal(off.cents, -40);
});

test('設定が変わったときだけ知らせる。知らせをやめられる', () => {
  const seen = [];
  const stop = onTuning((s) => seen.push(s));
  assert.equal(setTuning({ a4: 440 }), false);
  assert.equal(setTuning({ a4: 442, naming: 'de' }), true);
  stop();
  setTuning({ a4: 443 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].a4, 442);
  assert.equal(seen[0].naming, 'de');
});
