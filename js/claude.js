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

/** Claude への質問がうまくいかなかったときの説明 */
export function sampleErrorText(code) {
  switch (code) {
    case 'not_granted':
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return 'この画面からは Claude に質問できない設定になっています。';
    case 'rate_limited':
      return '質問が続いたため、少し時間をおいてからもう一度試してください。';
    case 'session_expired':
      return 'ログインの期限が切れました。Claude にもう一度ログインしてください。';
    case 'images_unavailable':
    case 'image_rejected':
      return '絵を送れなかったので、数字だけで聞き直してください。';
    case 'refused':
      return 'この内容には答えられませんでした。聞き方を変えてみてください。';
    case 'prompt_too_large':
      return '送る内容が長すぎました。';
    case 'cancelled':
      return '';
    default:
      return 'うまく答えを受け取れませんでした。もう一度「聞く」を押してください。';
  }
}
