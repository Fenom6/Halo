/**
 * watch-page.js — 見張りAIのカノン（学習用）：画面の係
 *
 * 計算は watch.js。ここでは、例の会話を流しながら、
 *   本人の画面   … 2人の声の高さ（光背の向き）と大きさ、合図、話した時間、第1声の記憶（直前 8 秒）
 *   第三者の画面 … 合図の一覧（直前 8 秒の記録・第2声の要約・第3声＝あなたの判断）
 * を描き、終わったら答え合わせをする。
 */
import {
  WATCH_SR, FRAME_S, MEMORY_S, SCRIPT_S, SPEAK_DB, PEOPLE, ANSWERS, KINDS,
  synthConversation, measureFrames, Watcher, summarize, sharedSeconds, droppedSeconds, score, isDangerAlert,
} from './watch.js';
import { spiralPoint, freqToTurn, fitCanvas, KOUHAI_OCTAVES } from './kouhai.js';
import { $, $$, h } from './ui.js';

const COLOR = { A: '#62b6d9', B: '#ff8a65', alert: '#ff5a4f', grid: '#2c312d', muted: '#5d655f', bg: '#000000' };
const params = new URLSearchParams(location.search);
const TEST_SPEED = Number(params.get('speed')) || 0; // 通しテスト用：?speed=20 で20倍の速さ

let data = null; // { channels, frames }
let watcher = null;
let raf = 0;
let startAt = 0;
let speed = 1;
let pushed = 0;
let audio = null;
let pulse = 0; // 合図のときに外の輪を光らせる強さ（0〜1）
let talk = { A: 0, B: 0 };
const judged = new Map(); // 合図 → 'danger' | 'ok'（第3声＝あなたの判断）
const minis = new Map(); // 第三者の画面の小さな記録の絵 → その合図（隠れていた絵を、見えたときに描き直すため）

const el = {
  play: $('#w-play'), stop: $('#w-stop'), sound: $('#w-sound'), fast: $('#w-fast'),
  clock: $('#w-clock'), bar: $('#w-bar-fill'), status: $('#w-status'),
  ring: $('#w-ring'), mem: $('#w-mem'), now: $('#w-now'),
  talkA: $('#w-talk-a'), talkB: $('#w-talk-b'), talkText: $('#w-talk-text'),
  dropped: $('#w-dropped'), shared: $('#w-shared'), shared2: $('#w-shared2'), elapsed: $('#w-elapsed'), alertN: $('#w-alert-n'),
  alerts: $('#w-alerts'), empty: $('#w-empty'), result: $('#w-result'), score: $('#w-score'),
  timeline: $('#w-timeline'), answers: $('#w-answers'), judge: $('#w-judge'), views: $('.w-views'),
};

