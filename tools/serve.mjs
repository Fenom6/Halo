// 手元で動かすための小さな Web サーバー（追加のインストール不要）
//   node tools/serve.mjs        → http://localhost:8080/
//   PORT=3000 node tools/serve.mjs
// localhost は「安全な場所」として扱われるので、パソコンのブラウザならマイクも試せます。
//
// 安全のための決まり：
//   - ふだんは、このパソコンの中（127.0.0.1）からしか開けない。同じ Wi-Fi の別の端末から開きたいときだけ、
//     HOST=0.0.0.0 を付けて起動する（そのあいだは、同じネットワークのだれでも開けることに注意）
//   - 名前が「.」で始まるファイル・フォルダ（.git・.env など、見せるつもりのない物）は、決して返さない
//   - 配るフォルダの外にあるファイルは、リンク（シンボリックリンク）をたどっても返さない
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.md': 'text/markdown; charset=utf-8',
};

/** 道すじに「.」で始まる名前（.git・.env・.claude など）が1つでもあるか */
export const isHiddenPath = (path) => path.split(/[\\/]+/).some((part) => part.startsWith('.') && part !== '.');

const inside = (base, file) => file === base || file.startsWith(base + sep);

export function startServer({ dir = root, listenPort = port, listenHost = host } = {}) {
  const base = resolve(dir);
  let realBase = null;
  const server = http.createServer(async (req, res) => {
    const deny = () => res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('forbidden');
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path.endsWith('/')) path += 'index.html';
      if (isHiddenPath(path)) return deny();
      const file = resolve(join(base, path));
      if (!inside(base, file)) return deny();
      // リンクをたどった先も、配るフォルダの中か確かめる
      realBase = realBase || (await realpath(base));
      const real = await realpath(file);
      if (!inside(realBase, real) || isHiddenPath(real.slice(realBase.length))) return deny();
      const data = await readFile(real);
      res.writeHead(200, { 'Content-Type': TYPES[extname(real)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    }
  });
  return new Promise((ok, ng) => {
    server.once('error', ng);
    server.listen(listenPort, listenHost, () => ok(server));
  });
}

/**
 * このファイルが `node tools/serve.mjs` で直接実行されたか（ほかのファイルから読み込まれただけなら、起動しない）。
 * ファイルの場所どうしで比べる。URL の文字（file://…）で比べると、Windows の「C:\…」や、
 * 空白・日本語の入ったフォルダでは書き方がちがって一致せず、何も言わずに終わってしまう。
 */
function isMain() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  startServer().then(() => {
    console.log(`光背 Halo: http://localhost:${port}/`);
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      console.log(`注意：HOST=${host} で起動しています。同じネットワークの別の端末からも開けます（使い終わったら止めてください）。`);
    }
  });
}
