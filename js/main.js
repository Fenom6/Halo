/**
 * main.js — 光背 Halo の係（index.html）
 *
 * 音の高さを、仏さまの後ろの光の輪（光背）のような螺旋に並べて観るアプリ。
 * 光背の部品（kouhai-stage.js）に、音の入口と操作をつなぐ。
 *
 *   音の入口：マイク ／ カノン（パッヘルベルの合成音）／ ファイル ／ 指で鳴らす（螺旋に触れた高さの音）
 *        │
 *        ├─ 1秒に約60回 ：観察窓の dB の並び → 光背を描く
 *        └─ 約0.08秒ごと：特徴量 → 音の性格 → いまの高さ → まん中の音名・チューナー・追いかける光
 *
 * 約束：音が届いていないときは「届いていない」と出す。古い音を描き続けない（見えないときは進まない）。
 */
import { AudioEngine } from './audio.js';
import { KouhaiStage } from './kouhai-stage.js';
import { KOUHAI_FFT_SIZE, clockOf, ringOf, pointToMidi } from './kouhai.js';
import { canonScore, chordAt, ALL_VOICES_BEAT, CANON_BPM, CANON_LEAD_S } from './canon.js';
import { choosePitch, PitchSmoother } from './pitch.js';
import { computeFeatures } from './features.js';
import { SoundClassifier } from './classify.js';
import { buildLut, readTokens } from './colormap.js';
import { analyserLikeDb, noteInfo, freqToMidi, midiToFreq } from './dsp.js';
import { canonRound } from './synth.js';
import { formatHz, formatCents } from './format.js';
import { $, $$, h, toast, openDialog, onResize, saveFile } from './ui.js';
import { prefs, applyTheme } from './prefs.js';
import { isEmbedded } from './claude.js';
import { LANG, L, noteName, clockText } from './i18n.js';

const ANALYSIS_MS = 80;
const UI_MS = 120;
const STALL_MS = 3000; // これより長く新しい音が届かなければ「音が届いていません」
const CLOCK_SLACK_MS = 250;
const DEAD_MS = 5000; // マイクから、まったくの 0 が 5 秒続いたら「マイクの音が届いていません」
const DEAD_DB = -150;
const TOUCH_VOICES = 4; // 同時に鳴らせる指の数
const TOUCH_PARTIALS = [1, 0.5, 0.33, 0.25, 0.2]; // 指で鳴らす音の、1倍・2倍・3倍・4倍・5倍の成分（倍音）の強さ
const TOUCH_MAX_HZ = 16000; // これより高い成分は鳴らさない

const CAPTION = {
  idle: L(
    '12時がド。時計回りに半音ずつ進み、1周で1オクターブ高くなります（内側ほど低い音）。外へ伸びる光の長さと色が、その高さの強さです。',
    "C is at 12 o'clock. Each step clockwise is a semitone, and one full turn is one octave higher (low notes inside). The length and color of each ray show how strong that pitch is.",
  ),
  mic: L(
    '朱色の光が、いまの高さ。淡い2つの光が、少し遅れて同じ道すじを追いかけます。歌うと、音程が半音のどちらにずれているかも見えます。',
    'The vermilion light is the pitch right now. Two faint lights follow the same path a little later. Sing, and you can see which way you are off the note.',
  ),
  file: L(
    '朱色の光が、いまの高さ。淡い2つの光が、少し遅れて同じ道すじを追いかけます。',
    'The vermilion light is the pitch right now. Two faint lights follow the same path a little later.',
  ),
  touch: L(
    '螺旋に触れると、いちばん近い半音の音が鳴ります。1つの音から、2倍・3倍…の光（倍音）も伸びます。何本かの指で触れると和音です。',
    'Touch the spiral to play the nearest semitone. One note also lights up 2×, 3×… (its harmonics). Touch with several fingers for a chord.',
  ),
};
const STATUS = {
  mic: () => L('マイクで観ています', 'Listening'),
  file: (name) => L(`ファイル：${name}`, name),
  sample: (name) => L(`サンプル：${name}`, name),
  touch: () => L('指で鳴らしています', 'Touch'),
};
/** カノンを鳴らしているあいだ、絵の下に出す「観るところ」 */
const CANON_LOOK = L(
  '3つの光が、同じ旋律を2小節（8拍）ずつ遅れて追いかけます。金の輪は低音（8つの音のくり返し）。3つの声がそろうと……。',
  'Three lights chase the same melody, each two bars (8 beats) behind. The gold ring is the bass (eight notes, over and over). When all three voices are in…',
);

