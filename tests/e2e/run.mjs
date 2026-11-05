// 光背 Halo の通しテスト：本物のブラウザ（Chromium）で開いて、ボタンを押して確かめる
//
//   - マイクの代わりに 440 Hz（ラ A4）の WAV を流し、まん中に「ラ」、9時の向きに光が出るか
//   - 指で鳴らす：螺旋のラの位置に触れるとラが鳴って映るか。旋律を弾くと、隠し味の蓮が開くか
//   - 残す：光背の絵（PNG）ができるか
//   - カノン：3つの光が追いかけ、3つの声がそろうと蓮が開くか
//   - オフライン：一度開いたあと電波がなくても開けるか
//   - claude.ai 用の1ファイル版（dist/halo-artifact.html。先に node tools/build-artifact.mjs）
//
//   node tests/e2e/kouhai.mjs                 … テストだけ
//   node tests/e2e/kouhai.mjs --shots <フォルダ> … スマホ幅の画面写真も保存
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../tools/serve.mjs';
import { chromium } from '../../tools/playwright.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const PORT = 8000 + Math.floor(Math.random() * 900);

/** 16bit・モノラルの WAV ファイルを作る */
function wav(samples, sr) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return buf;
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, e });
    console.log(`✖ ${name}\n    ${e.message.split('\n')[0]}`);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

const dir = await mkdtemp(join(tmpdir(), 'halo-e2e-'));
const sr = 48000;
const wavPath = join(dir, 'a440.wav');
await writeFile(wavPath, wav(Float32Array.from({ length: sr * 3 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)), sr));

/** 文字（Google Fonts）は読みに行かず、空の CSS を返す（ネットにつながらない場所でもテストできるように） */
async function quietFonts(target) {
  await target.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
}
/** canvas の中で、地の色（左上の画素）と違う画素の数 */
const inkOf = (p, sel = '#cv-kouhai') =>
  p.evaluate((s) => {
    const c = document.querySelector(s);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 40) n++;
    return n;
  }, sel);
/** 朱色の光（いまの高さ）の横の位置（0 が左端、1 が右端）。見つからなければ −1 */
const markX = (p) =>
  p.evaluate(() => {
    const c = document.querySelector('#cv-kouhai');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const n = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--spec-mark').trim().slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    let sx = 0;
    let cnt = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 40) {
        sx += (i / 4) % c.width;
        cnt++;
      }
    }
    return cnt ? sx / cnt / c.width : -1;
  });
/** 螺旋の上で、MIDI 番号 m の音の場所（画面の座標）。kouhai.js の spiralPoint と同じ式 */
const spiralXY = (p, m) =>
  p.evaluate((midi) => {
    const r = document.querySelector('#kh-stage').getBoundingClientRect();
    const size = Math.max(80, Math.min(r.width, r.height) - 2 - 8); // 枠線（1px × 2）の内側の円
    const turn = (midi - 36) / 12;
    const angle = -Math.PI / 2 + 2 * Math.PI * turn;
    const rad = size * (0.135 + ((0.4 - 0.135) * turn) / 7);
    return { x: r.left + r.width / 2 + rad * Math.cos(angle), y: r.top + r.height / 2 + rad * Math.sin(angle) };
  }, m);
