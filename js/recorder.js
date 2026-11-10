/**
 * recorder.js — 光背の動きを動画にする（「録画」）／音だけをファイルにする（「録音」）
 *
 * しくみ：
 *   1. 録画用の板（canvas）に、1コマごとに「光背＋音名＋下の帯」を描く（「残す」の絵と同じ描き方）
 *   2. その板を captureStream() で映像の流れにし、MediaRecorder（ブラウザの録画係）で動画ファイルにする
 *   3. 音は、スピーカーに出している音（カノン・指で鳴らす・ファイル）だけを入れる。マイクの音は入れない
 *
 * 動画の形式は、ブラウザが作れるものを選ぶ：iPhone の Safari は MP4、Chrome・Firefox は WebM。
 * 「録音」は、上の 2 の映像をはぶいて、音の流れだけを MediaRecorder に渡す（M4A か WebM）。
 */

/** 試す順の形式。先に書いたものほど、共有したときに開ける端末が多い */
export const VIDEO_TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/**
 * 録画を自動で止める上限。動画は、録り終えるまで端末のメモリ（作業用の記憶）にためるので、上限がないとスマホが止まってしまう。
 *   時間の上限：30 分
 *   大きさの上限：600 MB（時間より先にここへ届いたら、そこで止める）
 */
export const MAX_SECONDS = 30 * 60;
export const MAX_BYTES = 600 * 1024 * 1024;

/**
 * 映像の細かさ（1秒あたりのビット数）。大きさ ＝ ビット数 × 秒 ÷ 8 なので、
 * 2.5 Mbps × 1800 秒 ÷ 8 ≒ 560 MB。30 分録っても、上の大きさの上限におさまる。
 */
export const VIDEO_BPS = 2_500_000;

/** 止めるべきか：'time'（時間の上限）・'size'（大きさの上限）・''（まだ録れる） */
export const limitReached = (sec, bytes, maxSeconds = MAX_SECONDS, maxBytes = MAX_BYTES) => (sec >= maxSeconds ? 'time' : bytes >= maxBytes ? 'size' : '');

// ---------- パソコンなど：長さと画質を選べる ----------
// パソコンはメモリに余裕があるので、スマホより長く・きれいに録れるようにする。大きさの上限も 2 GB まで広げる。

/** 選べる長さ（分） */
export const LENGTHS = [30, 60, 120];
/** 選べる画質。bps は映像の 1 秒あたりのビット数（大きいほど細かく、ファイルも大きい） */
export const QUALITIES = {
  standard: { bps: VIDEO_BPS, ja: '標準', en: 'Standard' },
  high: { bps: 5_000_000, ja: '高画質', en: 'High' },
  best: { bps: 10_000_000, ja: '最高画質', en: 'Best' },
};
export const MAX_BYTES_DESKTOP = 2 * 1024 * 1024 * 1024;
/** 音の細かさ（1 秒あたりのビット数）。録音と、動画の大きさの見積もりに使う */
export const AUDIO_BPS = 128_000;

/**
 * 録画の決まりを作る。desktop でなければ、いつもスマホ向けの決まり（30 分・標準・600 MB）。
 * 知らない値が来たら、はじめの値（30 分・標準）にする。
 */
export function recordPlan({ desktop = false, minutes = 30, quality = 'standard' } = {}) {
  if (!desktop) return { minutes: 30, quality: 'standard', maxSeconds: MAX_SECONDS, maxBytes: MAX_BYTES, videoBps: VIDEO_BPS };
  const m = LENGTHS.includes(minutes) ? minutes : 30;
  const q = Object.hasOwn(QUALITIES, quality) ? quality : 'standard';
  return { minutes: m, quality: q, maxSeconds: m * 60, maxBytes: MAX_BYTES_DESKTOP, videoBps: QUALITIES[q].bps };
}

/**
 * 最後まで録ったときの見積もり。大きさ ＝（映像のビット数＋音のビット数）× 秒 ÷ 8。
 * 大きさの上限に先に届くときは capped が true で、seconds は止まるまでの秒。
 */
export function estimate(plan) {
  const perSec = (plan.videoBps + AUDIO_BPS) / 8;
  const full = perSec * plan.maxSeconds;
  if (full <= plan.maxBytes) return { bytes: full, seconds: plan.maxSeconds, capped: false };
  return { bytes: plan.maxBytes, seconds: Math.floor(plan.maxBytes / perSec), capped: true };
}

