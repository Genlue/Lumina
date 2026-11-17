// Golden Gate · controls/switch
import { h } from '../../core/dom.js';
import { applyControlState } from '../_shared/control.js';

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
  el.set = (v) => el.setAttribute('aria-checked', String(!!v));
  el.value = () => el.getAttribute('aria-checked') === 'true';
  el.setDisabled = (v) => applyControlState(el, { disabled: v });
  el.setInvalid = (v) => applyControlState(el, { invalid: v });
  el.dispose = () => {};
  return el;
}
