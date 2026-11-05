/**
 * audio.js — マイクやファイルの音を、解析できる形で取り出す係（Web Audio API）
 *
 *   音の入口：マイク ／ 音声ファイル ／ サンプル（合成音）
 *        │
 *        ├──→ AnalyserNode（流れる音を少しずつ写しとる「観察窓」）
 *        │
 *        └──→ スピーカー（ファイル・サンプルのときだけ。マイクの音を流すとハウリングするため）
 *
 * Web Audio API はブラウザに入っている「音の配線キット」。部品（ノード）をつないで音を流す。
 */
import { L } from './i18n.js';

/**
 * 音の「写しとり係」（AudioWorklet）。ブラウザの音の係（オーディオスレッド）の中で動き、
 * 新しい 4096 サンプル（48 kHz で約 0.085 秒）を、約 0.08 秒ごとに画面の係へ送る。
 * requestAnimationFrame（画面の描きかえ）と違い、画面が消えている・別のアプリを見ているときも
 * 音が流れている限り動き続けるので、「聞き守り」を止めずにすむ（Android の Chrome など）。
 */
const TAP_SOURCE = `
class KannonTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.size = o.size || 4096;
    this.hop = Math.round(sampleRate * (o.hopSec || 0.08));
    this.ring = new Float32Array(this.size);
    this.pos = 0;
    this.filled = 0;
    this.since = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'reset') { this.ring.fill(0); this.pos = 0; this.filled = 0; this.since = 0; }
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const size = this.size;
    for (let i = 0; i < ch.length; i++) {
      this.ring[this.pos] = ch[i];
      this.pos = this.pos + 1 === size ? 0 : this.pos + 1;
    }
    this.filled = Math.min(size, this.filled + ch.length);
    this.since += ch.length;
    if (this.since >= this.hop && this.filled === size) {
      this.since = this.since >= 2 * this.hop ? 0 : this.since - this.hop;
      const out = new Float32Array(size);
      out.set(this.ring.subarray(this.pos));
      out.set(this.ring.subarray(0, this.pos), size - this.pos);
      this.port.postMessage(out, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('kannon-tap', KannonTap);
`;

export class KannonAudioError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** マイクが使えなかった理由を、わかる言葉に直す */
function micError(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new KannonAudioError(
      'denied',
      L(
        'マイクの使用が許可されませんでした。ブラウザの設定でこのページのマイクを「許可」にすると使えます。表示している場所によってはマイクが使えないこともあります。そのときは「ファイル」か「カノン」で試せます。',
        'Microphone access was not allowed. Allow the microphone for this page in your browser settings. Some places cannot use the microphone at all; then try "File" or "Canon".',
      ),
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new KannonAudioError('nodevice', L('マイクが見つかりませんでした。マイクのある端末で開いてください。', 'No microphone was found. Open this page on a device with a microphone.'));
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new KannonAudioError(
      'busy',
      L('マイクを別のアプリが使っているようです。通話や録音のアプリを閉じてから、もう一度試してください。', 'Another app seems to be using the microphone. Close call or recording apps and try again.'),
    );
  }
  return new KannonAudioError('unknown', L(`マイクを開けませんでした（${name || '不明なエラー'}）。`, `Could not open the microphone (${name || 'unknown error'}).`));
}

export class AudioEngine extends EventTarget {
  constructor({ fftSize = 4096 } = {}) {
    super();
    this.fftSize = fftSize;
    this.ctx = null;
    this.analyser = null;
    this.output = null;
    this.kind = null; // 'mic' | 'file' | 'sample' | null
    this.sourceName = '';
    this.stream = null;
    this.mediaSource = null;
    this.bufferSource = null;
    this.wakeLock = null;
    this.keepAwake = true;
    this.awakeHolds = new Set(); // 「画面を消さないで」と頼んでいる係（聞き守り・掌中眼）。設定にかかわらず画面を消さない
    this.input = null; // すべての音の入口（ここから観察窓と写しとり係に分かれる）
    this.tap = null;
    this.readyPromise = null;
    this.onVisibility = () => {
      if (document.visibilityState !== 'visible' || !this.kind) return;
      this.requestWakeLock();
      // iPhone では、電話や別のアプリで音の係が止められることがある。戻ってきたら動かし直す
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    };
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  get active() {
    return this.kind !== null;
  }

  /** 音の係が動いているか。止まる・中断される（電話・別のアプリ など）と false。そのあいだ観察窓には最後の音が残る */
  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** 音の係の時計（秒）。音の係が止まっているあいだは進まない */
  get clock() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** 画面を消さないように頼んでいる係がいるか */
  get forceAwake() {
    return this.awakeHolds.size > 0;
  }

  /** key の係が「画面を消さないで」を頼む（on）・やめる。だれも頼んでいなければ、設定どおりにもどす */
  holdAwake(key, on) {
    if (on) {
      this.awakeHolds.add(key);
      this.requestWakeLock();
    } else {
      this.awakeHolds.delete(key);
      if (!this.forceAwake && !(this.keepAwake && this.kind)) this.releaseWakeLock();
    }
  }

  /** マイクの音が OS に止められている（ほかのアプリが使っている など）。そのあいだは、無音のゼロしか届かない */
  get micMuted() {
    const track = this.stream && this.stream.getAudioTracks()[0];
    return !!(track && track.muted);
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** 音の部品を用意する（最初の1回だけ）。ボタンを押したときに呼ぶこと（自動再生の制限のため）。 */
  async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new KannonAudioError('unsupported', L('このブラウザは Web Audio API に対応していません。', 'This browser does not support the Web Audio API.'));
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.input = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0; // ならさず、そのままの値を写す
      this.input.connect(this.analyser);
      // 観察窓はスピーカーにつながなくても動くが、Safari のために「音量0の道」をつないでおく
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0;
      this.analyser.connect(this.sink);
      this.sink.connect(this.ctx.destination);
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.9;
      this.output.connect(this.ctx.destination);
      this.readyPromise = this.setupTap();
    }
    const resumed = this.ctx.state !== 'running' ? this.ctx.resume() : null;
    await this.readyPromise;
    if (resumed) await resumed;
    return this.ctx;
  }

