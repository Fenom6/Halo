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
 * 音が流れている限り動き続ける（Android の Chrome など）。
 */
const TAP_SOURCE = `
class HaloTap extends AudioWorkletProcessor {
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
registerProcessor('halo-tap', HaloTap);
`;

export class HaloAudioError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * どの端末・ブラウザか（マイクを許可しなおす手順が、端末ごとにちがうため）。
 * 'ios'（iPhone・iPad の Safari など）・'android'・'firefox'・'desktop'（パソコンの Chrome・Edge・Safari）
 */
export function platformOf(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const ua = nav.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  return 'desktop';
}

/** マイクを許可しなおす手順（端末ごと）。1行に1つの手順 */
export function micAllowSteps(platform = platformOf()) {
  const steps = {
    ios: L(
      '【iPhone・iPad】\n1. 画面上（または下）のアドレス欄の左の「ぁあ」（AA）を押す\n2.「Webサイトの設定」→「マイク」を「許可」にする\n3. ページを読み込みなおして、もう一度「マイクで観る」\n（出てこないときは「設定」アプリ →「Safari」→「マイク」を「確認」か「許可」に）',
      '[iPhone / iPad]\n1. Tap “AA” at the left of the address bar\n2. Website Settings → Microphone → Allow\n3. Reload the page and tap “Microphone” again\n(If it is not there: Settings app → Safari → Microphone → Ask or Allow)',
    ),
    android: L(
      '【Android（Chrome）】\n1. アドレス欄の左の印（鍵や、つまみの印）を押す\n2.「権限」→「マイク」を「許可」にする\n3. ページを読み込みなおして、もう一度「マイクで観る」',
      '[Android (Chrome)]\n1. Tap the icon at the left of the address bar (lock or sliders)\n2. Permissions → Microphone → Allow\n3. Reload the page and tap “Microphone” again',
    ),
    firefox: L(
      '【Firefox】\n1. アドレス欄のマイクの印（斜線つき）を押す\n2.「一時的にブロック」の × を押して、ブロックを外す\n3. ページを読み込みなおして、もう一度「マイクで観る」',
      '[Firefox]\n1. Click the crossed-out microphone in the address bar\n2. Click the × next to “Blocked” to remove the block\n3. Reload the page and click “Microphone” again',
    ),
    desktop: L(
      '【パソコン（Chrome・Edge・Safari）】\n1. アドレス欄の左の印（鍵や、つまみの印）を押す\n2.「マイク」を「許可」にする（Safari は「Safari」メニュー →「このWebサイトの設定」）\n3. ページを読み込みなおして、もう一度「マイクで観る」',
      '[Computer (Chrome, Edge, Safari)]\n1. Click the icon at the left of the address bar (lock or sliders)\n2. Set Microphone to Allow (Safari: Safari menu → Settings for This Website)\n3. Reload the page and click “Microphone” again',
    ),
  };
  return steps[platform] || steps.desktop;
}

/** マイクが使えなかった理由を、わかる言葉に直す */
function micError(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new HaloAudioError(
      'denied',
      L(
        `マイクの使用が許可されていません。次の手順で「許可」にすると使えます。\n\n${micAllowSteps()}\n\nマイクを使わなくても、「カノン」「指で鳴らす」「ファイル」で試せます。`,
        `The microphone is not allowed. Allow it like this:\n\n${micAllowSteps()}\n\nWithout the microphone you can still try Canon, Touch and File.`,
      ),
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new HaloAudioError('nodevice', L('マイクが見つかりませんでした。マイクのある端末で開いてください。', 'No microphone was found. Open this page on a device with a microphone.'));
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new HaloAudioError(
      'busy',
      L('マイクを別のアプリが使っているようです。通話や録音のアプリを閉じてから、もう一度試してください。', 'Another app seems to be using the microphone. Close call or recording apps and try again.'),
    );
  }
  return new HaloAudioError('unknown', L(`マイクを開けませんでした（${name || '不明なエラー'}）。`, `Could not open the microphone (${name || 'unknown error'}).`));
}