/** PNG の幅と高さ（ファイルの先頭の IHDR から読む） */
const pngSize = (buf) => ({ sig: buf.subarray(1, 4).toString(), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

const server = await startServer({ dir: ROOT, listenPort: PORT });
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ja-JP', colorScheme: 'light', acceptDownloads: true });
await context.grantPermissions(['microphone'], { origin: `http://localhost:${PORT}` });
await quietFonts(context);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name, p = page) => SHOTS && p.screenshot({ path: join(SHOTS, `${name}.png`) });
const text = (sel, p = page) => p.locator(sel).innerText();
const overflow = (p = page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

try {
  await page.goto(`http://localhost:${PORT}/`);

  await check('開くと、例（カノンの3つの声がそろったところ）の光背と、12の音名が出る。横にはみ出さない', async () => {
    await page.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
    expect((await page.locator('#kouhai-dial .kouhai-pc').count()) === 12, '音名が12個ない');
    expect((await text('#kh-badge')) === '例', '例のしるしがない');
    expect((await inkOf(page)) > 2000, '光背がほとんど描かれていない');
    expect((await overflow()) <= 0, '横にはみ出している');
    const box = await page.locator('#kh-stage').boundingBox();
    expect(Math.abs(box.width - box.height) < 2 && box.width > 340, `光背が正方形で画面いっぱいではない（${box.width}×${box.height}）`);
    await shot('k01-start');
  });

  await check('マイク（440 Hz）で、まん中に「ラ」、読み取りに A4・440 Hz・9時の向き・3周目、朱色の光は左（9時）', async () => {
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 10000 });
    await page.waitForTimeout(1200);
    expect((await text('#kh-en')) === 'A4', `英語の音名が ${await text('#kh-en')}`);
    const hz = parseFloat(await text('#kh-hz'));
    expect(Math.abs(hz - 440) < 3, `高さが ${hz} Hz`);
    expect((await text('#kh-sub')).includes('9時の向き・3周目'), await text('#kh-sub'));
    expect((await text('#head-status-text')) === 'マイクで観ています', await text('#head-status-text'));
    expect(await page.locator('#kh-badge').isHidden(), '例のしるしが残っている');
    const x = await markX(page);
    expect(x > 0 && x < 0.5, `朱色の光の横位置が ${x}（左半分＝9時側のはず）`);
    await shot('k02-mic-a4');
  });

  await check('絵に触れると、その場所の高さが出る', async () => {
    const p = await spiralXY(page, 69);
    await page.mouse.click(p.x, p.y);
    const label = await text('#probe-label');
    expect(/Hz（ラ4）/.test(label), `触れた所の高さが「${label}」`);
  });

  await check('残す：いまの光背が、音名と下の帯つきの1枚の絵（PNG）になる', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#btn-save')]);
    expect(/^kouhai-\d{8}-\d{6}\.png$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const buf = await readFile(await dl.path());
    const { sig, w, h } = pngSize(buf);
    expect(sig === 'PNG', 'PNG ではない');
    expect(h > w && w > 600, `絵の大きさが ${w}×${h}（正方形の円と、下の帯のはず）`);
    if (SHOTS) await writeFile(join(SHOTS, 'k03-saved.png'), buf);
  });

  await check('マイクを止めると「止まっています」になり、止めた絵が残る', async () => {
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '止まっています', null, { timeout: 5000 });
    expect((await inkOf(page)) > 500, '止めたら絵が消えた');
  });

  await check('指で鳴らす：螺旋のラ4に触れると、ラが鳴って映る。離すと止まる', async () => {
    await page.click('#btn-touch');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '指で鳴らしています', null, { timeout: 5000 });
    expect((await page.getAttribute('#btn-touch', 'aria-pressed')) === 'true', 'ボタンが押された状態にならない');
    const p = await spiralXY(page, 69);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 5000 });
    expect((await text('#kh-caption')).includes('ラ4（9時）'), await text('#kh-caption'));
    expect((await text('#kh-en')) === 'A4', `${await text('#kh-en')}`);
    await shot('k04-touch-a4');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === '観', null, { timeout: 5000 });
  });

  await check('指で鳴らす：旋律（ファ♯・ミ・レ・ド♯・シ・ラ・シ・ド♯）を弾くと、蓮が開く', async () => {
    expect(await page.locator('#bloom').isHidden(), '弾く前から蓮が開いている');
    for (const m of [78, 76, 74, 73, 71, 69, 71, 73]) {
      const p = await spiralXY(page, m);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.waitForTimeout(420);
      await page.mouse.up();
      await page.waitForTimeout(90);
    }
    await page.waitForFunction(() => !document.querySelector('#bloom').hidden, null, { timeout: 5000 });
    await page.waitForTimeout(2600);
    await shot('k05-touch-bloom');
    await page.click('#btn-touch');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '止まっています', null, { timeout: 5000 });
    expect((await page.getAttribute('#kh-stage', 'data-touch')) === 'off', '指で鳴らすが止まらない');
  });

  await check('カノン：声を選んで鳴らせる。3つの光が追いかけ、3つの声がそろうと蓮が開く。光背で観るところが出る', async () => {
    await page.click('#btn-sample');
    await page.waitForSelector('#dlg-canon[open]');
    expect((await page.locator('#dlg-canon input[name="part"]').count()) === 4, '声の選び（低音・第1〜3声）が4つない');
    await shot('k06-canon-sheet');
    await page.click('#canon-play');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent.includes('カノン'), null, { timeout: 8000 });
    expect((await text('#kh-caption')).startsWith('観るところ：3つの光'), await text('#kh-caption'));
    await page.waitForFunction(() => document.querySelector('#bloom').hidden, null, { timeout: 12000 }); // 指で開いた蓮が閉じるまで待つ
    await page.waitForFunction(() => !document.querySelector('#bloom').hidden, null, { timeout: 20000 });
    await page.waitForTimeout(2600);
    await shot('k07-canon-bloom');
    // 蓮が開いているあいだに残すと、蓮も絵に入る
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#btn-save')]);
    if (SHOTS) await writeFile(join(SHOTS, 'k07b-saved-bloom.png'), await readFile(await dl.path()));
    await page.click('#btn-stop');
  });

  await check('カノン：声を1つにすると、その声の光だけが出て、蓮は開かない', async () => {
    await page.waitForFunction(() => document.querySelector('#bloom').hidden, null, { timeout: 12000 });
    await page.click('#btn-sample');
    await page.waitForSelector('#dlg-canon[open]');
    for (const v of ['bass', '1', '2']) await page.uncheck(`#dlg-canon input[name="part"][value="${v}"]`);
    await page.click('#canon-play');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent !== '観', null, { timeout: 8000 });
    await page.waitForTimeout(13000); // 3つめの声が入るはずの 16 拍目（約 11.5 秒）をこえる
    expect(await page.locator('#bloom').isHidden(), '声が1つなのに蓮が開いた');
    await page.click('#btn-stop');
    await page.click('#btn-sample');
    for (const v of ['bass', '1', '2']) await page.check(`#dlg-canon input[name="part"][value="${v}"]`);
    await page.keyboard.press('Escape');
  });

  await check('しくみ：見方・物理・数学・英語・コードの説明があり、表示を暗くできる', async () => {
    await page.click('#btn-about');
    await page.waitForSelector('#dlg-about[open]');
    const body = await text('#dlg-about');
    for (const w of ['見方', '物理', '数学', '英語', 'コード', 'log', 'octave', 'armBinMap']) expect(body.includes(w), `「${w}」がない`);
    await shot('k08-about');
    await page.check('#dlg-about input[name="kh-theme"][value="dark"]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const bg = await page.evaluate(() => {
      const d = document.querySelector('#cv-kouhai').getContext('2d').getImageData(2, 2, 1, 1).data;
      return d[0] + d[1] + d[2];
    });
    expect(bg < 120, `暗い表示なのに、光背の地が明るい（${bg}）`);
    await shot('k09-dark');
    await page.click('#btn-about');
    await page.check('#dlg-about input[name="kh-theme"][value="auto"]');
    await page.keyboard.press('Escape');
  });

  await check('横に持つ：左に光背（画面の高さに収まる）、右に操作。はみ出さない', async () => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(500);
    const box = await page.locator('#kh-stage').boundingBox();
    expect(box.y + box.height <= 390 + 1, `光背が画面の下にはみ出している（${box.y + box.height}）`);
    const panel = await page.locator('.kh-panel').boundingBox();
    expect(panel.x >= box.x + box.width - 1, '操作が光背の右にない');
    expect((await overflow()) <= 0, '横にはみ出している');
    await shot('k10-landscape');
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await check('電波がなくても：一度開いたあとは、光背が開いて描ける', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // Service Worker が受け持つ状態で開き直す
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    await context.setOffline(true);
    try {
      await page.goto(`http://localhost:${PORT}/`);
      expect((await page.title()).startsWith('光背'), `電波がないとき「${await page.title()}」が出た`);
      await page.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
      expect((await inkOf(page)) > 2000, '電波がないと、光背が描かれない（部品が欠けている）');
    } finally {
      await context.setOffline(false);
    }
  });

  await check('英語版（en.html）：端末が明るい表示でも黒い地。音名は C D E、マイクで「A」と 9 o\'clock・ring 3', async () => {
    expect((await page.getAttribute('.kh-lang', 'href')) === 'en.html', '日本語版に English の入口がない');
    await page.goto(`http://localhost:${PORT}/en.html`);
    await page.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('Example'), null, { timeout: 10000 });
    const bg = await page.evaluate(() => {
      const d = document.querySelector('#cv-kouhai').getContext('2d').getImageData(2, 2, 1, 1).data;
      return [d[0], d[1], d[2], getComputedStyle(document.body).backgroundColor];
    });
    expect(bg[0] + bg[1] + bg[2] === 0 && bg[3] === 'rgb(0, 0, 0)', `黒い地ではない（${bg.join(', ')}）`);
    const labels = await page.locator('#kouhai-dial .kouhai-pc').allInnerTexts();
    expect(labels[0] === 'C' && labels.includes('A'), `音名が ${labels.join(' ')}`);
    expect((await text('#btn-mic-text')) === 'Microphone', await text('#btn-mic-text'));
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'A', null, { timeout: 10000 });
    await page.waitForTimeout(1000);
    expect((await text('#kh-en')) === 'A4', await text('#kh-en'));
    expect((await text('#kh-sub')).includes("9\u00a0o'clock · ring 3"), await text('#kh-sub'));
    expect((await text('#head-status-text')) === 'Listening', await text('#head-status-text'));
    await shot('k12-english');
    await page.click('#btn-mic');
    await page.click('#btn-sample');
    await page.waitForSelector('#dlg-canon[open]');
    expect((await text('#dlg-canon-h')) === "Pachelbel's Canon", await text('#dlg-canon-h'));
    await page.keyboard.press('Escape');
    const jp = await page.evaluate(() => document.body.innerText.match(/[\u3040-\u30ff\u4e00-\u9fff][\u3040-\u30ff\u4e00-\u9fff・]*/g) || []);
    const allowed = new Set(['光背', '日本語', '千手', '蓮', 'ド・レ・ミ', 'ド']);
    const left = jp.filter((w) => !allowed.has(w));
    expect(!left.length, `英語版に日本語が残っている：${left.join(' ')}`);
    expect((await page.getAttribute('.kh-lang', 'href')) === './', '英語版に 日本語 の入口がない');
  });

  await check('エラーが1つも出ていない', async () => {
    expect(errors.length === 0, errors.join(' / '));
  });
} finally {
  await browser.close();
}