// 英語版（en.html）は、いつも黒い地（<html data-theme="dark" class="black">）。日本語版は設定どおり
if (LANG !== 'en') applyTheme();

const engine = new AudioEngine({ fftSize: KOUHAI_FFT_SIZE });
engine.keepAwake = prefs.get('keepAwake');

const el = {
  stage: $('#kh-stage'),
  badge: $('#kh-badge'),
  probe: $('#probe'),
  probeLabel: $('#probe-label'),
  readNote: $('#kh-note'),
  readEn: $('#kh-en'),
  readHz: $('#kh-hz'),
  cents: $('#kh-cents'),
  needle: $('#kh-needle'),
  readSub: $('#kh-sub'),
  caption: $('#kh-caption'),
  btnMic: $('#btn-mic'),
  btnMicText: $('#btn-mic-text'),
  btnStop: $('#btn-stop'),
  btnSample: $('#btn-sample'),
  btnFile: $('#btn-file'),
  btnTouch: $('#btn-touch'),
  btnSave: $('#btn-save'),
  btnAbout: $('#btn-about'),
  fileInput: $('#file-input'),
  micError: $('#mic-error'),
  note: $('#kh-embedded'),
  head: $('#head-status'),
  headText: $('#head-status-text'),
};

const stage = new KouhaiStage({
  canvas: $('#cv-kouhai'),
  dial: $('#kouhai-dial'),
  note: $('#kouhai-note'),
  oct: $('#kouhai-oct'),
  bloom: $('#bloom'),
  frame: el.stage,
});

const N = KOUHAI_FFT_SIZE;
const freq = new Float32Array(N / 2).fill(-160); // 観察窓の dB の並び（高さごとの大きさ）
const time = new Float32Array(N);
const silent = new Float32Array(N / 2).fill(-160); // 音が届いていないときに描く「無音」
const BLOCK = 4096; // 高さを調べる音の長さ（写しとり係と同じ。48 kHz で約 0.085 秒）
let unit = 'dbfs';
const classifier = new SoundClassifier({ unit });
const smoother = new PitchSmoother();
let snap = null; // いまの結果 { pitch, clarity, cls }
let showingExample = true;
let lookHint = ''; // サンプルを鳴らしている間、絵の下に出す「観るところ」
let pendingScore = null; // 次に鳴らすカノンの楽譜（再生位置 → 各声部の音）
const sampleCache = new Map();
let raf = 0;
let lastFrame = 0;
let lastAnalysis = 0;
let lastUi = 0;
let lastBlockAt = -1e9;
let lastClock = -1;
let lastClockMove = 0;
let lastAnalyzeAt = 0;
let silentSince = 0;

// ---------- 色 ----------
function applyPalette() {
  const t = readTokens(['spec-0', 'spec-1', 'spec-2', 'spec-3', 'spec-4', 'spec-mark', 'scope-bg', 'scope-grid', 'scope-ink', 'scope-muted', 'gold']);
  const lut = buildLut([t['spec-0'], t['spec-1'], t['spec-2'], t['spec-3'], t['spec-4']]);
  stage.setPalette(lut, { bg: t['scope-bg'], grid: t['scope-grid'], ink: t['scope-ink'], muted: t['scope-muted'], mark: t['spec-mark'], gold: t.gold });
  redrawStill();
}

function configure(sampleRate) {
  if (engine.analyser) engine.setFftSize(N);
  stage.configure({ sampleRate, fftSize: N, minDb: prefs.get('minDb'), maxDb: prefs.get('maxDb') });
}

/** 止まっているときに描き直す */
function redrawStill() {
  if (engine.active) return;
  stage.still(freq, !showingExample && snap && snap.pitch ? freqToMidi(snap.pitch.hz) : null);
}

