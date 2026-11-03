// ============================================================
// Lumina · Component Kit
// 控件工厂。每个函数返回真实 DOM 节点，行为自带，样式全靠 components.css。
// 页面只允许拼装这些函数，不允许自造控件。
// ============================================================

import { h, clamp, onOutside } from '../core/dom.js';
import { icon, iconEl } from '../core/icons.js';
import { spring, springValue } from '../core/spring.js';
import { mountRefraction } from '../core/refraction.js';
import { mountGlassLens, disposeGlassTree } from '../core/glass-lens.js';
import { theme } from '../core/theme.js';

/**
 * 显式释放一棵组件子树，不根据 isConnected 猜测组件是否已经废弃。
 * 各组件的 dispose 必须幂等；这里包含 root 自身，且不移除 root 的 DOM。
 */
export function disposeComponentTree(root) {
  if (!root) return;
  const nodes = [root];
  if (typeof root.querySelectorAll === 'function') nodes.push(...root.querySelectorAll('*'));
  for (const node of nodes) {
    if (typeof node.dispose === 'function') node.dispose();
  }
  disposeGlassTree(root);
}

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
  const cls = [
    'c-iconbtn',
    variant && `c-iconbtn--${variant}`,
    size && `c-iconbtn--${size}`,
    active && 'c-iconbtn--on',
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

/* ==========================================================================
   2. 分段控件
   ========================================================================== */

export function Segmented({ options = [], value, onChange, size = '' } = {}) {
  const group = h('div', {
    class: `c-seg ${size === 'lg' ? 'c-seg--lg' : ''}`.trim(),
    role: 'radiogroup',
  });

  // 会滑动的选中块，而不是每个选项各自上色
  const ind = h('div', { class: 'c-seg__ind' });
  group.append(ind);

  let first = true;
  let disposed = false;
  let retryTimer = 0;
  let raf = 0;
  let ro = null;

  const place = (animate, retry = 4) => {
    if (disposed) return;
    clearTimeout(retryTimer);
    retryTimer = 0;
    const opt = group.querySelector(`.c-seg__opt[data-value="${group.dataset.value}"]`);
    if (!opt) return;
    const r = opt.getBoundingClientRect();

    // 元素可能还没挂载 / 还没排版，量到 0 就下一帧再试，别把滑块留在 width:0
    if (!r.width) {
      if (retry > 0) retryTimer = setTimeout(() => place(animate, retry - 1), 16);
      return;
    }

    // 参照系用分组自身的边框盒，而不是缓存的视口坐标 ——
    // 后者在页面滚动后就会失效，切换时会按滚动距离把滑块甩出去。
    const gr = group.getBoundingClientRect();
    const dx = Math.round((r.left - gr.left) * 100) / 100;
    const dy = Math.round((r.top - gr.top) * 100) / 100;

    const apply = () => {
      ind.style.transform = `translate(${dx}px, ${dy}px)`;
      ind.style.width = `${r.width}px`;
      ind.style.height = `${r.height}px`;
    };

    if (!animate || first) {
      first = false;
      // 首次定位不参与过渡：加临时类 + 强制一次回流
      ind.classList.add('is-static');
      apply();
      void ind.offsetWidth;
      ind.classList.remove('is-static');
      return;
    }
    apply();
  };

  const sync = (v) => {
    [...group.children].forEach((btn) => {
      if (btn === ind) return;
      const on = btn.dataset.value === v;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
  };

  for (const opt of options) {
    const btn = h(
      'button',
      {
        class: 'c-seg__opt',
        type: 'button',
        role: 'radio',
        dataset: { value: opt.value },
        title: opt.title || null,
        onclick: () => {
          if (group.dataset.value === opt.value) return;
          group.dataset.value = opt.value;
          sync(opt.value);
          place(true);
          onChange?.(opt.value);
        },
      },
      opt.icon ? iconEl(opt.icon, 14) : null,
      opt.label ? h('span', { class: 'c-seg__label' }, opt.label) : null
    );
    group.append(btn);
  }

  group.dataset.value = value ?? options[0]?.value;
  sync(group.dataset.value);

  // 键盘：左右方向键在选项间移动
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = [...group.querySelectorAll('.c-seg__opt')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.click();
    next.focus();
    e.preventDefault();
  });

  // 先同步摆一次（此时可能还没挂载，place 会自己重试），再交给 ResizeObserver 兜底
  place(false);
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => place(false));
    ro.observe(group);
    group._ro = ro;
  }
  raf = requestAnimationFrame(() => {
    raf = 0;
    place(false);
  });

  group.set = (v) => {
    group.dataset.value = v;
    sync(v);
    place(true);
  };
  group.dispose = () => {
    if (disposed) return;
    disposed = true;
    ro?.disconnect();
    clearTimeout(retryTimer);
    cancelAnimationFrame(raf);
  };
  return group;
}

/* ==========================================================================
   3. 开关
   ========================================================================== */

export function Switch({ checked = false, onChange, label = '' } = {}) {
  const knob = h('span', { class: 'c-switch__knob' });
  const el = h(
    'button',
    {
      class: 'c-switch',
      type: 'button',
      role: 'switch',
      'aria-checked': String(checked),
      'aria-label': label || null,
      onclick: () => {
        const next = el.getAttribute('aria-checked') !== 'true';
        el.setAttribute('aria-checked', String(next));
        onChange?.(next);
      },
    },
    knob
  );
  el.set = (v) => el.setAttribute('aria-checked', String(v));
  return el;
}

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
    if (disposed || e.button !== 0) return;
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

/* ==========================================================================
   5. 输入
   ========================================================================== */

export function Field({
  value = '',
  placeholder = '',
  icon: ic = '',
  type = 'text',
  onInput,
  onEnter,
  width = '',
} = {}) {
  const input = h('input', {
    class: 'c-field__input selectable',
    type,
    value,
    placeholder,
    oninput: (e) => onInput?.(e.target.value),
    onkeydown: (e) => {
      if (e.key === 'Enter') onEnter?.(e.target.value);
    },
  });
  const wrap = h(
    'div',
    { class: 'c-field', style: width ? { width } : null },
    ic ? h('span', { class: 'c-field__icon', html: icon(ic, 14) }) : null,
    input
  );
  wrap.input = input;
  return wrap;
}

export function SearchField({ placeholder = '搜索', value = '', onInput, width = 180 } = {}) {
  const input = h('input', {
    class: 'c-field__input selectable',
    type: 'text',
    value,
    placeholder,
    oninput: (e) => {
      clearBtn.style.display = e.target.value ? 'grid' : 'none';
      onInput?.(e.target.value);
    },
    onkeydown: (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        clearBtn.style.display = 'none';
        onInput?.('');
        input.blur();
      }
    },
  });

  const clearBtn = h('button', {
    class: 'c-iconbtn c-iconbtn--sm',
    type: 'button',
    'aria-label': '清除',
    style: { display: value ? 'grid' : 'none', color: 'var(--text-tertiary)' },
    onclick: () => {
      input.value = '';
      clearBtn.style.display = 'none';
      onInput?.('');
      input.focus();
    },
    html: icon('x-circle', 14),
  });

  const wrap = h(
    'div',
    { class: 'c-field c-search', style: { width } },
    h('span', { class: 'c-field__icon', html: icon('search', 14) }),
    input,
    clearBtn
  );
  wrap.input = input;
  wrap.set = (v) => {
    input.value = v;
    clearBtn.style.display = v ? 'grid' : 'none';
  };
  return wrap;
}

/* ==========================================================================
   6. 下拉选择
   ========================================================================== */

