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
/** 朱色の光の縦の位置（0 が上端、1 が下端）。見つからなければ −1 */
const markY = (p) =>
  p.evaluate(() => {
    const c = document.querySelector('#cv-kouhai');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const n = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--spec-mark').trim().slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    let sy = 0;
    let cnt = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 40) {
        sy += Math.floor(i / 4 / c.width);
        cnt++;
      }
    }
    return cnt ? sy / cnt / c.height : -1;
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
/** 動画に音の筋（トラック）があるか：MP4 は音の係の印 soun、WebM は音の形式の印（A_OPUS など） */
const hasAudioTrack = (buf) => {
  const s = buf.toString('latin1');
  return s.includes('soun') || /A_(OPUS|VORBIS|AAC)/.test(s);
};
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

  await check('初めて開くと、3秒の案内：ドから時計回りに光が巡り、終わると例の絵に戻る。2回目からは流れない', async () => {
    await page.waitForFunction(() => document.documentElement.dataset.intro === 'on', null, { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('.kouhai-pc.is-lit'), null, { timeout: 3000 });
    const first = await page.evaluate(() => [document.querySelector('.kouhai-pc.is-lit').textContent, document.querySelector('#kouhai-note').textContent]);
    expect(first[1] === 'ド' || first[1] === 'ド♯', `案内の初めの音が「${first.join(' / ')}」`);
    expect((await page.getAttribute('#kouhai-center', 'data-state')) === 'intro', '案内のあいだ、まん中が音名の表示にならない');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ファ♯', null, { timeout: 4000 });
    expect((await page.locator('.kouhai-pc.is-lit').innerText()) === 'ファ♯', '♯の音も、光るあいだは名前が出る');
    await shot('k00-intro');
    await page.waitForFunction(() => !document.documentElement.dataset.intro, null, { timeout: 5000 });
    expect((await page.locator('.kouhai-pc.is-lit').count()) === 0, '案内のあとも音名が光ったまま');
    expect((await page.getAttribute('#kouhai-center', 'data-state')) === 'idle', '案内のあと、まん中が「タップで聴く」に戻らない');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
    await page.waitForTimeout(1500);
    expect(!(await page.evaluate(() => document.documentElement.dataset.intro)), '2回目も案内が流れた');
    // 「i」の見方から、もう一度流せる
    await page.click('#btn-about');
    await page.waitForSelector('#dlg-about[open]');
    await page.click('#btn-intro');
    await page.waitForFunction(() => document.documentElement.dataset.intro === 'on', null, { timeout: 3000 });
    await page.waitForFunction(() => !document.documentElement.dataset.intro, null, { timeout: 6000 });
  });

  await check('開くと、例（カノンの3つの声がそろったところ）の光背と、12の音名が出る。横にはみ出さない', async () => {
    await page.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
    expect((await page.locator('#kouhai-dial .kouhai-pc').count()) === 12, '音名が12個ない');
    expect((await text('#kh-badge')).includes('例') && (await text('#kh-badge')).includes('カノンを聴いてみる'), `例のしるしと入口が「${await text('#kh-badge')}」`);
    expect((await inkOf(page)) > 2000, '光背がほとんど描かれていない');
    expect((await overflow()) <= 0, '横にはみ出している');
    const box = await page.locator('#kh-stage').boundingBox();
    expect(Math.abs(box.width - box.height) < 2 && box.width > 340, `光背が正方形で画面いっぱいではない（${box.width}×${box.height}）`);
    await shot('k01-start');
  });

  await check('はじめの見た目は「座標と光だけ」（軌跡の長さは選べない）。ここから先の確かめのために「すべて」にする', async () => {
    expect((await page.getAttribute('html', 'data-view')) === 'pure', `はじめの見た目が「${await page.getAttribute('html', 'data-view')}」`);
    await page.click('#btn-look');
    await page.waitForSelector('#dlg-look[open]');
    expect(await page.isChecked('#dlg-look input[name="look-view"][value="pure"]'), '窓で「座標と光だけ」が選ばれていない');
    expect(await page.$eval('#dlg-look .lk-trail', (f) => f.disabled), 'はじめから軌跡の長さを選べる');
    await page.click('#dlg-look input[name="look-view"][value="full"]', { force: true });
    await page.keyboard.press('Escape');
    expect((await page.getAttribute('html', 'data-view')) === 'full', '「すべて」にならない');
  });

  await check('最初の一歩：「例 ▶ カノンを聴いてみる」を押すと、声を選ぶ窓を通らずにすぐ鳴り始める', async () => {
    await page.click('#kh-badge');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent.includes('カノン'), null, { timeout: 8000 });
    expect(await page.locator('#dlg-canon').evaluate((d) => !d.open), '声を選ぶ窓が開いてしまう');
    expect(await page.locator('#kh-badge').isHidden(), '鳴らしているのに、例の入口が残っている');
    await page.click('#btn-stop');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
  });

  await check('まん中：止まっているときは「タップで聴く」。押すとマイクで聴き始め、音名と音の大きさの輪が出る。もう一度押すと止まる', async () => {
    expect((await page.getAttribute('#kouhai-center', 'data-state')) === 'idle', '止まっているのに、まん中が操作の場所になっていない');
    expect((await text('#kouhai-hint')) === 'タップで聴く', `まん中の字が「${await text('#kouhai-hint')}」`);
    expect((await page.getAttribute('#kouhai-center', 'aria-label')) === 'マイクで聴く', '読み上げで何のボタンかわからない');
    const box = await page.locator('#kouhai-center').boundingBox();
    const stage = await page.locator('#kh-stage').boundingBox();
    expect(Math.abs(box.x + box.width / 2 - (stage.x + stage.width / 2)) < 3 && box.width > 50, `まん中の円が光背の中心にない（${JSON.stringify(box)}）`);
    await page.waitForFunction(() => document.querySelector('#probe').hidden, null, { timeout: 5000 }); // 前の操作で出た表示が消えるのを待つ
    await page.click('#kouhai-center');
    expect(!(await page.locator('#probe').isVisible()), 'まん中を押したのに、絵の高さを調べる表示が出た');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '観測中', null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 10000 });
    expect((await page.getAttribute('#kouhai-center', 'data-state')) === 'note', 'ラが聞こえているのに、まん中が音名の表示にならない');
    expect((await page.getAttribute('#kouhai-center', 'aria-label')) === '止める', '聴いているときのボタンの名前が「止める」でない');
    const level = await page.evaluate(() => Number(getComputedStyle(document.querySelector('#kouhai-center')).getPropertyValue('--level')));
    expect(level > 0.2, `音の大きさの輪が動かない（${level}）`);
    await shot('k02b-center-note');
    await page.click('#kouhai-center');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
    expect((await page.getAttribute('#kouhai-center', 'data-state')) === 'idle', '止めたあと、まん中が「タップで聴く」に戻らない');
  });

  await check('マイク（440 Hz）で、まん中に「ラ」、読み取りに A4・440 Hz・9時の向き・3周目、朱色の光は左（9時）', async () => {
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 10000 });
    await page.waitForTimeout(1200);
    expect((await text('#kh-en')) === 'A4', `英語の音名が ${await text('#kh-en')}`);
    const hz = parseFloat(await text('#kh-hz'));
    expect(Math.abs(hz - 440) < 3, `高さが ${hz} Hz`);
    expect((await text('#kh-sub')).includes('9時の向き・3周目'), await text('#kh-sub'));
    expect((await text('#head-status-text')) === '観測中', await text('#head-status-text'));
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

  await check('マイクを止めると「停止中」になり、止めた絵が残る', async () => {
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
    expect((await inkOf(page)) > 500, '止めたら絵が消えた');
  });

  await check('指で鳴らす：螺旋のラ4に触れると、ラが鳴って映る。離すと止まる', async () => {
    await page.click('#btn-touch');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '鳴らし中', null, { timeout: 5000 });
    expect((await page.getAttribute('#btn-touch', 'aria-pressed')) === 'true', 'ボタンが押された状態にならない');
    const p = await spiralXY(page, 69);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 5000 });
    expect((await text('#kh-caption')).includes('ラ4（9時）'), await text('#kh-caption'));
    expect((await text('#kh-en')) === 'A4', `${await text('#kh-en')}`);
    await shot('k04-touch-a4');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#kouhai-note').dataset.quiet === 'true', null, { timeout: 5000 });
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
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
    expect((await page.getAttribute('#kh-stage', 'data-touch')) === 'off', '指で鳴らすが止まらない');
  });

  await check('指で鳴らす：鍵盤（主音から13鍵）。ラの鍵でラが鳴って映り、すべらせるとシへ移る。離すと止まる', async () => {
    await page.click('#btn-touch');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '鳴らし中', null, { timeout: 5000 });
    expect(await page.locator('#touch-opts').isVisible(), '指で鳴らすときの切り替えが出ない');
    expect(await page.locator('#kh-keys').isHidden(), '最初から鍵盤が出ている');
    await page.check('#opt-keys');
    expect(await page.locator('#kh-keys').isVisible(), '鍵盤が出ない');
    const names = await page.locator('#kh-key-row .kh-key').allInnerTexts();
    expect(names.length === 13 && names[0] === 'ド' && names[9] === 'ラ' && names[12] === 'ド', `鍵の名前が ${names.join(' ')}`);
    expect((await text('#key-oct')) === 'ド4', `いちばん左が ${await text('#key-oct')}`);
    const a = await page.locator('#kh-key-row .kh-key').nth(9).boundingBox();
    const b = await page.locator('#kh-key-row .kh-key').nth(11).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height - 10);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 5000 });
    expect((await page.locator('#kh-key-row .kh-key.is-on').count()) === 1, '押した鍵が光らない');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 10, { steps: 4 });
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'シ', null, { timeout: 5000 });
    await shot('k05b-keys');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#kouhai-note').dataset.quiet === 'true', null, { timeout: 5000 });
    // オクターブを上げると、いちばん左が ド5
    await page.click('#key-up');
    expect((await text('#key-oct')) === 'ド5', `上げたあと ${await text('#key-oct')}`);
    await page.click('#key-down');
    // キーボードだけで弾く：13 の鍵はボタン。「−」から Tab で鍵へ入れ、Enter を押しているあいだ鳴る
    expect((await page.getByRole('button', { name: 'ラ4（A4）' }).count()) === 1, '鍵が「ラ4（A4）」のボタンとして読めない');
    await page.focus('#key-down');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.classList.contains('kh-key')), 'Tab で鍵へ入れない');
    await page.locator('#kh-key-row .kh-key').nth(9).focus();
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 5000 });
    expect((await page.locator('#kh-key-row .kh-key').nth(9).getAttribute('aria-pressed')) === 'true', '押している鍵が「押されている」にならない');
    expect((await text('#key-now')) === 'ラ4', `押している音の大きな表示が「${await text('#key-now')}」`);
    await page.keyboard.up('Enter');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').dataset.quiet === 'true', null, { timeout: 5000 });
    await page.keyboard.down(' ');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 5000 });
    await page.keyboard.up(' ');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').dataset.quiet === 'true', null, { timeout: 5000 });
    expect(await page.locator('#key-now').isHidden(), '離しても大きな表示が残る');
    await page.uncheck('#opt-keys');
  });

  await check('指で鳴らす：なめらか（ポルタメント）。半音のあいだに触れると、そのままの高さで鳴り、ずれ（セント）が出る', async () => {
    await page.check('#opt-glide');
    const p = await spiralXY(page, 69.5);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForFunction(() => /[+−]\d+/.test(document.querySelector('#kh-caption').textContent), null, { timeout: 5000 });
    const cap = await text('#kh-caption');
    const m = cap.match(/([+−])(\d+)/);
    expect(m && Number(m[2]) >= 35, `半音のあいだのずれが「${cap}」`);
    const label = await text('#probe-label');
    expect(/Hz（/.test(label), `触れた所の表示が「${label}」`);
    await page.mouse.up();
    await page.uncheck('#opt-glide');
    await page.click('#btn-touch');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
    expect(await page.locator('#touch-opts').isHidden(), '止めても切り替えが残っている');
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
    // 3つの声は色分け（第2声は空色、第3声は藤色）
    const hues = await page.evaluate(() => {
      const c = document.querySelector('#cv-kouhai');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const css = getComputedStyle(document.documentElement);
      const rgb = (k) => {
        const n = parseInt(css.getPropertyValue(k).trim().slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      return ['--voice-2', '--voice-3'].map((k) => {
        const [r, g, b] = rgb(k);
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 30) n++;
        return n;
      });
    });
    expect(hues[0] > 20 && hues[1] > 20, `声ごとの色の光が見つからない（空色 ${hues[0]}・藤色 ${hues[1]} 画素）`);
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
    await page.waitForFunction(() => document.querySelector('#kouhai-note').dataset.quiet === 'false', null, { timeout: 8000 });
    await page.waitForTimeout(13000); // 3つめの声が入るはずの 16 拍目（約 11.5 秒）をこえる
    expect(await page.locator('#bloom').isHidden(), '声が1つなのに蓮が開いた');
    await page.click('#btn-stop');
    await page.click('#btn-sample');
    for (const v of ['bass', '1', '2']) await page.check(`#dlg-canon input[name="part"][value="${v}"]`);
    await page.keyboard.press('Escape');
  });

  await check('録画：押すと長さと画質を選ぶ窓が出て（パソコン）、始めると録り始め、もう一度押すと、光の動きの動画（WebM）ができる', async () => {
    expect(await page.locator('#btn-record').isVisible(), '録画のボタンがない');
    await page.click('#btn-record');
    await page.waitForSelector('#dlg-rec[open]');
    expect((await text('#dlg-rec-h')) === '録画の設定', `窓の見出しが「${await text('#dlg-rec-h')}」`);
    expect(await page.locator('#rec-opts').isVisible(), '長さと画質の選択が出ていない');
    expect(await page.locator('#rec-with-mic').isHidden(), 'マイクで聴いていないのに、マイクの質問が出た');
    // はじめは 30 分・標準（約 560 MB）
    expect(await page.isChecked('#rec-opts input[name="rec-minutes"][value="30"]'), 'はじめの長さが 30 分でない');
    expect(await page.isChecked('#rec-opts input[name="rec-quality"][value="standard"]'), 'はじめの画質が標準でない');
    expect((await text('#rec-estimate')).includes('560 MB'), `見積もりが「${await text('#rec-estimate')}」`);
    // 2 時間・最高画質にすると、大きさの上限に先に届くことを知らせる。選んだものは覚えている
    await page.click('#rec-opts label:has(input[name="rec-minutes"][value="120"])');
    await page.click('#rec-opts label:has(input[name="rec-quality"][value="best"])');
    expect((await text('#rec-estimate')).includes('2.0 GB'), `上限の知らせが「${await text('#rec-estimate')}」`);
    await shot('k07b-record-options');
    await page.click('#dlg-rec .sheet-head button');
    await page.waitForTimeout(300);
    expect((await page.getAttribute('#btn-record', 'aria-pressed')) === 'false', 'やめたのに録画が始まった');
    await page.click('#btn-record');
    await page.waitForSelector('#dlg-rec[open]');
    expect(await page.isChecked('#rec-opts input[name="rec-minutes"][value="120"]'), '選んだ長さを覚えていない');
    await page.click('#rec-opts label:has(input[name="rec-quality"][value="high"])');
    await page.click('#rec-start');
    await page.waitForFunction(() => document.querySelector('#btn-record').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    await page.waitForTimeout(1600);
    expect((await text('#btn-record-text')).startsWith('止める 0:0'), `録画中の表示が「${await text('#btn-record-text')}」`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#btn-record')]);
    expect(/^kouhai-\d{8}-\d{6}\.(webm|mp4)$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const buf = await readFile(await dl.path());
    expect(buf.length > 2000, `動画が小さすぎる（${buf.length} バイト）`);
    if (dl.suggestedFilename().endsWith('.webm')) expect(buf.readUInt32BE(0) === 0x1a45dfa3, 'WebM の印（EBML）がない');
    // カノンを止めたあとの録画でも、動画に音の筋（トラック）が入っている（以前は、止めたあとだと入らなかった）
    expect(hasAudioTrack(buf), '動画に音の筋（トラック）がない');
    await page.waitForFunction(() => document.querySelector('#btn-record').getAttribute('aria-pressed') === 'false', null, { timeout: 5000 });
    expect((await text('#btn-record-text')) === '録画', '録画のボタンが元に戻らない');
  });

  await check('録音：押すとすぐ録り始め、もう一度押すと、音だけのファイルができる。録音中は録画を始められない', async () => {
    expect(await page.locator('#btn-audio').isVisible(), '録音のボタンがない');
    await page.click('#btn-audio');
    await page.waitForFunction(() => document.querySelector('#btn-audio').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    expect(!(await page.locator('#dlg-rec[open]').count()), '録音なのに、録画の窓が開いた');
    await page.click('#btn-record'); // 録音中は、録画は始まらない
    await page.waitForTimeout(300);
    expect(!(await page.locator('#dlg-rec[open]').count()), '録音中に、録画の窓が開いた');
    await page.waitForTimeout(1400);
    expect((await text('#btn-audio-text')).startsWith('止める 0:0'), `録音中の表示が「${await text('#btn-audio-text')}」`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#btn-audio')]);
    expect(/^kouhai-\d{8}-\d{6}\.(webm|m4a|ogg)$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const buf = await readFile(await dl.path());
    expect(buf.length > 500, `録音が小さすぎる（${buf.length} バイト）`);
    expect(hasAudioTrack(buf), '録音に音の筋（トラック）がない');
    expect(!/V_(VP8|VP9|AV1|MPEG4)/.test(buf.toString('latin1')), '録音に映像が入っている');
    await page.waitForFunction(() => document.querySelector('#btn-audio-text').textContent === '録音', null, { timeout: 5000 });
  });

  await check('録音（マイク）：マイクで聴いているときは、たずねずにマイクの音を入れる', async () => {
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 10000 });
    await page.click('#btn-audio');
    await page.waitForFunction(() => document.querySelector('#btn-audio').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    expect(!(await page.locator('#dlg-rec[open]').count()), '録音なのに、質問の窓が開いた');
    await page.waitForTimeout(2500);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#btn-audio')]);
    const buf = await readFile(await dl.path());
    // 440 Hz のマイクの音が入っているので、無音の録音（1 秒あたり数百バイト）よりずっと大きい
    expect(buf.length > 8000, `マイクの音が入っていないようだ（${buf.length} バイト）`);
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
  });

  await check('録画（マイク）：マイクで聴いているときは、マイクの音も入れるかをたずねる。やめる・入れるを選べる', async () => {
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 10000 });
    // ✕ でやめると、録画は始まらない
    await page.click('#btn-record');
    await page.waitForSelector('#dlg-rec[open]');
    await shot('k07c-record-ask');
    await page.click('#dlg-rec .sheet-head button');
    await page.waitForTimeout(300);
    expect((await page.getAttribute('#btn-record', 'aria-pressed')) === 'false', 'やめたのに録画が始まった');
    // 「マイクの音も入れる」：440 Hz のマイクの音が入った動画ができる
    await page.click('#btn-record');
    await page.waitForSelector('#dlg-rec[open]');
    await page.click('#rec-with-mic');
    await page.waitForFunction(() => document.querySelector('#btn-record').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#btn-record')]);
    const buf = await readFile(await dl.path());
    expect(hasAudioTrack(buf) && buf.length > 2000, 'マイクの音を入れた動画に、音の筋がない');
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
  });

  await check('止める：マイクの許可を待っている間に止めたら、あとからマイクが始まらない', async () => {
    await page.click('#btn-touch'); // 「指で鳴らす」にしておく（もう一度押すと止まる）
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent !== '停止中', null, { timeout: 5000 });
    // マイクの許可が出るまで 1 秒かかる端末のふりをする
    await page.evaluate(() => {
      const md = navigator.mediaDevices;
      const real = md.getUserMedia.bind(md);
      window.__realGum = real;
      window.__micTracks = [];
      md.getUserMedia = (c) => new Promise((resolve, reject) => setTimeout(() => real(c).then((st) => { window.__micTracks.push(...st.getTracks()); resolve(st); }, reject), 1000));
    });
    await page.click('#btn-mic');
    await page.waitForTimeout(200);
    await page.click('#btn-touch'); // 許可を待っている間に、止める
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
    await page.waitForTimeout(2000); // 許可が出たあとまで待つ
    expect((await text('#head-status-text')) === '停止中', `止めたのに「${await text('#head-status-text')}」になった`);
    expect(await page.evaluate(() => window.__micTracks.length > 0 && window.__micTracks.every((t) => t.readyState === 'ended')), 'もらったマイクを返していない');
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__realGum; delete window.__realGum; delete window.__micTracks; });
  });

  await check('止める：ファイルを読んでいる間に止めたら、あとから再生が始まらない', async () => {
    await page.click('#btn-touch');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent !== '停止中', null, { timeout: 5000 });
    // ファイルの読み込み（音への変換）に 1 秒かかる端末のふりをする
    await page.evaluate(() => {
      const P = (window.AudioContext || window.webkitAudioContext).prototype;
      const real = P.decodeAudioData;
      window.__realDecode = real;
      P.decodeAudioData = function (...a) {
        return new Promise((resolve, reject) => setTimeout(() => real.apply(this, a).then(resolve, reject), 1000));
      };
    });
    await page.setInputFiles('#file-input', wavPath);
    await page.waitForTimeout(200);
    await page.click('#btn-touch'); // 読んでいる間に、止める
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
    await page.waitForTimeout(2000);
    expect((await text('#head-status-text')) === '停止中', `止めたのに「${await text('#head-status-text')}」になった`);
    await page.evaluate(() => { (window.AudioContext || window.webkitAudioContext).prototype.decodeAudioData = window.__realDecode; delete window.__realDecode; });
    // そのあとは、ふつうにファイルを鳴らせる
    await page.setInputFiles('#file-input', wavPath);
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 10000 });
    await page.click('#btn-stop');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
  });

  await check('録画（マイクを始め直す）：録画中にマイクを止めて始め直しても、そのあとの音が動画に入る', async () => {
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 10000 });
    await page.click('#btn-record');
    await page.waitForSelector('#dlg-rec[open]');
    await page.click('#rec-with-mic');
    await page.waitForFunction(() => document.querySelector('#btn-record').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    await page.waitForTimeout(1000);
    await page.click('#btn-mic'); // マイクを止める
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.click('#btn-mic'); // 始め直す
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 10000 });
    await page.waitForTimeout(3000);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#btn-record')]);
    const b64 = (await readFile(await dl.path())).toString('base64');
    // 動画の音を数の並びに戻し、終わりの 1.5 秒の強さ（RMS：2乗の平均の平方根）を測る。無音なら 0
    const tail = await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(bytes.buffer);
      await ctx.close();
      const x = buf.getChannelData(0);
      const n = Math.min(x.length, Math.round(buf.sampleRate * 1.5));
      let sum = 0;
      for (let i = x.length - n; i < x.length; i++) sum += x[i] * x[i];
      return { rms: Math.sqrt(sum / n), seconds: buf.duration };
    }, b64);
    expect(tail.rms > 0.02, `始め直したあとの音が入っていない（強さ ${tail.rms.toFixed(4)}・長さ ${tail.seconds.toFixed(1)} 秒）`);
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
  });

  await check('残す（パソコン）：共有かダウンロードかを選べる。ダウンロードを選ぶとファイルになり、✕ では何も起きない', async () => {
    await page.evaluate(() => {
      window.__shared = 0;
      navigator.canShare = () => true;
      navigator.share = async () => { window.__shared++; };
    });
    // ダウンロード：共有の画面は開かず、ふつうのファイル（PNG）として保存する
    await page.click('#btn-save');
    await page.waitForSelector('#dlg-out[open]', { timeout: 8000 });
    await shot('k03b-share-or-download');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#out-download')]);
    expect(/^kouhai-\d{8}-\d{6}\.png$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    expect((await page.evaluate(() => window.__shared)) === 0, 'ダウンロードを選んだのに共有の画面を開いた');
    // 共有：共有の画面を開く
    await page.click('#btn-save');
    await page.waitForSelector('#dlg-out[open]', { timeout: 8000 });
    await page.click('#out-share');
    await page.waitForFunction(() => window.__shared === 1, null, { timeout: 5000 });
    // ✕：何も保存しない
    let downloaded = false;
    const onDl = () => { downloaded = true; };
    page.on('download', onDl);
    await page.click('#btn-save');
    await page.waitForSelector('#dlg-out[open]', { timeout: 8000 });
    await page.click('#dlg-out .sheet-head button');
    await page.waitForTimeout(600);
    page.off('download', onDl);
    expect(!downloaded && (await page.evaluate(() => window.__shared)) === 1, '✕ で閉じたのに保存か共有をした');
    await page.evaluate(() => { delete navigator.share; delete navigator.canShare; delete window.__shared; });
  });

  await check('残す（スマホ）：指で操作する端末では、窓を出さずにすぐ共有の画面を開く', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP', acceptDownloads: true });
    try {
      const p = await phone.newPage();
      await p.addInitScript(() => {
        localStorage.setItem('halo.prefs.v1', JSON.stringify({ introSeen: true })); // 3秒の案内は飛ばす
        window.__shared = 0;
        navigator.canShare = () => true;
        navigator.share = async () => { window.__shared++; };
      });
      await p.goto(`http://localhost:${PORT}/`);
      await p.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
      expect(await p.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), 'スマホのふりができていない');
      await p.click('#btn-save');
      await p.waitForFunction(() => window.__shared === 1, null, { timeout: 8000 });
      expect(!(await p.locator('#dlg-out[open]').count()), 'スマホなのに、共有かダウンロードかの窓が開いた');
    } finally {
      await phone.close();
    }
  });

  await check('録画（保存中）：共有の窓が開いている間は次の録画を始められず、終わると元に戻る', async () => {
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 10000 });
    // 共有の窓が開いたままの状態をつくる（閉じるのは、このテストが決める）
    await page.evaluate(() => {
      navigator.canShare = () => true;
      navigator.share = () => new Promise((resolve) => { window.__finishShare = resolve; });
    });
    await page.click('#btn-record');
    await page.waitForSelector('#dlg-rec[open]');
    await page.click('#rec-with-mic');
    await page.waitForFunction(() => document.querySelector('#btn-record').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    await page.waitForTimeout(1200);
    await page.click('#btn-record'); // 止める → 共有かダウンロードかをたずねる
    await page.waitForSelector('#dlg-out[open]', { timeout: 10000 });
    await page.click('#out-share');
    await page.waitForFunction(() => typeof window.__finishShare === 'function', null, { timeout: 10000 });
    expect((await text('#btn-record-text')) === '保存中…', `保存中の表示が「${await text('#btn-record-text')}」`);
    expect((await page.getAttribute('#btn-record', 'aria-pressed')) === 'false', '保存中なのに「録画中」のまま');
    // 保存のあいだに押しても、録画の質問も新しい録画も始まらない
    await page.click('#btn-record');
    await page.waitForTimeout(400);
    expect(!(await page.locator('#dlg-rec[open]').count()), '保存中に、次の録画の質問が開いた');
    expect((await page.getAttribute('#btn-record', 'aria-pressed')) === 'false', '保存中に、次の録画が始まった');
    expect((await text('#btn-record-text')) === '保存中…', '保存中の表示が書きかわった');
    await page.evaluate(() => window.__finishShare());
    await page.waitForFunction(() => document.querySelector('#btn-record-text').textContent === '録画', null, { timeout: 5000 });
    await page.evaluate(() => { delete navigator.share; delete navigator.canShare; delete window.__finishShare; });
    // 終わったあとは、また録画できる
    await page.click('#btn-record');
    await page.waitForSelector('#dlg-rec[open]');
    await page.click('#dlg-rec .sheet-head button');
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
  });

  await check('ファイル：対応形式の説明があり、音のファイルを画面へドラッグすると読める', async () => {
    expect((await text('.kh-file-hint')).includes('MP3') && (await text('.kh-file-hint')).includes('WAV'), '対応形式の説明がない');
    expect((await page.getAttribute('#file-input', 'accept')).includes('.flac'), 'ファイルの選び方に形式が書かれていない');
    await page.evaluate(() => {
      // 1 秒の 440 Hz（WAV）を作って、光背へ落とす
      const sr = 48000;
      const n = sr;
      const buf = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buf);
      const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
      v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * 440 * i) / sr)), true);
      const dt = new DataTransfer();
      dt.items.add(new File([buf], 'la440.wav', { type: 'audio/wav' }));
      const target = document.querySelector('#kh-stage');
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent.includes('la440.wav'), null, { timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'ラ', null, { timeout: 8000 });
    expect(!(await page.getAttribute('#kh-stage', 'data-drop')), '落としたあとも、光背の枠が光ったまま');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 8000 });
  });

  await check('しくみ：見方・物理・数学・英語・コードの説明がある', async () => {
    await page.click('#btn-about');
    await page.waitForSelector('#dlg-about[open]');
    const body = await text('#dlg-about');
    for (const w of ['見方', '物理', '数学', '英語', 'コード', 'log', 'octave', 'armBinMap', '世界の音楽で使う', 'サルガム', '四分音']) expect(body.includes(w), `「${w}」がない`);
    await shot('k08-about');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await check('世界の音楽に合わせる：基準 442 Hz・サルガム・主音レにすると、440 Hz は「Pa」・約 −8 セント・7時の向き。開き直しても覚えている', async () => {
    expect((await text('#btn-tuning')).includes('A4 = 440 Hz・ドレミ・12時：ド'), `設定の要約が「${await text('#btn-tuning')}」`);
    await page.click('#btn-tuning');
    await page.waitForSelector('#dlg-tuning[open]');
    expect((await page.locator('#dlg-tuning input[name="naming"]').count()) === 7, '音名の表し方が7つない');
    expect((await page.locator('#tn-a4 option').count()) >= 14, '基準の高さの選びが少ない');
    await page.selectOption('#tn-a4', '442');
    await page.check('#dlg-tuning input[name="naming"][value="sargam"]');
    await page.selectOption('#tn-tonic', '2');
    await shot('k08b-tuning-sheet');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const summary = await text('#btn-tuning');
    for (const w of ['A4 = 442 Hz', 'Sa Re Ga', '12時：レ']) expect(summary.includes(w), `要約に「${w}」がない（${summary}）`);
    const labels = await page.locator('#kouhai-dial .kouhai-pc').allInnerTexts();
    expect(labels[0] === 'Sa' && labels[7] === 'Pa' && labels.length === 12, `まわりの音名が ${labels.join(' ')}`);
    expect((await text('#kh-caption')).includes('12時がSa'), await text('#kh-caption'));
    const said = await page.getAttribute('#cv-kouhai', 'aria-label');
    expect(said.includes('12時がSa') && !said.includes('12時がド'), `読み上げ用の絵の説明が古い：${said}`);
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#kouhai-note').textContent === 'Pa', null, { timeout: 10000 });
    await page.waitForTimeout(1200);
    const sub = await text('#kh-sub');
    expect(/[−-][78] セント/.test(sub), `442 Hz の基準で 440 Hz のずれが「${sub}」`);
    expect(sub.includes('7時の向き・3周目'), sub);
    const [x, y] = [await markX(page), await markY(page)];
    expect(x > 0 && x < 0.5 && y > 0.5, `朱色の光が (${x.toFixed(2)}, ${y.toFixed(2)})（左下＝7時側のはず）`);
    await shot('k08c-tuning-sargam');
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent === '停止中', null, { timeout: 5000 });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
    expect((await text('#btn-tuning')).includes('A4 = 442 Hz'), '開き直すと設定を忘れている');
    expect((await page.locator('#kouhai-dial .kouhai-pc').first().innerText()) === 'Sa', '開き直すと音名が戻っている');
    // 四分音：オンにすると要約に出る。最初の設定に戻すと、すべて戻る
    await page.click('#btn-tuning');
    await page.waitForSelector('#dlg-tuning[open]');
    await page.check('#tn-quarter');
    expect((await text('#btn-tuning')).includes('四分音'), '四分音が要約に出ない');
    await page.click('.tn-reset');
    expect(!(await page.isChecked('#tn-quarter')), '戻しても四分音がオンのまま');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect((await text('#btn-tuning')).includes('A4 = 440 Hz・ドレミ・12時：ド'), `戻したあとの要約が「${await text('#btn-tuning')}」`);
    expect((await page.locator('#kouhai-dial .kouhai-pc').first().innerText()) === 'ド', '戻したあと、12時がドでない');
  });

  await check('見た目：光の色（青・虹）・軌跡の長さ・画面の明るさを選べ、すぐ光背に映る。開き直しても覚えている', async () => {
    // 光背の絵の、色の分かれ方：青みの強い画素の数と、色相（12区分）が何種類あるか
    const colors = () =>
      page.evaluate(() => {
        const c = document.querySelector('#cv-kouhai');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let blue = 0;
        const hues = new Map();
        for (let i = 0; i < d.length; i += 16) {
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max - min < 60 || max < 90) continue; // 灰色・暗い所（目盛り・地）は数えない
          if (b > r + 40 && b >= g) blue++;
          let h = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
          h = Math.floor((((h * 60) % 360) + 360) % 360 / 30);
          hues.set(h, (hues.get(h) || 0) + 1);
        }
        return { blue, hues: [...hues.values()].filter((n) => n > 15).length };
      });
    const before = await colors();
    await page.click('#btn-look');
    await page.waitForSelector('#dlg-look[open]');
    expect((await page.locator('#dlg-look input[name="look-hue"]').count()) === 5, '光の色が5つない');
    await page.click('#dlg-look input[name="look-hue"][value="ao"]', { force: true });
    await page.waitForTimeout(300);
    const ao = await colors();
    expect(ao.blue > before.blue + 100, `青にしても青くならない（前 ${before.blue}・後 ${ao.blue}）`);
    expect((await page.getAttribute('html', 'data-hue')) === 'ao', 'ページに青の印がない');
    await page.click('#dlg-look input[name="look-hue"][value="niji"]', { force: true });
    await page.waitForTimeout(300);
    const niji = await colors();
    expect(niji.hues >= 3, `虹で、和音（レ・ファ♯・ラ）が色の組み合わせにならない（${niji.hues} 色）`);
    await shot('k08d-look-niji');
    await page.click('#dlg-look input[name="look-trail"][value="long"]', { force: true });
    await page.click('#dlg-look input[name="look-dim"][value="0.55"]', { force: true });
    const veil = await page.evaluate(() => getComputedStyle(document.body, '::after').opacity);
    expect(Math.abs(Number(veil) - 0.55) < 0.01, `暗くする幕の濃さが ${veil}`);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
    expect((await page.getAttribute('html', 'data-hue')) === 'niji', '開き直すと光の色を忘れている');
    expect((await page.getAttribute('html', 'data-dim')) === '0.55', '開き直すと明るさを忘れている');
    expect((await colors()).hues >= 3, '開き直すと虹で描かれない');
    await page.click('#btn-look');
    await page.waitForSelector('#dlg-look[open]');
    expect(await page.isChecked('#dlg-look input[name="look-trail"][value="long"]'), '軌跡の長さを忘れている');
    await page.click('#dlg-look .tn-reset');
    await page.keyboard.press('Escape');
    expect((await page.getAttribute('html', 'data-hue')) === 'kin', '戻しても金にならない');
    expect((await page.getAttribute('html', 'data-view')) === 'pure', '戻しても「座標と光だけ」にならない');
    expect((await page.getAttribute('html', 'data-dim')) === null, '戻しても暗いまま');
  });

  await check('見た目：描くもの「座標と光だけ」。カノンでも、追いかける3つの光・軌跡・蓮は出ず、目盛りと千本の光だけ。軌跡の長さは選べなくなる', async () => {
    await page.click('#btn-look');
    await page.waitForSelector('#dlg-look[open]');
    expect((await page.locator('#dlg-look input[name="look-view"]').count()) === 2, '描くものが2つない');
    await page.click('#dlg-look input[name="look-view"][value="pure"]', { force: true });
    expect((await page.getAttribute('html', 'data-view')) === 'pure', 'ページに「座標と光だけ」の印がない');
    expect(await page.$eval('#dlg-look .lk-trail', (f) => f.disabled), '座標と光だけなのに、軌跡の長さを選べる');
    await page.keyboard.press('Escape');
    await page.click('#btn-sample');
    await page.waitForSelector('#dlg-canon[open]');
    await page.click('#canon-play');
    await page.waitForFunction(() => document.querySelector('#head-status-text').textContent.includes('カノン'), null, { timeout: 8000 });
    expect((await text('#kh-caption')).startsWith('観るところ：同じ旋律'), `座標と光だけの「観るところ」が「${await text('#kh-caption')}」`);
    await page.waitForTimeout(13000); // 3つの声がそろう 16 拍目（約 11.5 秒）をこえる：ふだんなら蓮が開くところ
    expect(await page.locator('#bloom').isHidden(), '座標と光だけなのに蓮が開いた');
    const px = await page.evaluate(() => {
      const c = document.querySelector('#cv-kouhai');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const css = getComputedStyle(document.documentElement);
      const near = (k) => {
        const n = parseInt(css.getPropertyValue(k).trim().slice(1), 16);
        const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        let m = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 30) m++;
        return m;
      };
      let lit = 0; // 地でも目盛りでもない、明るい画素（千本の光）
      for (let i = 0; i < d.length; i += 16) if (Math.max(d[i], d[i + 1], d[i + 2]) > 120) lit++;
      return { sky: near('--voice-2'), wisteria: near('--voice-3'), lit };
    });
    await shot('k08e-look-pure-canon');
    expect(px.sky < 5 && px.wisteria < 5, `座標と光だけなのに、追いかける光が見える（空色 ${px.sky}・藤色 ${px.wisteria} 画素）`);
    expect(px.lit > 50, `千本の光が描かれていない（${px.lit}）`);
    await page.click('#btn-stop');
    await page.click('#btn-look');
    await page.waitForSelector('#dlg-look[open]');
    await page.click('#dlg-look input[name="look-view"][value="full"]', { force: true });
    expect(!(await page.$eval('#dlg-look .lk-trail', (f) => f.disabled)), 'すべてに戻しても、軌跡の長さを選べない');
    await page.keyboard.press('Escape');
    expect((await page.getAttribute('html', 'data-view')) === 'full', 'すべてに戻らない');
  });

  await check('光だけを全画面で：目盛り・音名・操作が消えて光だけが画面いっぱいに。触れると操作と ✕ が出て、✕ で元に戻る', async () => {
    // ブラウザの全画面はウィンドウごと切り替わるので、別の画面で確かめる（あとの「横に持つ」の確かめに残さない）
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ja-JP' });
    await ctx.addInitScript(() => localStorage.setItem('halo.prefs.v1', JSON.stringify({ introSeen: true })));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://localhost:${PORT}/`);
    await p.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
    const pixels = () =>
      p.evaluate(() => {
        const c = document.querySelector('#cv-kouhai');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let gray = 0;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
          const mx = Math.max(r, g, b);
          if (mx > 120) lit++;
          else if (mx > 25 && mx - Math.min(r, g, b) < 12) gray++; // 灰色（目盛りの線）
        }
        return { gray, lit, corner: [...c.getContext('2d').getImageData(1, 1, 1, 1).data.slice(0, 3)] };
      });
    const before = await pixels();
    await p.click('#btn-full');
    expect((await p.getAttribute('html', 'data-full')) === 'on', '全画面の印がない');
    await p.waitForTimeout(600);
    const box = await p.locator('#kh-stage').boundingBox();
    expect(Math.abs(box.width - 390) < 2 && Math.abs(box.height - 844) < 2, `光背が画面いっぱいでない（${box.width}×${box.height}）`);
    expect(!(await p.locator('#kouhai-dial .kouhai-pc').first().isVisible()), '音名が出たまま');
    const px = await pixels();
    expect(px.lit > 500, `光が描かれていない（${px.lit}）`);
    expect(px.gray * 5 < before.gray, `目盛りの線が残っている（灰色 前 ${before.gray}・後 ${px.gray} 画素）`);
    expect(px.corner.every((v) => v < 8), `地が黒くない（${px.corner}）`);
    await shot('k08f-full-light', p);
    await p.waitForTimeout(3800);
    expect((await p.getAttribute('html', 'data-full-ui')) === null, '操作が出たまま消えない');
    await p.mouse.click(195, 170);
    expect((await p.getAttribute('html', 'data-full-ui')) === 'on', '触れても操作が出ない');
    expect(!(await p.locator('#probe').isVisible()), '全画面で、高さを調べる表示が出た');
    await p.click('#btn-full-exit');
    expect((await p.getAttribute('html', 'data-full')) === null, '✕ で元に戻らない');
    await p.waitForTimeout(400);
    expect(await p.locator('#kouhai-dial .kouhai-pc').first().isVisible(), '戻しても音名が出ない');
    const back = await p.locator('#kh-stage').boundingBox();
    expect(Math.abs(back.width - back.height) < 2, '戻しても正方形に戻らない');
    expect((await pixels()).gray > before.gray / 2, '戻しても目盛りが描かれない');
    await ctx.close();
  });

  await check('日本語版も、端末が明るい表示でも黒い地（光背の地も、ページの地も、まっ黒）。表示の切り替えはない', async () => {
    expect((await page.locator('input[name="kh-theme"]').count()) === 0, '表示の明るさの切り替えが残っている');
    const bg = await page.evaluate(() => {
      const d = document.querySelector('#cv-kouhai').getContext('2d').getImageData(2, 2, 1, 1).data;
      return [d[0], d[1], d[2], getComputedStyle(document.body).backgroundColor, document.querySelector('meta[name="theme-color"]').content];
    });
    expect(bg[0] + bg[1] + bg[2] === 0 && bg[3] === 'rgb(0, 0, 0)' && bg[4] === '#000000', `黒い地ではない（${bg.join(', ')}）`);
    await shot('k09-dark');
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
    // 横向きでは、見た目の窓は右の列を覆う引き出し（光背は見えたまま。窓の外に操作がはみ出して重ならない）
    await page.click('#btn-look');
    await page.waitForSelector('#dlg-look[open]');
    await page.waitForTimeout(300);
    const sheet = await page.locator('#dlg-look').boundingBox();
    expect(Math.abs(sheet.x + sheet.width - 844) < 2 && sheet.x >= box.x + box.width - 2 && sheet.height >= 388, `見た目の窓が右の引き出しになっていない（${JSON.stringify(sheet)}）`);
    await shot('k10b-landscape-look');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
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
    // 幅 320 px：上の帯の状態（Stopped）を省略しない
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(300);
    const cut = await page.evaluate(() => {
      const t = document.querySelector('#head-status-text');
      return [t.textContent, t.scrollWidth - t.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth];
    });
    expect(cut[1] <= 0 && cut[2] <= 0, `幅 320 px で「${cut[0]}」が省略される（${cut[1]} px）・はみ出し ${cut[2]} px`);
    await shot('k13-english-320');
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await check('マイクが止められているとき：端末に合わせた「許可しなおす手順」を、1行ずつ出す', async () => {
    const p2 = await context.newPage();
    await p2.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await p2.goto(`http://localhost:${PORT}/`);
    await p2.waitForFunction(() => document.querySelector('#kh-hz').textContent.includes('例'), null, { timeout: 10000 });
    await p2.click('#btn-mic');
    await p2.waitForSelector('#mic-error:not([hidden])', { timeout: 5000 });
    const msg = await p2.locator('#mic-error').innerText();
    for (const w of ['許可されていません', '1.', '2.', '3.', 'アドレス欄', '読み込みなおして', 'カノン']) expect(msg.includes(w), `手順に「${w}」がない：${msg}`);
    const ws = await p2.evaluate(() => getComputedStyle(document.querySelector('#mic-error')).whiteSpace);
    expect(ws === 'pre-line', '手順が1行ずつに分かれない');
    await shot('k14-mic-denied', p2);
    await p2.close();
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
