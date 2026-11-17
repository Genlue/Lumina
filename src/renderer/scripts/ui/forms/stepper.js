// Golden Gate · forms/stepper
import { h, clamp } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { applyControlState } from '../_shared/control.js';

export function Stepper({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  orientation = 'vertical', // 'vertical'（NSStepper）| 'horizontal'（工具栏 − 值 +）
  label = '',
} = {}) {
  let current = clamp(value, min, max);
  let disabled = false;
  const vertical = orientation !== 'horizontal';

  const dec = h('button', {
    class: 'c-stepper__btn',
    type: 'button',
    'aria-label': '减少',
    html: icon(vertical ? 'chevron-down' : 'minus', vertical ? 10 : 12),
  });
  const inc = h('button', {
    class: 'c-stepper__btn',
    type: 'button',
    'aria-label': '增加',
    html: icon(vertical ? 'chevron-up' : 'plus', vertical ? 10 : 12),
  });
  const out = vertical ? null : h('span', { class: 'c-stepper__value' }, String(current));

  const paint = () => {
    if (out) out.textContent = String(current);
    inc.disabled = disabled || current >= max;
    dec.disabled = disabled || current <= min;
  };

  const bump = (d) => {
    if (disabled) return;
    const next = clamp(Number((current + d * step).toFixed(6)), min, max);
    if (next === current) return;
    current = next;
    paint();
    onChange?.(current);
  };

  dec.addEventListener('click', () => bump(-1));
  inc.addEventListener('click', () => bump(1));

  // 竖排是「增在上、减在下」（NSStepper）；横排是「减 值 增」
  const el = h(
    'div',
    {
      class: `c-stepper ${vertical ? '' : 'c-stepper--h'}`.trim(),
      role: 'group',
      'aria-label': label || null,
    },
    vertical ? inc : dec,
    vertical ? dec : out,
    vertical ? null : inc
  );

  paint();
  el.set = (v) => {
    current = clamp(v, min, max);
    paint();
  };
  el.value = () => current;
  el.setDisabled = (v) => {
    applyControlState(el, { disabled: v });
    disabled = !!v;
    paint();
  };
  el.dispose = () => {};
  return el;
}
