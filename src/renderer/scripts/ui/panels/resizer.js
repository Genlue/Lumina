// Golden Gate · panels/resizer
import { h } from '../../core/dom.js';

/* ==========================================================================
   34. 分隔条
   —— 栏与栏之间那 9px。拖动改宽度，方向键一步步挪，双击复位。

   刻意只报「位移」不报「宽度」：谁被拖、拖的是哪一栏、上下限是多少，
   只有调用方知道。控件自己猜宽度，最后一定会猜错（被拖的可能不是相邻兄弟，
   也可能是被 flex 撑开的、有 min-width 的、或者干脆不是同一个容器里的）。
   ========================================================================== */

export function Resizer({
  axis = 'x',
  label = '调整大小',
  step = 16,
  className = '',
  onDelta,
  onReset,
} = {}) {
  const horizontal = axis === 'y';

  const el = h('div', {
    class: `c-resizer ${className}`.trim(),
    role: 'separator',
    tabindex: '0',
    'aria-label': label,
    'aria-orientation': horizontal ? 'horizontal' : 'vertical',
    dataset: { axis: horizontal ? 'y' : 'x' },
  });

  let drag = null;

  const point = (e) => (horizontal ? e.clientY : e.clientX);

  const onDown = (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, start: point(e), delta: 0 };
    el.setPointerCapture(e.pointerId);
    el.dataset.active = '1';
    // 拖动期间整页统一光标，鼠标滑出这 9px 也不会变回箭头
    document.documentElement.dataset.resizing = horizontal ? 'y' : 'x';
    onDelta?.(0, 'start');
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.delta = point(e) - drag.start;
    onDelta?.(drag.delta, 'move');
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const delta = drag.delta;
    drag = null;
    delete el.dataset.active;
    delete document.documentElement.dataset.resizing;
    onDelta?.(delta, 'end');
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    onReset?.();
  });

  el.addEventListener('keydown', (e) => {
    const back = horizontal ? 'ArrowUp' : 'ArrowLeft';
    const fwd = horizontal ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    onDelta?.(e.key === back ? -step : step, 'key');
  });

  let disposed = false;
  /** 结束手势、清全局标记；不摘 DOM */
  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    if (drag) {
      try {
        el.releasePointerCapture(drag.id);
      } catch {}
      drag = null;
    }
    delete el.dataset.active;
    delete document.documentElement.dataset.resizing;
  };
  el.destroy = () => {
    el.dispose();
    el.remove();
  };
  return el;
}
