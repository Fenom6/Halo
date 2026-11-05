/**
 * canon.js — パッヘルベル「カノン ニ長調」：楽譜のデータと、聴き分けのルール
 *
 * カノン（輪唱）は、同じ旋律を、少し遅れて別の声が追いかける音楽の形です。
 * ヨハン・パッヘルベル（1653〜1706）の「カノン ニ長調」では、
 *   - 低音が 8 つの音（レ・ラ・シ・ファ♯・ソ・レ・ソ・ラ）を何度もくり返し（グラウンド・バス）、
 *   - その上で 3 つの声が、2 小節（8 拍）ずつ遅れて同じ旋律を追いかけます。
 * 作曲から 300 年以上たった、誰でも自由に使える曲（パブリックドメイン）です。
 *
 * 光背 Halo では、
 *   - 光背の見方：今の高さの光を、2 つの淡い光が少し遅れて追いかける（3 声のカノン）
 *   - サンプル「カノン」：この曲の冒頭を、その場で計算して合成した音（声部を選べる）
 *   - ひみつ：低音か旋律を 1 音ずつ歌う（弾く）と、光背に蓮の花が開く
 *
 * このファイルは「楽譜のデータ」と「聴き分けのルール」だけ。画面にも音にも触らないので、テストできます。
 */

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 0〜11 に直す（マイナスの数でも正しく）。12 で割った余り＝オクターブを無視した音名の番号 */
export const mod12 = (n) => ((n % 12) + 12) % 12;

