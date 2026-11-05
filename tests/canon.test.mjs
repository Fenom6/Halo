// canon.js（隠し味のカノン）と、サンプル「輪唱」のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteToMidi,
  mod12,
  GROUND_BASS,
  CANON_CHORDS,
  CANON_PHRASES,
  PHRASE_BEATS,
  ENTRY_BEATS,
  voiceNoteAt,
  bassAt,
  chordAt,
  canonEvents,
  canonVoicesAt,
  CANON_BPM,
  CANON_BEATS,
  CANON_LEAD_S,
  CANON_CODA,
  ALL_VOICES_BEAT,
  intervalsOf,
  findCanon,
  NoteSequence,
  SECRET_PATTERNS,
  EchoTrail,
  ECHO_DELAY_MS,
} from '../js/canon.js';
import { canonRound } from '../js/synth.js';
import { yinPitch, noteInfo, midiToFreq } from '../js/dsp.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} 期待 ${b} ±${tol}、実際 ${a}`);

test('音名 → MIDI 番号', () => {
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('F#2'), 42);
  assert.equal(noteToMidi('C♯5'), 73);
  assert.equal(noteToMidi('Bb3'), 58);
  assert.throws(() => noteToMidi('H2'));
});

test('楽譜：低音は8音、どのフレーズもちょうど8拍', () => {
  assert.equal(GROUND_BASS.length, 8);
  assert.deepEqual(GROUND_BASS.map(mod12), [2, 9, 11, 6, 7, 2, 7, 9]); // レ・ラ・シ・ファ♯・ソ・レ・ソ・ラ
  for (const ph of CANON_PHRASES) assert.equal(ph.reduce((s, n) => s + n.beats, 0), PHRASE_BEATS);
});

test('楽譜：拍の頭の旋律の音は、低音の和音の音（写し間違いがないことの確認）', () => {
  for (const [i, ph] of CANON_PHRASES.entries()) {
    let t = 0;
    for (const n of ph) {
      if (Number.isInteger(t)) {
        const chord = CANON_CHORDS[t % 8];
        assert.ok(chord.pcs.includes(mod12(n.midi)), `フレーズ${i + 1}の${t}拍目 ${noteInfo(midiToFreq(n.midi)).en} が和音 ${chord.name} にない`);
      }
      t += n.beats;
    }
  }
  // 低音は、その拍の和音のいちばん下の音（根音）
  for (let b = 0; b < 8; b++) assert.equal(mod12(bassAt(b)), chordAt(b).pcs[0]);
});

test('カノンの性質：第2声は第1声の8拍遅れ、第3声は16拍遅れで、同じ旋律を歌う', () => {
  for (let b = 0; b < 24; b += 0.25) {
    const lead = voiceNoteAt(0, b);
    assert.equal(voiceNoteAt(1, b + ENTRY_BEATS).midi, lead.midi, `${b} 拍目`);
    assert.equal(voiceNoteAt(2, b + 2 * ENTRY_BEATS).midi, lead.midi, `${b} 拍目`);
  }
  assert.equal(voiceNoteAt(1, 7.99), null, '第2声は8拍目より前には入らない');
  assert.equal(voiceNoteAt(1, 8).midi, noteToMidi('F#5'));
  // 3つの声がそろうと、どの拍でも3つとも違うフレーズを歌っている（同じ音のユニゾンにならない）
  for (let b = ALL_VOICES_BEAT; b < CANON_BEATS; b++) {
    const phrases = [0, 1, 2].map((v) => Math.floor((b - v * ENTRY_BEATS) / PHRASE_BEATS) % 3);
    assert.equal(new Set(phrases).size, 3, `${b} 拍目`);
  }
});

test('音符の一覧：区間を分けて取り出しても、まとめて取り出しても同じ', () => {
  const all = canonEvents(0, CANON_BEATS);
  const parts = [...canonEvents(0, 5.5), ...canonEvents(5.5, 17), ...canonEvents(17, CANON_BEATS)];
  const key = (e) => `${e.kind}/${e.voice}/${e.start}/${e.midi}`;
  assert.deepEqual(parts.map(key).sort(), all.map(key).sort());
  assert.equal(all.filter((e) => e.kind === 'bass').length, CANON_BEATS);
  // 第1声 32拍（フレーズ 1,2,3,1）＝ 8+8+16+8、第2声 24拍 ＝ 8+8+16、第3声 16拍 ＝ 8+8
  assert.deepEqual([0, 1, 2].map((v) => all.filter((e) => e.voice === v).length), [40, 32, 16]);
});

