/**
 * format.js — 数字を、人が読みやすい文字にする
 */

/** 周波数の表示： 440 → "440 Hz"、1234 → "1.23 kHz" */
export function formatHz(f, { digits } = {}) {
  if (!(f > 0)) return '—';
  if (f >= 1000) return `${(f / 1000).toFixed(digits ?? (f >= 10000 ? 1 : 2))} kHz`;
  return `${f.toFixed(digits ?? (f < 100 ? 1 : 0))} Hz`;
}

/** マイナス記号は全角ではなく「−」(U+2212) を使うと数字がそろって読みやすい */
export function formatSigned(n, digits = 0) {
  const s = Math.abs(n).toFixed(digits);
  return n < 0 && Number(s) !== 0 ? `−${s}` : s;
}

/** dB の表示 */
export function formatDb(db, digits = 0) {
  if (!Number.isFinite(db) || db <= -150) return '—';
  return formatSigned(db, digits);
}

/** セント（半音の 1/100）の表示： +3 / −12 */
export function formatCents(c) {
  if (!Number.isFinite(c)) return '';
  if (c === 0) return '±0';
  return c > 0 ? `+${c}` : `−${Math.abs(c)}`;
}