/** 'F#4' のような音名 → MIDI 番号（ラ A4 = 69、ド C4 = 60）。♯ は # でも ♯ でもよい */
export function noteToMidi(name) {
  const m = /^([A-G])([#♯b♭]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`音名が読めません: ${name}`);
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + LETTER[m[1]] + acc;
}

// ---------------------------------------------------------------------------
// 楽譜
// ---------------------------------------------------------------------------

/** 低音（グラウンド・バス）：1 拍に 1 音、8 拍（2 小節）でひと巡りして、またくり返す */
export const GROUND_BASS = ['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2'].map(noteToMidi);

/** 低音の 8 拍それぞれの上で響く和音（pcs は音名の番号 0〜11：ド=0、レ=2 …） */
export const CANON_CHORDS = [
  { name: 'D', pcs: [2, 6, 9] },
  { name: 'A', pcs: [9, 1, 4] },
  { name: 'Bm', pcs: [11, 2, 6] },
  { name: 'F♯m', pcs: [6, 9, 1] },
  { name: 'G', pcs: [7, 11, 2] },
  { name: 'D', pcs: [2, 6, 9] },
  { name: 'G', pcs: [7, 11, 2] },
  { name: 'A', pcs: [9, 1, 4] },
];

/** 3 つの声が順番に歌う旋律（フレーズ）。どれもちょうど 8 拍。[音名, 拍の長さ] */
const PHRASE_SOURCE = [
  [['F#5', 1], ['E5', 1], ['D5', 1], ['C#5', 1], ['B4', 1], ['A4', 1], ['B4', 1], ['C#5', 1]],
  [['D5', 1], ['C#5', 1], ['B4', 1], ['A4', 1], ['G4', 1], ['F#4', 1], ['G4', 1], ['E4', 1]],
  [
    ['D4', 0.5], ['F#4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F#4', 0.5], ['D4', 0.5], ['F#4', 0.5], ['E4', 0.5],
    ['D4', 0.5], ['B3', 0.5], ['D4', 0.5], ['A4', 0.5], ['G4', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 0.5],
  ],
];
export const CANON_PHRASES = PHRASE_SOURCE.map((ph) => ph.map(([n, beats]) => ({ midi: noteToMidi(n), beats })));

export const PHRASE_BEATS = 8;
export const VOICE_COUNT = 3;
/** 次の声が入ってくるまでの遅れ（拍）。原曲どおり 2 小節 = 8 拍 */
export const ENTRY_BEATS = 8;

/**
 * 拍 beat（0 から数える）に、声 voice（0〜2）が鳴らしている音。まだ入っていなければ null。
 * 声 v は v × 8 拍目から入り、フレーズ 1 → 2 → 3 → 1 … の順に歌う。
 */
export function voiceNoteAt(voice, beat) {
  const local = beat - voice * ENTRY_BEATS;
  if (!(local >= 0)) return null;
  const cycle = Math.floor(local / PHRASE_BEATS);
  let pos = local - cycle * PHRASE_BEATS;
  for (const n of CANON_PHRASES[cycle % CANON_PHRASES.length]) {
    if (pos < n.beats) return { midi: n.midi, start: beat - pos, beats: n.beats };
    pos -= n.beats;
  }
  return null;
}

/** 拍 beat の低音（MIDI 番号） */
export function bassAt(beat) {
  return beat >= 0 ? GROUND_BASS[Math.floor(beat) % GROUND_BASS.length] : null;
}

/** 拍 beat の和音 */
export function chordAt(beat) {
  return beat >= 0 ? CANON_CHORDS[Math.floor(beat) % CANON_CHORDS.length] : null;
}

/**
 * [fromBeat, toBeat) の間に始まる音符をすべて返す（合成や楽譜の絵に使う）。
 * { kind: 'bass' | 'voice', voice: 0〜2（低音は -1）, midi, start: 始まりの拍, beats: 長さ }
 */
export function canonEvents(fromBeat, toBeat) {
  const events = [];
  for (let b = Math.max(0, Math.ceil(fromBeat)); b < toBeat; b++) {
    events.push({ kind: 'bass', voice: -1, midi: bassAt(b), start: b, beats: 1 });
  }
  for (let v = 0; v < VOICE_COUNT; v++) {
    const entry = v * ENTRY_BEATS;
    for (let c = Math.max(0, Math.floor((fromBeat - entry) / PHRASE_BEATS)); entry + c * PHRASE_BEATS < toBeat; c++) {
      let t = entry + c * PHRASE_BEATS;
      for (const n of CANON_PHRASES[c % CANON_PHRASES.length]) {
        if (t >= fromBeat && t < toBeat) events.push({ kind: 'voice', voice: v, midi: n.midi, start: t, beats: n.beats });
        t += n.beats;
      }
    }
  }
  return events.sort((a, b) => a.start - b.start || a.voice - b.voice);
}

// ---------------------------------------------------------------------------
// サンプル「輪唱」の長さと、終わりの和音
// ---------------------------------------------------------------------------

export const CANON_BPM = 84; // 1 分間の拍の数
export const CANON_BEATS = 32; // 8 小節。後半の 16 拍は 3 つの声がそろう
export const CANON_LEAD_S = 0.1; // 鳴り始めるまでの小さな間（秒）
/** 終わりの和音（レの長三和音）。それぞれの声が、いちばん近い和音の音へ進んで終わる */
export const CANON_CODA = { beats: 4, bass: noteToMidi('D2'), voices: ['D5', 'F#4', 'D4'].map(noteToMidi) };
/** 3 つの声がそろう拍（ここで蓮が開く） */
export const ALL_VOICES_BEAT = (VOICE_COUNT - 1) * ENTRY_BEATS;

/** サンプル「輪唱」を t 秒鳴らしたところで、各声部が鳴らしている音（光背の 3 つの光に使う） */
export function canonVoicesAt(t, { bpm = CANON_BPM } = {}) {
  const beat = ((t - CANON_LEAD_S) * bpm) / 60;
  if (!(beat >= 0) || beat >= CANON_BEATS + CANON_CODA.beats) return { beat, voices: [null, null, null], bass: null };
  if (beat >= CANON_BEATS) return { beat, voices: CANON_CODA.voices.slice(), bass: CANON_CODA.bass };
  const voices = [];
  for (let v = 0; v < VOICE_COUNT; v++) {
    const n = voiceNoteAt(v, beat);
    voices.push(n ? n.midi : null);
  }
  return { beat, voices, bass: bassAt(beat) };
}

/**
 * 鳴らす声部だけを光で追う楽譜（再生位置 t 秒 → 各声部の音）。parts = { bass, voices: [第1声, 第2声, 第3声] }。
 * 3 つの声を全部鳴らしたときだけ、そろったところで蓮が開く（声を減らすと、そろわないので開かない）。
 */
export function canonScore(parts = { bass: true, voices: [true, true, true] }) {
  const all = parts.voices.every(Boolean);
  return (t) => {
    const s = canonVoicesAt(t);
    return { beat: all ? s.beat : -1, voices: s.voices.map((m, v) => (parts.voices[v] ? m : null)), bass: parts.bass ? s.bass : null };
  };
}

/** 光背の 3 つの光が、今の高さを追いかける遅れ（ミリ秒） */
export const ECHO_DELAY_MS = 800;

/**
 * 今の高さを覚えておいて、少し前の高さを答える係（光背の 3 つの光：今・0.8 秒前・1.6 秒前）。
 * 輪唱で、あとから入る声が同じ旋律を遅れて歌うのと同じしくみ：y(t) = x(t) + x(t − T) + x(t − 2T)
 */
export class EchoTrail {
  constructor({ delayMs = ECHO_DELAY_MS, voices = VOICE_COUNT } = {}) {
    this.delayMs = delayMs;
    this.count = voices;
    this.items = []; // { t: 時刻（ミリ秒）, midi: 高さ（なければ null） }
  }

  /** 時刻 t に聞こえた高さを記録する。いちばん遅れた光より古い記録は捨てる */
  push(t, midi) {
    this.items.push({ t, midi: Number.isFinite(midi) ? midi : null });
    const oldest = t - this.count * this.delayMs;
    while (this.items.length && this.items[0].t < oldest) this.items.shift();
  }

  /** 時刻 t の高さ（t より前で、いちばん新しい記録）。記録がなければ null */
  at(t) {
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].t <= t) return this.items[i].midi;
    return null;
  }

  /** 今・delay 前・2 × delay 前 … の高さ（光の数だけ） */
  voices(now) {
    return Array.from({ length: this.count }, (_, v) => this.at(now - v * this.delayMs));
  }

  clear() {
    this.items.length = 0;
  }
}

