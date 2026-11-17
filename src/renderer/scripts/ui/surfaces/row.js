// Golden Gate · surfaces/row
import { h } from '../../core/dom.js';

export function Row({ label, hint, control, stack = false, onClick } = {}) {
  return h(
    'div',
    {
      class: `c-row ${stack ? 'c-row--stack' : ''} ${onClick ? 'c-row--interactive' : ''}`.trim(),
      onclick: onClick,
    },
    h(
      'div',
      { class: 'c-row__label' },
      label,
      hint ? h('span', { class: 'c-row__hint' }, hint) : null
    ),
    control ? h('div', { class: 'c-row__control' }, control) : null
  );
}
