// Golden Gate · overlays/tooltip
import { h, clamp } from '../../core/dom.js';

/* ==========================================================================
   32. 悬停提示
   —— 只给「没有可见文字的控件」用。有文字的控件加提示是噪音。

   三条规则：
   1) 同一时刻只有一个提示。多个触发器共享一个计时器和一个节点，
      否则快速掠过一排图标会叠出好几层。
   2) 提示与目标用 aria-describedby 关联，id 稳定；消失时解除关联。
   3) Esc、按下、滚动、失焦都要取消 —— 提示不能卡在屏幕中间。
   ========================================================================== */

let tipEl = null;
let tipTimer = 0;
let tipOwner = null;
let seq = 0;

const cancelAll = () => {
  clearTimeout(tipTimer);
  tipTimer = 0;
  if (tipOwner) {
    tipOwner.removeAttribute('aria-describedby');
    tipOwner = null;
  }
  tipEl?.remove();
  tipEl = null;
};

let listening = false;
const ensureGlobalCancel = () => {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancelAll();
  });
  document.addEventListener('pointerdown', cancelAll, true);
  window.addEventListener('scroll', cancelAll, true);
  window.addEventListener('blur', cancelAll);
};

/**
 * @param {HTMLElement} target
 * @param {string} text
 * @param {{ placement?: 'top'|'bottom'|'left'|'right', delay?: number, id?: string }} [opts]
 * @returns {() => void} 解除绑定
 */
export function tip(target, text, { placement = 'bottom', delay = 420, id } = {}) {
  ensureGlobalCancel();
  const tipId = id || `gg-tip-${++seq}`;

  const show = () => {
    cancelAll();
    tipOwner = target;
    tipEl = h('div', { class: 'c-tip', role: 'tooltip', id: tipId }, text);
    document.body.append(tipEl);
    target.setAttribute('aria-describedby', tipId);

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
    if (tipOwner === target) cancelAll();
    else clearTimeout(tipTimer);
  };

  target.addEventListener('pointerenter', schedule);
  target.addEventListener('pointerleave', hide);
  target.addEventListener('focus', schedule);
  target.addEventListener('blur', hide);
  target.addEventListener('pointerdown', hide);

  return () => {
    hide();
    if (tipOwner === target) cancelAll();
    target.removeEventListener('pointerenter', schedule);
    target.removeEventListener('pointerleave', hide);
    target.removeEventListener('focus', schedule);
    target.removeEventListener('blur', hide);
    target.removeEventListener('pointerdown', hide);
  };
}
