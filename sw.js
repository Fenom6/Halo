/**
 * sw.js — Service Worker：一度開けば、電波のない場所でも光背（日本語版・英語版）を開けるようにする係
 *
 * アプリの部品（HTML・CSS・JS・アイコン）を端末にしまっておき、
 * ネットにつながらないときは、しまっておいたものを使う。
 * 部品を変えたら VERSION の数字を上げること（古いしまい物を入れかえるため）。
 */
const VERSION = 'halo-1.3.0';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'en.html',
  'manifest-en.webmanifest',
  'css/halo.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'js/audio.js',
  'js/canon.js',
  'js/classify.js',
  'js/claude.js',
  'js/colormap.js',
  'js/dsp.js',
  'js/features.js',
  'js/format.js',
  'js/i18n.js',
  'js/kouhai-stage.js',
  'js/kouhai.js',
  'js/main.js',
  'js/pitch.js',
  'js/prefs.js',
  'js/recorder.js',
  'js/synth.js',
  'js/tuning-ui.js',
  'js/tuning.js',
  'js/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

/** 光背のしまい物の名前（"halo-1.0.0" と、文字用の "halo-1.0.0-fonts"） */
const OWN_CACHE = /^halo-\d+\.\d+\.\d+(-fonts)?$/;

self.addEventListener('activate', (event) => {
  // 古い版の光背のしまい物だけを消す。同じ場所（オリジン）にある、ほかのアプリのしまい物は消さない
  // （GitHub Pages では、同じ人のほかのアプリも同じ場所を使う）
  const keep = [VERSION, `${VERSION}-fonts`];
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => OWN_CACHE.test(k) && !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** 開いたページを、どの名前でしまうか（この sw.js と同じ場所からの道すじ。'./' は 'index.html'） */
function pageKey(url) {
  const base = new URL('./', self.location.href).pathname;
  const rel = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : '';
  return rel && !rel.endsWith('/') ? rel : 'index.html';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      // ページ本体：まずネットから新しいものを。つながらなければ、しまっておいたもの
      const key = pageKey(url);
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(key, copy));
            }
            return res;
          })
          .catch(() => caches.match(key).then((hit) => hit || caches.match('index.html'))),
      );
      return;
    }
    // 部品：しまっておいたものをすぐ使い、裏で新しいものに入れかえておく
    event.respondWith(
      caches.match(req).then((cached) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
    return;
  }

  // 文字（フォント）：一度取ってきたら、しまっておいたものを使う
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(`${VERSION}-fonts`).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