// ---------- 1秒に約60回：描く ----------
function loop(now) {
  raf = requestAnimationFrame(loop);
  if (!engine.active) return;
  const dt = lastFrame ? Math.min(250, now - lastFrame) : 16;
  lastFrame = now;
  // 新しい音が入ってきているか：音の係の時計が進んでいるかで確かめる（止まると、観察窓には最後の音が残ったままになる）
  const clock = engine.clock;
  if (clock !== lastClock) {
    lastClock = clock;
    lastClockMove = now;
  }
  if (engine.running && now - lastClockMove < CLOCK_SLACK_MS) {
    engine.getFreqData(freq);
    // 写しとり係（AudioWorklet）が届けているあいだは、そちらで解析する。届かなければ、ここで解析する
    const tapAlive = engine.tap && now - lastBlockAt < 400;
    if (!tapAlive && now - lastAnalysis >= ANALYSIS_MS) {
      engine.getTimeData(time);
      analyze(time.subarray(N - BLOCK)); // 新しい 4096 個だけを調べる
      lastAnalysis = now;
    }
  }
  setStalled(now - lastAnalyzeAt > STALL_MS);
  if (document.hidden) return;
  const voices = stage.voices(now, engine.position);
  // 音が届いていないあいだは、古い音を描き続けない（光は残像のまま消えていく）
  const live = !stalled && !deadMic;
  stage.draw(live ? freq : silent, live ? voices : [], dt);
  if (now - lastUi >= UI_MS) {
    lastUi = now;
    renderReadouts();
  }
}

// ---------- 約0.08秒ごと：いまの高さ ----------
engine.addEventListener('block', (e) => {
  lastBlockAt = performance.now();
  analyze(e.detail);
});

function analyze(block) {
  const now = performance.now();
  lastAnalyzeAt = now;
  setStalled(false);
  const f = computeFeatures(block, engine.sampleRate);
  const level = f.dbA + (unit === 'spl' ? prefs.get('calibration') : 0);
  const cls = classifier.push(f, level);
  // マイクの音が止められていないか（届いていない音を「聞こえている」ことにしない）
  if (engine.kind === 'mic' && (f.dbZ <= DEAD_DB || engine.micMuted)) silentSince = silentSince || now;
  else silentSince = 0;
  setDead(!!silentSince && now - silentSince > DEAD_MS);
  const pitch = smoother.push(choosePitch(f, cls.id));
  snap = { pitch, clarity: f.clarity, cls };
  // 光が追いかける高さを記録し、歌われた（弾かれた）旋律がカノンでないか聴く。サンプルは聴かない
  stage.hear(now, pitch, { clarity: f.clarity, secret: engine.kind !== 'sample' });
}

// ---------- 読み取り（チューナー） ----------
function renderReadouts() {
  if (showingExample) {
    // 最初の例：止めた絵の説明
    stage.setNote(null);
    el.readNote.textContent = '—';
    el.readEn.textContent = '';
    const ch = chordAt(EXAMPLE_BEAT);
    el.readHz.textContent = L('例：カノン', 'Example: Canon');
    el.cents.dataset.off = 'true';
    setSub(
      L(`3つの声がそろった ${ch.name} の和音。`, `All three voices: a ${ch.name} chord.`),
      ch.pcs.map((pc) => `${noteName(pc)}${L('（', '\u00a0(')}${clockText(clockOf(pc))}${L('）', ')')}`).join(L('・', ' · ')),
    );
    return;
  }
  if (engine.active && (stalled || deadMic)) {
    // 音が届いていないあいだは、前の高さを出し続けない（見えないときは進まない）
    stage.setNote(null);
    el.readNote.textContent = '—';
    el.readEn.textContent = '';
    el.readHz.textContent = stalled ? L('音が届いていません', 'No sound is coming in') : L('マイクの音が届いていません', 'No sound from the microphone');
    el.cents.dataset.off = 'true';
    setSub(L('高さは、音がまた届いたら出します。', 'The pitch will show again when sound comes back.'), '');
    return;
  }
  const p = snap && snap.pitch;
  const n = p ? noteInfo(p.hz) : null;
  stage.setNote(n);
  if (n) {
    el.readNote.textContent = noteName(n.pitchClass);
    el.readEn.textContent = n.en;
    el.readHz.textContent = formatHz(p.hz, { digits: p.hz < 1000 ? 1 : 2 });
    el.cents.dataset.off = 'false';
    el.needle.style.left = `${50 + Math.max(-50, Math.min(50, n.cents))}%`;
    setSub(
      p.kind === 'peak'
        ? L(`いちばん強い成分・${formatCents(n.cents)} セント`, `strongest component · ${formatCents(n.cents)} cents`)
        : L(`${formatCents(n.cents)} セント（半音の 1/100）`, `${formatCents(n.cents)} cents (1/100 of a semitone)`),
      L(`${clockOf(n.pitchClass)}時の向き・${ringOf(n.midi)}周目`, `${clockText(clockOf(n.pitchClass))} · ring ${ringOf(n.midi)}`),
    );
  } else {
    el.readNote.textContent = '—';
    el.readEn.textContent = '';
    el.readHz.textContent = !snap
      ? engine.active
        ? L('聞いています', 'Listening…')
        : L('音を待っています', 'Waiting for sound')
      : snap.cls.id === 'silence'
        ? L('静か', 'Quiet')
        : L('高さがはっきりしない音', 'No clear pitch');
    el.cents.dataset.off = 'true';
    setSub('　', '');
  }
}

