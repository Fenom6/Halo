// tools/serve.mjs のテスト：どんなフォルダに置いても `node tools/serve.mjs` で起動できるか
//   「このファイルが直接実行されたか」を、ファイルの場所と URL の書き方で比べていたため、
//   Windows（C:\Users\…）や、空白・日本語の入ったフォルダでは、何も言わずに終わっていた。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

test('空白や日本語の入ったフォルダからでも、node tools/serve.mjs でサーバーが起動する', async () => {
  const base = await mkdtemp(join(tmpdir(), 'kannon serve '));
  const dir = join(base, '光背 テスト');
  await mkdir(join(dir, 'tools'), { recursive: true });
  await copyFile(new URL('../tools/serve.mjs', import.meta.url), join(dir, 'tools', 'serve.mjs'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>t</title><p>ok</p>');
  const port = 9000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, [join(dir, 'tools', 'serve.mjs'), dir], { env: { ...process.env, PORT: String(port) } });
  try {
    const out = await new Promise((resolve) => {
      let text = '';
      const done = () => {
        clearTimeout(timer);
        resolve(text);
      };
      const timer = setTimeout(done, 5000);
      child.stdout.on('data', (d) => {
        text += d;
        if (text.includes('http://localhost')) done();
      });
      child.on('exit', done);
    });
    assert.ok(out.includes(`http://localhost:${port}/`), `サーバーが起動しなかった（出力：${JSON.stringify(out)}）`);
    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /ok/);
  } finally {
    child.kill();
    await rm(base, { recursive: true, force: true });
  }
});
