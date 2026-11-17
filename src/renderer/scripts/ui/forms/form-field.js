// Golden Gate · forms/form-field
import { h } from '../../core/dom.js';
import { applyControlState } from '../_shared/control.js';
import { createDisposer } from '../_shared/disposer.js';

/* ==========================================================================
   46. 表单 Form / FormField

   表单本身不持有值：值永远留在控件里，Form 只做「收集、校验、协调提交」。
   这样 Field / Select / Switch 能单独使用，也能被 Form 包一层，
   不出现两份状态互相打架。

   标签必须是真的 <label for>：屏幕阅读器点和读都依赖它。
   复合控件（Select / Switch / Checkbox）没有内部 input，
   降级成 span + aria-labelledby，绝不写一个指不到东西的 for。
   ========================================================================== */

let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

function findInput(control) {
  if (!control) return null;
  if (control.matches?.('input, textarea, select')) return control;
  if (control.input?.matches?.('input, textarea, select')) return control.input;
  return control.querySelector?.('input, textarea, select') ?? null;
}

export function FormField({
  id = '',
  label = '',
  hint = '',
  required = false,
  control = null,
  actions = null,
  layout = 'stacked',
  labelWidth = '96px',
  validate,
  validateOn = 'blur',
  className = '',
} = {}) {
  const input = findInput(control);
  const fieldId = id || input?.id || nextId('ff');

  // 显式给了 id 就落在真正可聚焦的元素上，label 才能指对；
  // 没给则沿用 input 自带的 id，最后才退回生成值。
  if (input) {
    if (id) input.id = id;
    else if (!input.id) input.id = nextId('ff-input');
  }

  const el = h('div', {
    class: `c-formfield${layout === 'inline' ? ' c-formfield--inline' : ''} ${className}`.trim(),
    style: layout === 'inline' ? { '--ff-label-w': labelWidth } : null,
  });
  el.dataset.fieldId = fieldId;
  el.fieldId = fieldId;
  el.control = control;
  el.input = input;

  const target = input ?? control;

  // —— 标签 ——
  const labelEl = h(
    input ? 'label' : 'span',
    {
      class: 'c-formfield__label',
      for: input ? input.id : null,
      id: input ? null : `${fieldId}-label`,
    },
    label,
    required
      ? h('span', { class: 'c-formfield__req', 'aria-hidden': 'true' }, '*')
      : null
  );

  const head = h(
    'div',
    { class: 'c-formfield__head' },
    label ? labelEl : null,
    actions ? h('div', { class: 'c-formfield__actions' }, actions) : null
  );

  // 没有 input 时 label 只能靠 aria-labelledby；保留调用方原有的关联再追加。
  if (!input && control && label) {
    const prev = control.getAttribute('aria-labelledby');
    control.setAttribute('aria-labelledby', [prev, labelEl.id].filter(Boolean).join(' '));
  }

  // 必填对原生 input 与复合控件都走 aria-required：不要用 required 触发浏览器气泡，
  // 校验文案由这里统一控制。
  if (required && target) target.setAttribute('aria-required', 'true');

  // —— 说明与错误 ——
  // 两者都用 aria-describedby 关联；错误元素只在真的有错时插入，
  // 否则 role=alert 会在每次输入时把「空文本」也播报一遍。
  const baseDescribedBy = target?.getAttribute('aria-describedby') || '';
  const hintEl = hint ? h('div', { class: 'c-formfield__hint', id: `${fieldId}-hint` }, hint) : null;
  const foot = h('div', { class: 'c-formfield__foot' }, hintEl);

  let errorEl = null;
  let errorMsg = '';
  let version = 0;
  let disposed = false;
  const disposer = createDisposer();

  const syncDescribedBy = () => {
    if (!target) return;
    const ids = [baseDescribedBy, hintEl?.id, errorEl?.id].filter(Boolean);
    if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
    else target.removeAttribute('aria-describedby');
  };
  syncDescribedBy();

  const paintInvalid = (invalid) => {
    if (typeof control?.setInvalid === 'function') control.setInvalid(invalid);
    else if (target) applyControlState(target, { invalid });
    if (invalid) el.dataset.invalid = '1';
    else delete el.dataset.invalid;
  };

  const setError = (msg) => {
    errorMsg = String(msg ?? '');
    if (!errorMsg) {
      clearError();
      return;
    }
    if (!errorEl) {
      errorEl = h('div', {
        class: 'c-formfield__error',
        id: `${fieldId}-error`,
        role: 'alert',
      });
      foot.append(errorEl);
    }
    errorEl.textContent = errorMsg;
    paintInvalid(true);
    syncDescribedBy();
  };

  function clearError() {
    errorMsg = '';
    if (errorEl) {
      errorEl.remove();
      errorEl = null;
    }
    paintInvalid(false);
    syncDescribedBy();
  }

  // —— 值转发 ——
  el.value = () => {
    if (typeof control?.value === 'function') return control.value();
    if (!input) return '';
    if (input.type === 'checkbox') return input.checked;
    return input.value;
  };

  el.setValue = (v) => {
    if (typeof control?.set === 'function') control.set(v);
    else if (input) {
      if (input.type === 'checkbox') input.checked = !!v;
      else input.value = v ?? '';
    }
    // 值已被程序改动，旧错误不再可信
    clearError();
  };

  el.setError = setError;
  el.clearError = clearError;
  el.error = () => errorMsg;

  el.setDisabled = (v) => {
    if (typeof control?.setDisabled === 'function') control.setDisabled(v);
    else if (target) applyControlState(target, { disabled: v });
    if (v) el.dataset.disabled = '1';
    else delete el.dataset.disabled;
  };

  el.setReadonly = (v) => {
    if (typeof control?.setReadonly === 'function') control.setReadonly(v);
    else if (target) applyControlState(target, { readonly: v });
    if (v) el.dataset.readonly = '1';
    else delete el.dataset.readonly;
  };

  el.focus = () => target?.focus?.();

  // —— 校验 ——
  // 版本号解决「慢请求后返回覆盖新结果」：每次校验自增，
  // 回来时不是最新号就直接丢弃，dispose 后再回来同样丢弃。
  const runValidate = async () => {
    const mine = ++version;
    let msg = null;
    try {
      msg = await validate(el.value());
    } catch (err) {
      msg = err?.message || '校验失败';
    }
    if (disposed || mine !== version) return false;
    if (msg) {
      setError(msg);
      return false;
    }
    clearError();
    return true;
  };

  el.validate = () => {
    if (disposed) return Promise.resolve(false);
    if (typeof validate !== 'function') return Promise.resolve(true);
    return runValidate();
  };

  if (typeof validate === 'function' && target) {
    if (validateOn === 'blur') {
      // focusout 会冒泡，复合控件内部换焦点也能收到；blur 不冒泡，靠不住。
      disposer.on(target, 'focusout', (e) => {
        // 焦点还在本控件内部移动（例如清空按钮）不算离开，先别报错
        if (control?.contains?.(e.relatedTarget)) return;
        runValidate();
      });
    } else if (validateOn === 'input') {
      disposer.on(target, 'input', () => {
        // 正在改就先撤掉旧错误，避免用户已经改对了还红着
        clearError();
        runValidate();
      });
    }
  }

  const body = h('div', { class: 'c-formfield__body' }, control);

  el.append(head, body, foot);

  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    // 让所有在途校验作废，回调回来时版本号不匹配
    version += 1;
    disposer.dispose();
  };

  return el;
}

