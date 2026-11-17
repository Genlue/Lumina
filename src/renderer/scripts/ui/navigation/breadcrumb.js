// Golden Gate · navigation/breadcrumb
import { h } from '../../core/dom.js';
import { icon, iconEl } from '../../core/icons.js';

/* ==========================================================================
   28. 面包屑
   ========================================================================== */

export function Breadcrumb({ items = [], onPick } = {}) {
  const el = h('nav', { class: 'c-crumbs', 'aria-label': '位置' });

  items.forEach((it, i) => {
    const last = i === items.length - 1;
    if (i > 0) el.append(h('span', { class: 'c-crumbs__sep', html: icon('chevron-right', 10) }));
    if (it.ellipsis) {
      el.append(h('span', { class: 'c-crumbs__item c-crumbs__item--ellipsis', html: icon('more', 12) }));
      return;
    }
    el.append(
      h(
        last ? 'span' : 'button',
        {
          class: 'c-crumbs__item',
          type: last ? null : 'button',
          'aria-current': last ? 'page' : null,
          onclick: last ? null : () => (it.onClick ? it.onClick(it, i) : onPick?.(it, i)),
        },
        it.icon ? iconEl(it.icon, 12) : null,
        it.label
      )
    );
  });

  return el;
}
