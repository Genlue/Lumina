// Golden Gate · controls/range-slider
import { h, clamp } from '../../core/dom.js';
import { springValue } from '../../core/spring.js';
import { mountRefraction } from '../../core/refraction.js';
import { mountGlassLens, disposeGlassTree } from '../../core/glass-lens.js';
import { theme } from '../../core/theme.js';
import { applyControlState } from '../_shared/control.js';
import { createDisposer } from '../_shared/disposer.js';

/* ==========================================================================
   区间滑块（双端滑块）
   —— 原型：NSSlider 的 range 形态（一个轨道、两个拇指）。价格区间、时间段、
   缩放范围都需要"两端各有稳定语义"的输入：两端各自可聚焦、各自有一份
   aria-valuenow，而不是把两个单选滑块用视觉拼在一起。

   和单值 Slider 的三处关键区别：
   1) 拇指是 role="slider" 的独立焦点目标，容器只是 role="group"；
   2) 交叉策略必须显式声明（push / swap / clamp），不能靠 clamp 蒙混 ——
      "把左边的拖过右边"在三种策略下是三种完全不同的产品行为；
   3) 位置用百分比布局（rail 两端各让半个拇指），不测像素、不依赖
      ResizeObserver：容器 200px 还是 900px，拇指都不会越界。

   焦点归属的固定选择（swap 策略下）：**身份跟着值走**。
   越过时值互换，焦点跟着"新值"落到另一个拇指上（键盘），指针拖动则把
   拖动权交给同一侧 —— 这样连续按 → 永远单调向右，不会出现"按一下没反应、
   拇指反而跳回左边"的半拍。另一种做法（焦点钉在 DOM 上、值交换）会让
   被聚焦的拇指在交换后突然变成另一端的值，连续按键会顿住，因此没采用。

   键盘 / ARIA 契约见文件底部注释与 docs/03-components.md 的 P 节。
   ========================================================================== */

const POLICIES = ['push', 'swap', 'clamp'];

