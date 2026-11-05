/**
 * classify.js — 音の「性格」をルールで判定する
 *
 * これは AI（機械学習）ではなく、人が決めたルールによる判定です。
 * そのかわり「どの数字が、どうだったから、そう判定したか」を全部説明できます。
 * 判定の理由は画面にも表示されるので、外れたときに原因を考える練習になります。
 */
import { formatHz, formatDb } from './format.js';

/**
 * 判定の種類。並び順は色の見分けやすさ（色覚の多様性を含む）を計算で確かめた順番なので変えないこと。
 * 「静寂」は「何もない」状態なので、色ではなく無彩色で表す。
 */
export const CATEGORIES = [
  { id: 'voice', label: '声', hint: '話し声・歌声など' },
  { id: 'impulse', label: '衝撃音', hint: '手拍子・ドア・足音など一瞬の音' },
  { id: 'tonal', label: '澄んだ音', hint: '楽器・鈴・鳥・笛など高さがはっきりした音' },
  { id: 'rumble', label: '低いざわめき', hint: '車・空調・風など「ゴーッ」' },
  { id: 'hiss', label: '高いざわめき', hint: '雨・水・葉ずれなど「シャー」' },
  { id: 'silence', label: '静寂', hint: 'ほとんど音がしない' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, { ...c, index: i }]));

/** しきい値（判定の境目）。数字を変えると判定の厳しさが変わる。 */
export const RULES = {
  silenceSpl: 35, // 推定 dB(A) がこれ未満なら静寂（図書館より静か）
  silenceDbfs: -62, // ファイル・サンプルのとき（デジタルの大きさ）
  onsetDb: 12, // 直前より 12 dB 以上（振幅で約4倍）急に大きくなったら衝撃音の候補
  crest: 4, // ピークが RMS の4倍以上とがっていたら「一瞬の音」
  impulseFlatness: 0.2, // 衝撃音は、たくさんの高さを含む（雑音っぽい）
  impulseClarity: 0.6, // 衝撃音は、高さがはっきりしない
  periodic: 0.8, // 周期性がこれ以上なら「高さがはっきり」
  lineLike: 0.15, // 平坦度がこれ未満なら「線のように成分が集まった音」
  voiceMinHz: 70,
  voiceMaxHz: 500,
  voiceClarity: 0.5,
  voiceHarmonicity: 0.6, // 声は倍音が整数倍にそろう（鐘・鈴はそろわない）
  voiceGlide: 0.35, // 声は高さが「なめらかに」動く割合が多い（歌の伸ばし・ビブラートも含む）
  glideMin: 0.15, // 半音。これより小さい変化は「止まっている」
  glideMax: 2.5, // 半音。これより大きい変化は「飛んだ」（なめらかではない）
  rumbleCentroid: 1500, // 雑音の重心がこれより低ければ「ゴーッ」、高ければ「シャー」
};

function median(arr) {
  if (!arr.length) return NaN;
  const v = [...arr].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** 半音（semitone）単位のばらつき（標準偏差） */
export function semitoneSpread(freqs) {
  const v = freqs.filter((f) => f > 0);
  if (v.length < 4) return 0;
  const st = v.map((f) => 12 * Math.log2(f));
  const mean = st.reduce((a, b) => a + b, 0) / st.length;
  return Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length);
}

/**
 * 直近の高さの列から「なめらかに動いた割合」を求める（0〜1）。
 * 声の高さは話しているあいだ、坂道のように少しずつ上下する。
 * 楽器の伸ばした音は止まっていて、鐘のように判定が飛ぶ音はなめらかではない。
 */
export function glideRatio(pitches) {
  let pairs = 0;
  let smooth = 0;
  for (let i = 1; i < pitches.length; i++) {
    const a = pitches[i - 1];
    const b = pitches[i];
    if (!(a > 0 && b > 0)) continue;
    pairs++;
    const d = Math.abs(12 * Math.log2(b / a));
    if (d >= RULES.glideMin && d <= RULES.glideMax) smooth++;
  }
  return pairs >= 3 ? smooth / pairs : 0;
}

/**
 * 1回ぶんの判定（なめらかにする前）。
 * @param f computeFeatures() の結果
 * @param level 表示している大きさ（マイク：推定 dB(A)、ファイル：dBFS）
 * @param ctx 直前の様子 { onset, glide, silenceThreshold, unit }
 */