// ---------------------------------------------------------------------------
// ひみつ：カノンを歌うと、蓮が開く
// ---------------------------------------------------------------------------

/** 聴き分ける 2 つの並び：低音（レ・ラ・シ・ファ♯・ソ・レ・ソ・ラ）と、旋律の最初（ファ♯・ミ・レ・ド♯・シ・ラ・シ・ド♯） */
export const SECRET_PATTERNS = [
  { id: 'bass', pcs: GROUND_BASS.map(mod12) },
  { id: 'melody', pcs: CANON_PHRASES[0].map((n) => mod12(n.midi)) },
];

/**
 * 音の並び → となりの音へ「いくつ上がったか」（半音の数、0〜11）の並び。
 * 上がり幅で比べるので、どの高さから歌い始めても同じ形として見分けられる（移調しても同じ）。
 */
export function intervalsOf(pcs) {
  return pcs.slice(1).map((p, i) => mod12(p - pcs[i]));
}

/** 最近歌われた音の並び（音名の番号）の終わりが、カノンの低音か旋律と同じ形なら、その id を返す */
export function findCanon(recentPcs) {
  for (const p of SECRET_PATTERNS) {
    if (recentPcs.length < p.pcs.length) continue;
    const heard = intervalsOf(recentPcs.slice(-p.pcs.length));
    const want = intervalsOf(p.pcs);
    if (heard.every((v, i) => v === want[i])) return p.id;
  }
  return null;
}

/**
 * ゆれる高さの流れから「はっきり歌われた音」だけを拾って並べる係。
 *  - 同じ音名に stableMs ミリ秒以上とどまったら、1 つの音として数える（音の出だしの揺れは数えない）
 *  - 同じ音名がつづくのは 1 つにまとめる
 *  - gapMs ミリ秒以上なにも聞こえなければ、並びを最初からにする
 */
export class NoteSequence {
  constructor({ stableMs = 120, gapMs = 2500, keep = 16 } = {}) {
    this.stableMs = stableMs;
    this.gapMs = gapMs;
    this.keep = keep;
    this.reset();
  }

  reset() {
    this.seq = [];
    this.candidate = null;
    this.last = null;
    this.lastHeard = -Infinity;
  }

  /**
   * @param {number} timeMs 時刻（ミリ秒）
   * @param {number|null} midi 聞こえた高さ（MIDI 番号。小数でもよい）。高さがはっきりしないときは null
   * @returns {number|null} 新しく数えた音の音名の番号（0〜11）。なければ null
   */
  push(timeMs, midi) {
    if (midi === null || midi === undefined || !Number.isFinite(midi)) {
      this.candidate = null;
      if (timeMs - this.lastHeard > this.gapMs) {
        this.seq = [];
        this.last = null;
      }
      return null;
    }
    this.lastHeard = timeMs;
    const pc = mod12(Math.round(midi));
    if (!this.candidate || this.candidate.pc !== pc) {
      this.candidate = { pc, since: timeMs };
      return null;
    }
    if (pc === this.last || timeMs - this.candidate.since < this.stableMs) return null;
    this.last = pc;
    this.seq.push(pc);
    if (this.seq.length > this.keep) this.seq.shift();
    return pc;
  }

  get notes() {
    return this.seq.slice();
  }
}
