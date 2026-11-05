/**
 * features.js — 約0.1秒ぶんの音から「特徴量」をまとめて計算する
 *
 * 特徴量（feature）とは、音の性格を表す数字のこと。
 * 人が「高い・低い」「澄んでいる・ざらざら」と感じるものを、計算できる数字に置きかえる。
 */
import {
  powerSpectrum,
  aWeightTable,
  weightedLevelDb,
  yinPitch,
  spectralCentroid,
  bandFlatness,
  bandEnergy,
  peakFrequency,
  harmonicity,
  rms,
  peakAbs,
  largestPow2,
  zeroCrossingRate,
} from './dsp.js';

/** 帯域の境目 [Hz]：電話の音声帯域（300〜3400 Hz）を「中」とする */
export const BAND_LOW_MID = 300;
export const BAND_MID_HIGH = 3400;

/**
 * 1/3 オクターブ帯の中心 [Hz]（250 Hz〜8 kHz の 16 本）。
 * 1/3 オクターブ＝周波数が 2 の 3 乗根（約 1.26 倍）ごとの区切り。騒音計でも使う、耳の感じ方に近い分け方。
 * 「覚えさせた音」（インターホンなど）の“成分の並び方”を比べるのに使う。
 */
export const THIRD_OCTAVE_CENTERS = [250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000];

/** 1/3 オクターブ帯ごとのエネルギー [dB]（いちばん強い帯から 60 dB 下までで切る） */
export function thirdOctaveBands(power, binHz) {
  const out = THIRD_OCTAVE_CENTERS.map((fc) => {
    const e = bandEnergy(power, binHz, fc / 2 ** (1 / 6), fc * 2 ** (1 / 6));
    return e > 0 ? 10 * Math.log10(e) : -160;
  });
  const top = Math.max(...out);
  return out.map((v) => Math.round(Math.max(v, top - 60) * 10) / 10);
}

/**
 * @param {Float32Array|number[]} block 音のサンプル（新しいものが末尾）。4096 個程度を想定。
 * @param {number} sampleRate サンプリング周波数 [Hz]
 * @returns {{
 *   dbZ:number, dbA:number, pitchHz:number, clarity:number, centroid:number, flatness:number,
 *   harmonicity:number, f0Db:number, lowRatio:number, midRatio:number, highRatio:number, peakHz:number,
 *   crest:number, zcr:number, bands:number[], power:Float64Array, binHz:number
 * }}
 * power と binHz は、計算に使ったパワースペクトルそのもの（power[k] が k × binHz [Hz] の成分）。
 * 掌中眼（eye.js）が「探す音の高さのところだけ」を測るのに使う。保存はしない（大きいので）。
 */
export function computeFeatures(block, sampleRate, { pitchSize = Math.round((2048 * Math.max(48000, sampleRate)) / 48000) } = {}) {
  const n = largestPow2(block.length);
  const power = powerSpectrum(block, n);
  const binHz = sampleRate / n;
  const nyquist = sampleRate / 2;
  const top = Math.min(16000, nyquist);

  // 大きさ：補正なし（Z特性）と、人の耳に合わせた A特性
  const dbZ = weightedLevelDb(power, null);
  const dbA = weightedLevelDb(power, aWeightTable(n, sampleRate));

  // 高さ：新しい約 43 ミリ秒（48 kHz で 2048 サンプル）で YIN 法。
  // 96 kHz の端末では同じ時間が 4096 サンプルになる。サンプルの数で固定すると時間が半分になり、
  // 低い音（ド C2 ≒ 65 Hz）の1回ぶんのくり返しが入りきらず、高さが出なくなるため
  const tail = block.length > pitchSize ? slice(block, block.length - pitchSize) : block;
  const { freq: pitchHz, clarity } = yinPitch(tail, sampleRate, { fMin: 60, fMax: 4000 });

  // 帯域ごとのエネルギーの割合
  const low = bandEnergy(power, binHz, 20, BAND_LOW_MID);
  const mid = bandEnergy(power, binHz, BAND_LOW_MID, BAND_MID_HIGH);
  const high = bandEnergy(power, binHz, BAND_MID_HIGH, nyquist + binHz);
  const total = low + mid + high || 1e-30;

  const r = rms(block);
  return {
    dbZ,
    dbA,
    pitchHz,
    clarity,
    centroid: spectralCentroid(power, binHz, 50, top),
    flatness: bandFlatness(power, binHz),
    harmonicity: clarity >= 0.5 ? harmonicity(power, binHz, pitchHz) : 0,
    f0Db: fundamentalDb(power, binHz, pitchHz),
    lowRatio: low / total,
    midRatio: mid / total,
    highRatio: high / total,
    peakHz: peakFrequency(power, binHz, 50, top),
    crest: r > 0 ? peakAbs(block) / r : 0,
    zcr: zeroCrossingRate(tail),
    bands: thirdOctaveBands(power, binHz),
    power,
    binHz,
  };
}

/**
 * 基本の高さ f0 のところ（±3%）に、どれだけのエネルギーがあるか。いちばん強い成分を 0 dB とした値。
 * 鈴や鐘では、計算上の「くり返し」が見つかっても、その高さに実際の音がないことがある（見かけの高さ）。
 */
function fundamentalDb(power, binHz, f0) {
  if (!(f0 > 0)) return -160;
  let max = 0;
  const k0 = Math.max(1, Math.floor(50 / binHz));
  const k1 = Math.min(power.length - 1, Math.ceil(5000 / binHz));
  for (let k = k0; k <= k1; k++) if (power[k] > max) max = power[k];
  let near = 0;
  const a = Math.max(1, Math.floor((f0 * 0.97) / binHz));
  const b = Math.min(power.length - 1, Math.ceil((f0 * 1.03) / binHz));
  for (let k = a; k <= b; k++) if (power[k] > near) near = power[k];
  return max > 0 && near > 0 ? 10 * Math.log10(near / max) : -160;
}

function slice(x, start) {
  return typeof x.subarray === 'function' ? x.subarray(start) : x.slice(start);
}
