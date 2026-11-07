/**
 * watch.js — 見張りAIのカノン（学習用）：計算の係
 *
 * 見張りを、カノン y(t) = x(t) + x(t − T) + x(t − 2T) と同じ3つの声に分けて考える。
 *   第1声 x(t)      … 物理の番人。声の大きさ・高さ・かぶり・間だけを、いつも測る（言葉の意味は聞かない）。
 *                      直前の T 秒だけを覚えておき、合図がなければ古い順に捨て続ける。
 *   第2声 x(t − T)  … 合図があったときだけ、直前の T 秒をさかのぼって見る係（本物の AI のかわりに、測った数だけを要約する）
 *   第3声 x(t − 2T) … 人。第2声の見立てを見て、本当に危ないかを決める
 *
 * 音は「例の会話」：AさんとBさんの声を合成して、左右の別のマイク（2チャンネル）で拾ったことにする。
 * どこが本当に危ないか（答え）も一緒に作っておき、最後に答え合わせをする。
 * 画面にもマイクにも触らないので、Node.js だけでテストできる。
 */
import { rms, ampToDb, yinPitch, dbToAmp } from './dsp.js';

export const WATCH_SR = 16000; // 声の高さと大きさを測るには十分（人の声の基本の高さは 80〜400 Hz ほど）
export const FRAME_S = 0.1; // 0.1 秒ごとに1回測る
export const MEMORY_S = 8; // 第1声が覚えておく長さ T（秒）
export const SPEAK_DB = -45; // これより大きければ「話している」
export const PEOPLE = ['A', 'B'];

/** 例の会話の台本（秒）。who は話す人、db は声の大きさ、pitch はふだんの高さの何倍か */
export const SCRIPT = [
  { who: 'A', from: 0.5, to: 3.4, db: -26, pitch: 1 },
  { who: 'B', from: 3.8, to: 6.6, db: -27, pitch: 1 },
  { who: 'A', from: 7.0, to: 9.6, db: -26, pitch: 1 },
  { who: 'A', from: 10.0, to: 14.0, db: -12, pitch: 1.28 }, // 声を荒らげる
  { who: 'B', from: 14.6, to: 19.0, db: -27, pitch: 1 },
  { who: 'A', from: 16.4, to: 19.0, db: -20, pitch: 1.08 }, // Bの話をさえぎる（かぶる）
  { who: 'B', from: 19.6, to: 22.4, db: -27, pitch: 1 },
  { who: 'A', from: 22.8, to: 24.0, db: -26, pitch: 1 },
  { who: 'A', from: 24.4, to: 38.0, db: -25, pitch: 1.02 }, // 一方的に話しつづける
  { who: 'B', from: 38.6, to: 43.6, db: -37, pitch: 0.92 }, // 静かで低い、冷たい言い方（物理では見えにくい）
  // 43.6〜50.0 は、2人とも黙る
  { who: 'A', from: 50.0, to: 52.0, db: -26, pitch: 1 },
  { who: 'B', from: 52.0, to: 55.0, db: -16, pitch: 1.2 }, // 2人で大笑い（大きくて、かぶるが、危なくない）
  { who: 'A', from: 52.4, to: 55.0, db: -17, pitch: 1.18 },
  { who: 'B', from: 55.6, to: 58.6, db: -27, pitch: 1 },
];
export const SCRIPT_S = 60;

/** 本当に危なかった所（答え）。danger が false のものは「危なく見えるが、危なくない」所 */
export const ANSWERS = [
  { from: 10.0, to: 14.0, danger: true, ja: 'Aが声を荒らげた' },
  { from: 16.4, to: 19.0, danger: true, ja: 'AがBの話をさえぎった' },
  { from: 24.4, to: 38.0, danger: true, ja: 'Aが一方的に話しつづけた' },
  { from: 38.6, to: 43.6, danger: true, ja: 'Bが静かに冷たく言った（声は小さく落ち着いている）' },
  { from: 43.6, to: 50.0, danger: true, ja: '気まずい沈黙' },
  { from: 52.0, to: 55.0, danger: false, ja: '2人で大笑い（大きくてかぶるが、楽しい）' },
];

