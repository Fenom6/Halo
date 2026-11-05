/**
 * synth.js — サンプルの音を、その場で計算して作る（合成音）
 *
 * 光背 Halo のサンプルは、パッヘルベル「カノン ニ長調」（1680 年ごろ。作曲から 300 年以上たった、誰でも自由に使える曲）。
 * 低音が 8 つの音をくり返し、その上で 3 つの声が 2 小節ずつ遅れて同じ旋律を追いかける。
 * 音は録音ではなく、はじいた弦のような音を、楽譜（canon.js）からその場で計算して作る。
 */
import { midiToFreq } from './dsp.js';
import { canonEvents, CANON_BPM, CANON_BEATS, CANON_LEAD_S, CANON_CODA } from './canon.js';

function makeBuffer(sr, seconds) {
  return new Float32Array(Math.round(sr * seconds));
}

/** いちばん大きいところが peak になるように全体の音量をそろえる */
export function normalize(buf, peak = 0.5) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) {
    const g = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}


/**
 * はじいた弦のような音（倍音つき）を足す。
 * 1 サンプルごとに sin と exp を計算すると遅いので、どちらも「かけ算のくり返し」で作る：
 *   サイン波 … 矢印を毎回 角度 w だけ回す（cos w と sin w をかける）
 *   減衰     … 毎回 同じ割合 d をかける（指数関数的に小さくなる）
 */
function addPluck(out, sr, { f, t0, len, amp, decay, partials, release = 0.25, attack = 0.006 }) {
  const start = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(out.length - start, Math.round((len + release) * sr));
  const relStart = Math.round(len * sr);
  const relN = Math.max(1, Math.round(release * sr));
  const atkN = Math.max(1, Math.round(attack * sr));
  for (let h = 0; h < partials.length; h++) {
    const fh = f * (h + 1);
    if (fh > sr * 0.45) break;
    const w = (2 * Math.PI * fh) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const d = Math.exp(-(1 + 0.5 * h) / (decay * sr)); // 高い倍音ほど早く消える
    let s = 0;
    let c = 1;
    let env = amp * partials[h];
    // 立ち上がり → のばす → 消える、の3つの区間に分けて回す（1サンプルごとの場合分けをなくして速くする）
    const end1 = Math.min(atkN, n);
    const end2 = Math.min(Math.max(relStart, end1), n);
    let i = 0;
    for (; i < end1; i++) {
      out[start + i] += env * (i / atkN) * s;
      const s2 = s * cw + c * sw;
      c = c * cw - s * sw;
      s = s2;
      env *= d;
    }
    for (; i < end2; i++) {
      out[start + i] += env * s;
      const s2 = s * cw + c * sw;
      c = c * cw - s * sw;
      s = s2;
      env *= d;
    }
    for (; i < n; i++) {
      out[start + i] += env * (1 - (i - relStart) / relN) * s;
      const s2 = s * cw + c * sw;
      c = c * cw - s * sw;
      s = s2;
      env *= d;
    }
  }
}

const VOICE_PARTIALS = [1, 0.42, 0.24, 0.13, 0.07];
const BASS_PARTIALS = [1, 0.55, 0.3, 0.16];

/**
 * 輪唱：パッヘルベル「カノン ニ長調」の冒頭（パブリックドメイン）。
 * 低音の 8 つの音がくり返す上で、3 つの声が 2 小節（8 拍）ずつ遅れて、同じ旋律を追いかける。
 * parts で鳴らす声部を選べる（「学ぶ」の道具で、声を 1 つずつ足して聞くため）。
 */
export function canonRound({ sampleRate: sr = 48000, bpm = CANON_BPM, parts = { bass: true, voices: [true, true, true] } } = {}) {
  const spb = 60 / bpm; // 1 拍の秒数
  const out = makeBuffer(sr, CANON_LEAD_S + (CANON_BEATS + CANON_CODA.beats) * spb + 0.4);
  const pluck = (kind, voice, midi, start, beats) => {
    if (kind === 'bass' ? !parts.bass : !parts.voices[voice]) return;
    const bass = kind === 'bass';
    addPluck(out, sr, {
      f: midiToFreq(midi),
      t0: CANON_LEAD_S + start * spb,
      len: beats * spb,
      amp: bass ? 0.5 : 0.3,
      decay: bass ? 0.9 : 0.55,
      partials: bass ? BASS_PARTIALS : VOICE_PARTIALS,
    });
  };
  for (const e of canonEvents(0, CANON_BEATS)) pluck(e.kind, e.voice, e.midi, e.start, e.beats);
  // 終わりの和音を、少し長めにのばす
  pluck('bass', -1, CANON_CODA.bass, CANON_BEATS, CANON_CODA.beats);
  CANON_CODA.voices.forEach((m, v) => pluck('voice', v, m, CANON_BEATS, CANON_CODA.beats));
  return normalize(out, 0.5);
}
