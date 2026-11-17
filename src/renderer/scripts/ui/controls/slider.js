// Golden Gate · controls/slider
import { h, clamp } from '../../core/dom.js';
import { springValue } from '../../core/spring.js';
import { mountRefraction } from '../../core/refraction.js';
import { mountGlassLens, disposeGlassTree } from '../../core/glass-lens.js';
import { theme } from '../../core/theme.js';
import { applyControlState } from '../_shared/control.js';

/* ==========================================================================
   4. 滑块
   ========================================================================== */

/**
 * 拇指的光学参数：第七个玻璃面，coating/coatingColor 与其它面一样遵循 theme。
 * CSS 白色遮罩只负责按压交互，不替代基础涂层。
 */
function thumbGlassParams() {
  return theme.getOptics('thumb');
}

export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value = 0,
  notched = false,
  marks = null,
  onInput,
  onChange,
  label = '',
  lens = true,
} = {}) {
  let current = clamp(value, min, max);
  // 位置是连续的（无极），取值才量化（有级）。两者分开，拇指才不会一格一格地跳。
  let pos = (current - min) / (max - min || 1);

  const fill = h('div', { class: 'c-slider__fill' });
  const track = h('div', { class: 'c-slider__track' }, fill);
  // 白色遮罩是拇指里独立的一层：按下只淡它，透镜本身留着
  const mask = h('div', { class: 'c-slider__mask' });
  const thumb = h('div', { class: 'c-slider__thumb' }, mask);

  // CSS 里的 url(#gg-refract) 需要这个滤镜真实存在，否则整条 backdrop-filter 失效。
  // 幂等，第一个滑块建出来时挂一次就够。
  mountRefraction();

  const el = h(
    'div',
    {
      class: `c-slider ${notched ? 'c-slider--notched' : ''}`.trim(),
      role: 'slider',
      tabindex: '0',
      'aria-label': label || null,
      'aria-valuemin': String(min),
      'aria-valuemax': String(max),
      'aria-valuenow': String(current),
    },
    track,
    thumb
  );

  // 渲染层：拇指的材质由 backdrop-filter + SVG 滤镜完成，背板就是它背后真实的轨道与进度条
  // —— 不用再手画一遍。不支持原生滤镜的浏览器（Safari）自动让位，CSS 那三层透镜接管。
  // lens: false 强制走 CSS —— 静态导出、截图对比用。
  const lensCtl = lens ? mountGlassLens(thumb, {
    shape: () => {
      const w = thumb.offsetWidth || 24;
      const h = thumb.offsetHeight || 16;
      return { w, h, radius: h / 2 };
    },
    surface: 'thumb',
    params: () => thumbGlassParams(),
  }) : null;

  if (lensCtl) thumb.__glassLens = lensCtl;

  let travel = 100;
  let disposed = false;
  let ro = null;
  let raf = 0;

  const paint = () => {
    if (disposed) return;
    el.style.setProperty('--p', String(pos));
    el.style.setProperty('--travel', `${travel}px`);
    // 折射只在「玻璃下面有分界线」时成立：两端没有可弯折的边缘，淡出
    el.style.setProperty('--rf', String(Math.min(1, pos * 12, (1 - pos) * 12)));
    el.setAttribute('aria-valuenow', String(current));
    // 拇指移动 = 它背后的东西变了（进度条的蓝边走到哪儿），纹理要重采
    lensCtl?.invalidate();
  };

  /** 量一次轨道宽度。不要只依赖 rAF——元素可能还没进 DOM，或者容器正在动画。 */
  const measure = () => {
    if (disposed) return;
    const w = track.clientWidth;
    if (w > 0) travel = w;
    paint();
  };

  const quantize = (v) => {
    const q = Math.round((v - min) / step) * step + min;
    return clamp(Number(q.toFixed(6)), min, max);
  };

  /** 拇指移到指针处（连续），同时把取值吸附到最近的档位（有级） */
  const moveTo = (clientX) => {
    if (disposed) return;
    const r = track.getBoundingClientRect();
    if (r.width > 0) travel = r.width; // 每次拖动都核对一次，避免宽度变化后错位
    pos = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
    const q = quantize(min + pos * (max - min));
    const changed = q !== current;
    current = q;
    paint();
    if (changed) onInput?.(current);
  };

  const setValue = (v) => {
    if (disposed) return;
    current = clamp(v, min, max);
    pos = (current - min) / (max - min || 1);
    measure();
  };

  // 按压缩放：阻尼 0.72 让它有一点回弹，像真的被捏了一下
  const press = springValue(1, {
    damping: 0.72,
    response: 0.26,
    onUpdate: (v) => {
      el.style.setProperty('--thumb-s', String(v));
      // transform 不触发 ResizeObserver，放大时得自己叫渲染层重画（采样范围跟着变大）
      lensCtl?.invalidate();
    },
  });

  let dragging = false;

  el.addEventListener('pointerdown', (e) => {
    if (disposed || e.button !== 0 || el.dataset.disabled) return;
    dragging = true;
    el.dataset.dragging = '1'; // 白色遮罩淡出的开关，见 .c-slider[data-dragging]
    try { el.setPointerCapture(e.pointerId); } catch {}
    press.to(2); // 按下立刻放大到两倍，不等松开
    moveTo(e.clientX);
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moveTo(e.clientX);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    delete el.dataset.dragging; // 松手 → 白色遮罩淡回 100%
    try { el.releasePointerCapture(e.pointerId); } catch {}
    // 这里动画的是缩放比例，不是位置：拖拽速度（px/s）不能直接当弹簧初速度，
    // 否则松手瞬间会被放大成几倍的过冲。缩回用临界阻尼即可。
    press.to(1, { damping: 0.9, response: 0.3 });
    onChange?.(current);
  };

  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  el.addEventListener('keydown', (e) => {
    const big = (max - min) / 10;
    let v = current;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v -= step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v += step;
    else if (e.key === 'PageDown') v -= big;
    else if (e.key === 'PageUp') v += big;
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else return;
    e.preventDefault();
    setValue(quantize(v));
    onInput?.(current);
    onChange?.(current);
  });

  measure(); // 同步量一次（此时可能还没挂载，挂载后由 ResizeObserver 补上）
  if (typeof ResizeObserver !== 'undefined') {
    // 持有引用，避免观察器被当成垃圾回收
    ro = new ResizeObserver(() => measure());
    ro.observe(track);
    el._ro = ro;
  }
  raf = requestAnimationFrame(() => {
    raf = 0;
    measure();
  });

  el.set = setValue;
  el.value = () => current;
  el.setDisabled = (v) => applyControlState(el, { disabled: v });
  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    dragging = false;
    delete el.dataset.dragging;
    ro?.disconnect();
    ro = null;
    cancelAnimationFrame(raf);
    raf = 0;
    press.stop();
    disposeGlassTree(el);
  };

  if (!marks) return el;

  // 刻度与外层轨道两端对齐：轨道左右各内缩半个拇指宽
  const inset = notched ? 18 : 14;
  const wrapper = h(
    'div',
    { class: 'l-stack l-stack--2', style: { width: '100%' } },
    el,
    h(
      'div',
      { class: 'c-notches', style: { margin: `0 ${inset}px` } },
      marks.map((m, i) => {
        const pct = marks.length === 1 ? 50 : (i / (marks.length - 1)) * 100;
        const align =
          i === 0 ? 'translateX(0)'
            : i === marks.length - 1 ? 'translateX(-100%)'
            : 'translateX(-50%)';
        return h('span', { style: { left: `${pct}%`, transform: align } }, m);
      })
    )
  );
  wrapper.input = el;
  wrapper.set = el.set;
  wrapper.value = el.value;
  wrapper.dispose = el.dispose;
  return wrapper;
}