/* ==========================================================================
   Form

   只做三件事：收集已注册字段、串行到「全部通过」、提交期间锁住按钮。
   原生 submit 一定 preventDefault，否则页面会整页刷新；
   Enter 走浏览器默认的隐式提交，但输入法组合期的 Enter 必须拦掉。
   ========================================================================== */

export function Form({
  children = null,
  label = '',
  onSubmit,
  onReset,
  submitLabel = '保存',
  cancelLabel = '',
  onCancel,
  actions = null,
  className = '',
} = {}) {
  const registry = new Set();
  const disposer = createDisposer();
  let pending = false;

  const register = (field) => {
    if (!field) return () => {};
    registry.add(field);
    return () => registry.delete(field);
  };

  const fields = () => [...registry];

  const readField = (field) => {
    if (typeof field.value === 'function') return field.value();
    const inp = field.querySelector?.('input, textarea, select');
    if (!inp) return null;
    return inp.type === 'checkbox' ? inp.checked : inp.value;
  };

  const values = () => {
    const out = {};
    for (const field of registry) {
      const key =
        field.fieldId || field.dataset?.fieldId || field.querySelector?.('input')?.id || '';
      if (key) out[key] = readField(field);
    }
    return out;
  };

  const submitBtn = actions
    ? null
    : h('button', { class: 'c-btn c-btn--primary', type: 'submit' }, submitLabel);
  const cancelBtn =
    actions || !cancelLabel
      ? null
      : h(
          'button',
          {
            class: 'c-btn',
            type: 'button',
            onclick: () => onCancel?.(),
          },
          cancelLabel
        );

  const actionsEl = actions
    ? h('div', { class: 'c-form__actions' }, actions)
    : h('div', { class: 'c-form__actions' }, cancelBtn, submitBtn);

  const doSubmit = async () => {
    // 提交中再按一次不能发第二遍 —— 校验也可能很慢，所以先上锁再校验
    if (pending) return false;
    setPending(true);
    try {
      if (!(await el.validate())) return false;
      await onSubmit?.(values());
      return true;
    } catch (err) {
      console.warn('[golden-gate] 表单提交失败', err);
      return false;
    } finally {
      setPending(false);
    }
  };

  const el = h(
    'form',
    {
      class: `c-form ${className}`.trim(),
      // 校验全部由 FormField 负责，关掉浏览器自带气泡，避免两套提示
      novalidate: true,
      'aria-label': label || null,
    },
    children,
    actionsEl
  );

  // 监听登记在 disposer 上，dispose 时才真的能摘掉
  disposer.on(el, 'submit', (e) => {
    e.preventDefault();
    doSubmit();
  });
  disposer.on(el, 'reset', () => {
    onReset?.();
  });
  disposer.on(el, 'keydown', (e) => {
    if (e.key !== 'Enter' || !(e.isComposing || e.keyCode === 229)) return;
    // 组合期按 Enter 是在选词，不能让它触发隐式提交
    e.preventDefault();
  });

  // 覆盖原生 form.submit（会整页导航的那个），统一走「先校验再提交」
  el.submit = doSubmit;
  el.register = register;
  el.fields = fields;
  el.values = values;

  el.validate = async () => {
    const list = fields();
    const results = await Promise.all(
      list.map((field) =>
        typeof field.validate === 'function'
          ? Promise.resolve()
              .then(() => field.validate())
              .catch(() => false)
          : Promise.resolve(true)
      )
    );
    const bad = list[results.findIndex((ok) => !ok)];
    if (bad) {
      // 只有第一个错误需要聚焦：一次把焦点扔到多处反而让人迷路
      bad.focus?.();
      return false;
    }
    return true;
  };

  function setPending(v) {
    pending = !!v;
    if (pending) el.setAttribute('aria-busy', 'true');
    else el.removeAttribute('aria-busy');
    for (const btn of [submitBtn, cancelBtn]) {
      if (btn) btn.disabled = pending;
    }
  }

  el.setPending = setPending;

  // 已有子树里的字段自动接管；后加的手动 register()
  for (const node of el.querySelectorAll('.c-formfield')) register(node);

  el.dispose = () => {
    if (disposer.disposed) return;
    disposer.dispose();
    registry.clear();
  };

  return el;
}
