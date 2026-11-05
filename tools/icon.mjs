// 光背のアイコン（icons/icon.svg）を、光背と同じ「螺旋の式」で描く
//   r ＝ 内側の半径 ＋（外側 − 内側）× 周回 ÷ 周の数、 角度 ＝ 12時から時計回りに 360° × 周回
// 光はドミソ（12時・4時・7時）の向きで長く、朱色の光（いまの高さ）を淡い2つの光が追いかける（カノンのように）。
//   node tools/make-icons.mjs で、この SVG と PNG を作り直す

const BG = '#121513'; // 青銅の地
const GOLD = '#d9b45a'; // 金の光
const MARK = '#ff8a65'; // 朱色の光
const C = 256; // 中心
const TURNS = 3;
const R_IN = 40;
const R_OUT = 134;

const f1 = (v) => Math.round(v * 10) / 10;

/** 周回 t（0〜TURNS）の点 */
function point(t) {
  const angle = -Math.PI / 2 + 2 * Math.PI * t;
  const r = R_IN + ((R_OUT - R_IN) * t) / TURNS;
  return { x: C + r * Math.cos(angle), y: C + r * Math.sin(angle), r, angle };
}

/** 角度（12時から時計回り、度）が、ドミソの向き（0°・120°・210°）にどれだけ近いか（0〜1） */
function triad(deg) {
  let best = 0;
  for (const target of [0, 120, 210]) {
    let d = Math.abs(((deg - target + 540) % 360) - 180);
    best = Math.max(best, Math.exp(-((d / 13) ** 2)));
  }
  return best;
}

export function haloIconSvg() {
  // 螺旋
  const steps = TURNS * 72;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const p = point((i / steps) * TURNS);
    pts.push(`${f1(p.x)} ${f1(p.y)}`);
  }
  const spiral = `M${pts.join('L')}`;
  // 千本の光（アイコンでは 72 本）：いちばん外の周から外へ
  const rays = [];
  const count = 72;
  for (let i = 0; i < count; i++) {
    const t = TURNS - 1 + i / count;
    const p = point(t);
    const deg = (360 * i) / count;
    const len = 8 + 50 * triad(deg) + 6 * (0.5 + 0.5 * Math.cos(i * 2.399)); // 2.399 ≒ 黄金角（光の長さに、ほどよいゆらぎ）
    const r0 = p.r + 13;
    const r1 = Math.min(200, r0 + len); // マスク用の安全な円（半径 205）の内側に収める
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    rays.push(`M${f1(C + c * r0)} ${f1(C + s * r0)}L${f1(C + c * r1)} ${f1(C + s * r1)}`);
  }
  // 3つの光：朱色の光（12時・いちばん外）と、少し遅れて追いかける淡い2つの光
  const lead = point(TURNS);
  const f2 = point(TURNS - 1 / 12);
  const f3 = point(TURNS - 2 / 12);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    `  <rect width="512" height="512" rx="112" fill="${BG}"/>`,
    `  <path d="${rays.join('')}" fill="none" stroke="${GOLD}" stroke-width="7" stroke-linecap="round" opacity="0.92"/>`,
    `  <path d="${spiral}" fill="none" stroke="${GOLD}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`,
    `  <circle cx="${f1(C)}" cy="${f1(C)}" r="22" fill="none" stroke="${GOLD}" stroke-width="6" opacity="0.7"/>`,
    `  <circle cx="${f1(f3.x)}" cy="${f1(f3.y)}" r="11" fill="${MARK}" opacity="0.38"/>`,
    `  <circle cx="${f1(f2.x)}" cy="${f1(f2.y)}" r="14" fill="${MARK}" opacity="0.62"/>`,
    `  <circle cx="${f1(lead.x)}" cy="${f1(lead.y)}" r="19" fill="${MARK}" stroke="${BG}" stroke-width="6"/>`,
    '</svg>',
    '',
  ].join('\n');
}
