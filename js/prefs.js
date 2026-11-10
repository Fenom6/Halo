/**
 * prefs.js — 設定を覚えておく係（この端末のブラウザの localStorage に保存）
 * 保存できない環境（プライベートモードなど）でも、その場では使えるようにしてある。
 */
const KEY = 'halo.prefs.v1';

export const DEFAULT_PREFS = {
  calibration: 100, // マイクの校正値 [dB]：静かかどうかの判定に使う（表示 = dBFS + 校正値）
  minDb: -100, // 色の濃さ：これより小さい成分は地の色
  maxDb: -25,
  keepAwake: true, // 観ているあいだは画面を消さない
  touchKeys: false, // 指で鳴らすとき、鍵盤も出す
  touchGlide: false, // 指で鳴らすとき、半音にそろえず、指の位置そのままの高さで鳴らす（ポルタメント）
  look: null, // 見た目（光の色・軌跡の長さ・明るさ）。null ならはじめの見た目（look.js の DEFAULT_LOOK）
  recMinutes: 30, // 録画の長さ（分）。パソコンなどで選べる（recorder.js の LENGTHS）
  recQuality: 'standard', // 録画の画質。パソコンなどで選べる（recorder.js の QUALITIES）
  introSeen: false, // 最初の案内（3秒）を見たか
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