// ---------- claude.ai 用の1ファイル版（マイクは使えない。サンプル・指で鳴らす・残すは使える） ----------
if (existsSync(join(ROOT, 'dist/halo-artifact.html'))) {
  const art = await readFile(join(ROOT, 'dist/halo-artifact.html'), 'utf8');
  const mock = `<script>
    window.__saved = null;
    const downloads = { save: async ({ filename, data }) => { window.__saved = { filename, size: data.size, type: data.type }; } };
    window.claude = { use: async (name) => (name === 'downloads' ? downloads : null) };
  </script>`;
  const file = join(dir, 'halo-artifact.html');
  await writeFile(file, `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">${mock}</head><body>${art}</body></html>`);
  const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const p = await b2.newPage({ viewport: { width: 390, height: 844 } });
    await quietFonts(p);
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(`file://${file}`);
    await check('1ファイル版：起動して、Claude の中ではマイクが使えないことを先に伝える', async () => {
      await p.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
      expect(await p.locator('#kh-embedded').isVisible(), 'マイクが使えない案内がない');
      expect((await p.locator('#kouhai-dial .kouhai-pc').count()) === 12, '音名が12個ない');
      expect(await p.locator('#ab-view-set').isHidden(), 'Claude の中なのに、表示の明るさの切り替えが出ている');
    });
    await check('1ファイル版：指で鳴らすと映り、残すと Claude の保存の機能で絵を保存する', async () => {
      await p.click('#btn-touch');
      // 指で鳴らすが始まる（音の部品の準備が終わる）のを待ってから触れる。待たずに触れると、その指は鳴らない
      await p.waitForFunction(() => document.querySelector('#btn-touch').getAttribute('aria-pressed') === 'true', null, { timeout: 8000 });
      const at = await spiralXY(p, 60);
      await p.mouse.move(at.x, at.y);
      await p.mouse.down();
      await p.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ド', null, { timeout: 5000 });
      await p.mouse.up();
      await p.click('#btn-save');
      await p.waitForFunction(() => !!window.__saved, null, { timeout: 5000 });
      const saved = await p.evaluate(() => window.__saved);
      expect(/^kouhai-.*\.png$/.test(saved.filename) && saved.type === 'image/png' && saved.size > 10000, JSON.stringify(saved));
      if (SHOTS) await p.screenshot({ path: join(SHOTS, 'k11-artifact.png') });
      await p.click('#btn-touch');
    });
    await check('1ファイル版：エラーなし', async () => {
      expect(errs.length === 0, errs.join(' / '));
    });
  } finally {
    await b2.close();
  }
} else {
  console.log('（1ファイル版は、先に node tools/build-artifact.mjs で作ると確かめます）');
}
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} 合格`);
process.exit(failed.length ? 1 : 0);