export function Select({ options = [], value, onChange, width = 'auto', label = '' } = {}) {
  const current = () => options.find((o) => o.value === value) || options[0] || {};

  const labelEl = h('span', { class: 'l-fill', style: { textAlign: 'left' } }, current().label || '');

  // 收起时箭头朝下，展开时转正朝上 —— 一眼能看出「现在能收起」
  const chev = iconEl('chevron-up', 12);
  chev.style.transform = 'rotate(180deg)';
  chev.style.opacity = '0.5';

  const setOpen = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    chev.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
  };

  const btn = h(
    'button',
    {
      class: 'c-btn',
      type: 'button',
      'aria-label': label || null,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      style: { width, justifyContent: 'space-between' },
      onclick: () => {
        // openMenu 自己会判「同一枚锚点已展开 → 收起」，返回 null 表示这一次是收起
        const opened = openMenu({
          anchor: btn,
          width: btn.getBoundingClientRect().width,
          onClose: () => setOpen(false),
          items: options.map((o) => ({
            label: o.label,
            checked: o.value === value,
            onClick: () => {
              value = o.value;
              labelEl.textContent = o.label;
              onChange?.(o.value);
            },
          })),
        });
        setOpen(!!opened);
      },
    },
    labelEl,
    chev
  );
  return btn;
}

/* ==========================================================================
   7. 复选
   ========================================================================== */

export function Checkbox({ checked = false, label = '', onChange } = {}) {
  let state = checked;
  const box = h('span', { class: 'c-check', 'aria-hidden': 'true' });

  const paint = () => {
    box.innerHTML = state ? icon('check', 11) : '';
    box.setAttribute('aria-checked', String(state));
  };

  const flip = () => {
    state = !state;
    paint();
    el.setAttribute('aria-checked', String(state));
    onChange?.(state);
  };

  // 整行是唯一热区：点框、点文字都只切换一次
  const el = h(
    'div',
    {
      class: 'c-check-row',
      role: 'checkbox',
      'aria-checked': String(state),
      'aria-label': label || null,
      tabindex: '0',
      onclick: flip,
      onkeydown: (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          flip();
        }
      },
    },
    box,
    label ? h('span', { style: { fontSize: 'var(--fs-13)' } }, label) : null
  );

  paint();
  el.set = (v) => {
    state = v;
    el.setAttribute('aria-checked', String(state));
    paint();
  };
  return el;
}

/* ==========================================================================
   8. 表面：卡片 / 行 / 分节
   ========================================================================== */

export function Card({ children, className = '' } = {}) {
  return h('section', { class: `c-card ${className}`.trim() }, children);
}

export function CardGroup({ title, children } = {}) {
  return h(
    'section',
    { class: 'l-stack l-stack--3' },
    title ? h('div', { class: 'c-section' }, title) : null,
    h('div', { class: 'c-card' }, children)
  );
}

export function Row({ label, hint, control, stack = false, onClick } = {}) {
  return h(
    'div',
    {
      class: `c-row ${stack ? 'c-row--stack' : ''} ${onClick ? 'c-row--interactive' : ''}`.trim(),
      onclick: onClick,
    },
    h(
      'div',
      { class: 'c-row__label' },
      label,
      hint ? h('span', { class: 'c-row__hint' }, hint) : null
    ),
    control ? h('div', { class: 'c-row__control' }, control) : null
  );
}

export function SectionTitle({ children }) {
  return h('div', { class: 'c-section' }, children);
}

export function Divider() {
  return h('div', { class: 'c-divider' });
}

/* ==========================================================================
   9. 侧栏导航
   ========================================================================== */

