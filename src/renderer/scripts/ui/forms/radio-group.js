// Golden Gate · forms/radio-group
import { h } from '../../core/dom.js';
import { applyControlState } from '../_shared/control.js';

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
  el.setDisabled = (v) => {
    applyControlState(el, { disabled: v });
    for (const row of el.children) applyControlState(row, { disabled: v });
  };
  el.setInvalid = (v) => applyControlState(el, { invalid: v });
  el.dispose = () => {};
  return el;
}
