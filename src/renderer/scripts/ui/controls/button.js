// Golden Gate · controls/button
import { h } from '../../core/dom.js';
import { iconEl } from '../../core/icons.js';

/* ==========================================================================
   1. 按钮
   ========================================================================== */

export function Button({
  label = '',
  icon: ic = '',
  variant = '', // '' | 'primary' | 'tonal' | 'plain' | 'danger'
  size = '', // '' | 'sm' | 'lg'
  disabled = false,
  title = '',
  onClick,
  className = '',
} = {}) {
  const cls = ['c-btn', variant && `c-btn--${variant}`, size && `c-btn--${size}`, className]
    .filter(Boolean)
    .join(' ');
  return h(
    'button',
    {
      class: cls,
      type: 'button',
      title: title || null,
      disabled: disabled || null,
      onclick: onClick,
    },
    ic ? iconEl(ic, size === 'sm' ? 13 : 14) : null,
    label ? h('span', { class: 'c-btn__label' }, label) : null
  );
}

export function IconButton({
  icon: ic,
  label = '',
  variant = '', // '' | 'tonal' | 'on'
  size = '', // '' | 'sm' | 'lg'
  active = false,
  disabled = false,
  toggle = false,
  onClick,
  className = '',
} = {}) {
  // 外观只由 variant 决定，状态只由 aria-pressed 决定。
  // 早先 active 会顺手挂上 --on 实心态，于是「开着的开关」和「选中的页」
  // 长得一模一样，页面只好自己再写一份 .is-on 去盖回来。
  const cls = [
    'c-iconbtn',
    variant && `c-iconbtn--${variant}`,
    size && `c-iconbtn--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const btn = h(
    'button',
    {
      class: cls,
      type: 'button',
      title: label || null,
      'aria-label': label || null,
      'aria-pressed': toggle ? String(active) : null,
      disabled: disabled || null,
      onclick: onClick,
    },
    iconEl(ic, size === 'sm' ? 13 : size === 'lg' ? 18 : 16)
  );
  return btn;
}