test('サンプル「輪唱」の再生位置から、各声部の音がわかる', () => {
  const at = (beat) => canonVoicesAt(CANON_LEAD_S + (beat * 60) / CANON_BPM + 1e-6);
  assert.deepEqual(at(0).voices, [noteToMidi('F#5'), null, null]);
  assert.equal(at(0).bass, noteToMidi('D3'));
  assert.ok(at(ALL_VOICES_BEAT).voices.every((m) => m !== null), '16拍目で3声がそろう');
  assert.deepEqual(at(CANON_BEATS + 1).voices, CANON_CODA.voices, '最後は和音でのばす');
  assert.deepEqual(at(CANON_BEATS + CANON_CODA.beats + 1).voices, [null, null, null]);
  assert.deepEqual(canonVoicesAt(0).voices, [null, null, null], '鳴り始める前');
});

test('ひみつ：低音・旋律の並びを、歌い始める高さに関係なく聴き分ける', () => {
  const bass = SECRET_PATTERNS.find((p) => p.id === 'bass').pcs;
  const melody = SECRET_PATTERNS.find((p) => p.id === 'melody').pcs;
  assert.deepEqual(intervalsOf(bass), [7, 2, 7, 1, 7, 5, 2]);
  assert.equal(findCanon(bass), 'bass');
  assert.equal(findCanon(melody), 'melody');
  const up5 = melody.map((p) => mod12(p + 5)); // 4半音上から歌っても
  assert.equal(findCanon(up5), 'melody');
  assert.equal(findCanon([0, 4, 7, ...bass.map((p) => mod12(p + 3))]), 'bass', '前に別の音があってもよい');
  assert.equal(findCanon(melody.slice(0, 7)), null, '途中まででは開かない');
  assert.equal(findCanon([...melody].reverse()), null, '逆から歌っても開かない');
  assert.equal(findCanon([0, 2, 4, 5, 7, 9, 11, 0]), null, 'ドレミファソラシド');
});

/** 80 ミリ秒ごとの観測を、NoteSequence に流し込む */
function feed(seq, plan) {
  let t = 0;
  const out = [];
  for (const [midi, ms] of plan) {
    for (let e = 0; e < ms; e += 80) {
      const pc = seq.push(t, midi);
      if (pc !== null) out.push(pc);
      t += 80;
    }
  }
  return out;
}

test('音の並びの係：はっきり歌った音だけを、1音ずつ数える', () => {
  const s = new NoteSequence();
  // ラ（0.4秒）→ 一瞬だけシ（0.08秒、出だしの揺れ）→ ラのまま → ド（0.4秒）
  assert.deepEqual(feed(s, [[69, 400], [71.2, 80], [69.3, 320], [72, 400]]), [9, 0]);
  // 同じ音がつづくのは1つ。少しの無音をはさんでも、同じ音なら数えない
  const s2 = new NoteSequence();
  assert.deepEqual(feed(s2, [[62, 400], [null, 160], [62, 400], [64, 400]]), [2, 4]);
  // 長い無音（3秒）のあとは、最初から数え直す
  const s3 = new NoteSequence();
  feed(s3, [[62, 400], [64, 400], [null, 3000], [66, 400]]);
  assert.deepEqual(s3.notes, [6]);
});

