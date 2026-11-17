// Golden Gate · navigation/nav-card
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { contrastOn } from '../_shared/contrast.js';

/**
 * 卡片模块 —— 导航栏里唯一允许「成块」的东西，作用只有一个：**跳转**。
 * 它不是换皮的列表分组；要分组仍然用 NavSection + NavItem。
 *
 * @param {'panel'|'solid'} variant
 *   panel  半透明容器，里面放若干跳转项（默认）
 *   solid  整卡实心，整块就是一个跳转目标
 * @param {'accent'|'neutral'} tone  solid 的底色取向
 * @param {string} color  solid 的自定义底色（任意 CSS 颜色，自动配前景色）
 */
export function NavCard({
  variant = 'panel',
  tone = 'accent',
  color = '',
  icon: ic = '',
  title = '',
  desc = '',
  children,
  onClick,
  className = '',
} = {}) {
  if (variant === 'solid') {
    const bg = color || (tone === 'neutral' ? 'var(--surface-card)' : 'var(--accent)');
    const fg = color
      ? contrastOn(color)
      : tone === 'neutral'
        ? 'var(--text-primary)'
        : 'var(--text-on-accent)';

    return h(
      'div',
      {
        class: `c-navcard c-navcard--solid ${className}`.trim(),
        role: 'button',
        tabindex: '0',
        style: { '--navcard-bg': bg, '--navcard-fg': fg },
        onclick: onClick,
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.(e);
          }
        },
      },
      h(
        'div',
        { class: 'c-navcard__row' },
        ic ? h('span', { class: 'c-navcard__icon', html: icon(ic, 13) }) : null,
        h('span', { class: 'c-navcard__title' }, title),
        h('span', { class: 'c-navcard__chev', html: icon('chevron-right', 12) })
      ),
      desc ? h('div', { class: 'c-navcard__desc' }, desc) : null
    );
  }

  return h(
    'div',
    { class: `c-navcard ${className}`.trim() },
    title ? h('div', { class: 'c-navcard__label' }, title) : null,
    children
  );
}
