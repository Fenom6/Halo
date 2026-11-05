/**
 * prefs.js — 設定を覚えておく係（この端末のブラウザの localStorage に保存）
 * 保存できない環境（プライベートモードなど）でも、その場では使えるようにしてある。
 */
import { isEmbedded } from './claude.js';

const KEY = 'halo.prefs.v1';

export const DEFAULT_PREFS = {
  calibration: 100, // マイクの校正値 [dB]：静かかどうかの判定に使う（表示 = dBFS + 校正値）
  minDb: -100, // 色の濃さ：これより小さい成分は地の色
  maxDb: -25,
  keepAwake: true, // 観ているあいだは画面を消さない
  theme: 'auto', // 'auto' | 'light' | 'dark'
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let state = load();

export const prefs = {
  get(key) {
    return state[key];
  },
  set(key, value) {
    if (state[key] === value) return;
    state = { ...state, [key]: value };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* 保存できなくても、この画面の中では使える */
    }
  },
};

/** 表示テーマを当てる（Claude の中では、Claude 側のテーマに任せる） */
export function applyTheme() {
  if (isEmbedded) return;
  const t = prefs.get('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