// ---------- 本人の画面：光背の目盛りの上に、2人の声 ----------
function drawRing(frame) {
  if (!el.ring.clientWidth) return; // 隠れている（スマホで第三者の画面を見ている）あいだは描かない
  const { w, h: hh, dpr } = fitCanvas(el.ring);
  const g = el.ring.getContext('2d');
  const size = Math.min(w, hh) - 8 * dpr;
  const cx = w / 2;
  const cy = hh / 2;
  g.fillStyle = COLOR.bg;
  g.fillRect(0, 0, w, hh);
  // 目盛り：12本の筋と螺旋（光背と同じ形。向きが声の高さの音名、外側ほど高い）
  g.lineWidth = dpr;
  g.strokeStyle = COLOR.grid;
  for (let k = 0; k < 12; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 6;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * size * 0.105, cy + Math.sin(a) * size * 0.105);
    g.lineTo(cx + Math.cos(a) * size * 0.43, cy + Math.sin(a) * size * 0.43);
    g.stroke();
  }
  g.strokeStyle = COLOR.muted;
  g.beginPath();
  for (let i = 0; i <= KOUHAI_OCTAVES * 120; i++) {
    const p = spiralPoint((i / 120), size);
    if (i) g.lineTo(cx + p.x, cy + p.y);
    else g.moveTo(cx + p.x, cy + p.y);
  }
  g.stroke();
  // 話した時間の割合：外周の弧（12時から時計回りに A、続けて B）
  const total = talk.A + talk.B;
  if (total > 0) {
    let a0 = -Math.PI / 2;
    for (const p of PEOPLE) {
      const a1 = a0 + (2 * Math.PI * talk[p]) / total;
      g.strokeStyle = COLOR[p];
      g.lineWidth = 4 * dpr;
      g.beginPath();
      g.arc(cx, cy, size * 0.47, a0, a1);
      g.stroke();
      a0 = a1;
    }
  }
  // 合図：外の輪が赤く光って、消えていく
  if (pulse > 0.01) {
    g.strokeStyle = COLOR.alert;
    g.globalAlpha = pulse;
    g.lineWidth = (3 + 6 * pulse) * dpr;
    g.beginPath();
    g.arc(cx, cy, size * 0.495, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }
  if (!frame) return;
  // 2人の声：向きと距離は声の高さ、光の大きさは声の大きさ
  for (const p of PEOPLE) {
    const v = frame[p];
    if (!(v.db > SPEAK_DB) || !(v.hz > 0)) continue;
    const turn = Math.min(KOUHAI_OCTAVES, Math.max(0, freqToTurn(v.hz)));
    const pt = spiralPoint(turn, size);
    const r = (4 + Math.max(0, v.db + 45) * 0.45) * dpr;
    const glow = g.createRadialGradient(cx + pt.x, cy + pt.y, 0, cx + pt.x, cy + pt.y, r * 2.4);
    glow.addColorStop(0, COLOR[p]);
    glow.addColorStop(0.4, `${COLOR[p]}aa`);
    glow.addColorStop(1, `${COLOR[p]}00`);
    g.fillStyle = glow;
    g.beginPath();
    g.arc(cx + pt.x, cy + pt.y, r * 2.4, 0, Math.PI * 2);
    g.fill();
  }
}

/** 直前 8 秒の大きさの記録を、A（上）と B（下）の棒で描く。第1声の記憶と、第三者に届いた記録の両方に使う */
function drawLevels(canvas, frames, endT) {
  if (!canvas.clientWidth) return; // 隠れているあいだは描かない（見えたときに描き直す）
  const { w, h: hh, dpr } = fitCanvas(canvas);
  const g = canvas.getContext('2d');
  g.fillStyle = '#0b0d0c';
  g.fillRect(0, 0, w, hh);
  const n = Math.round(MEMORY_S / FRAME_S);
  const bw = w / n;
  const half = hh / 2;
  for (const f of frames) {
    const i = Math.round((f.t - (endT - MEMORY_S)) / FRAME_S) - 1;
    if (i < 0 || i >= n) continue;
    PEOPLE.forEach((p, k) => {
      const u = Math.max(0, Math.min(1, (f[p].db + 60) / 50));
      if (u <= 0) return;
      g.fillStyle = COLOR[p];
      const bh = u * (half - 2 * dpr);
      g.fillRect(i * bw, k ? half + 1 * dpr : half - 1 * dpr - bh, Math.max(1, bw - dpr), bh);
    });
  }
  g.fillStyle = '#2c312d';
  g.fillRect(0, half - 0.5 * dpr, w, dpr);
}

// ---------- 第三者の画面：合図の一覧 ----------
function addAlertCard(a) {
  const mini = h('canvas', { class: 'w-mini', 'aria-hidden': 'true' });
  const who = a.who ? `${a.who}さん・` : '';
  const mk = (value, label) =>
    h('button', {
      type: 'button',
      class: 'btn w-judge-btn',
      text: label,
      'aria-pressed': 'false',
      on: {
        click: (e) => {
          judged.set(a, value);
          for (const b of e.target.parentElement.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === e.target));
          if (!el.result.hidden) renderJudge(); // 流し終わったあとに選んでも、答え合わせに入れる
        },
      },
    });
  const card = h(
    'li',
    { class: 'w-alert' },
    h('p', { class: 'w-alert-head' }, h('b', { text: `${a.t.toFixed(1)} 秒` }), h('span', { text: `${who}${KINDS[a.kind].ja}` })),
    mini,
    h('p', { class: 'w-alert-sum' }, h('b', { class: 'v-2', text: '第2声の要約 ' }), document.createTextNode(summarize(a, watcher))),
    h('div', { class: 'w-alert-judge' }, h('span', { class: 'v-3', text: '第3声（あなた）：' }), mk('danger', '危ない'), mk('ok', '問題ない')),
  );
  el.alerts.prepend(card);
  el.empty.hidden = true;
  minis.set(mini, a);
  requestAnimationFrame(() => drawLevels(mini, a.memory, a.t));
}