/** ふだんの声の高さ [Hz]（Aは低め、Bは高め） */
export const BASE_HZ = { A: 120, B: 210 };

/**
 * 例の会話を合成する。人の声のかわりに、倍音（基本の高さの整数倍の音）を重ねた音を、音節のように強弱をつけて鳴らす。
 * 戻り値 { A, B }：それぞれのマイク（チャンネル）の音
 */
export function synthConversation({ sampleRate: sr = WATCH_SR, script = SCRIPT, seconds = SCRIPT_S } = {}) {
  const n = Math.round(sr * seconds);
  const out = { A: new Float32Array(n), B: new Float32Array(n) };
  // 部屋の小さな雑音（-70 dB くらい）。毎回同じになるよう、決まった順の乱数を使う
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const noise = dbToAmp(-70) * Math.sqrt(3);
  for (const p of PEOPLE) for (let i = 0; i < n; i++) out[p][i] = rand() * noise;
  const H = 8; // 倍音の数
  let norm = 0;
  for (let k = 1; k <= H; k++) norm += 1 / (k * k);
  norm = Math.sqrt(norm / 2) * 0.8; // 倍音を重ねた音の RMS（と強弱の平均）で割り、db どおりの大きさにする
  for (const s of script) {
    const ch = out[s.who];
    const amp = dbToAmp(s.db) / norm;
    const i0 = Math.round(s.from * sr);
    const i1 = Math.min(n, Math.round(s.to * sr));
    let phase = 0;
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / sr;
      const f0 = BASE_HZ[s.who] * s.pitch * (1 + 0.035 * Math.sin(2 * Math.PI * 0.7 * t) - 0.01 * t / (s.to - s.from)); // 抑揚
      phase += (2 * Math.PI * f0) / sr;
      const syll = 0.55 + 0.45 * Math.sin(Math.PI * 4 * t) ** 2; // 1秒に約4音節の強弱
      const edge = Math.min(1, t / 0.03, (s.to - s.from - t) / 0.03); // 始めと終わりをなめらかに
      let v = 0;
      for (let k = 1; k <= H; k++) v += Math.sin(k * phase) / k;
      ch[i] += v * amp * syll * edge;
    }
  }
  return out;
}

/**
 * 第1声が 0.1 秒ごとに測るもの：それぞれの人の声の大きさ [dB] と高さ [Hz]（高さがはっきりしなければ 0）
 * @returns {{t:number, A:{db:number, hz:number}, B:{db:number, hz:number}}[]}
 */
export function measureFrames(channels, sr = WATCH_SR) {
  const hop = Math.round(sr * FRAME_S);
  const n = Math.min(...PEOPLE.map((p) => channels[p].length));
  const frames = [];
  for (let s = 0; s + hop <= n; s += hop) {
    const f = { t: +(s / sr + FRAME_S).toFixed(3) };
    for (const p of PEOPLE) {
      const x = channels[p];
      const db = ampToDb(rms(x, s, s + hop));
      let hz = 0;
      if (db > SPEAK_DB) {
        const y = yinPitch(x.subarray(s, s + Math.min(hop, 1024)), sr, { fMin: 70, fMax: 500 });
        if (y.clarity >= 0.8) hz = y.freq;
      }
      f[p] = { db, hz };
    }
    frames.push(f);
  }
  return frames;
}

/** 合図の種類 */
export const KINDS = {
  loud: { ja: '声が大きい', why: 'ふだんの声より大きい状態が続いた' },
  tense: { ja: '声が高い', why: 'ふだんの高さより上がった状態が続いた（張りつめると声は高くなりやすい）' },
  overlap: { ja: '声がかぶる', why: '2人が同時に話す状態が続いた' },
  mono: { ja: '一方的', why: '1人だけが話しつづけた' },
  silence: { ja: '沈黙', why: '2人とも黙った状態が続いた' },
};

