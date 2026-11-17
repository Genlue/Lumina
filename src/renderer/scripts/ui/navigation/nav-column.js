// Golden Gate · navigation/nav-column
import { h } from '../../core/dom.js';

/* ==========================================================================
   18. 导航栏
   —— 导航栏不等于侧栏。这一组只负责「把导航项排成某种形态」，
      容器本身在 layout.css（.l-nav / .l-app 的变体）。
   ========================================================================== */

/**
 * 一整根导航栏（侧边形态）。头 / 可滚的中间 / 脚 三区，外加一层顶部渐进模糊。
 *
 * 材质是 **acrylic**（磨砂 + 提饱和 + 染色），不是液态玻璃 —— 没有折射、没有色散。
 * 所以导航栏里**不要开菜单**：菜单是 L2 玻璃，压在 acrylic 上会读成两种材质打架。
 */
export function NavColumn({
  head = null,
  children,
  foot = null,
  veil = true,
  label = '导航栏',
  className = '',
  style = null,
} = {}) {
  const body = h('div', { class: 'l-nav__body' }, children);
  const veilEl = veil ? h('div', { class: 'c-topveil c-topveil--nav', dataset: { on: '0' } }) : null;

  const el = h(
    'aside',
    {
      class: `l-nav c-acrylic ${className}`.trim(),
      'aria-label': label,
      style,
    },
    // 头部永远存在：它是红绿灯那一行的高度预留。没有内容时就是个空占位，
    // 少了它，滚动的第一项会钻到红绿灯底下。
    h('div', { class: 'l-nav__head' }, head),
    body,
    veilEl,
    foot ? h('div', { class: 'l-nav__foot' }, foot) : null
  );
  el.body = body;

  // 面纱只在真的滚上去时出现；静止时糊住第一行是 bug，不是效果
  if (veilEl) {
    const sync = () => {
      veilEl.dataset.on = body.scrollTop > 2 ? '1' : '0';
    };
    body.addEventListener('scroll', sync, { passive: true });
    el.dispose = () => body.removeEventListener('scroll', sync);
    requestAnimationFrame(sync);
  }

  return el;
}
