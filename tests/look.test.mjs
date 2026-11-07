// look.js（見た目の設定：光の色・軌跡の長さ・画面の明るさ）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUES, TRAILS, DIMS, DEFAULT_LOOK, normalizeLook, rainbowTable } from '../js/look.js';

test('はじめの見た目は、座標と光だけ・金・短い軌跡・そのままの明るさ', () => {
  assert.deepEqual({ ...DEFAULT_LOOK }, { view: 'pure', hue: 'kin', trail: 'short', dim: 0 });
  assert.equal(TRAILS.short.frames, 24, 'これまでの軌跡の長さ（24 コマ）');
});

test('こわれた・古い設定は、はじめの値に置きかえる', () => {
  assert.deepEqual(normalizeLook({}), { ...DEFAULT_LOOK });
  assert.deepEqual(normalizeLook({ hue: 'toString', trail: 'forever', dim: 0.9 }), { ...DEFAULT_LOOK });
  assert.deepEqual(normalizeLook({ hue: 'niji', trail: 'long', dim: 0.55 }), { view: 'pure', hue: 'niji', trail: 'long', dim: 0.55 });
  assert.equal(normalizeLook({ dim: '0.3' }).dim, 0.3, '文字で覚えていても数にする');
});

test('軌跡は長いほど多くのコマ、暗さは 0 から濃くなる。どれも日本語・英語の名前がある', () => {
  const frames = Object.values(TRAILS).map((t) => t.frames);
  assert.deepEqual([...frames].sort((a, b) => a - b), frames);
  const dims = Object.keys(DIMS).map(Number);
  assert.equal(dims[0], 0);
  assert.ok(dims.every((d) => d >= 0 && d < 1));
  for (const table of [HUES, TRAILS, DIMS]) for (const v of Object.values(table)) assert.ok(v.ja && v.en);
});

test('金以外の「強さで色が変わる」テーマは、CSS に色が書いてある', () => {
  const css = readFileSync(new URL('../css/halo.css', import.meta.url), 'utf8');
  for (const [key, v] of Object.entries(HUES)) {
    if (key === 'kin' || key === 'niji') continue;
    const block = css.split(`:root[data-hue="${key}"] {`)[1];
    assert.ok(block, `${key} の色がない`);
    const body = block.split('}')[0];
    for (let i = 1; i <= 4; i++) assert.ok(body.includes(`--spec-${i}: ${v.stops[i - 1]};`), `${key} の --spec-${i} が見本と同じ`);
  }
});

test('虹：12の向き × 3段。向きごとに色がちがい、段が上がるほど明るい。12時（主音）は赤', () => {
  const t = rainbowTable();
  assert.equal(t.length, 12);
  const rgb = (s) => s.match(/\d+/g).map(Number);
  for (const row of t) {
    assert.equal(row.length, 3);
    const lum = row.map((c) => rgb(c).reduce((a, b) => a + b, 0));
    assert.ok(lum[0] < lum[1] && lum[1] < lum[2], `明るさの順 ${row.join(' ')}`);
    for (const c of row) assert.ok(rgb(c).every((v) => v >= 0 && v <= 255), c);
  }
  assert.equal(new Set(t.map((r) => r[1])).size, 12, '12の向きがすべて別の色');
  const [r, g, b] = rgb(t[0][1]);
  assert.ok(r > g && r > b, `12時は赤みがかった色（${t[0][1]}）`);
});

test('描くもの：はじめは「座標と光だけ」。「すべて」を選べて、こわれた値・前の版の設定は「座標と光だけ」になる', async () => {
  const { VIEWS, isPure } = await import('../js/look.js');
  assert.deepEqual(Object.keys(VIEWS), ['pure', 'full'], 'はじめの見た目を先に並べる');
  for (const v of Object.values(VIEWS)) assert.ok(v.ja && v.en);
  assert.equal(normalizeLook({}).view, 'pure', '前の版で覚えた設定（view がない）も、座標と光だけ');
  assert.equal(normalizeLook({ view: 'full' }).view, 'full', '「すべて」を選んだ人は、そのまま');
  assert.equal(normalizeLook({ view: 'constructor' }).view, 'pure');
  assert.equal(isPure({}), true);
  assert.equal(isPure({ view: 'full' }), false);
});
