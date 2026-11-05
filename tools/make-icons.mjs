// ホーム画面用のアイコンを作る（Playwright の Chromium を使う）
//   node tools/make-icons.mjs
//   tools/icon.mjs で icons/icon.svg を光背と同じ螺旋の式から描き直し、PNG（192・512・マスク用・iPhone 用）にする
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from './playwright.mjs';
import { haloIconSvg } from './icon.mjs';

await writeFile('icons/icon.svg', haloIconSvg());
console.log('✔ icons/icon.svg');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(markup, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`✔ ${out}`);
}
const svg = await readFile('icons/icon.svg', 'utf8');
// マスク用（Android が丸や角丸に切り抜く）は、角を丸めずに全面を塗る
const maskable = svg.replace('rx="112"', 'rx="0"');
await render(svg, 192, 'icons/icon-192.png');
await render(svg, 512, 'icons/icon-512.png');
await render(maskable, 512, 'icons/icon-maskable-512.png');
await render(maskable, 180, 'icons/apple-touch-icon.png'); // iPhone は自分で角を丸める
await browser.close();
