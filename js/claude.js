/**
 * claude.js — Claude（claude.ai）の中で開いたときだけ使える機能への入口
 *
 * claude.ai の中でこのページを開くと window.claude があり、
 *   - sample …… Claude に質問する
 *   - downloads … ファイルを保存する
 * が使える（使えるかどうかは、あとから非同期でわかる）。
 * 普通のブラウザで開いたときは window.claude がないので、代わりの方法（コピーなど）に切り替える。
 */

export const claudeHost =
  typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function' ? window.claude : null;

/** Claude の中で開いているか */
export const isEmbedded = !!claudeHost;

const cache = new Map();
/** 機能を取り出す。使えなければ null */
export function capability(name) {
  if (!claudeHost) return Promise.resolve(null);
  if (!cache.has(name)) {
    cache.set(
      name,
      claudeHost.use(name).catch(() => null),
    );
  }
  return cache.get(name);
}
