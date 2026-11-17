// Golden Gate · forms/checkbox
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { applyControlState } from '../_shared/control.js';

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
    state = !!v;
    el.setAttribute('aria-checked', String(state));
    paint();
  };
  el.value = () => state;
  el.setDisabled = (v) => applyControlState(el, { disabled: v });
  el.setInvalid = (v) => applyControlState(el, { invalid: v });
  el.dispose = () => {};
  return el;
}
