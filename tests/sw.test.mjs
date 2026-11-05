// sw.js のテスト：オフライン用の「しまい物」を新しい版に入れかえるとき、消してよいものだけを消す
//   GitHub Pages では、同じ人のほかのアプリも同じ場所（オリジン）にしまい物を置くので、
//   光背の古い版のもの以外は消してはいけない。
// ページ本体は、ページごとの名前でしまう。うまく読めなかったページ（404 など）はしまわない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const ORIGIN = 'https://example.github.io';
const BASE = `${ORIGIN}/Halo/`;

/**
 * sw.js を、ブラウザのまねをした入れ物の中で動かす。
 * fetchImpl はネットのまね。しまい物は stored（名前 → 中身）に入る
 */
async function loadSw(extraNames = [], { fetchImpl = async () => Promise.reject(new Error('offline')), stored = new Map() } = {}) {
  const src = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const version = src.match(/const VERSION = '([^']+)'/)[1];
  const names = new Set([version, `${version}-fonts`, ...extraNames]);
  const deleted = [];
  const handlers = {};
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
    location: { origin: ORIGIN, href: `${BASE}sw.js` },
  };
  const caches = {
    keys: async () => [...names],
    delete: async (k) => (deleted.push(k), names.delete(k)),
    open: async () => ({ addAll: async () => {}, put: async (k, v) => stored.set(String(k), v), match: async (k) => stored.get(String(k)) }),
    match: async (k) => stored.get(String(k)),
  };
  vm.runInNewContext(src, { self, caches, URL, fetch: fetchImpl });
  return { version, names, deleted, handlers, stored };
}

/** ページを開く（navigate）まね。返ってきた中身を返す */
async function navigate(sw, path) {
  let answer = null;
  sw.handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: `${BASE}${path}` }, respondWith: (p) => (answer = p) });
  const res = await answer;
  await new Promise((r) => setTimeout(r, 0)); // しまう係は、返事のあとで動く
  return res;
}

const page = (name, ok = true) => ({ name, ok, clone() {
  return this;
} });

test('新しい版に入れかえるとき、光背の古い版のしまい物だけを消す（ほかのアプリのものは残す）', async () => {
  const others = ['other-app-v3', 'workbox-precache-v2-https://example.github.io/other/', 'halo-notes', 'kannon-0.6.0'];
  const sw = await loadSw(['halo-0.9.0', 'halo-0.9.1-fonts', ...others]);
  let waited = null;
  sw.handlers.activate({ waitUntil: (p) => (waited = p) });
  await waited;
  assert.deepEqual(sw.deleted.sort(), ['halo-0.9.0', 'halo-0.9.1-fonts']);
  assert.ok(sw.names.has(sw.version), 'いまの版のしまい物を消した');
  assert.ok(sw.names.has(`${sw.version}-fonts`), 'いまの版の文字のしまい物を消した');
  for (const k of others) assert.ok(sw.names.has(k), `ほかのアプリのしまい物「${k}」を消した`);
});

test('開いたページは、そのページの名前でしまう（./ は index.html）', async () => {
  const sw = await loadSw([], { fetchImpl: async (req) => page(new URL(req.url).pathname) });
  await navigate(sw, '');
  await navigate(sw, 'other.html?from=readme');
  assert.equal(sw.stored.get('index.html').name, '/Halo/', 'ここ（./）は index.html としてしまう');
  assert.equal(sw.stored.get('other.html').name, '/Halo/other.html');
});

test('電波がないときは、しまっておいた光背を出す', async () => {
  const stored = new Map([
    ['index.html', page('光背')],
  ]);
  const sw = await loadSw([], { stored });
  assert.equal((await navigate(sw, 'index.html')).name, '光背');
  assert.equal((await navigate(sw, '')).name, '光背');
  assert.equal((await navigate(sw, 'other.html')).name, '光背', 'しまっていないページは、光背を出す');
});

test('うまく読めなかったページ（404 など）は、しまわない', async () => {
  const stored = new Map([['index.html', page('光背')]]);
  const sw = await loadSw([], { fetchImpl: async () => page('見つかりません', false), stored });
  await navigate(sw, '');
  await navigate(sw, 'other.html');
  assert.equal(stored.get('index.html').name, '光背', '404 のページで、光背を上書きした');
  assert.equal(stored.has('other.html'), false);
});
