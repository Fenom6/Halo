/**
 * recorder.js — 光背の動きを、短い動画にする（「録画」）
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

export const MAX_SECONDS = 30; // 長すぎる動画は送りにくいので、30 秒で自動で止める

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

/** 経過秒 → 「0:05」 */
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
    this.raf = 0;
    this.startedAt = 0;
    this.lastTick = -1;
    this.done = null;
  }

  get recording() {
    return !!this.recorder && this.recorder.state === 'recording';
  }

  /** 録画を始める。止まったら（stop() か 30 秒）、動画の Blob で終わる Promise を返す */
  start() {
    if (!this.type) throw new Error('unsupported');
    this.paint(this.canvas); // 先に1コマ描いて、板の大きさを決めておく
    const stream = this.canvas.captureStream(30);
    if (this.audio) stream.addTrack(this.audio);
    this.recorder = new MediaRecorder(stream, { mimeType: this.type, videoBitsPerSecond: 4_000_000 });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.done = new Promise((resolve, reject) => {
      this.recorder.onstop = () => {
        cancelAnimationFrame(this.raf);
        for (const t of stream.getVideoTracks()) t.stop(); // 音の流れは使い回すので止めない
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
      if (sec >= MAX_SECONDS) this.stop();
    };
    this.raf = requestAnimationFrame(frame);
    return this.done;
  }

  stop() {
    if (this.recording) this.recorder.stop();
  }
}
