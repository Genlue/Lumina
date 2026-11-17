// Golden Gate · navigation/nav-item
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

/* ==========================================================================
   9. 侧栏导航
   ========================================================================== */

/** 分类标题（个人收藏 / 位置）。必须放在 .c-nav 里，才能继承 --nav-indent 与图标对齐 */
export function NavSection({ label = '' } = {}) {
  return h('div', { class: 'c-nav__section', role: 'presentation' }, label);
}

export function NavItem({
  icon: ic,
  label,
  count = null,
  badge = null,
  selected = false,
  depth = 0,
  hasChildren = false,
  open = false,
  disabled = false,
  onClick,
  onToggle,
} = {}) {
  const item = h(
    'div',
    {
      class: 'c-nav__item',
      role: 'option',
      'aria-selected': String(selected),
      'aria-expanded': hasChildren ? String(open) : null,
      'aria-disabled': disabled ? 'true' : null,
      // 先给 0：单独使用时必须可达。放进 NavGroup 后由组的 roving tabindex
      // 收敛成「只有当前项在 Tab 序列里」，两项规则不冲突。
      tabindex: disabled ? null : '0',
      // 轨道形态下文字被视觉隐藏，标题就是唯一的可读入口
      title: label || null,
      // 缩进量与 .c-nav__section 共用 --nav-indent，分类标题才能和图标对齐。
      // 深度先乘成 px 再进 calc：calc 里的 `*` 不是所有浏览器都认。
      style: {
        paddingLeft: depth
          ? `calc(var(--nav-indent, 8px) + ${depth * 14}px)`
          : 'var(--nav-indent, 8px)',
      },
      onclick: (e) => {
        if (disabled) return;
        if (e.target.closest('.c-nav__twisty')) return;
        onClick?.(e);
      },
      onkeydown: (e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.(e);
          return;
        }
        // 有子项的导航：→ 展开、← 收起。没有子项时把方向键留给外层滚动。
        if (!hasChildren) return;
        if (e.key === 'ArrowRight' && !open) {
          e.preventDefault();
          onToggle?.(true);
        } else if (e.key === 'ArrowLeft' && open) {
          e.preventDefault();
          onToggle?.(false);
        }
      },
    },
    hasChildren
      ? h('span', {
          class: 'c-nav__twisty',
          dataset: { open: String(open) },
          html: icon('chevron-up', 11),
          style: { transform: open ? 'rotate(90deg)' : 'rotate(0deg)' },
          onclick: (e) => {
            e.stopPropagation();
            onToggle?.(!open);
          },
        })
      : depth > 0
        // 子项没有折叠箭头时补一个等宽占位，保证同层图标对齐
        ? h('span', { style: { width: '12px', marginLeft: '-2px', flex: 'none' } })
        : null,
    ic ? h('span', { class: 'c-nav__icon', html: icon(ic, 16) }) : null,
    h('span', { class: 'c-nav__label' }, label),
    badge !== null && badge !== undefined
      ? h('span', { class: 'c-nav__badge' }, badge)
      : count !== null && count !== undefined
        ? h('span', { class: 'c-nav__count' }, count)
        : null
  );
  return item;
}

/**
 * 一组导航项（列表）。分组靠 NavSection，成块靠 NavCard —— 这是两件事。
 *
 * 组内用 roving tabindex：整列只有一个 Tab 停靠点，方向键在项间移动。
 * 每一项都 tabindex=0 的话，29 项导航要按 29 次 Tab 才能穿过去。
 */
export function NavGroup({ children } = {}) {
  const el = h('div', { class: 'c-nav', role: 'listbox' }, children);

  const rows = () =>
    [...el.querySelectorAll('.c-nav__item')].filter(
      (row) => row.getAttribute('aria-disabled') !== 'true'
    );

  const sync = () => {
    const list = rows();
    if (!list.length) return;
    const active = list.find((row) => row.getAttribute('aria-selected') === 'true') ?? list[0];
    for (const row of list) row.tabIndex = row === active ? 0 : -1;
  };

  el.addEventListener('keydown', (e) => {
    const list = rows();
    const at = list.indexOf(document.activeElement);
    if (at < 0) return;

    let next = null;
    if (e.key === 'ArrowDown') next = list[(at + 1) % list.length];
    else if (e.key === 'ArrowUp') next = list[(at + list.length - 1) % list.length];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus({ preventScroll: true });
  });

  // 点选后应用会改 aria-selected；下一帧把 Tab 停靠点挪过去
  el.addEventListener('click', () => requestAnimationFrame(sync));
  requestAnimationFrame(sync);

  // 导航项常常是后挂进来的（分页、异步分类）。只监听 aria-selected 与子节点，
  // 不监听 tabindex —— 否则 sync 自己写的 tabindex 会再触发一轮。
  let mo = null;
  if (typeof MutationObserver !== 'undefined') {
    mo = new MutationObserver(() => sync());
    mo.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
  }

  el.syncFocus = sync;
  el.dispose = () => {
    mo?.disconnect();
    mo = null;
  };
  return el;
}