export function RangeSlider({
  min = 0,
  max = 100,
  step = 1,
  value = [25, 75],
  crossing = 'push',
  label = '',
  format = (v) => String(v),
  ticks = 0,
  showValue = false,
  disabled = false,
  onInput,
  onChange,
  className = '',
} = {}) {
  const vmin = Math.min(min, max);
  const vmax = Math.max(min, max);
  const span = vmax - vmin || 1;
  const stp = step > 0 ? step : 1;
  const policy = POLICIES.includes(crossing) ? crossing : 'push';

  /** 量化从 min 起算；toFixed(10) 清掉 0.1+0.2 这类浮点尾巴 */
  const quantize = (v) => {
    const q = vmin + Math.round((v - vmin) / stp) * stp;
    return clamp(Number(q.toFixed(10)), vmin, vmax);
  };
  const pctOf = (v) => clamp((v - vmin) / span, 0, 1);
  const valueAt = (p) => vmin + clamp(p, 0, 1) * span;

  /** 乱序自动排序、越界夹取、NaN 退回边界 */
  const normalize = (v) => {
    const arr = Array.isArray(v) ? v : [v, v];
    const rawA = Number(arr[0]);
    const rawB = arr.length > 1 ? Number(arr[1]) : rawA;
    let a = quantize(rawA);
    let b = quantize(rawB);
    if (!Number.isFinite(a)) a = vmin;
    if (!Number.isFinite(b)) b = vmax;
    return a <= b ? [a, b] : [b, a];
  };

  let pair = normalize(value);
  // 位置与取值分开：拖动时位置连续（拇指不跳格），取值才量化
  let pos = [pctOf(pair[0]), pctOf(pair[1])];
  let disposed = false;
  let drag = null; // { side, pointerId, changed }
  const disposer = createDisposer();

  /* ---------------- 结构 ---------------- */

  const fill = h('div', { class: 'c-rangeslider__fill' });
  const track = h('div', { class: 'c-rangeslider__track' }, fill);

  // 刻度：ticks 是"含两端"的总条数，5 → 0/25/50/75/100 五根
  const tickCount = Math.max(0, Math.floor(Number(ticks) || 0));
  const tickLayer = tickCount >= 2
    ? h(
        'div',
        { class: 'c-rangeslider__ticks', 'aria-hidden': 'true' },
        Array.from({ length: tickCount }, (_, i) =>
          h('span', {
            class: 'c-rangeslider__tick',
            style: { left: `${(i / (tickCount - 1)) * 100}%` },
          })
        )
      )
    : null;

  const makeThumb = (side, ariaLabel) => {
    const mask = h('div', { class: 'c-rangeslider__mask' });
    const node = h(
      'div',
      {
        class: 'c-rangeslider__thumb',
        role: 'slider',
        tabindex: '0',
        'aria-label': ariaLabel,
        'aria-orientation': 'horizontal',
        'aria-valuemin': String(vmin),
        'aria-valuemax': String(vmax),
      },
      mask
    );
    node.dataset.side = side;
    return node;
  };

  const groupName = label || '区间滑块';
  const thumbLo = makeThumb('lo', `${groupName}最小值`);
  const thumbHi = makeThumb('hi', `${groupName}最大值`);
  const thumbs = [thumbLo, thumbHi];

  const valueEl = showValue
    ? h('span', { class: 'c-rangeslider__value', 'aria-hidden': 'true' })
    : null;

  const rail = h('div', { class: 'c-rangeslider__rail' }, track, tickLayer, thumbLo, thumbHi);
  const el = h(
    'div',
    { class: `c-rangeslider ${className}`.trim(), role: 'group', 'aria-label': groupName },
    rail,
    valueEl
  );

  /* ---------------- 玻璃拇指 ---------------- */

  // CSS 里的 url(#gg-refract) 需要滤镜真实存在，否则整条 backdrop-filter 失效。
  // 幂等：全页建一次就够。
  mountRefraction();
  const lenses = thumbs.map((t) =>
    mountGlassLens(t, { surface: 'thumb', params: () => theme.getOptics('thumb') })
  );
  thumbs.forEach((t, i) => {
    if (lenses[i]) t.__glassLens = lenses[i];
  });

  // 按压反馈：1.06 的轻微放大 + 白膜淡出（见 CSS）。
  // 比单值滑块的 2 倍克制 —— 两颗拇指最近时只隔一个身位，放大太多会互相顶掉。
  const presses = thumbs.map((t) =>
    springValue(1, {
      damping: 0.72,
      response: 0.26,
      onUpdate: (v) => {
        t.style.setProperty('--thumb-s', String(v));
        // transform 不触发 ResizeObserver，放大时得自己叫渲染层重画
        t.__glassLens?.invalidate();
      },
    })
  );

  /* ---------------- 渲染 ---------------- */

  const rf = (p) => String(Math.min(1, p * 12, (1 - p) * 12));
  let lensKey = '';

  const paint = () => {
    if (disposed) return;
    el.style.setProperty('--p-lo', String(pos[0]));
    el.style.setProperty('--p-hi', String(pos[1]));

    thumbLo.style.setProperty('--p', String(pos[0]));
    thumbLo.style.setProperty('--rf', rf(pos[0]));
    thumbHi.style.setProperty('--p', String(pos[1]));
    thumbHi.style.setProperty('--rf', rf(pos[1]));

    thumbLo.setAttribute('aria-valuenow', String(pair[0]));
    thumbLo.setAttribute('aria-valuetext', format(pair[0]));
    thumbHi.setAttribute('aria-valuenow', String(pair[1]));
    thumbHi.setAttribute('aria-valuetext', format(pair[1]));

    if (valueEl) valueEl.textContent = `${format(pair[0])} – ${format(pair[1])}`;

    // 拇指移动 = 它背后的东西变了（选中段边界走到哪儿），纹理要重采。
    // 只在取值真的变化时重采：位置连续拖动每帧都重算两张位移贴图太贵。
    const key = `${pair[0]}|${pair[1]}`;
    if (key !== lensKey) {
      lensKey = key;
      lenses.forEach((l) => l?.invalidate());
    }
  };

  /* ---------------- 交叉策略 ---------------- */

  /**
   * 把 side 侧推到 target（已量化）。返回新的值与"现在由谁持有 target"。
   * owner === null 表示目标值没达成（被挡住 / 整体被推走），焦点留在原拇指。
   *
   * push ：另一侧被顶到同一个值（间距 0），再往前整体一起走；
   * swap ：越过时值互换 —— 旧的对侧值变成本侧，target 归对侧；
   * clamp：贴住对侧，不许越过。
   */
  const resolve = (side, target) => {
    const [a, b] = pair;
    if (side === 0) {
      if (target <= b) return { next: [target, b], owner: 0 };
      if (policy === 'clamp') return { next: [b, b], owner: null };
      if (policy === 'swap') return { next: [b, target], owner: 1 };
      return { next: [target, target], owner: null };
    }
    if (target >= a) return { next: [a, target], owner: 1 };
    if (policy === 'clamp') return { next: [a, a], owner: null };
    if (policy === 'swap') return { next: [target, a], owner: 0 };
    return { next: [target, target], owner: null };
  };

  const samePair = (x, y) => x[0] === y[0] && x[1] === y[1];

  /* ---------------- 指针 ---------------- */

  const setActive = (side, on) => {
    const t = thumbs[side];
    if (on) {
      t.dataset.dragging = '1'; // 白色遮罩淡出 / 背景模糊收到 0
      presses[side].to(1.06);
    } else {
      delete t.dataset.dragging;
      presses[side].to(1, { damping: 0.9, response: 0.3 });
    }
  };

  /** 指针落在哪一侧：两端外直接取该端，中间就近，等距取左 */
  const pickSide = (v) => {
    if (v <= pair[0]) return 0;
    if (v >= pair[1]) return 1;
    return v - pair[0] <= pair[1] - v ? 0 : 1;
  };

  const trackRect = () => track.getBoundingClientRect();
  const pFromClientX = (clientX) => {
    const r = trackRect();
    if (r.width <= 0) return null;
    return clamp((clientX - r.left) / r.width, 0, 1);
  };

  /** 拖动：把 side 侧推到连续位置 contP（0..1） */
  const dragTo = (contP) => {
    const v = quantize(valueAt(contP));
    const side = drag.side;
    const { next, owner } = resolve(side, v);

    // 位置：默认按量化值摆；真正被拖住的那一侧保持连续位置
    const nextPos = [pctOf(next[0]), pctOf(next[1])];
    if (policy === 'push' && next[0] === next[1]) {
      // 顶到同一个值：两个拇指叠在一起整体移动，不能一前一后拉开假间距
      nextPos[0] = nextPos[1] = clamp(contP, 0, 1);
    } else if (owner !== null) {
      nextPos[owner] = owner === 0
        ? clamp(contP, 0, pctOf(next[1]))
        : clamp(contP, pctOf(next[0]), 1);
    }

    const changed = !samePair(next, pair);
    pair = next;
    pos = nextPos;

    // 交换后拖动权交给"现在持有该值"的那一侧，指针不需要重新按下
    if (owner !== null && owner !== side) {
      setActive(side, false);
      drag.side = owner;
      setActive(owner, true);
      // 焦点跟着值走，键盘接手时不会落在另一端
      thumbs[owner].focus({ preventScroll: true });
    }

    paint();
    if (changed) {
      drag.changed = true;
      onInput?.([pair[0], pair[1]]);
    }
  };

  disposer.on(el, 'pointerdown', (e) => {
    if (disposed || e.button !== 0 || el.dataset.disabled || drag) return;
    const p = pFromClientX(e.clientX);
    if (p === null) return;
    const side = pickSide(valueAt(p));
    drag = { side, pointerId: e.pointerId, changed: false };
    try { el.setPointerCapture(e.pointerId); } catch {}
    setActive(side, true);
    thumbs[side].focus({ preventScroll: true });
    dragTo(p);
    e.preventDefault();
  });

  disposer.on(el, 'pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p = pFromClientX(e.clientX);
    if (p === null) return;
    dragTo(p);
  });

  const endDrag = (e) => {
    if (!drag) return;
    if (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
    const { side, pointerId, changed } = drag;
    drag = null;
    setActive(side, false);
    try { el.releasePointerCapture(pointerId); } catch {}
    // 只有真的动过才发 change —— 原地按一下不该惊动订阅方
    if (changed) onChange?.([pair[0], pair[1]]);
  };

  disposer.on(el, 'pointerup', endDrag);
  disposer.on(el, 'pointercancel', endDrag);
  disposer.on(el, 'lostpointercapture', endDrag);

  /* ---------------- 键盘 ---------------- */

  const moveBy = (side, target) => {
    const { next, owner } = resolve(side, quantize(target));
    if (samePair(next, pair)) return false;
    pair = next;
    pos = [pctOf(pair[0]), pctOf(pair[1])];
    paint();
    // swap：焦点跟着"新值"去另一个拇指，连续按键才单调
    if (owner !== null && owner !== side) thumbs[owner].focus({ preventScroll: true });
    return true;
  };

  disposer.on(el, 'keydown', (e) => {
    if (disposed || el.dataset.disabled) return;
    const side = e.target === thumbHi ? 1 : e.target === thumbLo ? 0 : -1;
    if (side < 0) return;

    const big = span / 10; // PageUp/Down = 10% 量程
    let target = null;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        target = pair[side] - stp * (e.shiftKey ? 10 : 1);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        target = pair[side] + stp * (e.shiftKey ? 10 : 1);
        break;
      case 'PageDown':
        target = pair[side] - big;
        break;
      case 'PageUp':
        target = pair[side] + big;
        break;
      case 'Home':
        target = vmin;
        break;
      case 'End':
        target = vmax;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (!moveBy(side, target)) return;
    onInput?.([pair[0], pair[1]]);
    onChange?.([pair[0], pair[1]]);
  });

  /* ---------------- 值 / 状态 API ---------------- */

  const set = (v) => {
    if (disposed) return;
    pair = normalize(v);
    pos = [pctOf(pair[0]), pctOf(pair[1])];
    paint();
  };

  const setDisabled = (v) => {
    applyControlState(el, { disabled: v });
    // 组上的 aria-disabled 不会被读屏带到子滑块上，两个拇指各写一遍；
    // 同时把 tabindex 收掉（applyControlState 只管根节点）。
    thumbs.forEach((t) => {
      t.setAttribute('aria-disabled', String(!!v));
      t.tabIndex = v ? -1 : 0;
    });
    if (v) endDrag();
  };

  el.value = () => [pair[0], pair[1]];
  el.set = set;
  el.setDisabled = setDisabled;
  el.setInvalid = (v) => applyControlState(el, { invalid: v });
  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    endDrag();
    drag = null;
    presses.forEach((p) => p.stop());
    disposer.add(() => disposeGlassTree(el));
    disposer.dispose();
  };

  paint();
  if (disabled) setDisabled(true);

  return el;
}

/* 键盘契约（焦点必须在某一个拇指上）：
     ← / →（↓ / ↑）       ±step，Shift 时 ×10
     PageUp / PageDown    ±10% 量程
     Home / End           到 min / max
   两个拇指都是 tabindex=0，Tab 依次经过"最小值"和"最大值"。
   交叉由 crossing 决定：push 顶走 / swap 互换身份 / clamp 挡住。
   aria-valuetext 用 format(v)，视觉值用「lo – hi」。 */
