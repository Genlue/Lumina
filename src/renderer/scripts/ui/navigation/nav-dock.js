// Golden Gate · navigation/nav-dock
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { mountGlassLens } from '../../core/glass-lens.js';
import { tip } from '../overlays/tooltip.js';

/**
 * 悬浮导航栏里的一颗圆钮。
 * 选中用 aria-current="page" —— 这是导航，不是列表多选；和面包屑同一个语义。
 */
export function NavDockItem({ icon: ic = '', label = '', selected = false, onClick, className = '' } = {}) {
  const el = h(
    'button',
    {
      class: `c-dock__item ${className}`.trim(),
      type: 'button',
      'aria-label': label || null,
      'aria-current': selected ? 'page' : null,
      dataset: { label },
      onclick: onClick,
    },
    ic ? h('span', { class: 'c-dock__ic', html: icon(ic, 18) }) : null
  );
  el.set = (on) => {
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  };
  return el;
}

/** 组间分隔：竖排时一根短横线，横排时一根短竖线（方向由 .c-dock[data-edge] 决定） */
export function NavDockSep() {
  return h('div', { class: 'c-dock__sep' });
}

/**
 * 悬浮导航栏 —— 侧边导航栏的另一种形态：一根浮在内容上的玻璃药丸，里面是圆钮。
 *
 * **它是液态玻璃，不是 acrylic。** 侧边导航栏贴着壁纸、长期占位，走系统磨砂；
 * 悬浮药丸是浮在内容上的临时层，走玻璃。两者不能互换。
 *
 * @param {'left'|'right'|'bottom'} edge 停靠边
 *
 *   NavDock({
 *     edge: 'left',
 *     children: [
 *       NavDockItem({ icon: 'house', label: '首页', selected: true, onClick }),
 *       NavDockItem({ icon: 'search', label: '搜索', onClick }),
 *       NavDockSep(),
 *       NavDockItem({ icon: 'sun', label: '外观', onClick }),
 *     ],
 *     foot: NavDockItem({ icon: 'rotate-ccw', label: '重做', onClick }),
 *   })
 */
export function NavDock({
  edge = 'left',
  children,
  foot = null,
  label = '导航栏',
  hidden = false,
  className = '',
  style = null,
} = {}) {
  const pill = h('div', { class: 'c-dock__pill' }, children);
  // 药丸是玻璃面：挂渲染层（页面没有壁纸时它自己让位，CSS 兜底继续生效）
  pill.__glassLens = mountGlassLens(pill, { surface: 'dock' });

  const el = h(
    'nav',
    {
      class: `c-dock ${className}`.trim(),
      'aria-label': label,
      dataset: { edge, hidden: hidden ? '1' : '0' },
      style,
    },
    pill,
    foot ? h('div', { class: 'c-dock__foot' }, foot) : null
  );

  // 悬浮显示按钮名。方向跟着停靠边走：贴左的往右长，贴底的往上长 ——
  // 否则提示会落到药丸外面，被窗口边裁掉。
  const items = [...el.querySelectorAll('.c-dock__item')];
  let tips = [];
  const wireTips = () => {
    tips.forEach((fn) => fn());
    const edgeNow = el.dataset.edge;
    const placement = edgeNow === 'left' ? 'right' : edgeNow === 'right' ? 'left' : 'top';
    tips = items
      .filter((it) => it.dataset.label)
      .map((it) => tip(it, it.dataset.label, { placement, delay: 240 }));
  };
  wireTips();

  el.pill = pill;
  el.items = items;
  /** 选中第 i 颗（只保留一个 aria-current="page"） */
  el.setSelected = (i) => {
    items.forEach((it, k) => it.set?.(k === i));
  };
  // 换停靠边要重接提示：方向是建的时候按边算死的，不重接会继续往旧方向长
  el.setEdge = (next) => {
    el.dataset.edge = next;
    wireTips();
  };
  el.setHidden = (on) => {
    el.dataset.hidden = on ? '1' : '0';
  };
  el.dispose = () => tips.forEach((fn) => fn());
  return el;
}
