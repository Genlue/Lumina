// Golden Gate · _shared/control
import { createDisposer } from './disposer.js';

/* ==========================================================================
   控件状态契约（M3 的接口部分）

   所有有值控件统一：
     set(value)        静默赋值，不触发 onChange
     value()           读取当前值
     setDisabled(bool) 禁用
     setInvalid(bool)  校验失败（aria-invalid + 视觉）
     setReadonly(bool) 只读（能聚焦、能选中、不能改）

   这里只处理「状态怎么落到 DOM」：原生可禁用元素用 disabled；
   用 div 装的复合控件退到 aria-disabled + tabindex=-1，再配 CSS。
   外观不在这里写，避免 JS 里出现字面色值。
   ========================================================================== */

export function applyControlState(el, { disabled, invalid, readonly, busy } = {}) {
  if (!el) return;

  if (disabled !== undefined) {
    const value = !!disabled;
    el.setAttribute('aria-disabled', String(value));
    if ('disabled' in el) el.disabled = value;
    if (value) {
      el.dataset.disabled = '1';
      if (el.tabIndex >= 0) {
        el.dataset.prevTabindex = String(el.tabIndex);
        el.tabIndex = -1;
      }
    } else {
      delete el.dataset.disabled;
      if (el.dataset.prevTabindex) {
        el.tabIndex = Number(el.dataset.prevTabindex);
        delete el.dataset.prevTabindex;
      }
    }
  }

  if (invalid !== undefined) {
    const value = !!invalid;
    el.setAttribute('aria-invalid', String(value));
    if (value) el.dataset.invalid = '1';
    else delete el.dataset.invalid;
  }

  if (readonly !== undefined) {
    const value = !!readonly;
    el.setAttribute('aria-readonly', String(value));
    if (value) el.dataset.readonly = '1';
    else delete el.dataset.readonly;
  }

  if (busy !== undefined) {
    el.setAttribute('aria-busy', String(!!busy));
  }
}

/**
 * 给控件挂上统一方法。传进来的 setter 只负责「改值」，状态由这里统一写 DOM。
 * @param {HTMLElement} el
 * @param {{ get:()=>any, set:(v:any)=>void }} io
 */
export function attachValueApi(el, { get, set }) {
  el.set = (v) => set(v);
  el.value = () => get();
  el.setDisabled = (v) => applyControlState(el, { disabled: v });
  el.setInvalid = (v) => applyControlState(el, { invalid: v });
  el.setReadonly = (v) => applyControlState(el, { readonly: v });
  return el;
}

/** 给「按一次改一次」的控件登记键盘与指针，销毁时一起摘掉 */
export function bindPress(el, handler, { keys = ['Enter', ' '] } = {}) {
  const disposer = createDisposer();
  disposer.on(el, 'click', handler);
  disposer.on(el, 'keydown', (e) => {
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    handler(e);
  });
  return disposer;
}
