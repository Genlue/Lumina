// Golden Gate · forms/number-field
import { h, clamp } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { applyControlState } from '../_shared/control.js';

/* ==========================================================================
   56. 数值输入 NumberField

   type=number 不够用的三件事：
   1) 用户打 `-`、``、`1.`、`1.0` 的中间态会被浏览器直接吞掉；
   2) 不同 locale 的小数点是 `,` 还是 `.`，浏览器各自解释；
   3) 想按 step 走键盘、想在失焦时才提交，都没有口子。

   所以这里用 text 输入 + 自己的草稿状态：
   输入期间不覆盖用户的字，提交（失焦 / Enter）时才解析、夹取、格式化。

   千分位（grouping）同理只在「非编辑态」加：编辑时给数字插逗号会让光标
   在下一次输入后跳到别处，这是格式化输入最典型的坑。
   ========================================================================== */

const MINUS = /^[-−—]$/;
const TRAILING_DOT = /[.,]$/;

function decimalSeparator(locale) {
  try {
    const parts = new Intl.NumberFormat(locale || undefined).formatToParts(1.1);
    return parts.find((p) => p.type === 'decimal')?.value ?? '.';
  } catch {
    return '.';
  }
}

function groupSeparator(locale) {
  try {
    const parts = new Intl.NumberFormat(locale || undefined).formatToParts(12345.6);
    return parts.find((p) => p.type === 'group')?.value ?? ',';
  } catch {
    return ',';
  }
}

