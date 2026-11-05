// 光背 Halo のページ（index.html）のテスト
//   - 向き・周回・指で鳴らす高さの計算
//   - サンプル「カノン」：鳴らす声部の選び方と、最初に見せる例の和音
//   - ページに書いた説明の数字が、コードの決まりと同じか（コードを変えたのに説明が古いまま、を防ぐ）
//   - ホーム画面に置くための説明書き（マニフェスト）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ARM_COUNT,
  KOUHAI_FMIN,
  KOUHAI_LOW_MIDI,
  KOUHAI_HIGH_MIDI,
  KOUHAI_OCTAVES,
  KOUHAI_FFT_SIZE,
  freqToTurn,
  clockOf,
  ringOf,
  spiralPoint,
  pointToMidi,
} from '../js/kouhai.js';
import { ECHO_DELAY_MS, canonScore, canonVoicesAt, chordAt, ALL_VOICES_BEAT, CANON_BPM, CANON_LEAD_S } from '../js/canon.js';
import { canonRound } from '../js/synth.js';
import { midiToFreq, powerSpectrum, freqToMidi } from '../js/dsp.js';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const html = await read('index.html');
const text = html.replace(/<[^>]+>/g, ''); // タグを外した文字（log<sub>2</sub> → log2）

test('向き：12個の音名が、時計の文字盤の12の時刻に重なる（ド＝12時、ラ＝9時）', () => {
  assert.equal(clockOf(0), 12);
  assert.equal(clockOf(4), 4);
  assert.equal(clockOf(9), 9);
  assert.equal(clockOf(11), 11);
  assert.equal(clockOf(12), 12, '1オクターブ上のドも12時');
  assert.equal(clockOf(-3), 9, 'マイナスでも正しく');
  // 螺旋の上の向きも、k 時 ＝ 12時から時計回りに k × 30°
  for (let k = 0; k < 12; k++) {
    const p = spiralPoint(2 + k / 12, 300);
    const deg = (Math.atan2(p.y, p.x) * 180) / Math.PI + 90;
    const diff = Math.abs(((deg - clockOf(k) * 30 + 540) % 360) - 180); // 角度の差（359.99…° と 0° は同じ向き）
    assert.ok(diff < 1e-6, `${k} → ${deg}°`);
  }
});

test('何周目か：C2〜B2 が1周目、ラ A4 は3周目、いちばん外のド C9 は7周目', () => {
  assert.equal(ringOf(KOUHAI_LOW_MIDI), 1);
  assert.equal(ringOf(KOUHAI_LOW_MIDI + 11), 1);
  assert.equal(ringOf(69), 3);
  assert.equal(ringOf(KOUHAI_HIGH_MIDI), KOUHAI_OCTAVES);
  assert.equal(ringOf(20), 1, '螺旋より低い音は、いちばん内側として数える');
});

test('指で鳴らす：触れた点にいちばん近い半音を鳴らす。螺旋の外に触れても C2〜C9 の中', () => {
  const size = 360;
  for (let m = KOUHAI_LOW_MIDI; m <= KOUHAI_HIGH_MIDI; m++) {
    const p = spiralPoint((m - KOUHAI_LOW_MIDI) / 12, size);
    assert.equal(pointToMidi(p.x, p.y, size), m, `MIDI ${m}`);
    // 半音の 1/3 ずれた所に触れても、同じ半音
    const q = spiralPoint((m - KOUHAI_LOW_MIDI + 0.33) / 12, size);
    if (m < KOUHAI_HIGH_MIDI) assert.equal(pointToMidi(q.x, q.y, size), m, `MIDI ${m} の近く`);
  }
  assert.equal(pointToMidi(0, 0, size), KOUHAI_LOW_MIDI, 'まん中');
  assert.equal(pointToMidi(0, -size, size), KOUHAI_HIGH_MIDI, '円の外（12時の向き）');
});