/** 分类标题（个人收藏 / 位置）。必须放在 .c-nav 里，才能继承 --nav-indent 与图标对齐 */
export function NavSection({ label = '' } = {}) {
  return h('div', { class: 'c-nav__section', role: 'presentation' }, label);
}

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

  const paint = () => {
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

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => paint()).observe(track);
  }

  return el;
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
  onClick,
  onToggle,
} = {}) {
  const item = h(
    'div',
    {
      class: 'c-nav__item',
      role: 'option',
      'aria-selected': String(selected),
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
        if (e.target.closest('.c-nav__twisty')) return;
        onClick?.(e);
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

/** 一组导航项（列表）。分组靠 NavSection，成块靠 NavCard —— 这是两件事。 */
export function NavGroup({ children } = {}) {
  return h('div', { class: 'c-nav', role: 'listbox' }, children);
}

/* ==========================================================================
   10. 缩略图
   —— 旧的 Thumb 实现已并入 MediaTile（第 19 节）。这里只留一个转发，
      保证老代码 `import { Thumb }` 还能跑。
   ========================================================================== */

/* ==========================================================================
   11. 徽标 / 胶囊
   ========================================================================== */

export function Badge({ label, variant = '', icon: ic = '' } = {}) {
  return h(
    'span',
    { class: `c-badge ${variant ? `c-badge--${variant}` : ''}`.trim() },
    ic ? iconEl(ic, 11) : null,
    label
  );
}

/* ==========================================================================
   12. 空状态 / 加载 / 进度
   ========================================================================== */

/** 空状态。默认图标是「空框」而不是「相册」—— 空列表、空搜索、空文件夹都用它 */
export function Empty({ icon: ic = 'square-dashed', title = '', desc = '', action = null } = {}) {
  return h(
    'div',
    { class: 'c-empty' },
    h('span', { class: 'c-empty__icon', html: icon(ic, 32) }),
    title ? h('div', { class: 'c-empty__title' }, title) : null,
    desc ? h('div', { class: 'c-empty__desc' }, desc) : null,
    action
  );
}

export const Spinner = () => h('span', { class: 'c-spinner' });

export function Progress({ value = 0 } = {}) {
  const bar = h('div', { class: 'c-progress__bar', style: { width: `${value}%` } });
  const el = h('div', { class: 'c-progress', role: 'progressbar' }, bar);
  el.set = (v) => {
    bar.style.width = `${clamp(v, 0, 100)}%`;
  };
  return el;
}

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

/* ==========================================================================
   14. 菜单
   ========================================================================== */

let activeMenu = null;

/**
 * 打开一个浮动菜单。
 * @param {object} o
 * @param {HTMLElement} [o.anchor] 锚点元素；给了就贴着它出现，否则用 x/y
 * @param {Array} o.items [{label, icon, key, checked, danger, disabled, onClick} | {sep:true}]
 * @param {number} [o.x]
 * @param {number} [o.y]
 * @param {(e:Event)=>void} [o.onClose]
 */
export function openMenu({ anchor, items = [], x, y, width, onClose } = {}) {
  // 同一枚锚点再点一次 = 收起。
  // 没有这一条时：pointerdown 先被 onOutside 判成「外部点击」把菜单关掉，
  // 紧接着 click 又把新菜单开出来 —— 看上去就是「点了一下，没收起，反而又展开一遍」。
  if (activeMenu && anchor && activeMenu._anchor === anchor) {
    closeMenu();
    return null;
  }

  // 菜单被外部从 DOM 上摘掉时 activeMenu 会变成悬空引用，别让下一枚锚点被误判成「已展开」
  if (activeMenu && !activeMenu.isConnected) activeMenu = null;

  closeMenu();

  const menu = h('div', { class: 'c-menu', role: 'menu' });

  const run = (it, e) => {
    if (it.disabled) return;
    closeMenu();
    e.stopPropagation();
    it.onClick?.(e);
  };

  for (const it of items) {
    if (it.sep) {
      menu.append(h('div', { class: 'c-menu__sep' }));
      continue;
    }
    if (it.header) {
      menu.append(h('div', { class: 'c-menu__header' }, it.header));
      continue;
    }
    menu.append(
      h(
        'div',
        {
          class: `c-menu__item ${it.danger ? 'c-menu__item--danger' : ''}`.trim(),
          role: 'menuitem',
          'aria-checked': it.checked !== undefined ? String(!!it.checked) : null,
          'aria-disabled': it.disabled ? 'true' : null,
          onclick: (e) => run(it, e),
        },
        it.checked !== undefined
          ? h('span', { class: 'c-menu__check', html: icon('check', 12) })
          : null,
        it.icon ? h('span', { style: { width: 14, display: 'grid' }, html: icon(it.icon, 14) }) : null,
        h('span', { class: 'c-menu__label' }, it.label),
        it.key ? h('span', { class: 'c-menu__key' }, it.key) : null
      )
    );
  }

  document.body.append(menu);
  // 菜单也是玻璃面：挂渲染层，参数取「菜单」那一套
  menu.__glassLens = mountGlassLens(menu, { surface: 'menu' });
  activeMenu = menu;
  menu._anchor = anchor || null; // 供「再点一次收起」判定

  // 指定宽度时与触发元素对齐（下拉选择要求菜单不比触发器宽）
  if (width) {
    menu.style.width = `${Math.round(width)}px`;
    menu.style.minWidth = '0';
  }

  // —— 定位：贴着锚点，越界就翻转 ——
  const pad = 8;
  let lastRect = null;

  const place = () => {
    const r = anchor ? anchor.getBoundingClientRect() : null;

    // 锚点被滚出视口：菜单没有存在的理由了
    if (r && (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth)) {
      closeMenu();
      return;
    }

    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let left = r ? r.left : x;
    let top = r ? r.bottom + 6 : y;

    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (left < pad) left = pad;
    if (top + h > window.innerHeight - pad) {
      top = r ? r.top - h - 6 : window.innerHeight - h - pad;
    }
    if (top < pad) top = pad;

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.setProperty('--origin', r ? 'top center' : 'top left');
    lastRect = r ? { top: r.top, left: r.left } : null;
  };

  menu._reposition = place; // 供外壳在自定义滚动容器里主动校正

  // 跟随锚点：三条机制同时挂，成本都可忽略
  // 1) 捕获阶段的 scroll —— 内层滚动容器也能收到（真实浏览器有效）
  // 2) resize —— 窗口尺寸变化
  // 3) 逐帧比对 —— 兜住布局抖动、以及某些环境不派发 scroll 的情况
  const onViewportChange = () => place();
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);

  let raf = 0;
  let enterSpring = null;
  const track = () => {
    const r = anchor ? anchor.getBoundingClientRect() : null;
    if (!r || !lastRect || Math.abs(r.top - lastRect.top) > 0.5 || Math.abs(r.left - lastRect.left) > 0.5) {
      place();
    }
    if (activeMenu === menu) raf = requestAnimationFrame(track);
  };
  if (anchor) raf = requestAnimationFrame(track);

  // —— 入场：材质浮现，不是单纯淡入 ——
  menu.style.transform = 'scale(0.96)';
  menu.style.opacity = '0';
  enterSpring = spring({
    from: 0,
    to: 1,
    damping: 1,
    response: 0.24,
    onUpdate: (t) => {
      menu.style.opacity = String(t);
      menu.style.transform = `scale(${0.96 + 0.04 * t})`;
    },
  });

  const off = onOutside(menu, (e) => {
    // 点在锚点上时先别收：那一下要留给触发器自己的 click 去做 toggle，
    // 否则就是「关掉 → 立刻重开」，一件事被拆成两步做。
    if (anchor && anchor.contains(e.target)) return;
    closeMenu();
  });
  let resourcesDisposed = false;
  menu._close = () => {
    if (resourcesDisposed) return;
    resourcesDisposed = true;
    off();
    cancelAnimationFrame(raf);
    raf = 0;
    enterSpring?.stop();
    enterSpring = null;
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
    onClose?.();
  };
  // 初次定位也可能因锚点在视口外而关闭，必须等清理钩子就位后再执行。
  place();
  return menu;
}

export function closeMenu() {
  if (!activeMenu) return;
  const m = activeMenu;
  activeMenu = null;
  m._close?.();

  let finished = false;
  let exitSpring = null;
  let fallbackTimer = 0;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(fallbackTimer);
    fallbackTimer = 0;
    exitSpring?.stop();
    exitSpring = null;
    disposeComponentTree(m);
    m.remove();
  };

  // 兜底：rAF 被节流（后台标签页、无头环境）时，退出动画不会推进，
  // 菜单必须仍然从 DOM 上消失，否则会留下一层不可见的浮层挡住点击。
  fallbackTimer = setTimeout(finish, 260);
  exitSpring = spring({
    from: 1,
    to: 0,
    damping: 1,
    response: 0.16,
    onUpdate: (v) => {
      m.style.opacity = String(v);
      m.style.transform = `scale(${0.96 + 0.04 * v})`;
    },
    onComplete: finish,
  });
  // reduced-motion 下 spring 会同步完成，此时不保留已经结束的句柄。
  if (finished) exitSpring = null;
}

/* ==========================================================================
   15. 浮层提示
   ========================================================================== */

let toastHost = null;

export function toast(message, { icon: ic = '', duration = 1900, tone = '' } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'c-toast-host' });
    document.body.append(toastHost);
  }

  const el = h(
    'div',
    { class: `c-toast ${tone ? `c-toast--${tone}` : ''}`.trim() },
    ic ? h('span', { html: icon(ic, 14) }) : null,
    message
  );
  el.style.opacity = '0';
  el.style.transform = 'translateY(8px) scale(0.96)';

  // 每条提示装在一个槽里：槽负责「被顶开」的位移，提示自己负责入场/退场，
  // 两套 transform 各管各的，不会互相覆盖。
  const slot = h('div', { class: 'c-toast-slot' }, el);
  // 提示条也是玻璃面（槽里才有尺寸，所以挂在这儿之后才量得到）
  el.__glassLens = mountGlassLens(el, { surface: 'toast' });

  // FLIP：先记录已有提示的位置，插入后再按差值补动画
  const before = snapshotToasts();
  toastHost.append(slot);
  flipToasts(before);

  let disposed = false;
  let exiting = false;
  let durationTimer = 0;
  let enterSpring = null;
  let exitSpring = null;

  const finish = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(durationTimer);
    durationTimer = 0;
    enterSpring?.stop();
    enterSpring = null;
    exitSpring?.stop();
    exitSpring = null;
    slot._flip?.stop();
    slot._flip = null;

    // 退场也要把「合拢」补上，否则下面的提示会瞬移
    const snap = snapshotToasts();
    disposeGlassTree(slot);
    slot.remove();
    flipToasts(snap);
  };

  const dismiss = () => {
    if (disposed || exiting) return;
    exiting = true;
    clearTimeout(durationTimer);
    durationTimer = 0;
    enterSpring?.stop();
    enterSpring = null;
    exitSpring = spring({
      from: 1,
      to: 0,
      damping: 1,
      response: 0.22,
      onUpdate: (t) => {
        el.style.opacity = String(t);
        el.style.transform = `translateY(${(1 - t) * 4}px) scale(${0.98 + 0.02 * t})`;
      },
      onComplete: finish,
    });
    if (disposed) exitSpring = null;
  };

  el.dispose = finish;
  enterSpring = spring({
    from: 0,
    to: 1,
    damping: 0.9,
    response: 0.32,
    onUpdate: (t) => {
      el.style.opacity = String(t);
      el.style.transform = `translateY(${(1 - t) * 8}px) scale(${0.96 + 0.04 * t})`;
    },
  });

  durationTimer = setTimeout(dismiss, duration);
  return el;
}

/* ---------------- 提示条的位移接力 ---------------- */

/** 记录当前所有槽的纵向位置 */
function snapshotToasts() {
  return new Map([...toastHost.children].map((s) => [s, s.getBoundingClientRect().top]));
}

/**
 * 用 FLIP 把「被顶开 / 合拢」的那一下补成动画。
 * 因为矩形是在 transform 生效后量的，中途被再次打断也能无缝接着走。
 */
function flipToasts(snapshot) {
  for (const [slot, y0] of snapshot) {
    if (!slot.isConnected) continue;
    const dy = y0 - slot.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.5) continue;

    slot._flip?.stop();
    slot.style.transform = `translateY(${dy}px)`;
    slot._flip = spring({
      from: dy,
      to: 0,
      damping: 1,
      response: 0.34,
      onUpdate: (v) => {
        slot.style.transform = `translateY(${v}px)`;
      },
      onComplete: () => {
        slot.style.transform = '';
      },
    });
  }
}

/* ==========================================================================
   16. 强调色预设
   —— macOS 27 的系统强调色盘
   ========================================================================== */

