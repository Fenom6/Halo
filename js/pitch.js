/**
 * pitch.js — 「いまの音の高さ」を1つに決める係
 *
 * 特徴量（features.js）には、高さの候補が2つあります。
 *   - pitchHz：波が「何秒ごとにくり返すか」から求めた、基本の高さ（YIN 法）
 *   - peakHz ：いちばん強い成分の高さ（FFT の山）
 * 声や楽器のように倍音が整数倍に並ぶ音は基本の高さ、鐘のように整数倍でない音はいちばん強い成分、を選びます。
 * 画面にもマイクにも触らないので、Node.js だけでテストできます。
 */

/** 表示する「高さ」を選ぶ。鐘のように整数倍でない音は、いちばん強い成分を表示する。 */
export function choosePitch(f, catId) {
  if (catId === 'silence' || catId === 'impulse') return null;
  const realF0 = f.f0Db === undefined || f.f0Db >= -30; // その高さに本当に音があるか
  if (f.pitchHz > 0 && f.clarity >= 0.8 && f.harmonicity >= 0.5 && realF0) return { hz: f.pitchHz, kind: 'f0' };
  // 純音や、基本の高さがいちばん強い音：くり返しの高さと、いちばん強い成分が一致する
  if (f.pitchHz > 0 && f.clarity >= 0.9 && f.peakHz > 0 && Math.abs(f.peakHz / f.pitchHz - 1) < 0.03) return { hz: f.pitchHz, kind: 'f0' };
  if (catId === 'voice' && f.pitchHz > 0 && realF0) return { hz: f.pitchHz, kind: 'f0' };
  if (catId === 'tonal' && f.peakHz > 0) return { hz: f.peakHz, kind: 'peak' };
  return null;
}

/**
 * ちらつき防止：直近の size 回の中央値（まん中の値）を答える。
 * 1半音より大きく飛んだら、新しい高さとして数え直す（歌が次の音へ移ったときに、前の音を引きずらない）。
 */
export class PitchSmoother {
  constructor(size = 3) {
    this.size = size;
    this.hist = [];
  }

  reset() {
    this.hist.length = 0;
  }

  /** p は choosePitch の結果。null（高さなし）なら、ためていた高さを忘れて null を返す */
  push(p) {
    if (!p) {
      this.reset();
      return null;
    }
    const h = this.hist;
    if (h.length && Math.abs(12 * Math.log2(p.hz / h[h.length - 1])) > 1) h.length = 0;
    h.push(p.hz);
    if (h.length > this.size) h.shift();
    const sorted = [...h].sort((a, b) => a - b);
    return { hz: sorted[sorted.length >> 1], kind: p.kind };
  }
}
