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

// 安全：開発用サーバーは、このパソコンの中からだけ開け、隠しファイル（.git・.env など）や、
// 配るフォルダの外のファイルを返さない（セキュリティ検査の指摘）
import { symlink } from 'node:fs/promises';
import { startServer, isHiddenPath } from '../tools/serve.mjs';

test('隠しファイル・配るフォルダの外は返さない。ふだんは 127.0.0.1（このパソコンの中）だけで待つ', async () => {
  const base = await mkdtemp(join(tmpdir(), 'halo-serve-safe-'));
  const dir = join(base, 'site');
  await mkdir(join(dir, '.git'), { recursive: true });
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<p>ok</p>');
  await writeFile(join(dir, '.git', 'config'), '[remote "origin"] url = https://token@example.invalid/repo');
  await writeFile(join(dir, '.env'), 'SECRET=1');
  await writeFile(join(base, 'outside.txt'), 'outside');
  await symlink(join(base, 'outside.txt'), join(dir, 'docs', 'link.txt'));
  const port = 9000 + Math.floor(Math.random() * 900);
  const server = await startServer({ dir, listenPort: port });
  try {
    assert.equal(server.address().address, '127.0.0.1', '外のネットワークからも開ける');
    const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).status;
    assert.equal(await get('/'), 200);
    assert.equal(await get('/.git/config'), 403, '.git の中身を返した');
    assert.equal(await get('/.env'), 403, '.env を返した');
    assert.equal(await get('/%2egit/config'), 403, '文字を変えた .git を返した');
    assert.equal(await get('/docs/link.txt'), 403, 'リンクをたどって、配るフォルダの外のファイルを返した');
    assert.notEqual(await get('/..%2foutside.txt'), 200, '1つ上のフォルダのファイルを返した');
  } finally {
    server.close();
    await rm(base, { recursive: true, force: true });
  }
});

test('隠しファイルの見分け方', () => {
  for (const p of ['/.git/config', '/.env', '/a/.claude/x', '\\.ssh\\id']) assert.ok(isHiddenPath(p), p);
  for (const p of ['/', '/index.html', '/js/main.js', '/docs/images/a.jpg', './x']) assert.ok(!isHiddenPath(p), p);
});