export const ACCENT_PRESETS = [
  { id: 'blue', label: '蓝色', value: '#0a84ff' },
  { id: 'purple', label: '紫色', value: '#bf5af2' },
  { id: 'pink', label: '粉色', value: '#ff375f' },
  { id: 'red', label: '红色', value: '#ff453a' },
  { id: 'orange', label: '橙色', value: '#ff9f0a' },
  { id: 'yellow', label: '黄色', value: '#ffd60a' },
  { id: 'green', label: '绿色', value: '#30d158' },
  { id: 'graphite', label: '石墨', value: '#8e8e93' },
];

/**
 * 强调色圆点选择器。
 * @param {object} o
 * @param {string} [o.value] 当前色值（小写十六进制）
 * @param {(hex:string)=>void} [o.onChange]
 * @param {boolean} [o.allowCustom=true] 末尾追加一个自定义色盘
 */
export function Swatches({ value = '', onChange, allowCustom = true, multi = false } = {}) {
  const norm = (s) => String(s || '').toLowerCase();

  const row = h('div', { class: 'c-swatches', role: 'radiogroup' });
  let current = norm(value);

  const select = (hex, silent = false) => {
    current = norm(hex);
    [...row.children].forEach((el) => {
      const v = el.dataset.value ? norm(el.dataset.value) : '';
      el.setAttribute('aria-checked', String(v === current));
    });
    if (!silent) onChange?.(hex);
  };

  const dot = (opts) =>
    h(
      'button',
      {
        class: `c-swatch ${opts.cls || ''}`.trim(),
        type: 'button',
        role: 'radio',
        'aria-checked': String(norm(opts.value) === current),
        'aria-label': opts.label,
        title: opts.label,
        dataset: opts.value ? { value: opts.value } : {},
        style: opts.style || null,
        onclick: opts.onClick,
      },
      opts.child || null
    );

  for (const p of ACCENT_PRESETS) {
    row.append(
      dot({
        value: p.value,
        label: p.label,
        style: { '--sw': p.value },
        onClick: () => select(p.value),
      })
    );
  }

  if (multi) {
    row.append(
      dot({
        label: '多彩',
        cls: 'c-swatch--multi',
        onClick: () => select('multi'),
      })
    );
  }

  if (allowCustom) {
    const picker = h('input', {
      type: 'color',
      value: current.startsWith('#') ? current : '#0a84ff',
      style: { position: 'absolute', opacity: '0', width: '0', height: '0', pointerEvents: 'none' },
      oninput: (e) => select(e.target.value),
    });
    row.append(
      dot({
        label: '自定义强调色',
        cls: 'c-swatch--custom',
        child: h('span', { html: icon('plus', 12) }),
        onClick: () => picker.click(),
      }),
      picker
    );
  }

  row.set = (hex) => select(hex, true);
  row.value = () => current;
  return row;
}

/* ==========================================================================
   17. 红绿灯
   几何与配色取自 aw3r1se/macOS-traffic-lights（macOS 26 实测）：
   28 单位栅格里画 14pt 圆，外圈 r=14 深一档作描边，内圈 r=13 是本体。
   ========================================================================== */

const TL_GLYPH = {
  close:
    '<path d="M9 9l10 10M19 9L9 19" fill="none" stroke="currentColor" ' +
    'stroke-width="4.5" stroke-linecap="round"/>',
  min:
    '<path d="M8 14h12" fill="none" stroke="currentColor" ' +
    'stroke-width="4" stroke-linecap="round"/>',
  zoom: '<path d="M8 8h10L8 18zM20 20H10l10-10z" fill="currentColor"/>',
};

function tlSvg(mod, withBusy = false) {
  return (
    '<svg class="c-traffic__svg" viewBox="0 0 28 28" aria-hidden="true">' +
    // 外圈是「描边环」，不是压在下面的实心圆：实心圆会被 body 半透明时透出来，
    // 失焦那套 alpha 灰就会叠成两倍深。r=13.5 + stroke 1 与原来 14/13 的环完全同形。
    '<circle class="c-traffic__rim" cx="14" cy="14" r="13.5"/>' +
    '<circle class="c-traffic__body" cx="14" cy="14" r="13"/>' +
    (withBusy ? '<circle class="c-traffic__dot" cx="14" cy="14" r="5"/>' : '') +
    `<g class="c-traffic__glyph">${TL_GLYPH[mod]}</g>` +
    '</svg>'
  );
}

/**
 * 窗口红绿灯。
 * @param {object} o
 * @param {boolean} [o.focused=true] 失焦时三灯统一深灰且不出图形
 * @param {boolean} [o.maximized=false] 仅用于语义记录（macOS 两态同形）
 * @param {boolean} [o.dirty=false] 有未保存修改时红灯中心显示圆点
 * @param {boolean} [o.reveal=false] 规范展示用：强制显示图形
 * @param {Function} [o.onClose]
 * @param {Function} [o.onMinimize]
 * @param {Function} [o.onZoom]
 */
export function TrafficLights({
  focused = true,
  maximized = false,
  dirty = false,
  reveal = false,
  active = false,
  onClose,
  onMinimize,
  onZoom,
} = {}) {
  let maxed = maximized;

  const mkLight = (mod, title, label, busy = false) =>
    h('button', {
      class: `c-traffic__light c-traffic__light--${mod}`,
      type: 'button',
      title,
      'aria-label': label,
      dataset: active ? { active: '1' } : {},
      html: tlSvg(mod, busy),
    });

  const closeBtn = mkLight('close', '关闭', '关闭窗口', dirty);
  closeBtn.addEventListener('click', () => onClose?.());

  const minBtn = mkLight('min', '最小化', '最小化窗口');
  minBtn.addEventListener('click', () => onMinimize?.());

  const zoomBtn = mkLight('zoom', '最大化', '最大化窗口');
  zoomBtn.addEventListener('click', () => onZoom?.());

  const el = h(
    'div',
    {
      class: 'c-traffic',
      // 契约是 0/1，不是布尔字符串：CSS 写的是 [data-focused="0"]。
      // 用 String(focused) 会得到 "true"/"false"，选择器永远不命中，失焦态静默失效。
      'data-focused': focused ? '1' : '0',
      'data-dirty': dirty ? '1' : null,
      'data-reveal': reveal ? '1' : null,
    },
    closeBtn,
    minBtn,
    zoomBtn
  );

  el.setFocused = (v) => el.setAttribute('data-focused', (focused = v) ? '1' : '0');
  el.setDirty = (v) => el.setAttribute('data-dirty', v ? '1' : null);
  el.setMaximized = (v) => {
    maxed = v; // macOS 两个方向同形，这里只记录状态
  };
  return el;
}

/**
 * 标记「导航栏正在开合」。
 *
 * 导航栏是覆盖层：开合的那 380ms 会压在内容上。系统 Acrylic 模糊的是窗口
 * **背后**的桌面，不是 webview 里的内容 —— 不补一层，内容会原样透出来，
 * 和底下的桌面模糊叠成双重曝光。样式在 layout.css 的「覆盖期材质」。
 *
 * 用法：toggle 里先调它，再切 `l-app--nav-hidden`。两个动作在同一帧，
 * 不会漏掉第一帧。
 *
 * @param {HTMLElement} app `.l-app`
 * @param {number} [duration] 覆盖动画时长；不传就读 `--nav-dur`
 * @returns {number} 实际保持的毫秒数
 */
const navMoveTimers = new WeakMap();

export function markNavMoving(app, duration) {
  if (!app) return 0;
  const raw = getComputedStyle(app).getPropertyValue('--nav-dur').trim();
  const ms = duration || parseFloat(raw) || 380;
  const hold = ms + 80;

  app.classList.add('l-app--nav-moving');
  clearTimeout(navMoveTimers.get(app));
  navMoveTimers.set(
    app,
    setTimeout(() => {
      app.classList.remove('l-app--nav-moving');
      navMoveTimers.delete(app);
    }, hold)
  );
  return hold;
}

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