  /** 写しとり係（AudioWorklet）を用意する。使えない環境では、画面の描きかえに合わせて解析する（前のやり方） */
  async setupTap() {
    if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined' || typeof Blob === 'undefined') return;
    let url = '';
    try {
      url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'text/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(this.ctx, 'kannon-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit', // ステレオのファイルも、左右を混ぜて1つにして調べる
        processorOptions: { size: 4096, hopSec: 0.08 },
      });
      node.port.onmessage = (e) => {
        if (this.kind) this.emit('block', e.data);
      };
      this.input.connect(node);
      node.connect(this.sink);
      this.tap = node;
    } catch {
      this.tap = null;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  setFftSize(n) {
    this.fftSize = n;
    if (this.analyser) this.analyser.fftSize = n;
  }

  /** マイクで観る */
  async startMic() {
    if (!window.isSecureContext) {
      throw new KannonAudioError('insecure', L('マイクは https のページでしか使えません。', 'The microphone only works on https pages.'));
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new KannonAudioError('unsupported', L('このブラウザはマイクの入力に対応していません。', 'This browser does not support microphone input.'));
    }
    const ctxReady = this.ensure(); // ボタンを押した直後に音の部品を起こしておく
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 測定のため、声を聞きやすくする自動処理は全部切る（音を「そのまま」観たい）
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
    } catch (e) {
      throw micError(e);
    }
    await ctxReady;
    this.stopSources();
    this.stream = stream;
    this.mediaSource = this.ctx.createMediaStreamSource(stream);
    this.mediaSource.connect(this.input);
    this.kind = 'mic';
    this.sourceName = L('マイク', 'Microphone');
    const track = stream.getAudioTracks()[0];
    if (track) track.addEventListener('ended', () => this.stop());
    this.afterStart();
  }

  /** 音のデータ（AudioBuffer）を流して観る。ファイルとサンプルで共通。 */
  async playBuffer(buffer, { kind = 'sample', name = '', loop = false } = {}) {
    await this.ensure();
    this.stopSources();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(this.input);
    src.connect(this.output);
    src.onended = () => {
      if (this.bufferSource === src) {
        this.bufferSource = null;
        this.kind = null;
        this.releaseWakeLock();
        this.emit('ended');
      }
    };
    src.start();
    this.bufferSource = src;
    this.kind = kind;
    this.sourceName = name;
    this.startedAt = this.ctx.currentTime;
    this.duration = buffer.duration;
    this.afterStart();
  }

  /**
   * 指で鳴らす音の入口（光背の「指で鳴らす」）。ほかの音の入口を止めて、kind を 'touch' にする。
   * 鳴らす音は tone(…, { observe: true }) で作る（スピーカーと観察窓の両方へ流れるので、光背に映る）。
   */
  async startTouch(name = L('指で鳴らす', 'Touch')) {
    await this.ensure();
    this.stopSources();
    this.kind = 'touch';
    this.sourceName = name;
    this.afterStart();
  }

  /** 再生中なら、何秒目か */
  get position() {
    if (!this.bufferSource || !this.ctx) return 0;
    const t = this.ctx.currentTime - this.startedAt;
    return this.bufferSource.loop ? t % this.duration : Math.min(t, this.duration);
  }

  /** Float32Array（-1〜1 の数の並び）から AudioBuffer を作る */
  async bufferFrom(samples, sampleRate) {
    await this.ensure();
    const b = this.ctx.createBuffer(1, samples.length, sampleRate);
    b.copyToChannel(samples, 0);
    return b;
  }

  /** 音声ファイルを読み込んで AudioBuffer にする */
  async decodeFile(file) {
    await this.ensure();
    const data = await file.arrayBuffer();
    try {
      return await this.ctx.decodeAudioData(data);
    } catch {
      throw new KannonAudioError('decode', L('この音声ファイルは読み込めませんでした。mp3・m4a・wav などの形式を試してください。', 'Could not read this audio file. Try mp3, m4a or wav.'));
    }
  }

  getTimeData(out) {
    this.analyser.getFloatTimeDomainData(out);
    return out;
  }

  getFreqData(out) {
    this.analyser.getFloatFrequencyData(out);
    return out;
  }

  afterStart() {
    this.requestWakeLock();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.emit('start', { kind: this.kind, name: this.sourceName });
  }

  /** 止める */
  stop() {
    const was = this.kind;
    this.stopSources();
    this.kind = null;
    this.releaseWakeLock();
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (was) this.emit('stop', { kind: was });
  }

  stopSources() {
    if (this.tap) this.tap.port.postMessage('reset'); // 前の音の残りを、次の音とまぜない
    if (this.bufferSource) {
      this.bufferSource.onended = null;
      try {
        this.bufferSource.stop();
      } catch {
        /* すでに止まっている */
      }
      this.bufferSource.disconnect();
      this.bufferSource = null;
    }
    if (this.mediaSource) {
      this.mediaSource.disconnect();
      this.mediaSource = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
  }

  /** 観測中は画面が消えないようにする（Screen Wake Lock API。使えない環境では何もしない） */
  async requestWakeLock() {
    if (!(this.keepAwake || this.forceAwake) || !('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      this.wakeLock = null;
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  /** マイクの音を seconds 秒だけ録音する（「この音を残す」で録音を選んだとき） */
  recordClip(seconds = 5) {
    if (this.kind !== 'mic' || !this.stream) return Promise.reject(new KannonAudioError('norec', '録音はマイクで観ているときだけできます。'));
    if (typeof MediaRecorder === 'undefined') return Promise.reject(new KannonAudioError('norec', 'このブラウザは録音に対応していません。'));
    const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    return new Promise((resolve, reject) => {
      let rec;
      try {
        rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
      } catch (e) {
        reject(new KannonAudioError('norec', '録音を始められませんでした。'));
        return;
      }
      const chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' }));
      rec.onerror = () => reject(new KannonAudioError('norec', '録音中にエラーが起きました。'));
      rec.start();
      setTimeout(() => rec.state !== 'inactive' && rec.stop(), seconds * 1000);
    });
  }

  /**
   * 学習用：作った音をスピーカーで1回だけ鳴らす（観察窓には流さない）。
   * loop: true なら、stop() するまでくり返す（「SOSを出す」）。返り値の startedAt は、鳴り始めた音の係の時刻（秒）。
   */
  async playOneShot(samples, sampleRate, { volume = 0.8, loop = false } = {}) {
    await this.ensure();
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    const b = this.ctx.createBuffer(1, samples.length, sampleRate);
    b.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.buffer = b;
    src.loop = loop;
    src.connect(g);
    g.connect(this.output);
    const startedAt = this.ctx.currentTime;
    src.start(startedAt);
    let ended = false;
    const done = new Promise((resolve) => {
      src.onended = () => {
        ended = true;
        g.disconnect();
        resolve();
      };
    });
    return {
      done,
      startedAt,
      stop() {
        if (ended) return;
        try {
          src.stop();
        } catch {
          /* すでに止まっている */
        }
      },
    };
  }

  /**
   * 学習用の音を鳴らす。parts = [{ freq, gain, type }]。返り値の stop() で止める。
   * 急に鳴らしたり止めたりすると「プツッ」と鳴るので、音量をなめらかに上げ下げする。
   * observe: true なら観察窓にも流す（光背の「指で鳴らす」：鳴らした音が、そのまま絵に映る）。
   * release は止めるときに音を消していく秒数（指を離したあとの余韻）。
   */
  async tone(parts, { volume = 0.15, duration = null, observe = false, release = 0.05 } = {}) {
    await this.ensure();
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(this.output);
    if (observe) master.connect(this.input);
    const now = ctx.currentTime;
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(volume, now + 0.03);
    const oscs = parts.map((p) => {
      const o = ctx.createOscillator();
      o.type = p.type || 'sine';
      o.frequency.value = p.freq;
      const g = ctx.createGain();
      g.gain.value = p.gain ?? 1;
      o.connect(g);
      g.connect(master);
      o.start(now);
      return { o, g };
    });
    let stopped = false;
    const handle = {
      set(index, freq) {
        const x = oscs[index];
        if (x) x.o.frequency.setTargetAtTime(freq, ctx.currentTime, 0.01);
      },
      setGain(index, gain) {
        const x = oscs[index];
        if (x) x.g.gain.setTargetAtTime(gain, ctx.currentTime, 0.01);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(0, t + release);
        for (const { o } of oscs) o.stop(t + release + 0.01);
        setTimeout(() => master.disconnect(), (release + 0.15) * 1000);
      },
    };
    if (duration) setTimeout(() => handle.stop(), duration * 1000);
    return handle;
  }
}
