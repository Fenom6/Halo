/**
 * kouhai-stage.js — 光背の「舞台」：1つの部品にまとめた光背
 *
 *   - 絵（kouhai.js の KouhaiView）：螺旋と千本の光、追いかける3つの光
 *   - まわりの飾り：12の音名、まん中（頭光）の音名、蓮の花
 *   - カノン：3つの光が少し遅れて追いかける・3声がそろうと蓮が開く・旋律を歌うと蓮が開く
 *
 * 部品に渡すものは2つだけです。
 *   - 約 0.08 秒ごと：いまの高さ → hear()
 *   - 1コマごと    ：高さごとの大きさ（AnalyserNode の dB の並び）→ voices() と draw()
 */
import { KouhaiView, KOUHAI_GEOMETRY, pointToFreq } from './kouhai.js';
import { EchoTrail, NoteSequence, findCanon, ALL_VOICES_BEAT } from './canon.js';
import { freqToMidi } from './dsp.js';
import { tuning, pcName, isAccidental } from './tuning.js';
import { h } from './ui.js';


const BLOOM_MS = 9000; // 蓮が開いてから消えるまで（CSS の bloom-life と同じ長さ）
const SECRET_REST_MS = 10000; // 歌で蓮が開いたあと、しばらくは聴き分けない（同じ歌で何度も開かないように）

/**
 * 光背のまわりの音名（12時が主音、時計回りに半音ずつ）。♯・♭ の付く音は小さな点にする。
 * 名前は、いまの音名の表し方（tuning.js）で付ける
 */
export function dialLabels() {
  return Array.from({ length: 12 }, (_, k) => {
    const pc = tuning.tonic + k;
    const name = pcName(pc);
    const ang = -Math.PI / 2 + (k * Math.PI) / 6;
    const sharp = isAccidental(pc);
    return h('span', {
      class: sharp ? 'kouhai-pc is-sharp' : 'kouhai-pc',
      text: sharp ? '·' : name,
      style: `left:${(50 + 100 * KOUHAI_GEOMETRY.rLabel * Math.cos(ang)).toFixed(2)}%;top:${(50 + 100 * KOUHAI_GEOMETRY.rLabel * Math.sin(ang)).toFixed(2)}%`,
    });
  });
}

/** 蓮の花びら（8枚 × 2重）を描いておく。8 はカノンの和音の数 */
export function buildLotus(svg) {
  if (!svg || svg.childElementCount) return;
  const ns = 'http://www.w3.org/2000/svg';
  const petal = 'M0,-9 C10,-18 10,-33 0,-45 C-10,-33 -10,-18 0,-9Z';
  for (const [ring, offset, scale] of [['back', 22.5, 1.04], ['front', 0, 0.8]]) {
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', `petals petals-${ring}`);
    for (let i = 0; i < 8; i++) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', petal);
      p.setAttribute('transform', `rotate(${offset + i * 45}) scale(${scale})`);
      p.style.setProperty('--i', String(i));
      g.append(p);
    }
    svg.append(g);
  }
}

export class KouhaiStage {
  /**
   * @param {object} el
   * @param {HTMLCanvasElement} el.canvas 絵を描く板
   * @param {HTMLElement} el.dial 音名とまん中の音名を重ねる入れ物（.kouhai-dial）
   * @param {HTMLElement} el.note まん中の音名（.kouhai-note）
   * @param {HTMLElement} el.oct まん中の英語の音名（.kouhai-oct）
   * @param {HTMLElement} el.bloom 蓮の入れ物（.bloom。中に svg.bloom-lotus）
   * @param {HTMLElement} el.frame 円の大きさ（--dial）と、蓮が開いているしるし（data-bloom）を付ける要素
   */
  constructor(el) {
    this.el = el;
    this.view = new KouhaiView(el.canvas);
    this.trail = new EchoTrail();
    this.ear = new NoteSequence();
    this.score = null; // 楽譜つきのサンプル（輪唱）の「再生位置 → 各声部の音」
    this.bass = null;
    this.bloomDone = false;
    this.bloomUntil = 0;
    this.bloomTimer = 0;
    this.labels = dialLabels();
    el.dial.prepend(...this.labels);
    buildLotus(el.bloom.querySelector('.bloom-lotus'));
  }

  /**
   * 基準の高さ・主音・音名の表し方が変わったとき：螺旋の始まり・千本の光の受け持ち・目盛り・まわりの音名を付け直す。
   * （syncSpiral() は呼ぶ側で先に済ませておく）
   */
  retune() {
    this.view.configure({});
    this.view.paintBase();
    this.trail.clear();
    const next = dialLabels();
    this.labels.forEach((old, i) => old.replaceWith(next[i]));
    this.labels = next;
  }

  setPalette(lut, colors) {
    this.view.setPalette(lut, colors);
  }

  configure(o) {
    this.view.configure(o);
  }

  /** 画面の大きさに合わせる。円の大きさを、文字（音名）と蓮の重ね絵にも伝える */
  resize() {
    const r = this.view.resize();
    if (r) this.el.frame.style.setProperty('--dial', `${r.size}px`);
    return r;
  }

  /** 円の直径（CSS の px） */
  get size() {
    return this.view.sizeCss;
  }

  /** 円の中心からのずれ（CSS の px）にいちばん近い、螺旋の上の高さ [Hz] */
  freqAt(dx, dy) {
    return pointToFreq(dx, dy, this.view.sizeCss);
  }