// 読み取りの下の行：2つのまとまり（ずれ／向き）。折り返すときは、ことばの切れ目で折り返す。
// 1秒に約8回書きかえるので、部品は作り直さずに文字だけを入れかえる
const subParts = [h('span', { class: 'kh-chunk' }), h('span', { class: 'kh-chunk' })];
el.readSub.replaceChildren(...subParts);
function setSub(a, b) {
  // 区切りの「・」は前のまとまりの終わりに付ける（行の頭に「・」が来ないように。文の終わり「。」のあとには付けない）
  const first = b && !/[。.]$/.test(a) ? `${a}${L('・', ' · ')}` : a;
  if (subParts[0].textContent !== first) subParts[0].textContent = first;
  if (subParts[1].textContent !== b) subParts[1].textContent = b;
  subParts[1].hidden = !b;
}

// ---------- 状態の表示 ----------
let headText = '';
let headLive = false;
let stalled = false;
let deadMic = false;
function paintHead() {
  const off = stalled || deadMic;
  el.headText.textContent = stalled ? L('音が届いていません', 'No sound is coming in') : deadMic ? L('マイクの音が届いていません', 'No sound from the microphone') : headText;
  el.head.dataset.live = headLive && !off ? 'on' : 'off';
  el.head.dataset.stalled = off ? 'on' : 'off';
}
function setStatus(text, live) {
  headText = text;
  headLive = live;
  paintHead();
}
function setStalled(v) {
  if (v === stalled) return;
  stalled = v;
  paintHead();
  if (engine.active) renderReadouts(); // 上の帯と読み取りを、同時に切りかえる
}
function setDead(v) {
  if (v === deadMic) return;
  deadMic = v;
  paintHead();
  if (engine.active) renderReadouts();
}

function setCaption() {
  const k = engine.kind;
  if (k === 'sample' && lookHint) el.caption.textContent = L(`観るところ：${lookHint}`, `What to watch: ${lookHint}`);
  else if (k === 'touch') el.caption.textContent = touchCaption();
  else el.caption.textContent = CAPTION[k] || CAPTION.idle;
}

function updateButtons() {
  const k = engine.kind;
  el.btnMicText.textContent = k === 'mic' ? L('マイクを止める', 'Stop microphone') : L('マイクで観る', 'Microphone');
  el.btnMic.classList.toggle('btn-primary', k !== 'mic');
  el.btnStop.hidden = !(k === 'file' || k === 'sample');
  el.btnTouch.setAttribute('aria-pressed', String(k === 'touch'));
  el.stage.dataset.touch = k === 'touch' ? 'on' : 'off';
}

function showError(msg) {
  el.micError.textContent = msg;
  el.micError.hidden = !msg;
}

// ---------- 始める・止める ----------
engine.addEventListener('start', (ev) => {
  const { kind, name } = ev.detail;
  if (kind !== 'touch') releaseAllTouches();
  showingExample = false;
  el.badge.hidden = true;
  stage.start(kind === 'sample' ? pendingScore : null); // 輪唱は、3つの光が各声部を追う
  pendingScore = null;
  if (kind !== 'sample') lookHint = '';
  unit = kind === 'mic' ? 'spl' : 'dbfs';
  classifier.setUnit(unit);
  classifier.reset();
  smoother.reset();
  snap = null;
  configure(engine.sampleRate);
  lastAnalysis = lastUi = lastFrame = 0;
  lastBlockAt = -1e9;
  lastClock = engine.clock;
  lastClockMove = lastAnalyzeAt = performance.now();
  stalled = false;
  deadMic = false;
  silentSince = 0;
  setStatus(STATUS[kind] ? STATUS[kind](name) : name, true);
  setCaption();
  updateButtons();
  renderReadouts();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
});

