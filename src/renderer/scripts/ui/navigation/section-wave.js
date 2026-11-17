// Golden Gate · navigation/section-wave
import { h } from '../../core/dom.js';

/**
 * 页内波浪条：连续滚动长页的目录，挂在滚动容器右侧、滚动条左边。
 * 每个分区一根横条，当前那根最长；邻近的按高斯衰减一起放大，
 * 整条轨道总高不变 —— 放大的部分从其它分区那里挤出来，形成一道波。
 * 不占左侧栏：目录不该和「页面导航」抢同一块地方。
 *
 *   const wave = SectionWave({ onPick: (i) => goTo(i) });
 *   wave.setItems([{ label: '按钮' }, ...]);
 *   wave.setCurrent(2);
 *   wave.setEnabled(true);
 */
export function SectionWave({ onPick } = {}) {
  const track = h('div', { class: 'c-wave__track' });
  const el = h('div', { class: 'c-wave' }, track);

  const SIGMA = 1.7;   // 波形影响半径（以分区为单位）
  const AMP = 1.5;     // 当前那根相对基线的最大放大
  const BASE_W = 8;
  const MAX_W = 30;

  let current = 0;
  let slots = [];
  let disposed = false;

  const paint = () => {
    if (disposed) return;
    const n = slots.length;
    const H = track.clientHeight;
    if (!n || !H) return;

    // 高斯权重 → 每个分区占的纵向份额
    const mags = Array.from({ length: n }, (_, i) =>
      1 + AMP * Math.exp(-((i - current) ** 2) / (2 * SIGMA * SIGMA)));
    const unit = H / mags.reduce((a, b) => a + b, 0);

    slots.forEach((s, i) => {
      const t = (mags[i] - 1) / AMP;          // 0 = 基线，1 = 当前
      s.slot.style.height = `${(unit * mags[i]).toFixed(2)}px`;
      // 线宽走变量，按钮本身撑满整列当命中区
      s.bar.style.setProperty('--bar-w', `${(BASE_W + (MAX_W - BASE_W) * t).toFixed(1)}px`);
      s.slot.dataset.current = String(i === current);
    });
  };

  el.setItems = (items = []) => {
    slots = [];
    track.replaceChildren();
    // 条目少时别把整条边拉满：给每根留 ~34px，超出的高度交给外层居中
    track.style.maxHeight = `${items.length * 34}px`;
    items.forEach((it, i) => {
      const bar = h('button', {
        class: 'c-wave__bar',
        type: 'button',
        'aria-label': it.label,
        onclick: (e) => { e.stopPropagation(); onPick?.(i); },
      });
      const tip = h('span', { class: 'c-wave__tip' }, it.label);
      const slot = h('div', { class: 'c-wave__slot' }, bar, tip);
      slots.push({ slot, bar });
      track.append(slot);
    });
    current = 0;
    paint();
    requestAnimationFrame(paint);   // 刚挂载时 clientHeight 还是 0
  };

  el.setCurrent = (i) => {
    if (i === current || !slots[i]) return;
    current = i;
    paint();
  };

  el.setEnabled = (on) => {
    el.hidden = !on;
    if (on) requestAnimationFrame(paint);
  };

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paint()) : null;
  ro?.observe(track);

  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    ro?.disconnect();
    slots = [];
  };

  return el;
}
