// Golden Gate · content/tile
import { h } from '../../core/dom.js';
import { iconEl } from '../../core/icons.js';

/**
 * 内容卡：上面一块媒体，下面两行文字。网格浏览的通用单位 ——
 * 应用列表、文件、模板、专辑，都长这样。
 *
 *   Tile({ media: { src }, title: '设计稿', subtitle: '昨天' })
 *   Tile({ media: { icon: 'folder' }, title: '项目' })
 */
export function Tile({ media = {}, title = '', subtitle = '', selected = false, onClick, onDouble, className = '' } = {}) {
  const box = h('div', { class: 'c-tile__media' });
  if (media.src) box.append(h('img', { src: media.src, alt: media.alt || '', draggable: 'false' }));
  else if (media.icon) box.append(iconEl(media.icon, media.iconSize || 28));
  if (media.badge) box.append(h('span', { class: 'c-tile__badge' }, media.badge));

  return h(
    'div',
    {
      class: `c-tile ${className}`.trim(),
      role: 'option',
      'aria-selected': String(selected),
      onclick: onClick,
      ondblclick: onDouble,
    },
    box,
    title || subtitle
      ? h(
          'div',
          { class: 'c-tile__caption' },
          title ? h('div', { class: 'c-tile__title' }, title) : null,
          subtitle ? h('div', { class: 'c-tile__subtitle' }, subtitle) : null
        )
      : null
  );
}
