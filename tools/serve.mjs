// 手元で動かすための小さな Web サーバー（追加のインストール不要）
//   node tools/serve.mjs        → http://localhost:8080/
//   PORT=3000 node tools/serve.mjs
// localhost は「安全な場所」として扱われるので、パソコンのブラウザならマイクも試せます。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.md': 'text/markdown; charset=utf-8',
};

export function startServer({ dir = root, listenPort = port } = {}) {
  const base = resolve(dir);
  const server = http.createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(join(base, path));
      if (file !== base && !file.startsWith(base + sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    }
  });
  return new Promise((ok) => server.listen(listenPort, () => ok(server)));
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
  startServer().then(() => console.log(`光背 Halo: http://localhost:${port}/`));
}