// ---------- 流す ----------
async function prepare() {
  if (data) return data;
  el.status.textContent = '例の会話を作っています…';
  await new Promise((r) => setTimeout(r, 30)); // 文字を先に出してから重い計算をする
  const channels = synthConversation();
  data = { channels, frames: measureFrames(channels) };
  return data;
}

function playSound(channels) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const buf = ctx.createBuffer(2, channels.A.length, WATCH_SR);
  buf.copyToChannel(channels.A, 0); // Aさんは左、Bさんは右から
  buf.copyToChannel(channels.B, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return { ctx, src };
}

function stopSound() {
  if (!audio) return;
  try {
    audio.src.stop();
  } catch {
    /* もう止まっている */
  }
  audio.ctx.close();
  audio = null;
}

async function play() {
  el.play.disabled = true;
  const { channels, frames } = await prepare();
  stop(false);
  const level = $('input[name="w-sens"]:checked').value;
  watcher = new Watcher(level);
  pushed = 0;
  pulse = 0;
  talk = { A: 0, B: 0 };
  judged.clear();
  el.alerts.replaceChildren();
  minis.clear();
  el.empty.hidden = false;
  el.result.hidden = true;
  speed = TEST_SPEED || (el.fast.checked ? 3 : 1);
  if (speed === 1 && el.sound.checked) audio = playSound(channels);
  startAt = performance.now();
  el.stop.disabled = false;
  el.play.disabled = false;
  el.play.textContent = '↻ はじめから流す';
  el.status.textContent = `流しています（感度：${{ high: '敏感', mid: 'ふつう', low: '鈍感' }[level]}）`;
  raf = requestAnimationFrame(() => tick(frames));
}

function tick(frames) {
  const t = Math.min(SCRIPT_S, ((performance.now() - startAt) / 1000) * speed);
  let last = null;
  while (pushed < frames.length && frames[pushed].t <= t) {
    const f = frames[pushed++];
    last = f;
    for (const p of PEOPLE) if (f[p].db > SPEAK_DB) talk[p] += FRAME_S;
    for (const a of watcher.push(f)) {
      pulse = 1;
      addAlertCard(a);
    }
  }
  pulse *= 0.96;
  const frame = last || frames[Math.max(0, pushed - 1)];
  drawRing(pushed ? frame : null);
  drawLevels(el.mem, watcher.memory, frame ? frame.t : 0);
  renderNumbers(t, frame);
  if (t >= SCRIPT_S || pushed >= frames.length) {
    finish();
    return;
  }
  raf = requestAnimationFrame(() => tick(frames));
}

function renderNumbers(t, frame) {
  el.clock.textContent = t.toFixed(1);
  el.bar.style.width = `${(100 * t) / SCRIPT_S}%`;
  el.shared.textContent = el.shared2.textContent = sharedSeconds(watcher.alerts).toFixed(1);
  el.dropped.textContent = droppedSeconds(watcher.alerts, t).toFixed(1);
  el.elapsed.textContent = t.toFixed(1);
  el.alertN.textContent = String(watcher.alerts.length);
  const total = talk.A + talk.B;
  el.talkA.style.width = total ? `${(100 * talk.A) / total}%` : '0';
  el.talkB.style.width = total ? `${(100 * talk.B) / total}%` : '0';
  el.talkText.textContent = total ? `A ${talk.A.toFixed(0)} 秒・B ${talk.B.toFixed(0)} 秒` : '—';
  if (frame) {
    const who = PEOPLE.filter((p) => frame[p].db > SPEAK_DB);
    el.now.textContent = who.length === 2 ? 'いま：2人が同時に話している' : who.length ? `いま：${who[0]}さんが話している` : 'いま：だれも話していない';
  }
}

function stop(showResult = true) {
  cancelAnimationFrame(raf);
  stopSound();
  el.stop.disabled = true;
  if (showResult && watcher) finish();
}

