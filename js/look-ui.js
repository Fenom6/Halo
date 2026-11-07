/**
 * look-ui.js — 見た目の設定の窓（描くもの・光の色・軌跡の長さ・画面の明るさ）
 *
 * 決まりは look.js。選ぶと、窓の後ろの光背にすぐ映る（窓は画面の下から出るので、光背を見ながら選べる）。
 * 選んだものは、この端末のブラウザに覚えておく（prefs.js）。
 */
import { VIEWS, HUES, TRAILS, DIMS, DEFAULT_LOOK, normalizeLook } from './look.js';
import { LANG, L } from './i18n.js';
import { $, h, openDialog } from './ui.js';
import { prefs } from './prefs.js';

/** いまの見た目の設定（端末に覚えておいたもの） */
export const currentLook = () => normalizeLook(prefs.get('look') || {});

/** ページに映す：描くものは <html data-view>、光の色は <html data-hue>、明るさは <html data-dim>（css/halo.css が読む） */
export function applyLookToPage(look) {
  const root = document.documentElement;
  root.dataset.view = look.view;
  root.dataset.hue = look.hue;
  if (look.dim) root.dataset.dim = String(look.dim);
  else delete root.dataset.dim;
  root.style.setProperty('--dim', String(look.dim));
}

/** 見本の色の帯（虹は色相環） */
function swatch(key) {
  const stops = HUES[key].stops;
  const bg = stops.length ? `linear-gradient(90deg, #000, ${stops.join(', ')})` : 'conic-gradient(from -90deg, #e0464b, #e8a33a, #d9d84a, #5fc46a, #3fb5c9, #5a7de8, #a06ae0, #e0464b)';
  return h('i', { class: 'lk-swatch', style: `background:${bg}` });
}

/**
 * @param {object} o
 * @param {HTMLButtonElement} o.button 窓を開くボタン
 * @param {HTMLDialogElement} o.dialog 窓（中の #look-body に部品を作る）
 * @param {(look:{view:string, hue:string, trail:string, dim:number})=>void} o.onChange 変わったときに呼ぶ（光背の色を塗り直すなど）
 */
export function initLookSheet({ button, dialog, onChange }) {
  const body = $('#look-body', dialog);
  const group = (name, legend, entries, help) =>
    h(
      'fieldset',
      { class: `kh-parts lk-group lk-${name}` },
      h('legend', { text: legend }),
      h(
        'div',
        { class: 'lk-choices' },
        entries.map(([value, label, extra]) =>
          h('label', { class: 'kh-chip lk-chip' }, h('input', { type: 'radio', name: `look-${name}`, value }), extra || null, h('span', { text: label })),
        ),
      ),
      help ? h('p', { class: 'tn-help', text: help }) : null,
    );

  const view = group(
    'view',
    L('描くもの', 'What to draw'),
    Object.entries(VIEWS).map(([k, v]) => [k, v[LANG]]),
    L(
      'はじめは「座標と光だけ」：目盛り（螺旋・12本の筋・音名）と千本の光だけを描き、光の形だけを静かに観られます。「すべて」にすると、今の高さを追いかける3つの光と軌跡・カノンの低音の金の輪・蓮の花も出ます。',
      'By default, “Only the grid and the rays” draws just the grid (spiral, 12 lines, note names) and the thousand rays, so you can watch the shape of the light alone. “Everything” adds the three lights that follow the pitch and their trails, the gold bass ring of the canon, and the lotus.',
    ),
  );
  const hue = group(
    'hue',
    L('光の色', 'Color of the light'),
    Object.entries(HUES).map(([k, v]) => [k, v[LANG], swatch(k)]),
    L(
      '金・朱・青・紫は、音が強いほど明るい色になります。虹は、音名（向き）ごとに色が決まります（12時の主音が赤、時計回りに色が巡る）。同じ音名は何周目でも同じ色、和音は色の組み合わせになります。',
      'Gold, vermilion, blue and purple get brighter as the sound gets stronger. Rainbow gives each note name (direction) its own color: the tonic at 12 o’clock is red, and the colors go round clockwise. The same note is the same color in every octave, so a chord becomes a set of colors.',
    ),
  );
  const trail = group(
    'trail',
    L('追いかける光の軌跡', 'Trail of the moving lights'),
    Object.entries(TRAILS).map(([k, v]) => [k, v[LANG]]),
    L('長くすると、旋律がたどった道すじが、しばらく残って見えます。', 'A longer trail keeps the path of a melody on screen for a while.'),
  );
  const dim = group(
    'dim',
    L('画面の明るさ', 'Screen brightness'),
    Object.entries(DIMS).map(([k, v]) => [k, v[LANG]]),
    L('暗い部屋や夜に。画面に薄い黒を重ねるだけなので、「残す」の絵と「録画」の動画は暗くなりません。', 'For a dark room or at night. It only lays a thin black veil over the screen; saved pictures and videos are not darkened.'),
  );
  const reset = h('button', { type: 'button', class: 'btn btn-quiet tn-reset', text: L('最初の見た目に戻す', 'Reset to default') });
  body.replaceChildren(view, hue, trail, dim, reset);

  function show(look) {
    for (const [field, el] of [['view', view], ['hue', hue], ['trail', trail], ['dim', dim]]) {
      for (const r of el.querySelectorAll('input')) r.checked = r.value === String(look[field]);
    }
    trail.disabled = look.view === 'pure'; // 座標と光だけ のときは軌跡を描かないので、選べなくする（選んだ長さは覚えておく）
    button.setAttribute('aria-label', L(`見た目（光の色：${HUES[look.hue].ja}）`, `Look (light: ${HUES[look.hue].en})`));
  }

  function set(patch) {
    const look = normalizeLook({ ...currentLook(), ...patch });
    prefs.set('look', look);
    applyLookToPage(look);
    show(look);
    onChange(look);
  }

  view.addEventListener('change', (e) => set({ view: e.target.value }));
  hue.addEventListener('change', (e) => set({ hue: e.target.value }));
  trail.addEventListener('change', (e) => set({ trail: e.target.value }));
  dim.addEventListener('change', (e) => set({ dim: Number(e.target.value) }));
  reset.addEventListener('click', () => set({ ...DEFAULT_LOOK }));
  button.addEventListener('click', () => openDialog(dialog));
  show(currentLook());
}
