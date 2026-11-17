// Golden Gate · navigation/toolbar
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { mountGlassLens } from '../../core/glass-lens.js';

/* ==========================================================================
   13. 工具栏
   ========================================================================== */

/**
 * 窗口顶栏。
 *
 * `chrome` 是红绿灯 + 导航栏开关那一组 —— **它是顶栏的第一个 flex 子项**，
 * 不是另挂一层绝对定位。这样顶栏的横向节奏只有一个 `--topbar-gap`：
 * 红绿灯 → 开关 → 标题组 → 胶囊组，每一段都一样宽；开关被隐藏时
 * （悬浮导航形态）后面的东西会自己往前挪，不会在原地留一个洞。
 *
 * @param {Node|Node[]} [o.chrome] 窗口控件（TrafficLights / 开关）
 * @param {Node|Node[]} [o.lead]   左侧标题组
 * @param {Node[]}      [o.pills]  右侧胶囊组
 */
export function Toolbar({ chrome = null, lead = null, pills = [] } = {}) {
  const chromeKids = (Array.isArray(chrome) ? chrome : [chrome]).filter(Boolean);
  return h(
    'div',
    { class: 'c-topbar', 'data-drag': '' },
    chromeKids.length
      ? h('div', { class: 'l-chrome', 'data-no-drag': '' }, chromeKids)
      : null,
    h('div', { class: 'c-topbar__lead', 'data-no-drag': '' }, lead),
    h('div', { class: 'c-topbar__pills', 'data-no-drag': '' }, pills)
  );
}

/** 一组控件共用的玻璃胶囊 */
export function Capsule({ children, text = false, round = false, className = '' } = {}) {
  // 只有一个按钮时可以做成正圆；两个以上仍然是最低"短胶囊"，不做球
  const kids = (Array.isArray(children) ? children : [children]).filter(Boolean);
  const circle = round && kids.length === 1;
  const cls = [
    'c-capsule',
    text && 'c-capsule--text',
    round && 'c-capsule--round',
    circle && 'c-capsule--circle',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const el = h('div', { class: cls }, children);
  // 胶囊是玻璃面：挂渲染层（页面没有壁纸时它自己让位，CSS 兜底继续生效）
  el.__glassLens = mountGlassLens(el, { surface: 'capsule' });
  return el;
}

/**
 * 前进 / 后退。一枚胶囊里两枚按钮，中间一竖线，没有选中块。
 * 到头的方向自动置灰（而不是隐藏），保证宽度不跳。
 */
export function NavPair({ canBack = true, canForward = false, onBack, onForward } = {}) {
  const mk = (iconName, label, enabled, fn) =>
    h('button', {
      class: 'c-navpair__btn',
      type: 'button',
      title: label,
      'aria-label': label,
      disabled: !enabled || null,
      html: icon(iconName, 15),
      onclick: fn,
    });

  return Capsule({
    className: 'c-capsule--nav',
    children: [
      mk('chevron-left', '后退', canBack, onBack),
      h('span', { class: 'c-navpair__sep' }),
      mk('chevron-right', '前进', canForward, onForward),
    ],
  });
}

/** 顶栏下方的渐进模糊层 */
export const TopVeil = () => h('div', { class: 'c-topveil' });

export function ToolbarTitle({ title, subtitle }) {
  return h(
    'div',
    { class: 'l-row l-row--3', style: { minWidth: 0 } },
    h('span', { class: 'c-title' }, title),
    subtitle ? h('span', { class: 'c-subtitle' }, subtitle) : null
  );
}