export function NumberField({
  value = 0,
  min = -Infinity,
  max = Infinity,
  step = 1,
  precision,
  locale = 'zh-CN',
  unit = '',
  grouping = false,
  label = '',
  placeholder = '',
  disabled = false,
  invalid = false,
  onInput,
  onChange,
  className = '',
} = {}) {
  const dec = decimalSeparator(locale);
  const grp = groupSeparator(locale);

  let current = clamp(Number(value) || 0, min, max);
  let draft = format(current);
  let editing = false;
  let invalidRaf = 0;
  let disposed = false;

  function digits(v) {
    if (precision != null) return v.toFixed(precision);
    // 去掉浮点误差尾巴：0.1 + 0.2 → 0.30000000000000004
    return String(Number(v.toFixed(10)));
  }

  /* 千分位只加在整数部分：符号、小数原样保留，`1,234.5` 不会变成 `1,234.5,0`。
     分组符按 locale 取（zh-CN 是逗号，de-DE 是句点），不写死。 */
  function groupText(text) {
    if (!grouping) return text;
    const sign = text.startsWith('-') ? '-' : '';
    const body = sign ? text.slice(1) : text;
    const dot = body.indexOf('.');
    const intPart = dot < 0 ? body : body.slice(0, dot);
    const rest = dot < 0 ? '' : body.slice(dot);
    return sign + intPart.replace(/\B(?=(\d{3})+(?!\d))/g, grp) + rest;
  }

  function format(v) {
    const text = groupText(digits(v));
    return unit ? `${text} ${unit}` : text;
  }

  function parse(text) {
    const raw = String(text).trim();
    if (!raw) return null;
    let cleaned = raw
      .replace(new RegExp(`\\s*${escapeRe(unit)}\\s*$`), '')
      .split(grp)
      .join('')
      .replace('−', '-')
      .replace('—', '-');
    if (dec !== '.') cleaned = cleaned.replace(dec, '.');
    cleaned = cleaned.replace(/[^\d.+-]/g, '');
    if (!cleaned || MINUS.test(cleaned) || cleaned === '.' || cleaned === '-.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function quantize(v) {
    const snapped = step > 0 ? Math.round((v - (min === -Infinity ? 0 : min)) / step) * step + (min === -Infinity ? 0 : min) : v;
    const rounded = Number(snapped.toFixed(precision ?? 10));
    return clamp(rounded, min, max);
  }

  const input = h('input', {
    class: 'c-field__input c-numberfield__input selectable',
    type: 'text',
    inputmode: 'decimal',
    role: 'spinbutton',
    autocomplete: 'off',
    'aria-label': label || null,
    'aria-invalid': invalid ? 'true' : null,
    placeholder,
    disabled: disabled || null,
    oninput: (e) => {
      draft = e.target.value;
      editing = true;
      const parsed = parse(draft);
      // 中间态（`-`、`1.`）不算输入事件，但也不覆盖用户正在打的字
      if (parsed != null) {
        current = clamp(parsed, min, max);
        paintAria();
        onInput?.(current);
      }
      e.target.dataset.drafting = TRAILING_DOT.test(draft) || MINUS.test(draft.trim()) ? '1' : '';
    },
    onfocus: () => {
      editing = true;
      input.value = digits(current);
      input.select?.();
    },
    onblur: () => {
      commit({ notify: true });
    },
    onkeydown: (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const big = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        bump((e.key === 'ArrowUp' ? 1 : -1) * step * big);
        return;
      }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        bump((e.key === 'PageUp' ? 1 : -1) * step * 10);
        return;
      }
      if (e.key === 'Home' && Number.isFinite(min)) {
        e.preventDefault();
        setSilent(min, { notify: true });
        return;
      }
      if (e.key === 'End' && Number.isFinite(max)) {
        e.preventDefault();
        setSilent(max, { notify: true });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        commit({ notify: true });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // 不把 Esc 继续传给外层浮层
        draft = format(current);
        input.value = draft;
        editing = false;
      }
    },
  });

  const spin = (dir) =>
    h('button', {
      class: 'c-numberfield__btn',
      type: 'button',
      tabindex: '-1',
      'aria-label': dir > 0 ? '增加' : '减少',
      html: icon(dir > 0 ? 'chevron-up' : 'chevron-down', 9),
      // 用 pointerdown 而不是 click：按下就连续走，和 NSStepper 一致
      onpointerdown: (e) => {
        e.preventDefault();
        bump(dir * step);
      },
    });

  const el = h(
    'div',
    { class: `c-numberfield ${className}`.trim() },
    input,
    h('span', { class: 'c-numberfield__spin' }, spin(1), spin(-1))
  );

  function paintAria() {
    input.setAttribute('aria-valuenow', digits(current));
    if (Number.isFinite(min)) input.setAttribute('aria-valuemin', digits(min));
    else input.removeAttribute('aria-valuemin');
    if (Number.isFinite(max)) input.setAttribute('aria-valuemax', digits(max));
    else input.removeAttribute('aria-valuemax');
    input.setAttribute('aria-valuetext', format(current));
  }

  function bump(delta) {
    if (disposed || input.disabled) return;
    setSilent(current + delta, { notify: true });
  }

  function setSilent(v, { notify = false } = {}) {
    if (disposed) return;
    const next = quantize(Number(v));
    const changed = next !== current;
    current = next;
    draft = format(current);
    input.value = editing ? digits(current) : draft;
    paintAria();
    if (changed && notify) {
      onInput?.(current);
      onChange?.(current);
    }
  }

  function commit({ notify = true } = {}) {
    if (disposed || input.disabled) return;
    const parsed = parse(input.value);
    editing = false;
    if (parsed == null) {
      // 不是数字：退回上一个合法值，并标一次 invalid（不永久留着）
      input.value = digits(current);
      input.dataset.invalidDraft = '1';
      // 只闪一帧就撤，别让输入框长期标红；句柄留给 dispose 取消
      if (invalidRaf) cancelAnimationFrame(invalidRaf);
      invalidRaf = requestAnimationFrame(() => {
        invalidRaf = 0;
        delete input.dataset.invalidDraft;
      });
      paintAria();
      return;
    }
    const next = quantize(parsed);
    const changed = next !== current;
    current = next;
    draft = format(current);
    input.value = draft;
    paintAria();
    if (changed && notify) onChange?.(current);
    if (!changed) onInput?.(current);
  }

  paintAria();
  input.value = draft;

  el.input = input;
  el.set = (v) => {
    if (disposed) return;
    current = clamp(Number(v) || 0, min, max);
    draft = format(current);
    input.value = editing ? digits(current) : draft;
    paintAria();
  };
  el.value = () => current;
  el.setDisabled = (v) => {
    if (disposed) return;
    applyControlState(input, { disabled: v });
    applyControlState(el, { disabled: v });
  };
  // 状态统一走 applyControlState：el 上落 data-invalid（给容器描边），
  // input 上落 aria-invalid（给读屏和 :has 选择器），不再手工写 dataset
  el.setInvalid = (v) => {
    if (disposed) return;
    applyControlState(input, { invalid: v });
    applyControlState(el, { invalid: v });
  };
  el.focus = () => input.focus();
  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    // 未执行的那一帧 invalidDraft 回调必须撤掉：它闭包着 input，
    // 页面已经拆掉后再跑会写到一个孤儿节点上
    if (invalidRaf) cancelAnimationFrame(invalidRaf);
    invalidRaf = 0;
    delete input.dataset.invalidDraft;
  };
  if (invalid) el.setInvalid(true);
  if (disabled) el.setDisabled(true);
  return el;
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
