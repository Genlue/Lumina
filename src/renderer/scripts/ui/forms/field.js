// Golden Gate · forms/field
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { applyControlState } from '../_shared/control.js';

/* ==========================================================================
   5. 输入

   值的变化只走一条路：用户输入派发 onInput / onEnter，程序赋值走 set()。
   输入法组合期的 Enter 不算提交 —— 否则中文选词按回车会把表单发出去。
   ========================================================================== */

export function Field({
  value = '',
  placeholder = '',
  icon: ic = '',
  type = 'text',
  onInput,
  onEnter,
  width = '',
  label = '',
  disabled = false,
  readonly = false,
  invalid = false,
  name = '',
  autocomplete = '',
} = {}) {
  const input = h('input', {
    class: 'c-field__input selectable',
    type,
    placeholder,
    'aria-label': label || null,
    'aria-invalid': invalid ? 'true' : null,
    disabled: disabled || null,
    readonly: readonly || null,
    name: name || null,
    autocomplete: autocomplete || null,
    oninput: (e) => onInput?.(e.target.value),
    onkeydown: (e) => {
      // isComposing / keyCode 229：中文、日文输入法正在选词
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      onEnter?.(e.target.value);
    },
  });
  input.value = value ?? '';

  const wrap = h(
    'div',
    { class: 'c-field', style: width ? { width } : null },
    ic ? h('span', { class: 'c-field__icon', html: icon(ic, 14) }) : null,
    input
  );
  wrap.input = input;
  // NavSearch 和应用外部状态都需要静默更新；不派发 input，避免循环回调。
  wrap.set = (v) => {
    input.value = v ?? '';
  };
  wrap.value = () => input.value;
  wrap.setDisabled = (v) => applyControlState(input, { disabled: v });
  wrap.setReadonly = (v) => applyControlState(input, { readonly: v });
  wrap.setInvalid = (v) => {
    applyControlState(input, { invalid: v });
    if (v) wrap.dataset.invalid = '1';
    else delete wrap.dataset.invalid;
  };
  wrap.focus = () => input.focus();
  wrap.dispose = () => {};
  return wrap;
}
