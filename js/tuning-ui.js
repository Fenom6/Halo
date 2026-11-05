/**
 * tuning-ui.js — 「世界の音楽に合わせる」設定の窓
 *
 * 決まり（何を選べるか・どう呼ぶか）は tuning.js にあり、ここは画面の部品だけを受け持ちます。
 * 選んだ設定は、この端末のブラウザに覚えておきます（prefs.js）。音名の表し方だけは、
 * 日本語版と英語版で別々に覚えます（日本語版はドレミ、英語版は C D E のように、ふだん使うものがちがうため）。
 */
import { NAMINGS, A4_CHOICES, DEFAULT_TUNING, tuning, setTuning, onTuning } from './tuning.js';
import { NOTE_JA, NOTE_EN } from './dsp.js';
import { LANG, L } from './i18n.js';
import { $, h, openDialog } from './ui.js';
import { prefs } from './prefs.js';

/** 基準の高さの、ひとことの説明 */
const A4_NOTE = {
  415: L('バロック音楽（古楽器）', 'Baroque (period instruments)'),
  430: L('モーツァルトのころ', "Mozart's time"),
  432: L('一部で好まれる高さ', 'preferred by some'),
  435: L('19世紀フランスの標準', '19th-century French standard'),
  440: L('国際標準', 'international standard'),
  442: L('日本・ヨーロッパの多くのオーケストラ', 'many orchestras in Japan and Europe'),
  443: L('ドイツ・オーストリアのオーケストラに多い', 'common in German and Austrian orchestras'),
  466: L('バロックの一部（教会のオルガンなど）', 'some Baroque (church organs)'),
};