export function classifyFrame(f, level, ctx) {
  const unitLabel = ctx.unit === 'spl' ? 'dB' : 'dBFS';
  if (level < ctx.silenceThreshold) {
    return {
      id: 'silence',
      reason: `大きさが ${formatDb(level)} ${unitLabel} と小さい（境目 ${formatDb(ctx.silenceThreshold)}）`,
    };
  }
  if (
    ctx.onset >= RULES.onsetDb &&
    f.crest >= RULES.crest &&
    f.flatness >= RULES.impulseFlatness &&
    f.clarity < RULES.impulseClarity
  ) {
    return {
      id: 'impulse',
      reason: `直前より ${Math.round(ctx.onset)} dB 急に大きくなった、とがった短い音（いろいろな高さを含む）`,
    };
  }

  const inVoiceRange =
    f.pitchHz >= RULES.voiceMinHz && f.pitchHz <= RULES.voiceMaxHz && f.clarity >= RULES.voiceClarity;
  if (inVoiceRange && f.harmonicity >= RULES.voiceHarmonicity && ctx.glide >= RULES.voiceGlide) {
    return {
      id: 'voice',
      reason:
        `高さ ${formatHz(f.pitchHz)} が声の範囲・倍音がそろう（${f.harmonicity.toFixed(2)}）` +
        `・高さがなめらかに動く（${Math.round(ctx.glide * 100)}%）`,
    };
  }

  const periodic = f.clarity >= RULES.periodic;
  const lineLike = f.flatness < RULES.lineLike;
  if (periodic || lineLike) {
    const parts = [];
    if (periodic) parts.push(`周期性 ${f.clarity.toFixed(2)}（高さ ${formatHz(f.pitchHz)} がはっきり）`);
    if (lineLike) parts.push(`雑音っぽさ ${f.flatness.toFixed(2)} と低い（成分が線のように集まる）`);
    return { id: 'tonal', reason: parts.join('・') };
  }

  const noisy = `高さがはっきりしない（周期性 ${f.clarity.toFixed(2)}・雑音っぽさ ${f.flatness.toFixed(2)}）`;
  if (f.centroid < RULES.rumbleCentroid) {
    return { id: 'rumble', reason: `${noisy}うえ、音の重心が ${formatHz(f.centroid)} と低い` };
  }
  return { id: 'hiss', reason: `${noisy}うえ、音の重心が ${formatHz(f.centroid)} と高い` };
}

/**
 * 判定を時間でならす係。1回ごとの判定はチラつくので、直近の多数決で表示する。
 * 衝撃音だけは一瞬で終わるので、多数決を待たずにすぐ表示し、少しのあいだ保つ。
 */
export class SoundClassifier {
  constructor({ unit = 'spl', historySize = 14, smoothSize = 6 } = {}) {
    this.unit = unit;
    this.historySize = historySize;
    this.smoothSize = smoothSize;
    this.reset();
  }

  reset() {
    this.dbHist = [];
    this.voicedHist = [];
    this.recent = [];
    this.lastById = {};
    this.impulseHold = 0;
  }

  setUnit(unit) {
    if (unit !== this.unit) {
      this.unit = unit;
      this.reset();
    }
  }

  get silenceThreshold() {
    return this.unit === 'spl' ? RULES.silenceSpl : RULES.silenceDbfs;
  }

  /**
   * @param f computeFeatures() の結果
   * @param level 表示している大きさ
   * @returns {{ id:string, frameId:string, reason:string }}
   */
  push(f, level) {
    const prevMedian = median(this.dbHist);
    const onset = this.dbHist.length >= 4 ? f.dbZ - prevMedian : 0;
    pushLimited(this.dbHist, f.dbZ, this.historySize);

    const voiced = f.clarity >= RULES.voiceClarity && f.pitchHz >= RULES.voiceMinHz && f.pitchHz <= RULES.voiceMaxHz;
    pushLimited(this.voicedHist, voiced ? f.pitchHz : 0, this.historySize);

    const frame = classifyFrame(f, level, {
      onset,
      glide: glideRatio(this.voicedHist),
      silenceThreshold: this.silenceThreshold,
      unit: this.unit,
    });
    this.lastById[frame.id] = frame;

    if (frame.id === 'impulse') this.impulseHold = 3;
    pushLimited(this.recent, frame.id, this.smoothSize);

    let id;
    if (this.impulseHold > 0) {
      this.impulseHold--;
      id = 'impulse';
    } else {
      id = majority(this.recent.filter((x) => x !== 'impulse')) || frame.id;
    }
    const shown = this.lastById[id] || frame;
    return { id, frameId: frame.id, reason: shown.reason };
  }
}

function pushLimited(arr, v, max) {
  arr.push(v);
  while (arr.length > max) arr.shift();
}

function majority(ids) {
  const count = {};
  let best = null;
  for (const id of ids) {
    count[id] = (count[id] || 0) + 1;
    if (!best || count[id] > count[best]) best = id;
  }
  return best;
}