test('通し：合成したハミングで旋律を歌うと、カノンだと聴き分ける（YIN 法 → 音の並び → 判定）', () => {
  const sr = 48000;
  // ファ♯・ミ・レ・ド♯・シ・ラ・シ・ド♯（1オクターブ下で。各 0.45 秒、間に 0.05 秒の息つぎ）
  const tune = ['F#4', 'E4', 'D4', 'C#4', 'B3', 'A3', 'B3', 'C#4'].map(noteToMidi);
  const noteLen = Math.round(0.45 * sr);
  const gap = Math.round(0.05 * sr);
  const x = new Float32Array(tune.length * (noteLen + gap) + sr);
  let i0 = 0;
  for (const m of tune) {
    const f = midiToFreq(m);
    for (let i = 0; i < noteLen; i++) {
      const env = Math.min(1, i / 400, (noteLen - i) / 400);
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin((2 * Math.PI * f * h * i) / sr) / h; // 声のような倍音
      x[i0 + i] = 0.2 * env * v;
    }
    i0 += noteLen + gap;
  }
  const seq = new NoteSequence();
  let found = null;
  for (let end = 2048; end <= x.length && !found; end += Math.round(0.08 * sr)) {
    const { freq, clarity } = yinPitch(x.subarray(end - 2048, end), sr, { fMin: 60, fMax: 4000 });
    const midi = freq > 0 && clarity >= 0.8 ? 69 + 12 * Math.log2(freq / 440) : null;
    if (seq.push((end / sr) * 1000, midi) !== null) found = findCanon(seq.notes);
  }
  assert.equal(found, 'melody');
});

test('サンプル「輪唱」：第1声だけを鳴らすと、最初の2音はファ♯5・ミ5', () => {
  const sr = 48000;
  const x = canonRound({ sampleRate: sr, parts: { bass: false, voices: [true, false, false] } });
  const spb = 60 / CANON_BPM;
  near(x.length / sr, CANON_LEAD_S + (CANON_BEATS + CANON_CODA.beats) * spb + 0.4, 0.01, '長さ');
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  near(peak, 0.5, 1e-6, '音量をそろえてある');
  const pitchAt = (beat) => {
    const end = Math.round((CANON_LEAD_S + beat * spb) * sr);
    return yinPitch(x.subarray(end - 2048, end), sr, { fMin: 60, fMax: 4000 });
  };
  const a = pitchAt(0.5);
  assert.equal(noteInfo(a.freq).en, 'F♯5', `0.5拍目 ${a.freq}`);
  near(a.freq, midiToFreq(78), 2, 'ファ♯5 の周波数');
  assert.equal(noteInfo(pitchAt(1.5).freq).en, 'E5');
});

test('追いかける光：今・0.8 秒前・1.6 秒前の高さを答える（光背の3つの光）', () => {
  const trail = new EchoTrail();
  assert.deepEqual(trail.voices(0), [null, null, null], '記録がなければ光なし');
  // 0.1 秒ごとに、ド4 → レ4 → ミ4 … と半音2つずつ上がる高さを記録
  for (let t = 0; t <= 2000; t += 100) trail.push(t, 60 + 2 * Math.floor(t / 400));
  const [now, d1, d2] = trail.voices(2000);
  assert.equal(now, 70, '今の高さ');
  assert.equal(d1, trail.at(2000 - ECHO_DELAY_MS), '1つめの光は 0.8 秒前');
  assert.equal(d1, 66);
  assert.equal(d2, 62, '2つめの光は 1.6 秒前');
  // まだ 1.6 秒たっていなければ、2つめの光は出ない
  const fresh = new EchoTrail();
  fresh.push(0, 60);
  fresh.push(900, 62);
  assert.deepEqual(fresh.voices(1000), [62, 60, null]);
});

test('追いかける光：高さがない時刻は「光なし」、いちばん遅れた光より古い記録は捨てる', () => {
  const trail = new EchoTrail({ delayMs: 500 });
  trail.push(0, 69);
  trail.push(100, null);
  trail.push(200, NaN); // 数でない高さも「光なし」
  assert.equal(trail.at(150), null);
  assert.equal(trail.at(250), null);
  assert.equal(trail.at(50), 69);
  for (let t = 300; t <= 5000; t += 100) trail.push(t, 72);
  assert.ok(trail.items.length <= 3 * 5 + 1, `記録がたまり続けている（${trail.items.length}）`);
  assert.equal(trail.items[0].t >= 5000 - 3 * 500, true);
  trail.clear();
  assert.deepEqual(trail.voices(5000), [null, null, null]);
});
