// Golden Gate · content/media-tile
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

/* ==========================================================================
   19. 内容格子：媒体格 / 内容卡
   —— 相册只是「格子」的一个用例。格子本身不知道里面放的是照片还是应用。
   ========================================================================== */

/** 纯媒体格子：图片 + 选中环 + 多选位。相册、素材库、封面墙用它 */
export function MediaTile({ src = '', alt = '', selected = false, multi = false, fav = false, onClick, onDouble, className = '' } = {}) {
  const img = h('img', {
    src,
    alt,
    draggable: 'false',
    onload: () => {
      img.dataset.loaded = '1';
      const box = img.parentElement;
      if (img.naturalWidth && img.naturalHeight) {
        box.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      }
    },
  });

  return h(
    'div',
    {
      class: `c-thumb ${className}`.trim(),
      role: 'option',
      'aria-selected': String(selected),
      dataset: { multi: String(multi) },
      onclick: onClick,
      ondblclick: onDouble,
    },
    img,
    h('div', { class: 'c-thumb__veil' }),
    h('span', { class: 'c-thumb__check', html: icon('check', 11) }),
    fav ? h('span', { class: 'c-thumb__fav', html: icon('heart', 13) }) : null
  );
}

/** @deprecated 旧名，等价于 MediaTile */
export const Thumb = MediaTile;