test('カノン：選んだ声部だけを光で追い、3つの声を全部鳴らしたときだけ蓮が開く', () => {
  const t = CANON_LEAD_S + ((ALL_VOICES_BEAT + 2) * 60) / CANON_BPM; // 3つの声がそろったあと
  const full = canonVoicesAt(t);
  const all = canonScore()(t);
  assert.deepEqual(all.voices, full.voices);
  assert.equal(all.bass, full.bass);
  assert.ok(all.beat >= ALL_VOICES_BEAT, '全部の声なら、そろった拍がわかる（蓮が開く）');
  const two = canonScore({ bass: false, voices: [true, false, true] })(t);
  assert.deepEqual(two.voices, [full.voices[0], null, full.voices[2]], '鳴らさない声の光は出さない');
  assert.equal(two.bass, null, '低音を鳴らさないなら金の輪も出さない');
  assert.ok(two.beat < 0, '声が欠けていると、そろわないので蓮は開かない');
});

test('最初に見せる例：3つの声がそろったところの和音が、本物の音でもいちばん強い3つの音名', () => {
  const sr = 48000;
  const beat = ALL_VOICES_BEAT + 0.6; // main.js の EXAMPLE_BEAT と同じ
  const ch = chordAt(beat);
  assert.equal(ch.name, 'D');
  const music = canonRound({ sampleRate: sr });
  const end = Math.round((CANON_LEAD_S + (beat * 60) / CANON_BPM) * sr);
  const power = powerSpectrum(music.subarray(end - 8192, end), 8192);
  const chroma = new Array(12).fill(0);
  // 山の頂上（となりより大きい区分）だけを数える。強い低音のすそ野（FFT のにじみ）を、となりの音名に数えないため
  for (let k = 2; k < power.length - 1; k++) {
    const f = (k * sr) / 8192;
    if (f < 65 || f > 1200 || !(power[k] > power[k - 1] && power[k] >= power[k + 1])) continue;
    chroma[((Math.round(freqToMidi(f)) % 12) + 12) % 12] += power[k];
  }
  const top = chroma
    .map((e, pc) => ({ e, pc }))
    .sort((a, b) => b.e - a.e)
    .slice(0, 3)
    .map((x) => x.pc)
    .sort((a, b) => a - b);
  assert.deepEqual(top, [...ch.pcs].sort((a, b) => a - b), 'レ・ファ♯・ラ');
  assert.deepEqual(ch.pcs.map(clockOf).sort((a, b) => a - b), [2, 6, 9], '2時・6時・9時');
});

test('光背の FFT：ド4 のあたりで1区分が半音の 1/4 より細かい（和音の形がぼやけない）', () => {
  const binHz = 48000 / KOUHAI_FFT_SIZE;
  const semitones = 12 * Math.log2((midiToFreq(60) + binHz) / midiToFreq(60));
  assert.ok(semitones < 0.25, `ド4 で1区分が ${semitones.toFixed(2)} 半音`);
  assert.ok(KOUHAI_FFT_SIZE <= 32768, 'AnalyserNode の上限（32768）を超えている');
});

test('しくみの説明の数字が、光背のコードと同じ', () => {
  assert.ok(text.includes(`log2（f ÷ ${KOUHAI_FMIN.toFixed(1)}）`), '螺旋の式の 65.4');
  assert.ok(text.includes(`約 ${Math.round(KOUHAI_FMIN)} Hz`), 'いちばん内側のド');
  const c9 = Math.round(midiToFreq(KOUHAI_HIGH_MIDI) / 100) * 100;
  assert.ok(text.includes(`約 ${c9.toLocaleString('en-US')} Hz`), `いちばん外側のド（約 ${c9} Hz）`);
  assert.ok(text.includes(`${KOUHAI_OCTAVES}周して`), '周の数');
  assert.ok(text.includes(`≒ ${freqToTurn(440).toFixed(2)}`), 'ラ 440 Hz の周回');
  assert.ok(text.includes(`${Math.floor(freqToTurn(440)) + 1}周目の${clockOf(9)}時`), 'ラの向き');
  assert.ok(text.includes(`${(ECHO_DELAY_MS / 1000).toFixed(1)} 秒ずつ遅れて`), '追いかける光の遅れ');
  assert.ok(text.includes(`約 ${Math.pow(2, 1 / 12).toFixed(4)} 倍`), '半音の比');
  assert.equal(ARM_COUNT, 1000);
  assert.ok(text.includes('千本の光'));
  assert.ok(text.includes(`${(KOUHAI_FFT_SIZE / 2).toLocaleString('en-US')} 個の高さの区分`), 'FFT の区分の数');
  assert.ok(text.includes(`約 ${(48000 / KOUHAI_FFT_SIZE).toFixed(1)} Hz`), '1区分の幅');
});