function onStopped() {
  cancelAnimationFrame(raf);
  raf = 0;
  releaseAllTouches();
  lookHint = '';
  stalled = false;
  deadMic = false;
  silentSince = 0;
  setStatus(L('止まっています', 'Stopped'), false);
  setCaption();
  updateButtons();
  redrawStill();
  renderReadouts();
}
engine.addEventListener('stop', onStopped);
engine.addEventListener('ended', onStopped);

el.btnMic.addEventListener('click', async () => {
  showError('');
  if (engine.kind === 'mic') {
    engine.stop();
    return;
  }
  el.btnMic.disabled = true;
  try {
    await engine.startMic();
  } catch (e) {
    showError(e.message || String(e));
  } finally {
    el.btnMic.disabled = false;
  }
});

el.btnStop.addEventListener('click', () => engine.stop());

el.btnFile.addEventListener('click', () => {
  showError('');
  engine.ensure().catch(() => {}); // ボタンを押した瞬間に音の部品を起こす（スマホの自動再生の制限のため）
  el.fileInput.click();
});
el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files && el.fileInput.files[0];
  el.fileInput.value = '';
  if (!file) return;
  try {
    const buf = await engine.decodeFile(file);
    await engine.playBuffer(buf, { kind: 'file', name: file.name });
  } catch (e) {
    showError(e.message || String(e));
  }
});

// ---------- カノン（パッヘルベル「カノン ニ長調」の始まり） ----------
el.btnSample.addEventListener('click', () => {
  showError('');
  engine.ensure().catch(() => {}); // ボタンを押した瞬間に音の部品を起こす（スマホの自動再生の制限のため）
  openDialog($('#dlg-canon'));
});

/** 窓で選んだ声部（低音・第1〜3声） */
function chosenParts() {
  const on = new Set($$('#dlg-canon input[name="part"]:checked').map((i) => i.value));
  return { bass: on.has('bass'), voices: [0, 1, 2].map((v) => on.has(String(v))) };
}

$('#canon-play').addEventListener('click', () => {
  const parts = chosenParts();
  if (!parts.bass && !parts.voices.some(Boolean)) {
    toast(L('鳴らす声を1つ以上えらんでください', 'Choose at least one voice'));
    return;
  }
  $('#dlg-canon').close();
  playCanon(parts);
});

async function playCanon(parts) {
  try {
    await engine.ensure();
    const sr = engine.sampleRate;
    const key = `canon:${sr}:${parts.bass ? 1 : 0}${parts.voices.map((v) => (v ? 1 : 0)).join('')}`;
    let samples = sampleCache.get(key);
    if (!samples) {
      samples = canonRound({ sampleRate: sr, parts });
      sampleCache.set(key, samples);
    }
    const buf = await engine.bufferFrom(samples, sr);
    pendingScore = canonScore(parts);
    lookHint = CANON_LOOK;
    await engine.playBuffer(buf, { kind: 'sample', name: L('カノン', 'Canon') });
  } catch (e) {
    showError(e.message || String(e));
  }
}

// ---------- 指で鳴らす ----------
const touches = new Map(); // 指の番号 → { midi, handle, released }

el.btnTouch.addEventListener('click', async () => {
  showError('');
  if (engine.kind === 'touch') {
    engine.stop();
    return;
  }
  try {
    await engine.startTouch();
  } catch (e) {
    showError(e.message || String(e));
  }
});

/** 指で鳴らす音の成分：基本の高さと、その2倍・3倍…（高すぎる成分は鳴らさない） */
function touchParts(midi) {
  const f = midiToFreq(midi);
  const limit = Math.min(TOUCH_MAX_HZ, engine.sampleRate * 0.45);
  const sum = TOUCH_PARTIALS.reduce((a, b) => a + b, 0);
  return TOUCH_PARTIALS.map((g, i) => ({ freq: f * (i + 1), gain: f * (i + 1) < limit ? g / sum : 0 }));
}

