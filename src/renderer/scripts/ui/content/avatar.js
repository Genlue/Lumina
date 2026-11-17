// Golden Gate · content/avatar
import { h } from '../../core/dom.js';
import { initials } from '../_shared/initials.js';

/* ==========================================================================
   25. 头像
   ========================================================================== */

export function Avatar({ src = '', name = '', size = '', square = false, status = '', className = '' } = {}) {
  const el = h(
    'span',
    {
      class: [
        'c-avatar',
        size && `c-avatar--${size}`,
        square && 'c-avatar--square',
        className,
      ]
        .filter(Boolean)
        .join(' '),
      title: name || null,
      'aria-label': name || null,
    },
    src ? h('img', { src, alt: name || '', draggable: 'false' }) : initials(name)
  );
  if (status) el.append(h('span', { class: `c-avatar__status ${status !== 'online' ? `c-avatar__status--${status}` : ''}`.trim() }));
  return el;
}
