/**
 * format.js — 数字を、人が読みやすい文字にする
 */

/** 周波数の表示： 440 → "440 Hz"、1234 → "1.23 kHz" */
export function formatHz(f, { digits } = {}) {
  if (!(f > 0)) return '—';
  if (f >= 1000) return `${(f / 1000).toFixed(digits ?? (f >= 10000 ? 1 : 2))} kHz`;
  return `${f.toFixed(digits ?? (f < 100 ? 1 : 0))} Hz`;
}

/** 目盛り用の短い表示： 1000 → "1k" */
export function formatHzShort(f) {
  if (f >= 1000) return `${+(f / 1000).toFixed(1)}k`;
  return `${Math.round(f)}`;
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

/** 長さの表示： 0.78 → "78 cm"、17.2 → "17.2 m" */
export function formatLength(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 0.01) return `${(m * 1000).toFixed(1)} mm`;
  if (m < 1) return `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm`;
  return `${m.toFixed(m < 10 ? 2 : 1)} m`;
}

/** 時間の長さ：秒 → "1時間2分" / "3分20秒" / "12秒" */
export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}時間${m}分`;
  if (m) return `${m}分${s ? s + '秒' : ''}`;
  return `${s}秒`;
}

/** 時刻： Date → "14:05" */
export function formatClock(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

/** 日付キー（端末の時刻で）： Date → "2026-11-03" */
export function dayKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** 日付キー → "11月3日（火）" */
export function formatDayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日（${WEEK[dt.getDay()]}）`;
}

/** 0〜1 → "42%" */
export function formatPercent(x) {
  if (!Number.isFinite(x)) return '—';
  return `${Math.round(x * 100)}%`;
}