function stagePoint(e) {
  const r = el.stage.getBoundingClientRect();
  const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
  const y = Math.max(0, Math.min(r.height, e.clientY - r.top));
  return { x, y, dx: x - r.width / 2, dy: y - r.height / 2, r };
}

async function touchStart(e) {
  if (touches.has(e.pointerId) || touches.size >= TOUCH_VOICES) return;
  const { dx, dy } = stagePoint(e);
  const entry = { midi: pointToMidi(dx, dy, stage.size), handle: null, released: false };
  touches.set(e.pointerId, entry);
  setCaption();
  let handle;
  try {
    handle = await engine.tone(touchParts(entry.midi), { volume: 0.2, observe: true, release: 0.35 });
  } catch (err) {
    touches.delete(e.pointerId);
    showError(err.message || String(err));
    return;
  }
  // 音の準備ができる前に指が離れた・指で鳴らすをやめた
  if (entry.released || engine.kind !== 'touch') {
    handle.stop();
    return;
  }
  entry.handle = handle;
  retune(entry);
}

/** 指が動いたら、いちばん近い半音へ高さを移す（すべる音） */
function retune(entry) {
  if (!entry.handle) return;
  touchParts(entry.midi).forEach((p, i) => {
    entry.handle.set(i, p.freq);
    entry.handle.setGain(i, p.gain);
  });
}

function touchMove(e) {
  const entry = touches.get(e.pointerId);
  if (!entry) return;
  const { dx, dy } = stagePoint(e);
  const midi = pointToMidi(dx, dy, stage.size);
  if (midi === entry.midi) return;
  entry.midi = midi;
  retune(entry);
  setCaption();
}

function releaseTouch(id) {
  const entry = touches.get(id);
  if (!entry) return;
  touches.delete(id);
  entry.released = true;
  if (entry.handle) entry.handle.stop();
  if (engine.kind === 'touch') setCaption();
}

function releaseAllTouches() {
  for (const id of [...touches.keys()]) releaseTouch(id);
}

function touchCaption() {
  if (!touches.size) return CAPTION.touch;
  const names = [...touches.values()]
    .map((t) => t.midi)
    .sort((a, b) => a - b)
    .map((m) => {
      const n = noteInfo(midiToFreq(m));
      return L(`${n.ja}${n.octave}（${clockOf(n.pitchClass)}時）`, `${n.en} (${clockText(clockOf(n.pitchClass))})`);
    });
  return L(`鳴らしている音：${names.join('・')}`, `Playing: ${names.join(' · ')}`);
}

// ---------- 絵に触れて調べる（指で鳴らすときは、その音が鳴る） ----------
let probeTimer = 0;
function probeAt(e) {
  const { x, y, dx, dy, r } = stagePoint(e);
  let text;
  if (engine.kind === 'touch') {
    const n = noteInfo(midiToFreq(pointToMidi(dx, dy, stage.size)));
    text = `${n.ja}${n.octave}（${formatHz(n.target)}）`;
  } else {
    const fz = stage.freqAt(dx, dy);
    const n = noteInfo(fz);
    text = `${formatHz(fz)}（${n.ja}${n.octave}）`;
  }
  el.probe.hidden = false;
  el.probeLabel.textContent = text;
  const lw = el.probeLabel.offsetWidth || 140;
  el.probeLabel.style.left = `${Math.max(6, Math.min(r.width - lw - 6, x - lw / 2))}px`;
  el.probeLabel.style.top = `${y > 56 ? y - 46 : y + 22}px`; // 指に隠れないよう、少し上に出す
  clearTimeout(probeTimer);
}
function hideProbeSoon() {
  clearTimeout(probeTimer);
  probeTimer = setTimeout(() => {
    el.probe.hidden = true;
  }, 1600);
}