/** 给自定义底色配前景：只解析 #RGB / #RRGGBB，其它颜色交回 --text-on-accent */
function contrastOn(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return 'var(--text-on-accent)';
  let hx = m[1];
  if (hx.length === 3) hx = hx.split('').map((c) => c + c).join('');
  const n = parseInt(hx, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.55 ? 'var(--text-primary)' : 'var(--text-on-accent)';
}

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

/**
 * 信息模块 —— 导航栏顶部的「我是谁 / 这是哪个应用」。
 * 系统设置里那一行 Apple 账户就是这个：头像 + 名称 + 副标题，整行一个跳转目标。
 *
 * 三种媒介，共用同一个 36px 的盒子，所以文字起点永远一致：
 *   avatar  圆形头像（账户）
 *   icon    圆角方形应用图标（某个应用的设置页）
 *   stack   重叠头像组（家人共享 / 协作者）
 *
 *   NavInfo({ avatar: 'me.jpg', title: '小 Q', subtitle: 'Apple 账户', onClick })
 *   NavInfo({ icon: 'sliders', iconBg: '#5b8def', title: '参数', subtitle: '应用设置' })
 *   NavInfo({ stack: ['a.jpg', 'b.jpg', 'c.jpg'], title: '家人共享' })
 */
export function NavInfo({
  avatar = '',
  icon: ic = '',
  iconSrc = '',
  iconBg = '',
  stack = [],
  title = '',
  subtitle = '',
  onClick,
  className = '',
} = {}) {
  let media;
  if (stack.length) {
    media = h(
      'span',
      { class: 'c-navinfo__media c-navinfo__media--stack' },
      stack.slice(0, 3).map((src) => h('img', { class: 'c-navinfo__face', src, alt: '', draggable: 'false' }))
    );
  } else if (iconSrc) {
    // 应用图标（图片）：软件自己有 .ico / .png 时不要再拿字形拼一个假的。
    // 媒介盒换成方形圆角，与 icon 模式的 .c-navinfo__app 同一个比例。
    media = h(
      'span',
      { class: 'c-navinfo__media c-navinfo__media--app' },
      h('img', { class: 'c-navinfo__appimg', src: iconSrc, alt: '', draggable: 'false' })
    );
  } else if (ic) {
    media = h(
      'span',
      { class: 'c-navinfo__media' },
      h('span', {
        class: 'c-navinfo__app',
        style: iconBg ? { '--navinfo-app-bg': iconBg, '--navinfo-app-fg': contrastOn(iconBg) } : null,
        html: icon(ic, 18),
      })
    );
  } else {
    media = h(
      'span',
      { class: 'c-navinfo__media' },
      avatar
        ? h('img', { src: avatar, alt: '', draggable: 'false' })
        : initials(title)
    );
  }

  const el = h(
    'div',
    {
      class: `c-navinfo ${onClick ? 'c-navinfo--interactive' : ''} ${className}`.trim(),
      role: onClick ? 'button' : null,
      tabindex: onClick ? '0' : null,
      onclick: onClick,
      onkeydown: onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick(e);
            }
          }
        : null,
    },
    media,
    h(
      'span',
      { class: 'c-navinfo__body' },
      h('span', { class: 'c-navinfo__title' }, title),
      subtitle ? h('span', { class: 'c-navinfo__sub' }, subtitle) : null
    )
  );
  return el;
}

/**
 * 搜索模块（可选）—— 全局搜索的入口，只负责「找到并跳过去」。
 * 结果**内联展开**在导航栏里，不做浮层：导航栏上禁止开菜单。
 *
 *   NavSearch({
 *     placeholder: '搜索全部内容',
 *     search: (q) => [{ label: '滑块', hint: '控件陈列', onPick: () => go() }],
 *   })
 */
export function NavSearch({ placeholder = '搜索', search, onPick, className = '' } = {}) {
  const listHost = h('div', { class: 'c-navsearch__results', hidden: true });

  const paint = (q) => {
    const query = q.trim();
    listHost.replaceChildren();
    if (!query) {
      listHost.hidden = true;
      return;
    }
    const items = search?.(query) ?? [];
    listHost.hidden = false;
    if (!items.length) {
      listHost.append(h('div', { class: 'c-navsearch__empty' }, '没有匹配项'));
      return;
    }
    for (const it of items) {
      const pick = () => {
        onPick?.(it);
        field.set('');
        listHost.hidden = true;
      };
      listHost.append(
        h(
          'div',
          {
            class: 'c-navsearch__result',
            role: 'option',
            tabindex: '0',
            onclick: pick,
            onkeydown: (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                pick();
              }
            },
          },
          h('span', { class: 'l-fill' }, it.label),
          it.hint ? h('span', { class: 'c-navsearch__hint' }, it.hint) : null
        )
      );
    }
  };

  const field = Field({
    placeholder,
    icon: 'search',
    width: '100%',
    onInput: paint,
  });

  const el = h('div', { class: `c-navsearch ${className}`.trim() }, field, listHost);
  el.input = field.input;
  el.clear = () => {
    field.set('');
    listHost.hidden = true;
  };
  return el;
}

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

/**
 * 内容卡：上面一块媒体，下面两行文字。网格浏览的通用单位 ——
 * 应用列表、文件、模板、专辑，都长这样。
 *
 *   Tile({ media: { src }, title: '设计稿', subtitle: '昨天' })
 *   Tile({ media: { icon: 'folder' }, title: '项目' })
 */
export function Tile({ media = {}, title = '', subtitle = '', selected = false, onClick, onDouble, className = '' } = {}) {
  const box = h('div', { class: 'c-tile__media' });
  if (media.src) box.append(h('img', { src: media.src, alt: media.alt || '', draggable: 'false' }));
  else if (media.icon) box.append(iconEl(media.icon, media.iconSize || 28));
  if (media.badge) box.append(h('span', { class: 'c-tile__badge' }, media.badge));

  return h(
    'div',
    {
      class: `c-tile ${className}`.trim(),
      role: 'option',
      'aria-selected': String(selected),
      onclick: onClick,
      ondblclick: onDouble,
    },
    box,
    title || subtitle
      ? h(
          'div',
          { class: 'c-tile__caption' },
          title ? h('div', { class: 'c-tile__title' }, title) : null,
          subtitle ? h('div', { class: 'c-tile__subtitle' }, subtitle) : null
        )
      : null
  );
}

/* ==========================================================================
   20. 列表
   —— 桌面应用里出现频率最高的控件。以前这套库只有「照片格子」，
      于是任何非相册的页面都得手写列表 —— 这是最大的泛化缺口。
   ========================================================================== */

/**
 * @param {object} o
 * @param {''|'inset'|'flush'} [o.variant] inset = 圆角卡里的分组列表
 */
export function List({ children, variant = '', className = '' } = {}) {
  return h(
    'div',
    {
      class: `c-list ${variant ? `c-list--${variant}` : ''} ${className}`.trim(),
      role: 'listbox',
      'aria-label': '列表',
    },
    children
  );
}

/**
 * 一行。
 * leading 优先级：media（自定义节点）> avatar > icon。
 * 有 onClick 才变成可交互行，否则就是纯展示 —— 不给没有行为的东西加 hover。
 */
export function ListRow({
  icon: ic = '',
  avatar = null,
  media = null,
  title = '',
  subtitle = '',
  meta = '',
  trailing = null,
  chevron = false,
  selected = false,
  onClick,
  className = '',
} = {}) {
  const leading = media
    ? h('div', { class: 'c-list__leading' }, media)
    : avatar
      ? avatar
      : ic
        ? h('div', { class: 'c-list__leading' }, h('span', { class: 'c-list__icon', html: icon(ic, 16) }))
        : null;

  return h(
    'div',
    {
      class: `c-list__row ${onClick ? 'c-list__row--interactive' : ''} ${className}`.trim(),
      role: 'option',
      'aria-selected': String(selected),
      tabindex: onClick ? '0' : null,
      onclick: onClick,
      onkeydown: onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick(e);
            }
          }
        : null,
    },
    leading,
    h(
      'div',
      { class: 'c-list__body' },
      h('div', { class: 'c-list__title' }, title),
      subtitle ? h('div', { class: 'c-list__subtitle' }, subtitle) : null
    ),
    meta ? h('div', { class: 'c-list__meta' }, meta) : null,
    trailing || chevron
      ? h(
          'div',
          { class: 'c-list__trailing' },
          trailing,
          chevron ? iconEl('chevron-right', 13) : null
        )
      : null
  );
}

