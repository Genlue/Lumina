// Golden Gate · panels/outline-item
import { h } from '../../core/dom.js';

/** 大纲的一行。层级只影响缩进和字号，不改变语义。 */
export function OutlineItem({ label = '', level = 1, active = false, onClick } = {}) {
  const el = h(
    'button',
    {
      class: 'c-outline__item',
      type: 'button',
      'data-level': String(level),
      'data-active': active ? '1' : '0',
      'aria-current': active ? 'true' : null,
      title: label,
      onclick: onClick,
    },
    h('span', { class: 'c-outline__text' }, label)
  );

  el.setActive = (v) => {
    el.dataset.active = v ? '1' : '0';
    if (v) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  };
  return el;
}