/** バイト数 → 「560 MB」「1.1 GB」 */
export function sizeText(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb < 1000 ? `${Math.round(mb / 10) * 10} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

// ---------- 録音（音だけ） ----------
/** 試す順の形式。iPhone の Safari は MP4（M4A）、Chrome・Firefox は WebM か Ogg */
export const AUDIO_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
/** 録音の上限：2 時間（128 kbps で約 115 MB。スマホでも持てる大きさ） */
export const AUDIO_MAX_SECONDS = 120 * 60;

/** このブラウザで作れる録音の形式（作れなければ空文字） */
export function audioType(env = globalThis) {
  const MR = env.MediaRecorder;
  if (typeof MR !== 'function' || typeof env.MediaStream !== 'function') return '';
  if (typeof MR.isTypeSupported !== 'function') return 'audio/webm';
  return AUDIO_TYPES.find((t) => MR.isTypeSupported(t)) || '';
}

/** 録音の形式 → ファイルの拡張子（MP4 の音だけのファイルは、ふつう .m4a と書く） */
export const audioExt = (type) => (/mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm');

/** このブラウザで作れる動画の形式（作れなければ空文字） */
export function videoType(env = globalThis) {
  const MR = env.MediaRecorder;
  const C = env.HTMLCanvasElement;
  if (typeof MR !== 'function' || !C || typeof C.prototype.captureStream !== 'function') return '';
  if (typeof MR.isTypeSupported !== 'function') return 'video/webm';
  return VIDEO_TYPES.find((t) => MR.isTypeSupported(t)) || '';
}

/** 動画の形式 → ファイルの拡張子 */
export const videoExt = (type) => (/mp4/.test(type) ? 'mp4' : 'webm');

/** 経過秒 → 「0:05」「12:34」（分は 60 をこえても分のまま数える） */
export const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export class ClipRecorder {
  /**
   * @param {object} o
   * @param {(target:HTMLCanvasElement)=>void} o.paint 1コマ描く係（録画用の板を渡すので、そこに描く）
   * @param {MediaStreamTrack|null} [o.audio] 動画に入れる音
   * @param {(sec:number)=>void} [o.onTick] 経過秒を知らせる（ボタンの表示用。約 0.25 秒ごと）
   * @param {boolean} [o.audioOnly] true なら音だけ録る（「録音」。paint は使わない）
   * @param {number} [o.maxSeconds] 時間の上限
   * @param {number} [o.maxBytes] 大きさの上限
   * @param {number} [o.videoBps] 映像の細かさ
   */
  constructor({ paint = () => {}, audio = null, onTick = () => {}, audioOnly = false, maxSeconds = MAX_SECONDS, maxBytes = MAX_BYTES, videoBps = VIDEO_BPS }) {
    this.paint = paint;
    this.audio = audio;
    this.onTick = onTick;
    this.audioOnly = audioOnly;
    this.maxSeconds = maxSeconds;
    this.maxBytes = maxBytes;
    this.videoBps = videoBps;
    this.type = audioOnly ? audioType() : videoType();
    this.canvas = audioOnly ? null : document.createElement('canvas');
    this.timer = 0;
    this.recorder = null;
    this.chunks = [];
    this.bytes = 0; // ここまでにたまった動画の大きさ
    this.stoppedBy = ''; // 自動で止まったときの理由（'time'・'size'）。自分で止めたときは空
    this.raf = 0;
    this.startedAt = 0;
    this.lastTick = -1;
    this.done = null;
  }

  get recording() {
    return !!this.recorder && this.recorder.state === 'recording';
  }

  /** 録画を始める。止まったら（stop() か、時間・大きさの上限）、動画の Blob で終わる Promise を返す */
  start() {
    if (!this.type) throw new Error('unsupported');
    let stream;
    if (this.audioOnly) {
      if (!this.audio) throw new Error('unsupported'); // 音の流れを作れない端末では録音できない
      stream = new MediaStream([this.audio]);
    } else {
      this.paint(this.canvas); // 先に1コマ描いて、板の大きさを決めておく
      stream = this.canvas.captureStream(30);
      if (this.audio) stream.addTrack(this.audio);
    }
    this.recorder = new MediaRecorder(stream, { mimeType: this.type, videoBitsPerSecond: this.videoBps, audioBitsPerSecond: AUDIO_BPS });
    this.chunks = [];
    this.bytes = 0;
    this.stoppedBy = '';
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) {
        this.chunks.push(e.data);
        this.bytes += e.data.size;
      }
      // 画面が裏に回ると、下の「1コマごとの係」は止まる。ここは 0.5 秒ごとに呼ばれ続けるので、上限はここでも見る
      this.checkLimit((performance.now() - this.startedAt) / 1000);
    };
    this.done = new Promise((resolve, reject) => {
      this.recorder.onstop = () => {
        cancelAnimationFrame(this.raf);
        clearInterval(this.timer);
        for (const t of stream.getTracks()) t.stop(); // 映像も音も、この録画のための写しなので止める
        const blob = new Blob(this.chunks, { type: this.type.split(';')[0] });
        blob.size ? resolve(blob) : reject(new Error('empty'));
      };
      this.recorder.onerror = (e) => reject(e.error || new Error('record'));
    });
    this.startedAt = performance.now();
    this.recorder.start(500);
    const tickAt = (now) => {
      const sec = (now - this.startedAt) / 1000;
      const tick = Math.floor(sec * 4);
      if (tick !== this.lastTick) {
        this.lastTick = tick;
        this.onTick(sec);
      }
      this.checkLimit(sec);
    };
    if (this.audioOnly) {
      // 録音は絵を描かないので、時計（0.25 秒ごと）で経過を知らせる
      this.timer = setInterval(() => tickAt(performance.now()), 250);
    } else {
      const frame = (now) => {
        this.raf = requestAnimationFrame(frame);
        this.paint(this.canvas);
        tickAt(now);
      };
      this.raf = requestAnimationFrame(frame);
    }
    return this.done;
  }

  /** 上限に届いていたら、理由を残して止める */
  checkLimit(sec) {
    const why = limitReached(sec, this.bytes, this.maxSeconds, this.maxBytes);
    if (!why || !this.recording) return;
    this.stoppedBy = why;
    this.stop();
  }

  stop() {
    if (this.recording) this.recorder.stop();
  }
}
