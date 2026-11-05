// claude.ai のページ（アーティファクト）用に、アプリを1つの HTML ファイルにまとめる
//   node tools/build-artifact.mjs   … dist/halo-artifact.html を作る
//
// しくみ（小さな「バンドラー」）：
//   入口の JS（js/main.js）から import をたどって、使っているモジュールを全部集める。
//   各モジュールを「関数のカプセル」に入れて、export したものだけを外に返す。
//   import していた所は、そのカプセルから取り出す形に書きかえる。
//   CSS は、ページが読み込んでいるもの（<link rel="stylesheet" href="css/…">）を、その順番で中に入れる。
// このアプリの書き方（名前つきの import / export だけ）に合わせた、簡単なものです。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

const TARGETS = {
  halo: { html: 'index.html', entry: 'js/main.js', out: 'dist/halo-artifact.html' },
};

const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*'(\.\/[^']+)';?[ \t]*$/gm;
const EXPORT_RE = /^export\s+(async\s+function\*?|function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;

const id = (p) => `__m_${p.replace(/^js\//, '').replace(/[^\w]/g, '_')}`;

/** 入口の JS から、使っているモジュールを全部集めて1つの JS にする */
async function bundle(entry) {
  const modules = new Map(); // path -> { code, deps, imports, exports }
  async function load(path) {
    if (modules.has(path)) return;
    const src = await readFile(path, 'utf8');
    const deps = [];
    const imports = [];
    for (const m of src.matchAll(IMPORT_RE)) {
      const dep = normalize(join(dirname(path), m[2]));
      deps.push(dep);
      imports.push({ dep, names: m[1] });
    }
    if (/^export\s+(default|\{|\*)/m.test(src)) throw new Error(`${path}: export default / export { } / export * には対応していません`);
    if (/\bimport\s*\(|import\.meta/.test(src)) throw new Error(`${path}: 動的 import と import.meta には対応していません`);
    const exports = [...src.matchAll(EXPORT_RE)].map((m) => m[2]);
    const code = src.replace(IMPORT_RE, '').replace(/^export\s+/gm, '');
    modules.set(path, { code, deps, imports, exports });
    for (const d of deps) await load(d);
  }
  await load(entry);

  // 依存しているものが先に来る順番に並べる（トポロジカルソート）
  const order = [];
  const state = new Map();
  function visit(p, stack = []) {
    if (state.get(p) === 'done') return;
    if (state.get(p) === 'visiting') throw new Error(`循環 import: ${[...stack, p].join(' → ')}`);
    state.set(p, 'visiting');
    for (const d of modules.get(p).deps) visit(d, [...stack, p]);
    state.set(p, 'done');
    order.push(p);
  }
  visit(entry);

  let js = '';
  for (const p of order) {
    const m = modules.get(p);
    const head = m.imports
      .map(({ dep, names }) => {
        const list = names
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s.replace(/\s+as\s+/, ': '));
        return `const { ${list.join(', ')} } = ${id(dep)};`;
      })
      .join('\n');
    js += `\n// ---- ${p} ----\nconst ${id(p)} = (() => {\n${head}\n${m.code}\nreturn { ${m.exports.join(', ')} };\n})();\n`;
  }
  return { js, count: order.length };
}

async function build(name, out) {
  const t = TARGETS[name];
  if (!t) throw new Error(`作れるのは ${Object.keys(TARGETS).join('・')} です（${name}）`);
  const html = await readFile(t.html, 'utf8');
  const pick = (re, what) => {
    const m = html.match(re);
    if (!m) throw new Error(`${t.html} に ${what} が見つかりません`);
    return m[1] ?? m[0];
  };
  const title = pick(/<title>[\s\S]*?<\/title>/, '<title>');
  const sides = pick(/<meta name="claude:viewport-fit-sides"[^>]*>/, 'viewport-fit-sides');
  const fonts = [...html.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]);
  const cssFiles = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+\.css)">/g)].map((m) => m[1]);
  if (!cssFiles.length) throw new Error(`${t.html} に CSS の読み込みが見つかりません`);
  const css = (await Promise.all(cssFiles.map((f) => readFile(f, 'utf8')))).join('\n');
  const body = pick(/<!-- HALO:BODY-START -->([\s\S]*?)<!-- HALO:BODY-END -->/, '本文の目印');
  const { js, count } = await bundle(t.entry);

  // </script> が中に出てくると HTML が途中で終わってしまうので、念のため書きかえる
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const page = [title, sides, ...fonts, `<style>\n${css}\n</style>`, body.trim(), `<script type="module">\n${safeJs}\n</script>`, ''].join('\n');

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, page);
  console.log(`✔ ${out}（${count} モジュール、${(page.length / 1024).toFixed(0)} KB）`);
}

const [name, out] = process.argv.slice(2);
if (name) await build(name, out || TARGETS[name]?.out);
else for (const [n, t] of Object.entries(TARGETS)) await build(n, t.out);