// ---------- 答え合わせ ----------
function finish() {
  cancelAnimationFrame(raf);
  stopSound();
  el.stop.disabled = true;
  el.status.textContent = '流し終わりました';
  const s = score(watcher.alerts);
  el.score.replaceChildren(
    h('span', { text: `危ない所 ${s.dangers} か所のうち ` }),
    h('b', { text: `${s.caught} か所を捉えた` }),
    h('span', { text: '・' }),
    h('b', { class: 'w-bad', text: `見逃し ${s.miss}` }),
    h('span', { text: '・' }),
    h('b', { class: 'w-bad', text: `空振り ${s.falseAlarm} 回` }),
    h('span', { text: `・第三者に渡った記録 ${sharedSeconds(watcher.alerts).toFixed(1)} 秒 / ${SCRIPT_S} 秒` }),
  );
  el.answers.replaceChildren(
    ...s.result.map((r) =>
      h(
        'li',
        { class: r.danger ? 'is-danger' : 'is-fine' },
        h('b', { text: `${r.from.toFixed(0)}〜${r.to.toFixed(0)} 秒` }),
        h('span', { text: `${r.ja}：` }),
        h('span', { class: r.alerts.length ? (r.danger ? 'w-good' : 'w-bad') : r.danger ? 'w-bad' : 'w-good', text: r.alerts.length ? (r.danger ? '捉えた' : '空振り（合図が出た）') : r.danger ? '見逃した' : '合図なし（正しい）' }),
      ),
    ),
  );
  renderJudge();
  el.result.hidden = false;
  drawTimeline();
}

/** 第3声（あなた）の判断の答え合わせ */
function renderJudge() {
  const decided = watcher.alerts.filter((a) => judged.has(a));
  const right = decided.filter((a) => (judged.get(a) === 'danger') === isDangerAlert(a)).length;
  el.judge.textContent = decided.length
    ? `あなた（第3声）の判断：${decided.length} 回のうち ${right} 回が答えと同じでした。第2声の要約は数だけなので、言い方の冷たさや笑いの楽しさは、要約からは読みとれません。`
    : 'あなた（第3声）の判断：まだ選んでいません。第三者の画面の合図ごとに「危ない／問題ない」を選ぶと、ここで答え合わせができます。';
}

function drawTimeline() {
  const { w, h: hh, dpr } = fitCanvas(el.timeline);
  const g = el.timeline.getContext('2d');
  g.fillStyle = '#0b0d0c';
  g.fillRect(0, 0, w, hh);
  const x = (t) => (t / SCRIPT_S) * w;
  for (const a of ANSWERS) {
    g.fillStyle = a.danger ? '#7a2a24' : '#24553f';
    g.fillRect(x(a.from), 4 * dpr, x(a.to) - x(a.from), hh * 0.45);
  }
  g.fillStyle = COLOR.alert;
  for (const a of watcher.alerts) {
    g.beginPath();
    g.moveTo(x(a.t), hh * 0.58);
    g.lineTo(x(a.t) - 5 * dpr, hh - 4 * dpr);
    g.lineTo(x(a.t) + 5 * dpr, hh - 4 * dpr);
    g.fill();
  }
  g.fillStyle = '#94928a';
  g.font = `${11 * dpr}px system-ui, sans-serif`;
  for (let s = 0; s <= SCRIPT_S; s += 10) g.fillText(String(s), Math.min(w - 16 * dpr, x(s) + 2 * dpr), hh * 0.53);
}

// ---------- 操作 ----------
el.play.addEventListener('click', play);
el.stop.addEventListener('click', () => stop(true));
el.fast.addEventListener('change', () => {
  el.sound.disabled = el.fast.checked;
});
for (const tab of $$('.w-tab')) {
  tab.addEventListener('click', () => {
    for (const t of $$('.w-tab')) t.setAttribute('aria-selected', String(t === tab));
    el.views.dataset.view = tab.id === 'tab-self' ? 'self' : 'third';
    // 隠れていたあいだに描けなかった絵を描く
    for (const [mini, a] of minis) drawLevels(mini, a.memory, a.t);
    if (watcher && el.stop.disabled) {
      drawRing(null);
      drawLevels(el.mem, watcher.memory, watcher.memory.length ? watcher.memory[watcher.memory.length - 1].t : 0);
    }
  });
}
drawRing(null);
drawLevels(el.mem, [], 0);
