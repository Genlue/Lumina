// Golden Gate · overlays/toast
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { spring } from '../../core/spring.js';
import { mountGlassLens, disposeGlassTree } from '../../core/glass-lens.js';

/* ==========================================================================
   15. 浮层提示
   ========================================================================== */

let toastHost = null;

export function toast(message, { icon: ic = '', duration = 1900, tone = '' } = {}) {
  if (!toastHost) {
    // 提示条是「说完就消失」的状态反馈，用 status 让读屏礼貌播报；
    // data-layer-ignore 让模态隔离背景时不要把它一起 aria-hidden 掉。
    toastHost = h('div', {
      class: 'c-toast-host',
      role: 'status',
      'aria-live': 'polite',
      'data-layer-ignore': '',
    });
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
