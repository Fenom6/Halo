/**
 * recorder.js — 光背の動きを、動画にする（「録画」。最長 30 分）
 *
 * しくみ：
 *   1. 録画用の板（canvas）に、1コマごとに「光背＋音名＋下の帯」を描く（「残す」の絵と同じ描き方）
 *   2. その板を captureStream() で映像の流れにし、MediaRecorder（ブラウザの録画係）で動画ファイルにする
 *   3. 音は、スピーカーに出している音（カノン・指で鳴らす・ファイル）だけを入れる。マイクの音は入れない
 *
 * 動画の形式は、ブラウザが作れるものを選ぶ：iPhone の Safari は MP4、Chrome・Firefox は WebM。
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
export const limitReached = (sec, bytes) => (sec >= MAX_SECONDS ? 'time' : bytes >= MAX_BYTES ? 'size' : '');

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
   */
  constructor({ paint, audio = null, onTick = () => {} }) {
    this.paint = paint;
    this.audio = audio;
    this.onTick = onTick;
    this.type = videoType();
    this.canvas = document.createElement('canvas');
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
    this.paint(this.canvas); // 先に1コマ描いて、板の大きさを決めておく
    const stream = this.canvas.captureStream(30);
    if (this.audio) stream.addTrack(this.audio);
    this.recorder = new MediaRecorder(stream, { mimeType: this.type, videoBitsPerSecond: VIDEO_BPS });
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
        for (const t of stream.getTracks()) t.stop(); // 映像も音も、この録画のための写しなので止める
        const blob = new Blob(this.chunks, { type: this.type.split(';')[0] });
        blob.size ? resolve(blob) : reject(new Error('empty'));
      };
      this.recorder.onerror = (e) => reject(e.error || new Error('record'));
    });
    this.startedAt = performance.now();
    this.recorder.start(500);
    const frame = (now) => {
      this.raf = requestAnimationFrame(frame);
      this.paint(this.canvas);
      const sec = (now - this.startedAt) / 1000;
      const tick = Math.floor(sec * 4);
      if (tick !== this.lastTick) {
        this.lastTick = tick;
        this.onTick(sec);
      }
      this.checkLimit(sec);
    };
    this.raf = requestAnimationFrame(frame);
    return this.done;
  }

  /** 上限に届いていたら、理由を残して止める */
  checkLimit(sec) {
    const why = limitReached(sec, this.bytes);
    if (!why || !this.recording) return;
    this.stoppedBy = why;
    this.stop();
  }

  stop() {
    if (this.recording) this.recorder.stop();
  }
}
