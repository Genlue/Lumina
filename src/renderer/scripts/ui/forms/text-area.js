// Golden Gate · forms/text-area
import { h } from '../../core/dom.js';
import { applyControlState } from '../_shared/control.js';

/* ==========================================================================
   24. 多行输入 / 步进器
   ========================================================================== */

export function TextArea({
  value = '',
  placeholder = '',
  rows = 4,
  onInput,
  onEnter,
  label = '',
  disabled = false,
  readonly = false,
  invalid = false,
} = {}) {
  const ta = h('textarea', {
    class: 'c-textarea selectable',
    rows,
    placeholder,
    'aria-label': label || null,
    'aria-invalid': invalid ? 'true' : null,
    disabled: disabled || null,
    readonly: readonly || null,
    oninput: (e) => onInput?.(e.target.value),
    onkeydown: (e) => {
      // ⌘/Ctrl + Enter 提交；单独 Enter 是换行，别抢
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
      if (e.isComposing || e.keyCode === 229) return;
      onEnter?.(e.target.value);
    },
  });
  ta.value = value ?? '';

  const wrap = h('div', null, ta);
  wrap.input = ta;
  wrap.set = (v) => {
    ta.value = v ?? '';
  };
  wrap.value = () => ta.value;
  wrap.setDisabled = (v) => applyControlState(ta, { disabled: v });
  wrap.setReadonly = (v) => applyControlState(ta, { readonly: v });
  wrap.setInvalid = (v) => {
    applyControlState(ta, { invalid: v });
    if (v) wrap.dataset.invalid = '1';
    else delete wrap.dataset.invalid;
  };
  wrap.focus = () => ta.focus();
  wrap.dispose = () => {};
  return wrap;
}