  /** 新しい音の入口で始めるとき。score は楽譜つきのサンプル（輪唱）のとき、その声部の表 */
  start(score = null) {
    this.trail.clear();
    this.ear.reset();
    this.bloomDone = false;
    this.score = score;
    this.bass = null;
    // カノンでは3つの光を声ごとに色分けする。それ以外は「朱色の光と、追いかける淡い2つの光」
    this.view.setVoiceColors(score && this.canonColors ? this.canonColors : null);
    this.view.clear();
  }

  /**
   * 約 0.08 秒ごとに、いまの高さを受け取る（光が追いかけるための記録と、ひみつの聴き分け）。
   * @param {number} now 時刻（ミリ秒）
   * @param {{hz:number, kind:'f0'|'peak'}|null} pitch いまの高さ
   * @param {{clarity?:number, secret?:boolean}} o clarity は周期性（0〜1）。secret が true のときだけ、歌われた旋律を聴き分ける
   */
  hear(now, pitch, { clarity = 0, secret = false } = {}) {
    const midi = pitch ? freqToMidi(pitch.hz) : null;
    this.trail.push(now, midi);
    if (!secret) return;
    // 基本の高さがはっきりした音（声・楽器・口笛など）だけを、歌として数える
    const sung = pitch && pitch.kind === 'f0' && clarity >= 0.8 ? midi : null;
    if (this.ear.push(now, sung) === null || now < this.bloomUntil) return;
    if (findCanon(this.ear.notes)) {
      this.bloomUntil = now + SECRET_REST_MS;
      this.ear.reset();
      this.bloom();
    }
  }

  /**
   * 3つの光が今いる高さ。楽譜つきのサンプルは各声部を、それ以外は今の高さを 0.8 秒ずつ遅れて追う。
   * @param {number} now 時刻（ミリ秒）
   * @param {number} position サンプルの再生位置（秒）
   */
  voices(now, position = 0) {
    if (this.score) {
      const s = this.score(position);
      this.bass = s.bass;
      if (!this.bloomDone && s.beat >= ALL_VOICES_BEAT) {
        this.bloomDone = true; // 3つの声がそろったところで、蓮が開く
        this.bloom();
      }
      return s.voices;
    }
    this.bass = null;
    return this.trail.voices(now);
  }

  /**
   * 1コマ描く。db は高さごとの大きさ [dB]、voices は voices() の答え、dt は前のコマからのミリ秒。
   * fast は速い観察窓の dB の並び（あれば、高い音の光をすばやく動かす）
   */
  draw(db, voices, dt, fast = null) {
    this.view.draw(db, voices, { dt, bass: this.bass, fast });
  }

  /** カノンの3つの声の色（第1〜3声）。楽譜つきのサンプルを鳴らすあいだだけ使う */
  setCanonColors(list) {
    this.canonColors = list;
    if (this.score) this.view.setVoiceColors(list);
  }

  /** 止まっているときに、今の高さ（MIDI 番号。なければ null）で描き直す */
  still(db, midi = null) {
    this.view.draw(db, [midi], { still: true });
  }

  clear() {
    this.view.clear();
  }

  /**
   * いまの光背を1枚の画像にする（音名・まん中の音名・蓮も描き込む）。footer は下の帯に書く1行。
   * 文字の書体は、画面と同じもの（CSS の --font-display など）を使う。読み込みが終わるのを待ってから描く。
   */
  async exportImage(footer = '') {
    if (document.fonts && document.fonts.ready) await document.fonts.ready.catch(() => {});
    return this.frameInto(null, footer);
  }

  /**
   * いまの光背を、絵（音名・まん中の音名・蓮・下の帯つき）として target に描く（動画では毎コマ呼ぶ）。
   * target がなければ新しい板を作る
   */
  frameInto(target, footer = '') {
    const cs = getComputedStyle(this.el.frame);
    const quiet = this.el.note.dataset.quiet === 'true';
    return this.view.exportImage(
      {
        note: quiet ? '' : this.el.note.textContent,
        en: quiet ? '' : this.el.oct.textContent,
        footer,
        bloom: this.el.frame.dataset.bloom === 'on',
        fonts: {
          display: cs.getPropertyValue('--font-display').trim(),
          body: cs.getPropertyValue('--font-body').trim(),
          mono: cs.getPropertyValue('--font-mono').trim(),
        },
      },
      target,
    );
  }

  /** まん中（頭光）の音名。n は tuning.js の describe の答え。高さがはっきりしないときは空にする（まん中には状態を出す） */
  setNote(n) {
    this.el.note.textContent = n ? n.name : '';
    this.el.note.dataset.quiet = String(!n);
    this.el.oct.textContent = n ? n.en : '';
  }

  /** 蓮の花を開く（光背の上に重ねて、しばらくして消える） */
  bloom() {
    const { bloom, frame } = this.el;
    clearTimeout(this.bloomTimer);
    bloom.hidden = false;
    bloom.classList.remove('is-open');
    void bloom.offsetWidth; // アニメーションを最初から
    bloom.classList.add('is-open');
    frame.dataset.bloom = 'on';
    this.bloomTimer = setTimeout(() => {
      bloom.hidden = true;
      bloom.classList.remove('is-open');
      delete frame.dataset.bloom;
    }, BLOOM_MS);
  }
}
