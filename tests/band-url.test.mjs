// 保存する画像・動画の下の帯の URL が、公開ページの URL（canonical）と一致しているか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('下の帯の URL は、公開ページの canonical と同じ場所を指す', async () => {
  const kouhai = await read('js/kouhai.js');
  const label = /const APP_URL_LABEL = '([^']+)'/.exec(kouhai)?.[1];
  assert.ok(label, 'APP_URL_LABEL が見つかりません');
  const canonical = /rel="canonical" href="([^"]+)"/.exec(await read('index.html'))?.[1];
  assert.equal(`https://${label}/`, canonical);
});

test('下の帯に URL を描く（画像にも動画にも共通の描き方）', async () => {
  const kouhai = await read('js/kouhai.js');
  assert.match(kouhai, /fillText\(APP_URL_LABEL/);
});

test('共有の文章のハッシュタグ：日本語は #光背Halo、英語は #HaloPitch（#Halo は使わない）', async () => {
  const main = await read('js/main.js');
  const text = /text: L\('([^']+)', '([^']+)'\)/.exec(main);
  assert.ok(text, '共有の文章が見つかりません');
  const [, ja, en] = text;
  assert.match(ja, /#光背Halo /);
  assert.match(en, /#HaloPitch /);
  assert.doesNotMatch(`${ja} ${en}`, /#Halo(?!Pitch)/);
});