/** 列表里的分组小标题 */
export const ListHeader = (label) => h('div', { class: 'c-list__header', role: 'presentation' }, label);

/* ==========================================================================
   21. 数据表
   ========================================================================== */

/**
 * @param {object} o
 * @param {Array<{key:string,label:string,width?:string,align?:'left'|'right',sortable?:boolean,render?:(row)=>Node|string}>} o.columns
 * @param {Array<object>} o.rows
 * @param {{key:string, dir:'asc'|'desc'}|null} [o.sort]
 * @param {(sort:object)=>void} [o.onSort]
 */
export function Table({
  columns = [],
  rows = [],
  sort = null,
  onSort,
  rowKey = (row, i) => row.id ?? i,
  selectedKey = null,
  onSelect,
  dense = false,
  className = '',
} = {}) {
  const head = h('tr');
  for (const c of columns) {
    const sorted = sort && sort.key === c.key ? sort.dir : null;
    const label = h(
      'span',
      null,
      c.label,
      c.sortable ? iconEl('chevron-down', 11) : null
    );
    const th = h(
      'th',
      {
        style: { width: c.width || null, textAlign: c.align || null },
        'aria-sort': sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : null,
      },
      c.sortable
        ? h(
            'button',
            {
              class: 'c-table__sort',
              type: 'button',
              onclick: () =>
                onSort?.({
                  key: c.key,
                  dir: sorted === 'asc' ? 'desc' : 'asc',
                }),
            },
            c.label,
            iconEl(sorted === 'asc' ? 'chevron-up' : 'chevron-down', 11)
          )
        : label
    );
    head.append(th);
  }

  const body = h('tbody');
  rows.forEach((row, i) => {
    const key = rowKey(row, i);
    const tr = h('tr', {
      'aria-selected': selectedKey === null ? null : String(String(selectedKey) === String(key)),
      onclick: onSelect ? () => onSelect(row, i) : null,
    });
    for (const c of columns) {
      const raw = c.render ? c.render(row) : row[c.key];
      const td = h('td', { class: c.align === 'right' ? 'c-table__num' : '' });
      if (raw instanceof Node) td.append(raw);
      else td.textContent = raw ?? '';
      tr.append(td);
    }
    body.append(tr);
  });

  return h(
    'table',
    { class: `c-table ${dense ? 'c-table--dense' : ''} ${className}`.trim() },
    h('thead', null, head),
    body
  );
}

/* ==========================================================================
   22. 页签
   ========================================================================== */

/**
 * 页签栏。指示条位置由 JS 实测写入，和分段控件同一套做法。
 * @param {Array<{value:string,label?:string,icon?:string}>} o.tabs
 */
export function Tabs({ tabs = [], value, onChange, closable = false, onClose, className = '' } = {}) {
  // 页签是「文档页签」：一条轨道 + 抬起来的那一颗。没有滑动指示条 ——
  // 指示条是 web 的做法，macOS 靠「抬起 / 落下」表达选中。
  const scroller = h('div', { class: 'c-tabs__scroll' });
  const el = h('div', { class: `c-tabs ${className}`.trim(), role: 'tablist' }, scroller);

  let current = value ?? tabs[0]?.value;

  const sync = () => {
    for (const btn of scroller.querySelectorAll('.c-tabs__tab')) {
      const on = btn.dataset.value === current;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
  };

  for (const t of tabs) {
    const btn = h(
      'button',
      {
        class: 'c-tabs__tab',
        type: 'button',
        role: 'tab',
        dataset: { value: t.value },
        onclick: () => {
          if (current === t.value) return;
          current = t.value;
          sync();
          onChange?.(t.value);
        },
      },
      t.icon ? iconEl(t.icon, 13) : null,
      t.label ? h('span', null, t.label) : null,
      closable
        ? h('span', {
            class: 'c-tabs__close',
            html: icon('x', 9),
            onclick: (e) => {
              e.stopPropagation();
              onClose?.(t.value);
            },
          })
        : null
    );
    scroller.append(btn);
  }

  sync();

  // 左右方向键在页签间移动
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = [...scroller.querySelectorAll('.c-tabs__tab')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.click();
    next.focus();
    e.preventDefault();
  });

  el.set = (v) => {
    current = v;
    sync();
  };
  el.value = () => current;
  return el;
}

/* ==========================================================================
   23. 单选组
   ========================================================================== */

export function RadioGroup({ options = [], value, onChange, inline = false, name = '' } = {}) {
  const el = h('div', {
    class: `c-radio-group ${inline ? 'c-radio-group--inline' : ''}`.trim(),
    role: 'radiogroup',
  });

  let current = value ?? options[0]?.value;

  const sync = () => {
    for (const row of el.children) {
      const on = row.dataset.value === current;
      row.setAttribute('aria-checked', String(on));
      row.tabIndex = on ? 0 : -1;
    }
  };

  for (const o of options) {
    const row = h(
      'div',
      {
        class: 'c-radio-row',
        role: 'radio',
        dataset: { value: o.value },
        onclick: () => {
          if (current === o.value) return;
          current = o.value;
          sync();
          onChange?.(o.value);
        },
      },
      h('span', { class: 'c-radio', 'aria-hidden': 'true' }),
      h('span', { style: { fontSize: 'var(--fs-13)' } }, o.label)
    );
    el.append(row);
  }

  sync();

  el.addEventListener('keydown', (e) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
    if (!keys.includes(e.key)) return;
    const list = [...el.children];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const next = list[(i + (fwd ? 1 : list.length - 1)) % list.length];
    next.click();
    next.focus();
    e.preventDefault();
  });

  el.set = (v) => {
    current = v;
    sync();
  };
  el.value = () => current;
  return el;
}

/* ==========================================================================
   24. 多行输入 / 步进器
   ========================================================================== */

export function TextArea({ value = '', placeholder = '', rows = 4, onInput, onEnter, label = '' } = {}) {
  const ta = h('textarea', {
    class: 'c-textarea selectable',
    rows,
    placeholder,
    'aria-label': label || null,
    oninput: (e) => onInput?.(e.target.value),
    onkeydown: (e) => {
      // ⌘/Ctrl + Enter 提交；单独 Enter 是换行，别抢
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onEnter?.(e.target.value);
    },
  });
  ta.value = value;
  const wrap = h('div', null, ta);
  wrap.input = ta;
  wrap.set = (v) => {
    ta.value = v;
  };
  wrap.value = () => ta.value;
  return wrap;
}

export function Stepper({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  orientation = 'vertical', // 'vertical'（NSStepper）| 'horizontal'（工具栏 − 值 +）
  label = '',
} = {}) {
  let current = clamp(value, min, max);
  const vertical = orientation !== 'horizontal';

  const dec = h('button', {
    class: 'c-stepper__btn',
    type: 'button',
    'aria-label': '减少',
    html: icon(vertical ? 'chevron-down' : 'minus', vertical ? 10 : 12),
  });
  const inc = h('button', {
    class: 'c-stepper__btn',
    type: 'button',
    'aria-label': '增加',
    html: icon(vertical ? 'chevron-up' : 'plus', vertical ? 10 : 12),
  });
  const out = vertical ? null : h('span', { class: 'c-stepper__value' }, String(current));

  const paint = () => {
    if (out) out.textContent = String(current);
    inc.disabled = current >= max;
    dec.disabled = current <= min;
  };

  const bump = (d) => {
    const next = clamp(Number((current + d * step).toFixed(6)), min, max);
    if (next === current) return;
    current = next;
    paint();
    onChange?.(current);
  };

  dec.addEventListener('click', () => bump(-1));
  inc.addEventListener('click', () => bump(1));

  // 竖排是「增在上、减在下」（NSStepper）；横排是「减 值 增」
  const el = h(
    'div',
    {
      class: `c-stepper ${vertical ? '' : 'c-stepper--h'}`.trim(),
      role: 'group',
      'aria-label': label || null,
    },
    vertical ? inc : dec,
    vertical ? dec : out,
    vertical ? null : inc
  );

  paint();
  el.set = (v) => {
    current = clamp(v, min, max);
    paint();
  };
  el.value = () => current;
  return el;
}