/** 感度：厳しいほど早く・小さな変化で合図する（鳴りすぎ） / ゆるいほど見逃す */
export const SENSITIVITY = {
  high: { ja: '敏感', loudDb: 5, tense: 0.08, loudS: 0.8, tenseS: 1.2, overlapS: 0.5, monoS: 8, silenceS: 3 },
  mid: { ja: 'ふつう', loudDb: 8, tense: 0.14, loudS: 1.5, tenseS: 2, overlapS: 1.0, monoS: 12, silenceS: 4.5 },
  low: { ja: '鈍感', loudDb: 12, tense: 0.22, loudS: 2.5, tenseS: 3, overlapS: 1.8, monoS: 18, silenceS: 7 },
};

const REPEAT_S = 6; // 同じ人・同じ種類の合図は、この秒数のあいだ出し直さない
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};

/**
 * 第1声：物理の番人。1コマずつ push すると、合図（あれば）を返す。
 * 覚えているのは直前の MEMORY_S 秒だけ。それより古いコマは捨てる（捨てた秒数を数える）
 */
export class Watcher {
  constructor(level = 'mid') {
    this.rule = SENSITIVITY[level] || SENSITIVITY.mid;
    this.memory = []; // 直前 T 秒のコマ
    this.history = { A: { db: [], hz: [] }, B: { db: [], hz: [] } }; // その人の「ふだん」を知るための、話していたコマの記録（数だけ）
    this.run = { loud: { A: 0, B: 0 }, tense: { A: 0, B: 0 }, overlap: 0, mono: { A: 0, B: 0 }, silence: 0 };
    this.last = {};
    this.started = false;
    this.alerts = [];
  }

  /** その人の「ふだん」の大きさと高さ（話していたコマの中央値）。まだ少ないときは null */
  baseline(p) {
    const h = this.history[p];
    if (h.db.length < 15) return null;
    return { db: median(h.db), hz: median(h.hz.filter((v) => v > 0)) };
  }

  /** 1コマ（0.1 秒）ぶんの測った値を入れる。合図があれば、その一覧を返す */
  push(frame) {
    const r = this.rule;
    this.memory.push(frame);
    while (this.memory.length && frame.t - this.memory[0].t >= MEMORY_S) this.memory.shift();
    const speak = { A: frame.A.db > SPEAK_DB, B: frame.B.db > SPEAK_DB };
    if (speak.A || speak.B) this.started = true;
    const out = [];
    const fire = (kind, who) => {
      const key = `${kind}:${who || ''}`;
      if (this.last[key] !== undefined && frame.t - this.last[key] < REPEAT_S) return;
      this.last[key] = frame.t;
      const a = { t: frame.t, kind, who, memory: this.memory.map((m) => ({ ...m })) };
      out.push(a);
      this.alerts.push(a);
    };
    for (const p of PEOPLE) {
      const base = this.baseline(p);
      const me = frame[p];
      const loud = speak[p] && base && me.db > base.db + r.loudDb;
      const tense = speak[p] && base && base.hz > 0 && me.hz > 0 && me.hz > base.hz * (1 + r.tense);
      this.run.loud[p] = loud ? this.run.loud[p] + FRAME_S : 0;
      this.run.tense[p] = tense ? this.run.tense[p] + FRAME_S : 0;
      if (this.run.loud[p] >= r.loudS) fire('loud', p);
      if (this.run.tense[p] >= r.tenseS) fire('tense', p);
      const other = p === 'A' ? 'B' : 'A';
      this.run.mono[p] = speak[p] && !speak[other] ? this.run.mono[p] + FRAME_S : speak[other] ? 0 : this.run.mono[p];
      if (this.run.mono[p] >= r.monoS) fire('mono', p);
      // ふだんの声は、大きくも高くもないときだけ覚える（荒らげた声を「ふだん」にしないため）
      if (speak[p] && !loud && !tense) {
        this.history[p].db.push(me.db);
        if (me.hz > 0) this.history[p].hz.push(me.hz);
      }
    }
    this.run.overlap = speak.A && speak.B ? this.run.overlap + FRAME_S : 0;
    if (this.run.overlap >= r.overlapS) fire('overlap', null);
    this.run.silence = this.started && !speak.A && !speak.B ? this.run.silence + FRAME_S : 0;
    if (this.run.silence >= r.silenceS) fire('silence', null);
    return out;
  }
}

