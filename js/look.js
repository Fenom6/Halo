/**
 * look.js — 見た目の設定：描くもの・光の色のテーマ・追いかける光の軌跡の長さ・画面の明るさ
 *
 *   描くもの … 座標と光だけ（はじめ）か、すべて。座標と光だけ では、目盛り（螺旋・12本の筋・音名）と千本の光だけを描き、
 *               追いかける3つの光と軌跡・低音の金の輪・蓮の花は描かない（速い曲や和音の多い曲でも、光の形だけを静かに観られる）
 *   光の色   … 金（はじめの色）・朱・青・紫 は「強さで色が変わる」5段の色の並びを、CSS の色（--spec-1〜4）で差し替える。
 *               虹 だけは、強さではなく「音名（向き）」で色を変える。12時の主音を赤にして、時計回りに色相環を1周する
 *   軌跡     … 3つの光が残す尾の長さ（コマ数。1秒に約60コマ）
 *   明るさ   … 画面の上に、うすい黒の幕を重ねる（暗い部屋で、まぶしくないように）。「残す」の絵と「録画」の動画には入らない
 *
 * 決まり（下の表）は画面に触らないので、Node.js だけでテストできる。
 */
import { oklabToRgb } from './colormap.js';

/** 描くもの。pure＝座標（目盛りと音名）と千本の光だけ（はじめの見た目）。full＝追いかける光・軌跡・低音の輪・蓮も描く */
export const VIEWS = {
  pure: { ja: '座標と光だけ', en: 'Only the grid and the rays' },
  full: { ja: 'すべて（光・追いかける光・軌跡）', en: 'Everything (rays, moving lights, trails)' },
};

/** 光の色のテーマ。stops は見本の色（窓の中の見本に使う。本当の色は css/halo.css の :root[data-hue=…]） */
export const HUES = {
  kin: { ja: '金', en: 'Gold', stops: ['#143a3a', '#2f7d70', '#b0b45e', '#f6e7b8'] },
  shu: { ja: '朱', en: 'Vermilion', stops: ['#3a1410', '#8c2f1e', '#e0663c', '#ffd9b8'] },
  ao: { ja: '青', en: 'Blue', stops: ['#0a1f3a', '#1f5fa0', '#5fb0e8', '#e0f4ff'] },
  murasaki: { ja: '紫', en: 'Purple', stops: ['#24113a', '#5b2e8c', '#a678e0', '#f0e0ff'] },
  niji: { ja: '虹', en: 'Rainbow', stops: [] },
};

/** 軌跡の長さ（コマ数）。短い＝いままでと同じ約 0.4 秒 */
export const TRAILS = {
  short: { frames: 24, ja: '短い（約 0.4 秒）', en: 'Short (about 0.4 s)' },
  mid: { frames: 72, ja: 'ふつう（約 1.2 秒）', en: 'Medium (about 1.2 s)' },
  long: { frames: 180, ja: '長い（約 3 秒）', en: 'Long (about 3 s)' },
};

/** 画面の明るさ：重ねる黒い幕の濃さ（0 は幕なし） */
export const DIMS = {
  0: { ja: 'そのまま', en: 'Normal' },
  0.3: { ja: '少し暗く', en: 'A little darker' },
  0.55: { ja: '暗く', en: 'Darker' },
};

export const DEFAULT_LOOK = Object.freeze({ view: 'pure', hue: 'kin', trail: 'short', dim: 0 });

/** おかしな値を、はじめの値に置きかえる（端末に覚えておいた値が古い・こわれている時のため） */
export function normalizeLook(o = {}) {
  return {
    view: Object.hasOwn(VIEWS, o.view) ? o.view : DEFAULT_LOOK.view,
    hue: Object.hasOwn(HUES, o.hue) ? o.hue : DEFAULT_LOOK.hue,
    trail: Object.hasOwn(TRAILS, o.trail) ? o.trail : DEFAULT_LOOK.trail,
    dim: Object.hasOwn(DIMS, String(o.dim)) ? Number(o.dim) : DEFAULT_LOOK.dim,
  };
}

/** 座標と光だけ（追いかける光・軌跡・低音の輪・蓮を描かない）か */
export const isPure = (look) => normalizeLook(look).view === 'pure';

/**
 * 虹の色：12の向き × 3段の明るさの色（"rgb(r,g,b)"）。[向き][段]。
 * 色相（hue）を 30° ずつ回す。人の目に同じくらいの明るさに見えるよう、OKLCH（明るさ・あざやかさ・色相）で作る
 */
export function rainbowTable() {
  return Array.from({ length: 12 }, (_, k) => {
    const h = (k * 30 + 25) * (Math.PI / 180); // 25° ずらすと、12時（主音）が赤になる
    return [0.52, 0.7, 0.88].map((L, j) => {
      const C = [0.13, 0.16, 0.11][j];
      const [r, g, b] = oklabToRgb([L, C * Math.cos(h), C * Math.sin(h)]);
      return `rgb(${r},${g},${b})`;
    });
  });
}