/* ==========================================================================
   25. 头像
   ========================================================================== */

/** 中文取首字，西文取首字母缩写 */
function initials(name = '') {
  const s = String(name).trim();
  if (!s) return '';
  if (/[\u3400-\u9fff]/.test(s)) return s.slice(0, 1);
  return s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

export function Avatar({ src = '', name = '', size = '', square = false, status = '', className = '' } = {}) {
  const el = h(
    'span',
    {
      class: [
        'c-avatar',
        size && `c-avatar--${size}`,
        square && 'c-avatar--square',
        className,
      ]
        .filter(Boolean)
        .join(' '),
      title: name || null,
      'aria-label': name || null,
    },
    src ? h('img', { src, alt: name || '', draggable: 'false' }) : initials(name)
  );
  if (status) el.append(h('span', { class: `c-avatar__status ${status !== 'online' ? `c-avatar__status--${status}` : ''}`.trim() }));
  return el;
}

/* ==========================================================================
   26. 标签片
   ========================================================================== */

export function Chip({ label = '', icon: ic = '', selected = false, removable = false, onClick, onRemove, size = '' } = {}) {
  const el = h(
    'div',
    {
      class: `c-chip ${size ? `c-chip--${size}` : ''} ${onClick ? 'c-chip--interactive' : ''}`.trim(),
      role: onClick ? 'button' : null,
      'aria-selected': onClick ? String(selected) : null,
      tabindex: onClick ? '0' : null,
      onclick: onClick,
      onkeydown: onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick(e);
            }
          }
        : null,
    },
    ic ? iconEl(ic, 12) : null,
    label,
    removable
      ? h('span', {
          class: 'c-chip__x',
          html: icon('x', 9),
          onclick: (e) => {
            e.stopPropagation();
            onRemove?.();
          },
        })
      : null
  );
  el.set = (v) => el.setAttribute('aria-selected', String(v));
  return el;
}

/* ==========================================================================
   27. 折叠区
   ========================================================================== */

export function Disclosure({ title, children, open = false, hint = '', onToggle } = {}) {
  const chev = h('span', { class: 'c-disclosure__chev', html: icon('chevron-right', 12) });
  const body = h(
    'div',
    { class: 'c-disclosure__body' },
    h('div', { class: 'c-disclosure__inner' }, h('div', { class: 'c-disclosure__content' }, children))
  );

  const el = h(
    'div',
    { class: 'c-disclosure', dataset: { open: open ? '1' : '0' } },
    h(
      'button',
      {
        class: 'c-disclosure__head',
        type: 'button',
        'aria-expanded': String(open),
        onclick: () => {
          const next = el.dataset.open !== '1';
          el.set(next);
          onToggle?.(next);
        },
      },
      chev,
      h('span', { class: 'l-fill' }, title),
      hint ? h('span', { class: 'c-disclosure__hint' }, hint) : null
    ),
    body
  );

  el.set = (v) => {
    el.dataset.open = v ? '1' : '0';
    el.querySelector('.c-disclosure__head').setAttribute('aria-expanded', String(v));
  };
  return el;
}

/* ==========================================================================
   28. 面包屑
   ========================================================================== */

export function Breadcrumb({ items = [], onPick } = {}) {
  const el = h('nav', { class: 'c-crumbs', 'aria-label': '位置' });

  items.forEach((it, i) => {
    const last = i === items.length - 1;
    if (i > 0) el.append(h('span', { class: 'c-crumbs__sep', html: icon('chevron-right', 10) }));
    if (it.ellipsis) {
      el.append(h('span', { class: 'c-crumbs__item c-crumbs__item--ellipsis', html: icon('more', 12) }));
      return;
    }
    el.append(
      h(
        last ? 'span' : 'button',
        {
          class: 'c-crumbs__item',
          type: last ? null : 'button',
          'aria-current': last ? 'page' : null,
          onclick: last ? null : () => (it.onClick ? it.onClick(it, i) : onPick?.(it, i)),
        },
        it.icon ? iconEl(it.icon, 12) : null,
        it.label
      )
    );
  });

  return el;
}

/* ==========================================================================
   29. 环形进度 / 骨架屏
   ========================================================================== */

export function ProgressRing({ value = 0, size = '', label = '' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('class', `c-ring ${size === 'lg' ? 'c-ring--lg' : ''}`.trim());
  svg.setAttribute('role', 'progressbar');
  svg.setAttribute('aria-valuemin', '0');
  svg.setAttribute('aria-valuemax', '100');
  if (label) svg.setAttribute('aria-label', label);

  const mk = (cls) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '18');
    c.setAttribute('cy', '18');
    c.setAttribute('r', '15.9155');
    c.setAttribute('class', cls);
    return c;
  };
  svg.append(mk('c-ring__track'), mk('c-ring__bar'));

  const set = (v) => {
    const p = clamp(v, 0, 100);
    svg.style.setProperty('--v', String(p / 100));
    svg.setAttribute('aria-valuenow', String(p));
  };
  set(value);

  svg.set = set;
  svg.value = () => Number(svg.getAttribute('aria-valuenow'));
  return svg;
}

/**
 * 骨架屏。lines > 1 时返回一组文本行（最后一根短一截），否则返回单块。
 * 知道大概长什么样才用它；不知道就用 Spinner。
 */
export function Skeleton({ width = '100%', height = '12px', lines = 0, circle = false, className = '' } = {}) {
  const one = (w, ht, extra = '') =>
    h('div', {
      class: `c-skeleton ${circle ? 'c-skeleton--circle' : ''} ${extra} ${className}`.trim(),
      style: { width: w, height: ht },
    });

  if (lines <= 1) return one(width, height, 'c-skeleton--text');
  return h(
    'div',
    { class: 'l-stack l-stack--3', style: { width } },
    Array.from({ length: lines }, (_, i) =>
      one(i === lines - 1 ? '62%' : '100%', height, 'c-skeleton--text')
    )
  );
}

/* ==========================================================================
   30. 模态
   ========================================================================== */

/* 模态栈：可以一层压一层。
   一级 = 直接盖在页面上；二级 = 盖在另一个模态上（下面那层会变暗并 inert）。 */
const dialogStack = [];

/** 当前打开的模态层数（0 = 没有） */
export const dialogDepth = () => dialogStack.length;

/**
 * 模态。返回控制器 `{ el, sheet, close, level }`，`ctl.close()` 关闭。
 * 材质走 L4（.c-glass-sheet）—— 模态必须比它盖住的一切都实。
 *
 * 在另一个 Dialog 的 actions / body 里再调一次，就自动变成**二级弹窗**：
 * 它盖在上一级之上、四周压暗、上一级同时变暗并失去交互。
 *
 * @param {number} [o.level] 强制层级；不传则按栈深度自动算
 */
