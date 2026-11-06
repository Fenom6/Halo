// 公開ページのレビュー（2026-11-06）を受けて足したもののテスト：マイクを許可しなおす手順・SNS で共有したときの絵と説明
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { platformOf, micAllowSteps } from '../js/audio.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

test('端末の見分け方：iPhone・iPad（パソコンのふりをする iPad も）・Android・Firefox・そのほかのパソコン', () => {
  assert.equal(platformOf({ userAgent: UA.iphone }), 'ios');
  assert.equal(platformOf({ userAgent: UA.ipad, maxTouchPoints: 5 }), 'ios', 'iPad の Safari は Mac と名のるが、指で触れる');
  assert.equal(platformOf({ userAgent: UA.ipad, maxTouchPoints: 0 }), 'desktop', '本物の Mac');
  assert.equal(platformOf({ userAgent: UA.android }), 'android');
  assert.equal(platformOf({ userAgent: UA.firefox }), 'firefox');
  assert.equal(platformOf({ userAgent: UA.chrome }), 'desktop');
  assert.equal(platformOf({}), 'desktop');
});

test('マイクを許可しなおす手順：端末ごとに、どこを押すかが書いてあり、読み込みなおしまで3つの手順', () => {
  assert.match(micAllowSteps('ios'), /Webサイトの設定/);
  assert.match(micAllowSteps('ios'), /「設定」アプリ/);
  assert.match(micAllowSteps('android'), /権限/);
  assert.match(micAllowSteps('firefox'), /ブロック/);
  assert.match(micAllowSteps('desktop'), /アドレス欄/);
  for (const p of ['ios', 'android', 'firefox', 'desktop']) {
    const s = micAllowSteps(p);
    for (const n of ['1.', '2.', '3.']) assert.ok(s.includes(`\n${n}`), `${p} に手順 ${n} がない`);
    assert.match(s, /読み込みなおして/);
  }
});

/** JPEG の幅と高さ（SOF の印から読む） */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

test('SNS で共有したときの絵と説明（OGP）：日本語版・英語版とも、題・説明・絵（1200×630）がある', () => {
  const img = readFileSync(new URL('../icons/og.jpg', import.meta.url));
  assert.deepEqual(jpegSize(img), { w: 1200, h: 630 });
  assert.ok(img.length < 300_000, '絵が重すぎる（SNS が読みこまないことがある）');
  for (const page of ['index.html', 'en.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const meta = (prop) => (html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`)) || [])[1];
    assert.equal(meta('og:image'), 'https://fenom6.github.io/Halo/icons/og.jpg', page);
    assert.equal(meta('og:image:width'), '1200');
    assert.equal(meta('og:image:height'), '630');
    assert.equal(meta('twitter:card'), 'summary_large_image');
    for (const k of ['og:title', 'og:description', 'og:url', 'og:image:alt']) assert.ok(meta(k) && meta(k).length > 5, `${page} の ${k}`);
    assert.ok(meta('og:url').startsWith('https://fenom6.github.io/Halo/'), page);
  }
  // 公開（GitHub Pages）に、絵の入った icons/ が含まれる
  const deploy = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  assert.match(deploy, /\bicons\b/);
});