export class AudioEngine extends EventTarget {
  constructor({ fftSize = 4096, fastFftSize = 0 } = {}) {
    super();
    this.fftSize = fftSize;
    this.fastFftSize = fastFftSize; // 0 でなければ、速い観察窓（短い時間ぶんだけ見る）も並べて置く
    this.ctx = null;
    this.analyser = null;
    this.fastAnalyser = null;
    this.recordDest = null;
    this.recordMicWanted = false; // 録画・録音にマイクの音を入れる約束が生きているか（マイクを始め直したときに、つなぎ直すため）
    this.ticket = 0; // 「始める」の整理券。止める・次を始めるたびに進む（古い「始める」を無効にするため）
    this.output = null;
    this.kind = null; // 'mic' | 'file' | 'sample' | null
    this.sourceName = '';
    this.stream = null;
    this.mediaSource = null;
    this.bufferSource = null;
    this.wakeLock = null;
    this.keepAwake = true;
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
      if (!AC) throw new HaloAudioError('unsupported', L('このブラウザは Web Audio API に対応していません。', 'This browser does not support the Web Audio API.'));
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
      if (this.fastFftSize) {
        // 速い観察窓：同じ音を、短い時間ぶんだけ見る（高い音の光をすばやく動かすため）
        this.fastAnalyser = this.ctx.createAnalyser();
        this.fastAnalyser.fftSize = this.fastFftSize;
        this.fastAnalyser.smoothingTimeConstant = 0;
        this.input.connect(this.fastAnalyser);
        this.fastAnalyser.connect(this.sink);
      }
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
      const node = new AudioWorkletNode(this.ctx, 'halo-tap', {
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

  /**
   * 「始める」の整理券を取る。マイクの許可やファイルの読み込みは時間がかかるので、
   * その間に「止める」か別の「始める」が来たら、整理券の番号が進み、古い方は始めずに終わる。
   * 準備の前（ファイルを読む前など）に取っておき、始める係（startMic・playBuffer・startTouch）へ渡す。
   */
  claim() {
    this.ticket += 1;
    return this.ticket;
  }

  /** この整理券は、まだ有効か（あとから「止める」も「始める」も来ていないか） */
  isCurrent(ticket) {
    return ticket === this.ticket;
  }

  /** マイクで観る。準備のあいだに止められたら、始めずに false を返す */
  async startMic({ ticket = this.claim() } = {}) {
    if (!window.isSecureContext) {
      throw new HaloAudioError('insecure', L('マイクは https のページでしか使えません。', 'The microphone only works on https pages.'));
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new HaloAudioError('unsupported', L('このブラウザはマイクの入力に対応していません。', 'This browser does not support microphone input.'));
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
    try {
      await ctxReady;
    } catch (e) {
      for (const t of stream.getTracks()) t.stop();
      throw e;
    }
    if (!this.isCurrent(ticket)) {
      // 許可を待っている間に「止める」か別の音が始まった：もらったマイクはすぐ返して、何も始めない
      for (const t of stream.getTracks()) t.stop();
      return false;
    }
    this.stopSources();
    this.stream = stream;
    this.mediaSource = this.ctx.createMediaStreamSource(stream);
    this.mediaSource.connect(this.input);
    // 録画・録音にマイクの音を入れている途中で、マイクを始め直したとき：新しいマイクも録画・録音の流れへつなぐ
    // （つながないと、録っている表示のまま、そこから先が無音になる）
    if (this.recordMicWanted) this.connectMicToRecord();
    this.kind = 'mic';
    this.sourceName = L('マイク', 'Microphone');
    const track = stream.getAudioTracks()[0];
    if (track) track.addEventListener('ended', () => {
      if (this.stream === stream) this.stop(); // 前のマイクの「終わり」で、いまの音を止めない
    });
    this.afterStart();
    return true;
  }

  /** 音のデータ（AudioBuffer）を流して観る。ファイルとサンプルで共通。 */
  async playBuffer(buffer, { kind = 'sample', name = '', loop = false, ticket = this.claim() } = {}) {
    await this.ensure();
    if (!this.isCurrent(ticket)) return false; // 準備のあいだに止められた・別の音が始まった
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
    return true;
  }

  /**
   * 指で鳴らす音の入口（光背の「指で鳴らす」）。ほかの音の入口を止めて、kind を 'touch' にする。
   * 鳴らす音は tone(…, { observe: true }) で作る（スピーカーと観察窓の両方へ流れるので、光背に映る）。
   */
  async startTouch(name = L('指で鳴らす', 'Touch')) {
    const ticket = this.claim();
    await this.ensure();
    if (!this.isCurrent(ticket)) return false;
    this.stopSources();
    this.kind = 'touch';
    this.sourceName = name;
    this.afterStart();
    return true;
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
      throw new HaloAudioError('decode', L('この音声ファイルは読み込めませんでした。mp3・m4a・wav などの形式を試してください。', 'Could not read this audio file. Try mp3, m4a or wav.'));
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

  /**
   * 録画にマイクの音も入れる（on）／やめる（off）。利用者が録画のときに選んだときだけ呼ぶ。
   * マイクの音は、動画を作るためだけに録画用の流れへつなぐ（スピーカーには出さない・どこへも送らない）。
   * on のあいだは約束を覚えておき、マイクを始め直したとき・あとからマイクを始めたときも、新しいマイクをつなぐ。
   * 返り値は、いまマイクがつながったか（off のときは、切れたか）
   */
  recordMic(on) {
    this.recordMicWanted = !!on;
    if (on) return this.connectMicToRecord();
    if (!this.recordDest || !this.mediaSource) return false;
    try {
      this.mediaSource.disconnect(this.recordDest);
      return true;
    } catch {
      return false; // つないでいなかった
    }
  }

  /** いまのマイクを、録画・録音の流れへつなぐ。つなげたら true */
  connectMicToRecord() {
    if (!this.recordDest || !this.mediaSource) return false;
    try {
      this.mediaSource.connect(this.recordDest);
      return true;
    } catch {
      return false;
    }
  }

  /** 速い観察窓の dB の並び。速い観察窓がなければ null */
  getFastFreqData(out) {
    if (!this.fastAnalyser) return null;
    this.fastAnalyser.getFloatFrequencyData(out);
    return out;
  }

  /**
   * 動画に入れる音（スピーカーに出している音：カノン・指で鳴らす・ファイル）。
   * マイクの音はスピーカーに出していないので、入らない（録音はしない約束のため）。使えなければ null
   */
  recordAudioTrack() {
    if (!this.ctx || typeof this.ctx.createMediaStreamDestination !== 'function') return null;
    if (!this.recordDest) {
      this.recordDest = this.ctx.createMediaStreamDestination();
      this.output.connect(this.recordDest);
      // 無音の源を1つつないでおく。鳴らす音が1つもない間も、音の流れが途切れないように
      // （途切れると、止めたあとの録画で、動画に音の筋そのものが入らないことがある）
      if (typeof this.ctx.createConstantSource === 'function') {
        const keep = this.ctx.createConstantSource();
        keep.offset.value = 0;
        keep.connect(this.recordDest);
        keep.start();
      }
    }
    // 録画ごとに写し（clone）を渡す。同じ流れを何度も録画に使い回すと、止めたあとの録画で音が入らないことがあるため
    const track = this.recordDest.stream.getAudioTracks()[0];
    return track ? track.clone() : null;
  }

  afterStart() {
    this.requestWakeLock();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.emit('start', { kind: this.kind, name: this.sourceName });
  }

  /** 止める */
  stop() {
    this.ticket += 1; // 準備中の「始める」（マイクの許可待ち・ファイルの読み込み中）を無効にする
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
    if (!this.keepAwake || !('wakeLock' in navigator) || this.wakeLock) return;
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

  /**
   * 音を鳴らす（指で鳴らす）。parts = [{ freq, gain, type }]。返り値の stop() で止める。
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
