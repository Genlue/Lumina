// Golden Gate · appearance/swatches
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

/* ==========================================================================
   16. 强调色预设
   —— macOS 27 的系统强调色盘
   ========================================================================== */

export const ACCENT_PRESETS = [
  { id: 'blue', label: '蓝色', value: '#0a84ff' },
  { id: 'purple', label: '紫色', value: '#bf5af2' },
  { id: 'pink', label: '粉色', value: '#ff375f' },
  { id: 'red', label: '红色', value: '#ff453a' },
  { id: 'orange', label: '橙色', value: '#ff9f0a' },
  { id: 'yellow', label: '黄色', value: '#ffd60a' },
  { id: 'green', label: '绿色', value: '#30d158' },
  { id: 'graphite', label: '石墨', value: '#8e8e93' },
];

/**
 * 强调色圆点选择器。
 * @param {object} o
 * @param {string} [o.value] 当前色值（小写十六进制）
 * @param {(hex:string)=>void} [o.onChange]
 * @param {boolean} [o.allowCustom=true] 末尾追加一个自定义色盘
 */
export function Swatches({ value = '', onChange, allowCustom = true, multi = false } = {}) {
  const norm = (s) => String(s || '').toLowerCase();

  const row = h('div', { class: 'c-swatches', role: 'radiogroup' });
  let current = norm(value);

  const select = (hex, silent = false) => {
    current = norm(hex);
    [...row.children].forEach((el) => {
      const v = el.dataset.value ? norm(el.dataset.value) : '';
      el.setAttribute('aria-checked', String(v === current));
    });
    if (!silent) onChange?.(hex);
  };

  const dot = (opts) =>
    h(
      'button',
      {
        class: `c-swatch ${opts.cls || ''}`.trim(),
        type: 'button',
        role: 'radio',
        'aria-checked': String(norm(opts.value) === current),
        'aria-label': opts.label,
        title: opts.label,
        dataset: opts.value ? { value: opts.value } : {},
        style: opts.style || null,
        onclick: opts.onClick,
      },
      opts.child || null
    );

  for (const p of ACCENT_PRESETS) {
    row.append(
      dot({
        value: p.value,
        label: p.label,
        style: { '--sw': p.value },
        onClick: () => select(p.value),
      })
    );
  }

  if (multi) {
    row.append(
      dot({
        label: '多彩',
        cls: 'c-swatch--multi',
        onClick: () => select('multi'),
      })
    );
  }

  if (allowCustom) {
    const picker = h('input', {
      type: 'color',
      value: current.startsWith('#') ? current : '#0a84ff',
      style: { position: 'absolute', opacity: '0', width: '0', height: '0', pointerEvents: 'none' },
      oninput: (e) => select(e.target.value),
    });
    row.append(
      dot({
        label: '自定义强调色',
        cls: 'c-swatch--custom',
        child: h('span', { html: icon('plus', 12) }),
        onClick: () => picker.click(),
      }),
      picker
    );
  }

  row.set = (hex) => select(hex, true);
  row.value = () => current;
  return row;
}
