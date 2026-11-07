// かんたんな点検：
//  1. すべての JS ファイルが、文法の間違いなく読み込めるか（node --check）
//  2. オフライン用の一覧（sw.js の SHELL）に、js/ のファイルがもれなく入っているか
//  3. 一覧にあるファイルが、本当に存在するか
//  4. ページが読み込む部品（CSS・JS・アイコン・マニフェスト）が、一覧にあるか
//  5. マニフェスト（ホーム画面に追加するときの説明書き）のアイコンが、本当に存在するか
import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`✖ ${msg}`);
};

async function listJs(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listJs(p)));
    else if (/\.(m?js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [...(await listJs('js')), ...(await listJs('tools')), ...(await listJs('tests')), 'sw.js'];
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail(`${f} の文法: ${String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')}`);
  }
}

const sw = await readFile('sw.js', 'utf8');
const shell = [...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((s) => /\.(js|css|html|png|svg|webmanifest)$/.test(s));
for (const f of await listJs('js')) {
  const rel = f.replaceAll('\\', '/');
  if (!shell.includes(rel)) fail(`sw.js の SHELL に ${rel} がありません（オフラインで開けなくなります）`);
}
for (const f of shell) {
  try {
    await access(f);
  } catch {
    fail(`sw.js の SHELL にある ${f} が見つかりません`);
  }
}

const PAGES = ['index.html', 'en.html', 'watch.html'];
for (const page of PAGES) {
  if (!shell.includes(page)) fail(`sw.js の SHELL に ${page} がありません`);
  const html = await readFile(page, 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"#:]+\.(?:css|js|png|svg|webmanifest))"/g)].map((m) => m[1].replace(/^\.\//, ''));
  for (const ref of refs) if (!shell.includes(ref)) fail(`${page} が読み込む ${ref} が、sw.js の SHELL にありません（オフラインで欠けます）`);
}

for (const manifest of ['manifest.webmanifest', 'manifest-en.webmanifest']) {
  const m = JSON.parse(await readFile(manifest, 'utf8'));
  for (const ic of m.icons || []) {
    try {
      await access(ic.src);
    } catch {
      fail(`${manifest} のアイコン ${ic.src} が見つかりません`);
    }
  }
}

if (failed) {
  console.error(`\n${failed} 件の問題があります`);
  process.exit(1);
}
console.log(`✔ ${files.length} ファイルの文法と、オフライン用の一覧（${shell.length} 件）を確認しました`);