test('ホーム画面に置ける：光背 Halo の説明書き（マニフェスト）', async () => {
  const m = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(m.short_name, '光背');
  assert.ok(m.start_url.startsWith(m.scope), '始めのページが、アプリの範囲の中');
  const sizes = m.icons.map((i) => `${i.sizes}${i.purpose ? `:${i.purpose}` : ''}`);
  for (const s of ['192x192', '512x512', '512x512:maskable']) assert.ok(sizes.includes(s), `アイコン ${s}`);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<script type="module" src="js\/main\.js"><\/script>/);
  assert.ok(!/観音|Kannon/.test(html), '別のアプリの名前が残っている（Halo は単体のアプリ）');
});

test('英語版（en.html）：黒い地・英語・同じ部品。日本語版とたがいに行き来できる', async () => {
  const en = await read('en.html');
  assert.match(en, /<html lang="en" data-theme="dark" class="black">/, '英語・暗い表示・黒い地');
  assert.match(en, /<link rel="manifest" href="manifest-en\.webmanifest">/);
  assert.match(en, /<script type="module" src="js\/main\.js"><\/script>/, '同じ係（main.js）で動く');
  // 日本語版にある部品（id）は、英語版にもある（用語の節だけは、日本語版は「英語の用語」、英語版は「日本語のことば」で中身がちがう）
  const ids = (h) => new Set([...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const jaIds = ids(html);
  const enIds = ids(en);
  for (const id of jaIds) if (!['ab-en'].includes(id)) assert.ok(enIds.has(id), `英語版に #${id} がない`);
  assert.match(html, /<a class="kh-lang" href="en\.html"/, '日本語版から英語版へ');
  assert.match(en, /<a class="kh-lang" href="\.\/"/, '英語版から日本語版へ');
  // 本文の日本語は、ロゴの「光背」・「日本語」の入口・日本語のことばの説明だけ
  const body = en.slice(en.indexOf('<body>')).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
  const jp = body.match(/[\u3040-\u30ff\u4e00-\u9fff][\u3040-\u30ff\u4e00-\u9fff・]*/g) || [];
  const allowed = new Set(['光背', '日本語', '千手', '蓮', 'ド・レ・ミ', 'ド']);
  assert.deepEqual(jp.filter((w) => !allowed.has(w)), [], '英語版に、訳していない日本語が残っている');
  const m = JSON.parse(await read('manifest-en.webmanifest'));
  assert.equal(m.lang, 'en');
  assert.equal(m.start_url, './en.html');
  assert.equal(m.background_color, '#000000');
});

test('日本語版も英語版も、いつも黒い地（切り替えなし）', async () => {
  const en = await read('en.html');
  for (const [name, page] of [['index.html', html], ['en.html', en]]) {
    assert.match(page, /<html lang="(ja|en)" data-theme="dark" class="black">/, `${name}：黒い地`);
    assert.match(page, /<meta name="theme-color" content="#000000">/, `${name}：ブラウザの帯も黒`);
    assert.ok(!/kh-theme|ab-view-set/.test(page), `${name}：表示の明るさの切り替えが残っている`);
  }
  for (const f of ['manifest.webmanifest', 'manifest-en.webmanifest']) {
    const m = JSON.parse(await read(f));
    assert.equal(m.background_color, '#000000', f);
    assert.equal(m.theme_color, '#000000', f);
  }
});