const shortTitle = (key) => NAMINGS[key].title[LANG].split(/[（(]/)[0].trim();

/** 設定の要約（光背の下のボタンに出す1行） */
export function tuningSummary() {
  const tonic = LANG === 'en' ? NOTE_EN[tuning.tonic] : NOTE_JA[tuning.tonic];
  return [
    `A4 = ${tuning.a4} Hz`,
    shortTitle(tuning.naming),
    L(`12時：${tonic}`, `12 o'clock: ${tonic}`),
    tuning.quarter ? L('四分音', 'quarter tones') : '',
  ]
    .filter(Boolean)
    .join(L('・', ' · '));
}

/** 覚えておいた設定を読み出して、使い始める */
export function loadTuning() {
  const saved = prefs.get('tuning') || {};
  setTuning({ ...saved, naming: prefs.get(`naming.${LANG}`) || DEFAULT_TUNING.naming });
}

function save() {
  prefs.set('tuning', { a4: tuning.a4, tonic: tuning.tonic, quarter: tuning.quarter });
  prefs.set(`naming.${LANG}`, tuning.naming);
}

/**
 * 設定の窓を作る。
 * @param {object} o
 * @param {HTMLButtonElement} o.button 窓を開くボタン（要約の文字を入れる span.kh-tuning-text を中に持つ）
 * @param {HTMLDialogElement} o.dialog 窓（中の #tuning-body に部品を作る）
 */
export function initTuningSheet({ button, dialog }) {
  const body = $('#tuning-body', dialog);
  const id = (s) => `tn-${s}`;

  // 1) 音名の表し方
  const namingField = h(
    'fieldset',
    { class: 'kh-parts tn-naming' },
    h('legend', { text: L('音名の表し方（どの国の呼び方で出すか）', 'Note names (which system to use)') }),
    Object.entries(NAMINGS).map(([key, n]) =>
      h(
        'label',
        { class: 'check tn-choice' },
        h('input', { type: 'radio', name: 'naming', value: key }),
        h('span', {}, h('b', { text: n.title[LANG] }), h('small', { text: n.where[LANG] })),
      ),
    ),
  );

  // 2) 主音（12時に置く音）
  const tonicSelect = h(
    'select',
    { id: id('tonic') },
    NOTE_EN.map((en, pc) => h('option', { value: String(pc), text: LANG === 'en' ? en : `${NOTE_JA[pc]}（${en}）` })),
  );
  const tonicField = h(
    'div',
    { class: 'tn-row' },
    h('label', { for: id('tonic'), text: L('12時に置く音（主音）', 'Note at 12 o’clock (tonic)') }),
    tonicSelect,
    h('p', {
      class: 'tn-help',
      text: L(
        '曲の主音や、インド音楽のサ（Sa）を真上に置くと、音階の形がいつも同じ向きで見えます。移動ド・サルガム・数字譜では、この音が「ド・Sa・1」になります。',
        'Put the tonic of a song, or Sa in Indian music, at the top, and a scale always shows the same shape. With movable do, sargam and jianpu this note becomes Do, Sa or 1.',
      ),
    }),
  );

  // 3) 基準の高さ（A4）
  const a4Select = h(
    'select',
    { id: id('a4') },
    A4_CHOICES.map((hz) => h('option', { value: String(hz), text: A4_NOTE[hz] ? `${hz} Hz — ${A4_NOTE[hz]}` : `${hz} Hz` })),
  );
  const a4Field = h(
    'div',
    { class: 'tn-row' },
    h('label', { for: id('a4'), text: L('基準の高さ（ラ A4 の周波数）', 'Reference pitch (A4)') }),
    a4Select,
    h('p', {
      class: 'tn-help',
      text: L(
        'チューナーの「セント」は、この高さを基準に数えます。合奏する相手（ピアノ・オーケストラ）に合わせて選んでください。「指で鳴らす」の音も、この高さで鳴ります。',
        'The tuner counts cents from this pitch. Match the ensemble you play with (piano, orchestra). Touch notes also play at this pitch.',
      ),
    }),
  );

  // 4) 四分音
  const quarterBox = h('input', { type: 'checkbox', id: id('quarter') });
  const quarterField = h(
    'label',
    { class: 'check tn-quarter' },
    quarterBox,
    h(
      'span',
      {},
      h('b', { text: L('四分音（半音の半分）も名前で出す', 'Name quarter tones (half a semitone)') }),
      h('small', {
        text: L(
          'アラブ・トルコ・ペルシャの音楽は、半音より細かい音を使います。オンにすると、半音と半音のまん中の音を「ミ−¼（ミより四分音低い）」のように呼び、光背に「○時半」の筋を引きます。',
          'Arabic, Turkish and Persian music use steps smaller than a semitone. Turn this on to name the note halfway between two semitones, like “E−¼” (a quarter tone below E), and draw half-hour lines on the halo.',
        ),
      }),
    ),
  );

  const reset = h('button', { type: 'button', class: 'btn btn-quiet tn-reset', text: L('最初の設定に戻す', 'Reset to default') });

  body.replaceChildren(namingField, tonicField, a4Field, quarterField, reset);

  /** いまの設定を、部品の見た目に写す */
  function show() {
    for (const r of namingField.querySelectorAll('input')) r.checked = r.value === tuning.naming;
    tonicSelect.value = String(tuning.tonic);
    if (![...a4Select.options].some((o) => o.value === String(tuning.a4))) a4Select.append(h('option', { value: String(tuning.a4), text: `${tuning.a4} Hz` }));
    a4Select.value = String(tuning.a4);
    quarterBox.checked = tuning.quarter;
    button.querySelector('.kh-tuning-text').textContent = tuningSummary();
  }

  namingField.addEventListener('change', (e) => setTuning({ naming: e.target.value }));
  tonicSelect.addEventListener('change', () => setTuning({ tonic: Number(tonicSelect.value) }));
  a4Select.addEventListener('change', () => setTuning({ a4: Number(a4Select.value) }));
  quarterBox.addEventListener('change', () => setTuning({ quarter: quarterBox.checked }));
  reset.addEventListener('click', () => setTuning({ ...DEFAULT_TUNING }));
  button.addEventListener('click', () => openDialog(dialog));

  onTuning(() => {
    save();
    show();
  });
  show();
}
