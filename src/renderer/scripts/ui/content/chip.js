// Golden Gate · content/chip
import { h } from '../../core/dom.js';
import { icon, iconEl } from '../../core/icons.js';

/* ==========================================================================
   26. 标签片

   删除必须是一个**独立的按钮**：能 Tab 到、有名字、Enter/Space 能触发。
   以前把 × 写成 tabindex=-1 的 span，键盘用户根本删不掉。
   可点击 + 可删除时不能把两个按钮嵌套在 role=button 里 ——
   外壳降成普通容器，主体和删除各自是按钮。
   ========================================================================== */

export function Chip({
  label = '',
  icon: ic = '',
  selected = false,
  removable = false,
  onClick,
  onRemove,
  size = '',
  removeLabel = '',
} = {}) {
  const inner = [ic ? iconEl(ic, 12) : null, label];

  const main = onClick
    ? h(
        'button',
        {
          class: 'c-chip__label',
          type: 'button',
          'aria-pressed': String(!!selected),
          onclick: (e) => onClick(e),
        },
        ...inner
      )
    : null;

  const removeBtn = removable
    ? h('button', {
        class: 'c-chip__x',
        type: 'button',
        'aria-label': removeLabel || `移除 ${label || '标签'}`,
        title: removeLabel || `移除 ${label || '标签'}`,
        html: icon('x', 9),
        onclick: (e) => {
          e.stopPropagation();
          onRemove?.();
        },
      })
    : null;

  // 只有「可点、不可删」时才把整个外壳当按钮；否则交给里面的真按钮
  const shellIsButton = !!onClick && !removable;

  const el = h(
    'div',
    {
      class: `c-chip ${size ? `c-chip--${size}` : ''} ${
        onClick || removable ? 'c-chip--interactive' : ''
      }`
        .trim()
        .replace(/\s+/g, ' '),
      role: shellIsButton ? 'button' : null,
      'aria-pressed': shellIsButton ? String(!!selected) : null,
      tabindex: shellIsButton ? '0' : null,
      onclick: shellIsButton ? onClick : null,
      onkeydown: shellIsButton
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick(e);
            }
          }
        : null,
    },
    main,
    main ? null : ic ? iconEl(ic, 12) : null,
    main ? null : label,
    removeBtn
  );

  el.set = (v) => {
    if (shellIsButton) el.setAttribute('aria-pressed', String(!!v));
    main?.setAttribute('aria-pressed', String(!!v));
  };
  el.value = () => (main ? main.getAttribute('aria-pressed') === 'true' : el.getAttribute('aria-pressed') === 'true');
  el.dispose = () => {};
  return el;
}
