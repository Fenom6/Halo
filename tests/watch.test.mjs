// watch.js（見張りAIのカノン：学習用）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthConversation, measureFrames, Watcher, summarize, sharedSeconds, droppedSeconds, score, isDangerAlert, MEMORY_S, ANSWERS, BASE_HZ } from '../js/watch.js';

const frames = measureFrames(synthConversation());
const run = (level) => {
  const w = new Watcher(level);
  for (const f of frames) w.push(f);
  return w;
};

test('第1声は、合成した声の大きさと高さを測れる（Aは約 120 Hz・-26 dB、だれも話さない所は静か）', () => {
  assert.equal(frames.length, 600, '0.1 秒ごとに 60 秒');
  const at = (t) => frames.find((f) => Math.abs(f.t - t) < 0.05);
  const a = at(2.1).A;
  assert.ok(Math.abs(a.db + 26) < 2, `Aの大きさ ${a.db}`);
  assert.ok(Math.abs(a.hz / BASE_HZ.A - 1) < 0.06, `Aの高さ ${a.hz}`);
  assert.ok(at(46).A.db < -60 && at(46).B.db < -60, '沈黙の所が静かでない');
});

test('ふつうの感度：荒らげた声・さえぎり・一方的・沈黙を捉え、静かで冷たい言い方は見逃し、大笑いで空振りする', () => {
  const w = run('mid');
  const s = score(w.alerts);
  const by = Object.fromEntries(s.result.map((r) => [r.ja.slice(0, 6), r.alerts.length]));
  assert.ok(s.result[0].alerts.some((a) => a.kind === 'loud' && a.who === 'A'), '荒らげた声に「声が大きい」が出ない');
  assert.ok(s.result[1].alerts.some((a) => a.kind === 'overlap'), 'さえぎりに「声がかぶる」が出ない');
  assert.ok(s.result[2].alerts.some((a) => a.kind === 'mono' && a.who === 'A'), '一方的な話に合図が出ない');
  assert.equal(s.result[3].alerts.length, 0, `静かで冷たい言い方は、物理では見えないはず（${JSON.stringify(by)}）`);
  assert.ok(s.result[4].alerts.some((a) => a.kind === 'silence'), '沈黙に合図が出ない');
  assert.ok(s.result[5].alerts.length > 0, '大笑いで空振りしない（学べない）');
  assert.equal(s.caught, 4);
  assert.equal(s.miss, 1);
});

test('感度は交換条件：敏感ほど合図と渡る記録が増え、鈍感ほど見逃しが増える', () => {
  const [hi, mid, lo] = ['high', 'mid', 'low'].map((l) => {
    const w = run(l);
    return { n: w.alerts.length, shared: sharedSeconds(w.alerts), ...score(w.alerts) };
  });
  assert.ok(hi.n > mid.n && mid.n > lo.n, `合図の数 ${hi.n} ${mid.n} ${lo.n}`);
  assert.ok(hi.shared > mid.shared && mid.shared > lo.shared, `渡った秒数 ${hi.shared} ${mid.shared} ${lo.shared}`);
  assert.ok(lo.miss > mid.miss, `鈍感の見逃し ${lo.miss}・ふつう ${mid.miss}`);
  assert.ok(hi.falseAlarm >= mid.falseAlarm && mid.falseAlarm >= lo.falseAlarm, '空振りの数の順');
});

test('第1声は直前 8 秒だけを覚え、合図に付けて渡すのもその 8 秒だけ。渡った秒数は会話より短い', () => {
  const w = run('mid');
  for (const a of w.alerts) {
    const span = a.memory[a.memory.length - 1].t - a.memory[0].t;
    assert.ok(span < MEMORY_S, `渡した記録が ${span} 秒`);
  }
  assert.ok(w.memory.length <= MEMORY_S * 10);
  const shared = sharedSeconds(w.alerts);
  assert.ok(shared > 0 && shared <= w.alerts.length * MEMORY_S && shared < 60, `渡った秒数 ${shared}`);
});

test('第2声の要約は、測った数だけで書く（言葉の中身は書かない）。人の判断の答え合わせができる', () => {
  const w = run('mid');
  const text = summarize(w.alerts[0], w);
  assert.match(text, /直前 \d+\.\d 秒/);
  assert.match(text, /dB/);
  assert.match(text, /理由：/);
  assert.equal(isDangerAlert({ t: 12 }), true);
  assert.equal(isDangerAlert({ t: 53 }), false, '大笑いは危なくない');
  assert.ok(ANSWERS.some((a) => !a.danger), '危なく見えて危なくない所がある');
});

test('秒数の帳じり：60 秒 ＝ 捨てた ＋ 第三者に渡った ＋ まだ覚えている（渡った所と覚えている所の重なりは引く）', () => {
  const w = run('mid');
  const t = 60;
  const shared = sharedSeconds(w.alerts);
  const dropped = droppedSeconds(w.alerts, t);
  const sharedOld = sharedSeconds(w.alerts, t - MEMORY_S);
  assert.ok(Math.abs(dropped + sharedOld + MEMORY_S - t) < 1e-6, `捨てた ${dropped}・渡った（古い所）${sharedOld}`);
  assert.ok(dropped > 0 && shared > 0);
  assert.equal(droppedSeconds([], 5), 0, '8 秒たつまでは何も捨てない');
  assert.equal(droppedSeconds([], 20), 12);
});
