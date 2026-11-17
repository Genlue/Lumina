// Golden Gate · surfaces/disclosure
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

/* ==========================================================================
   27. 折叠区

   收起不能只把高度做成 0：里面的按钮仍在 Tab 序列里，屏幕阅读器也照读。
   所以收起时 body 同时 inert + aria-hidden；如果在内部焦点时收起，
   先把焦点送回标题，避免焦点停在已隐藏的节点上。
   ========================================================================== */

let uid = 0;

export function Disclosure({ title, children, open = false, hint = '', onToggle } = {}) {
  const id = `gg-disclosure-${++uid}`;
  const chev = h('span', { class: 'c-disclosure__chev', html: icon('chevron-right', 12) });

  const head = h(
    'button',
    {
      class: 'c-disclosure__head',
      type: 'button',
      id: `${id}-head`,
      'aria-expanded': String(open),
      'aria-controls': id,
    },
    chev,
    h('span', { class: 'l-fill' }, title),
    hint ? h('span', { class: 'c-disclosure__hint' }, hint) : null
  );

  const body = h(
    'div',
    { class: 'c-disclosure__body', id, role: 'region', 'aria-labelledby': `${id}-head` },
    h('div', { class: 'c-disclosure__inner' }, h('div', { class: 'c-disclosure__content' }, children))
  );

  const el = h('div', { class: 'c-disclosure', dataset: { open: open ? '1' : '0' } }, head, body);

  const set = (v) => {
    const next = !!v;
    if (!next && body.contains(document.activeElement)) head.focus({ preventScroll: true });
    el.dataset.open = next ? '1' : '0';
    head.setAttribute('aria-expanded', String(next));
    body.toggleAttribute('inert', !next);
    body.setAttribute('aria-hidden', String(!next));
  };

  head.addEventListener('click', () => {
    const next = el.dataset.open !== '1';
    set(next);
    onToggle?.(next);
  });

  set(open);

  el.set = set;
  el.value = () => el.dataset.open === '1';
  el.toggle = () => set(el.dataset.open !== '1');
  el.head = head;
  el.body = body;
  el.dispose = () => {};
  return el;
}
