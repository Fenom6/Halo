/**
 * ui.js — 画面の部品を作る・出す・しまうための小さな道具
 */
import { claudeHost, capability } from './claude.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * 要素を作る。h('p', { class: 'x', text: '文字' }, 子要素...)
 * text は textContent として入れるので、外から来た文字列でも安全（HTML として解釈されない）。
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') el.style.cssText = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** SVG のアイコン（<use> で定義済みの絵を呼ぶ） */
export function icon(id, cls = 'btn-icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

let toastTimer = 0;
/** 画面の下に短いお知らせを出す */
export function toast(message, ms = 2600) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

const supportsClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

/** 外側を押すと閉じる（closedby="any"）に対応していないブラウザ（Safari など）向けの代わり */
function addLightDismissFallback(dialog) {
  if (supportsClosedBy || dialog.dataset.lightDismiss || dialog.getAttribute('closedby') !== 'any') return;
  dialog.dataset.lightDismiss = '1';
  const outside = (e) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (e) => {
    pressedOutside = outside(e);
  });
  dialog.addEventListener('pointerup', (e) => {
    if (pressedOutside && outside(e)) dialog.close();
  });
}

/** ダイアログを開く（showModal で開くと、後ろの画面は操作できなくなり、Esc や戻る操作で閉じられる） */
export function openDialog(dialog) {
  addLightDismissFallback(dialog);
  dialog.returnValue = '';
  if (!dialog.open) dialog.showModal();
}

/** ファイルとして保存する。Claude の中では、Claude の「保存」機能を使う */
export async function saveFile(filename, data, mime = 'application/octet-stream') {
  if (claudeHost) {
    const downloads = await capability('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename, data });
        return 'saved';
      } catch (e) {
        if (e && e.code === 'declined') return 'declined';
        return 'failed';
      }
    }
    return 'unavailable';
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}

/** 画面の幅が変わったら呼ぶ（連続で呼ばれすぎないよう、少し待ってから） */
export function onResize(el, fn) {
  let t = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(t);
    t = requestAnimationFrame(fn);
  });
  ro.observe(el);
  return () => ro.disconnect();
}