el.stage.addEventListener('pointerdown', (e) => {
  probeAt(e);
  if (engine.kind !== 'touch') return;
  e.preventDefault();
  try {
    el.stage.setPointerCapture(e.pointerId);
  } catch {
    /* 指を追えなくても鳴らせる */
  }
  touchStart(e);
});
el.stage.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) {
    touchMove(e);
    probeAt(e);
  } else if (e.pointerType === 'mouse' || e.buttons) probeAt(e);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  el.stage.addEventListener(type, (e) => {
    releaseTouch(e.pointerId);
    hideProbeSoon();
  });
}
el.stage.addEventListener('pointerleave', (e) => {
  if (!touches.has(e.pointerId)) hideProbeSoon();
});

// ---------- 残す（いまの光背を、1枚の絵に） ----------
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return { file: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`, text: `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` };
}

el.btnSave.addEventListener('click', async () => {
  const when = stamp();
  // 音が届いていないあいだの高さは古いので、絵に書き込まない（画面と同じく）
  const p = !stalled && !deadMic && snap && snap.pitch;
  const n = p && !showingExample ? noteInfo(p.hz) : null;
  const hzText = p ? formatHz(p.hz, { digits: p.hz < 1000 ? 1 : 2 }) : '';
  const what = showingExample ? L('例：カノン', 'Example: Canon') : n ? L(`${n.ja} ${n.en}・${hzText}`, `${n.en} · ${hzText}`) : '';
  const footer = [what, when.text].filter(Boolean).join('　');
  el.btnSave.disabled = true;
  try {
    const canvas = await stage.exportImage(footer);
    if (!canvas) {
      toast(L('まだ絵がありません', 'Nothing to save yet'));
      return;
    }
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('png');
    const name = `kouhai-${when.file}.png`;
    // スマホでは共有の画面から「画像を保存」や、家族・友だちに送れる。共有できなければ、ファイルとして保存する
    const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
    if (!isEmbedded && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: L('光背', 'Halo') });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    const r = await saveFile(name, blob, 'image/png');
    toast(
      r === 'saved' ? L('光背の絵を保存しました', 'Saved the picture') : r === 'declined' ? L('保存をやめました', 'Not saved') : L('保存できませんでした', 'Could not save'),
    );
  } catch {
    toast(L('絵を作れませんでした', 'Could not make the picture'));
  } finally {
    el.btnSave.disabled = false;
  }
});

// ---------- しくみ（見方・物理・数学・英語・コード） ----------
el.btnAbout.addEventListener('click', () => openDialog($('#dlg-about')));
for (const r of $$('input[name="kh-theme"]')) {
  r.checked = r.value === prefs.get('theme');
  r.addEventListener('change', () => {
    if (!r.checked) return;
    prefs.set('theme', r.value);
    applyTheme();
  });
}

// ---------- 最初に見せる例：カノンの3つの声がそろったところを止めた絵 ----------
const EXAMPLE_BEAT = ALL_VOICES_BEAT + 0.6;
function renderExample() {
  showingExample = true;
  const sr = 48000;
  configure(sr);
  const key = `canon:${sr}:1111`;
  let samples = sampleCache.get(key);
  if (!samples) {
    samples = canonRound({ sampleRate: sr });
    sampleCache.set(key, samples);
  }
  // 観察窓と同じやり方（Blackman 窓 → FFT → dB）で、その瞬間までの約 0.34 秒を写す
  const end = Math.round((CANON_LEAD_S + (EXAMPLE_BEAT * 60) / CANON_BPM) * sr);
  analyserLikeDb(samples.subarray(end - N, end), N, freq);
  el.badge.hidden = false;
  snap = null;
  stage.still(freq, null);
  renderReadouts();
}

// ---------- 画面の大きさ・テーマの変化 ----------
onResize(el.stage, () => {
  if (!el.stage.clientWidth) return;
  stage.resize();
  if (showingExample && !engine.active) renderExample();
  else redrawStill();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPalette);
new MutationObserver(applyPalette).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// Claude の中（claude.ai）ではマイクが使えないので、先に伝えておく。
// 表示の明るさは Claude が決めるので、切り替えは出さない
if (isEmbedded) {
  el.note.hidden = false;
  const themeSet = $('#ab-view-set');
  if (themeSet) themeSet.hidden = true;
}

// 始めの状態
stage.resize();
applyPalette();
updateButtons();
setStatus(L('止まっています', 'Stopped'), false);
setCaption();
renderExample();

// 普通のブラウザで開いたときは、オフラインでも開けるように準備する（Service Worker）
if (!isEmbedded && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