export function Dialog({
  title = '',
  desc = '',
  body = null,
  icon: ic = '',
  tone = '', // '' | 'danger'
  width = '',
  actions = null,
  closable = true,
  level = 0,
  onClose,
} = {}) {
  const depth = level > 0 ? level : dialogStack.length + 1;
  const parent = dialogStack[dialogStack.length - 1] ?? null;
  // 二级默认比一级窄一档：两层都居中，尺寸一样就会完全盖住下面那层，
  // 于是「压在谁上面」根本读不出来。窄 80px 才露出上一级的轮廓。
  const w = width || (depth > 1 ? '300px' : '');

  const sheet = h(
    'div',
    {
      class: `c-dialog c-glass-sheet ${depth > 1 ? 'c-dialog--sub' : ''}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title || '对话框',
      dataset: { level: String(depth) },
      style: w ? { '--dlg-w': w } : null,
    },
    ic || title
      ? h(
          'div',
          { class: 'c-dialog__head' },
          ic
            ? h('span', {
                class: `c-dialog__icon ${tone === 'danger' ? 'c-dialog__icon--danger' : ''}`.trim(),
                html: icon(ic, 17),
              })
            : null,
          h(
            'div',
            { class: 'l-fill' },
            title ? h('div', { class: 'c-dialog__title' }, title) : null,
            desc ? h('div', { class: 'c-dialog__desc' }, desc) : null
          )
        )
      : null,
    body ? h('div', { class: 'c-dialog__body' }, body) : null,
    actions ? h('div', { class: 'c-dialog__actions' }, actions) : null
  );

  const scrim = h(
    'div',
    {
      class: 'c-dialog-scrim',
      // 层级写在属性上，CSS 按层调遮罩浓度；z-index 每层拉开 20
      dataset: { level: String(depth) },
      style: { zIndex: String(500 + (depth - 1) * 20) },
    },
    sheet
  );

  document.body.append(scrim);
  sheet.__glassLens = mountGlassLens(sheet, { surface: 'sheet' });

  // 上一级变暗 + 失去交互。inert 会连 Tab 一起挡住，比 pointer-events 干净。
  const previousFocus = document.activeElement;
  if (parent) {
    parent.sheet.setAttribute('inert', '');
    parent.sheet.setAttribute('aria-hidden', 'true');
  }

  const isTop = () => dialogStack[dialogStack.length - 1]?.el === scrim;

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;

    // 关父级时先把压在它上面的都收掉，避免留下孤儿层
    const idx = dialogStack.findIndex((d) => d.el === scrim);
    if (idx >= 0) {
      for (const above of dialogStack.slice(idx + 1).reverse()) above.close(undefined);
      dialogStack.splice(idx, 1);
    }

    document.removeEventListener('keydown', onKey, true);
    disposeGlassTree(scrim);
    scrim.remove();

    if (parent) {
      parent.sheet.removeAttribute('inert');
      parent.sheet.removeAttribute('aria-hidden');
      // 焦点回到上一级，不要掉到 <body>
      requestAnimationFrame(() => parent.sheet.focus?.());
    } else if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      requestAnimationFrame(() => previousFocus.focus?.());
    }

    onClose?.(result);
  };

  // 只有最上面那层响应 Esc —— 否则一次 Esc 会把整摞全关掉
  const onKey = (e) => {
    if (e.key !== 'Escape' || !closable || !isTop()) return;
    e.stopPropagation();
    close(undefined);
  };
  document.addEventListener('keydown', onKey, true);

  if (closable) {
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim && isTop()) close(undefined);
    });
  }

  // 入场：二级比一级起得更「远」，读起来是压在上一层之上
  const from = depth > 1 ? 0.9 : 0.96;
  sheet.style.opacity = '0';
  sheet.style.transform = `scale(${from}) translateY(6px)`;
  spring({
    from: 0,
    to: 1,
    damping: 0.9,
    response: depth > 1 ? 0.26 : 0.3,
    onUpdate: (t) => {
      sheet.style.opacity = String(t);
      sheet.style.transform = `scale(${from + (1 - from) * t}) translateY(${(1 - t) * 6}px)`;
    },
  });

  // 焦点进到面板本身，不要落在第一个按钮上 ——
  // 程序化聚焦按钮会画出焦点环，读起来像「取消」已经被选中了。
  sheet.tabIndex = -1;
  requestAnimationFrame(() => sheet.focus?.());

  const ctl = { el: scrim, sheet, close, level: depth };
  dialogStack.push(ctl);
  return ctl;
}

/**
 * 确认框。返回 Promise<boolean>。
 *   if (await confirmDialog({ title: '删除？', tone: 'danger' })) remove()
 */
export function confirmDialog({
  title = '确定吗？',
  desc = '',
  confirmLabel = '确定',
  cancelLabel = '取消',
  tone = '',
  icon: ic = '',
} = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const ctl = Dialog({
      title,
      desc,
      icon: ic || (tone === 'danger' ? 'trash' : 'info'),
      tone,
      actions: [
        Button({ label: cancelLabel, variant: 'plain', onClick: () => { finish(false); ctl.close(); } }),
        Button({
          label: confirmLabel,
          variant: tone === 'danger' ? 'danger' : 'primary',
          onClick: () => { finish(true); ctl.close(); },
        }),
      ],
      onClose: () => finish(false),
    });
  });
}

/* ==========================================================================
   31. 浮层 Popover
   —— 菜单是「一串可选项」，浮层是「一块任意内容」。别互相顶替。
   ========================================================================== */

let activePopover = null;

export function openPopover({ anchor, content, placement = 'bottom', width, onClose } = {}) {
  closePopover();

  const el = h('div', { class: 'c-popover c-glass-sheet', role: 'dialog' }, content);
  document.body.append(el);
  el.__glassLens = mountGlassLens(el, { surface: 'sheet' });
  if (width) el.style.width = typeof width === 'number' ? `${width}px` : width;

  const pad = 8;
  const place = () => {
    if (!anchor?.isConnected) return closePopover();
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const hh = el.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    let top = placement === 'top' ? r.top - hh - 6 : r.bottom + 6;
    if (top + hh > window.innerHeight - pad) top = r.top - hh - 6;
    if (top < pad) top = pad;
    left = clamp(left, pad, Math.max(pad, window.innerWidth - w - pad));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };
  place();

  const off = onOutside(el, (e) => {
    if (anchor?.contains(e.target)) return;
    closePopover();
  });
  const onScroll = () => place();
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);

  let raf = 0;
  const track = () => {
    place();
    if (activePopover === ctl) raf = requestAnimationFrame(track);
  };
  raf = requestAnimationFrame(track);

  el.style.opacity = '0';
  el.style.transform = 'scale(0.97)';
  spring({
    from: 0,
    to: 1,
    damping: 1,
    response: 0.22,
    onUpdate: (t) => {
      el.style.opacity = String(t);
      el.style.transform = `scale(${0.97 + 0.03 * t})`;
    },
  });

  const ctl = {
    el,
    close: closePopover,
    _cleanup: () => {
      off();
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      onClose?.();
    },
  };
  activePopover = ctl;
  return ctl;
}

export function closePopover() {
  if (!activePopover) return;
  const c = activePopover;
  activePopover = null;
  c._cleanup();
  disposeGlassTree(c.el);
  c.el.remove();
}

/* ==========================================================================
   32. 悬停提示
   —— 只给「没有可见文字的控件」用。有文字的控件加提示是噪音。
   ========================================================================== */

let tipEl = null;
let tipTimer = 0;

/**
 * @param {HTMLElement} target
 * @param {string} text
 * @param {{ placement?: 'top'|'bottom', delay?: number }} [opts]
 * @returns {() => void} 解除绑定
 */
export function tip(target, text, { placement = 'bottom', delay = 420 } = {}) {
  const show = () => {
    hide();
    tipEl = h('div', { class: 'c-tip', role: 'tooltip' }, text);
    document.body.append(tipEl);
    const r = target.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    const hh = tipEl.offsetHeight;
    // 四个方向：上下居中压横轴，左右居中压纵轴。贴边的悬浮导航要用左右，
    // 否则提示会跑到药丸外面、被窗口边裁掉。
    let left;
    let top;
    if (placement === 'left' || placement === 'right') {
      left = placement === 'left' ? r.left - w - 6 : r.right + 6;
      top = r.top + r.height / 2 - hh / 2;
    } else {
      left = r.left + r.width / 2 - w / 2;
      top = placement === 'top' ? r.top - hh - 5 : r.bottom + 5;
    }
    left = clamp(left, 6, window.innerWidth - w - 6);
    top = clamp(top, 4, window.innerHeight - hh - 4);
    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
    requestAnimationFrame(() => tipEl?.setAttribute('data-show', '1'));
  };

  const schedule = () => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(show, delay);
  };
  const hide = () => {
    clearTimeout(tipTimer);
    tipEl?.remove();
    tipEl = null;
  };

  target.addEventListener('pointerenter', schedule);
  target.addEventListener('pointerleave', hide);
  target.addEventListener('focus', schedule);
  target.addEventListener('blur', hide);
  target.addEventListener('pointerdown', hide);

  return () => {
    hide();
    target.removeEventListener('pointerenter', schedule);
    target.removeEventListener('pointerleave', hide);
    target.removeEventListener('focus', schedule);
    target.removeEventListener('blur', hide);
    target.removeEventListener('pointerdown', hide);
  };
}