/**
 * 第2声：合図があったときだけ、覚えていた直前の T 秒を見て要約する。
 * ここでは本物の AI のかわりに、測った数（大きさ・高さ・話した時間）だけで書く。言葉の意味は分からない
 */
export function summarize(alert, watcher) {
  const m = alert.memory;
  const span = m.length ? m[m.length - 1].t - m[0].t + FRAME_S : 0;
  const talk = { A: 0, B: 0 };
  const peak = { A: -Infinity, B: -Infinity };
  for (const f of m) {
    for (const p of PEOPLE) {
      if (f[p].db > SPEAK_DB) talk[p] += FRAME_S;
      if (f[p].db > peak[p]) peak[p] = f[p].db;
    }
  }
  const lines = [`直前 ${span.toFixed(1)} 秒を見ました。話した時間 A ${talk.A.toFixed(1)} 秒・B ${talk.B.toFixed(1)} 秒。`];
  if (alert.who) {
    const base = watcher.baseline(alert.who);
    if (base) {
      const d = peak[alert.who] - base.db;
      lines.push(`${alert.who}のいちばん大きな声は、ふだんより ${d >= 0 ? '+' : ''}${d.toFixed(0)} dB。`);
    }
  }
  lines.push(`理由：${KINDS[alert.kind].why}。`);
  return lines.join('');
}

/** 第三者に渡った秒数（合図ごとに渡した T 秒ぶんの記録。重なった所は1回だけ数える）。until までの所だけを数える */
export function sharedSeconds(alerts, until = Infinity) {
  const spans = alerts.map((a) => [a.memory.length ? a.memory[0].t - FRAME_S : a.t, Math.min(a.t, until)]).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [s, e] of spans) {
    if (e <= end || e <= s) continue;
    total += e - Math.max(s, end);
    end = e;
  }
  return total;
}

/**
 * いま t 秒のとき、第1声が「だれにも渡さずに捨てた」秒数。
 * 直前 T 秒はまだ覚えているので数えない。それより前の所から、第三者に渡った所を引く
 */
export function droppedSeconds(alerts, t) {
  const gone = Math.max(0, t - MEMORY_S);
  return Math.max(0, gone - sharedSeconds(alerts, gone));
}

/**
 * 答え合わせ。合図が、答えのどこに当たったかを数える。
 *   捉えた  … 本当に危ない所のうち、合図が出た所の数（その所の終わりから 2 秒以内まで含める：合図は少し遅れて出るため）
 *   空振り  … 危なくない所で出た合図の数
 *   見逃し  … 本当に危ない所なのに、合図が1つも出なかった所の数
 */
export function score(alerts, answers = ANSWERS) {
  const LATE = 2;
  const result = answers.map((x) => ({ ...x, alerts: [] }));
  let falseAlarm = 0;
  for (const a of alerts) {
    const i = answers.findIndex((x) => a.t >= x.from && a.t <= x.to + LATE);
    if (i < 0 || !answers[i].danger) falseAlarm++;
    if (i >= 0) result[i].alerts.push(a);
  }
  const dangers = result.filter((r) => r.danger);
  const caught = dangers.filter((r) => r.alerts.length).length;
  return { caught, dangers: dangers.length, falseAlarm, miss: dangers.length - caught, result };
}

/** 合図が、答えの「危ない所」に当たっているか（人の判断の答え合わせに使う） */
export function isDangerAlert(alert, answers = ANSWERS) {
  const x = answers.find((a) => alert.t >= a.from && alert.t <= a.to + 2);
  return !!(x && x.danger);
}
