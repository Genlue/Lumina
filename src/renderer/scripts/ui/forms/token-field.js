// Golden Gate · forms/token-field
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { createDisposer } from '../_shared/disposer.js';
import { applyControlState } from '../_shared/control.js';
import { openLayer, positionLayer } from '../_shared/overlay.js';

/* ==========================================================================
   55. 令牌输入 TokenField

   Chip + 组合框 + 光标模型的合体：输入框里的文字是「正在敲的查询」，
   左边的 token 是「已确认的值」。两者必须分开存 —— 合在一起就表达不了
   「打了一半但还没确认」这个中间态，onChange 也会每敲一键响一次。

   键盘模型（桌面邮件客户端的惯例）：
     输入框空时 ← 进入 token 序列；token 上 ←→ 移动，最后一枚再按 → 回到输入框；
     Backspace 两阶段 —— 先「选中」最后一枚（data-armed），再按一次才删；
     输入框里 Enter / , / Tab 提交文本，Esc 清空；Delete 只删当前聚焦的 token。
   「先选中再删」不是多余的一步：直接删会让「想删但按错了」无法撤销。

   中文输入法：composition 期间与 keyCode 229 的 Enter 一律不提交，
   否则选词的回车会把半截拼音变成 token。输入法上屏的「，」同样当分隔符。
   ========================================================================== */

let seq = 0;

const SEPARATORS = /[,，;；\n\r]+/;

const normalize = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((token) => token !== null && token !== undefined)
    .map((token) =>
      typeof token === 'string'
        ? { value: token, label: token }
        : { value: token.value, label: token.label ?? String(token.value ?? '') }
    )
    .filter((token) => token.value !== undefined && token.value !== null && token.value !== '');

const splitText = (text) =>
  String(text ?? '')
    .split(SEPARATORS)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ value: part, label: part }));

export function TokenField({
  tokens = [],
  placeholder = '输入后回车',
  label = '',
  suggest,
  parse,
  allowCustom = true,
  max = 0,
  validateToken,
  onChange,
  renderToken,
  className = '',
} = {}) {
  const uid = `tok-${++seq}`;
  const errorId = `${uid}-err`;
  const listId = `${uid}-list`;

  const disposer = createDisposer();

  let items = normalize(tokens);
  let tokenEls = [];
  let disabled = false;
  let disposed = false;
  let composing = false;
  let armed = -1;
  let limit = Number(max) > 0 ? Number(max) : 0;

  // 最近一次 suggest 的结果：回车时用它把「文本」对回「值」
  let suggestions = [];
  let suggestSeq = 0;

  let panelOpen = false;
  let layer = null;
  let pos = null;
  let activeIndex = -1;
  let optionEls = [];

  /* ---------------- DOM ---------------- */

  const input = h('input', {
    class: 'c-tokenfield__input',
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder,
    'aria-label': label || placeholder || '添加令牌',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-describedby': errorId,
  });

  const countEl = h('span', { class: 'c-tokenfield__count', 'aria-hidden': 'true', hidden: true });
  const errorEl = h('div', { class: 'c-tokenfield__error', id: errorId, role: 'alert', hidden: true });

  const el = h('div', { class: `c-tokenfield ${className}`.trim() }, input, countEl, errorEl);

  const panel = h('div', {
    class: 'c-tokenfield__panel',
    id: listId,
    role: 'listbox',
    'aria-label': '候选项',
  });

  /* ---------------- 状态 ---------------- */

  const full = () => limit > 0 && items.length >= limit;

  function notify() {
    onChange?.(items.map((token) => ({ ...token })));
  }

  function showError(message) {
    const text = String(message ?? '');
    errorEl.textContent = text;
    errorEl.hidden = !text;
    if (text) {
      el.dataset.invalid = '1';
      applyControlState(input, { invalid: true });
    }
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.hidden = true;
    delete el.dataset.invalid;
    applyControlState(input, { invalid: false });
  }

  function syncCount() {
    if (!limit) {
      countEl.hidden = true;
      delete el.dataset.full;
      input.readOnly = false;
      input.placeholder = placeholder;
      return;
    }
    countEl.hidden = false;
    countEl.textContent = `${items.length} / ${limit}`;
    const reached = items.length >= limit;
    if (reached) el.dataset.full = '1';
    else delete el.dataset.full;
    // 上限到了就不再接受输入，但保留焦点：用户仍要能用方向键回看 token
    input.readOnly = reached;
    input.placeholder = reached ? '已达上限' : placeholder;
  }

  /* ---------------- 渲染 ---------------- */

  function buildToken(token, index) {
    const node = h('span', {
      class: 'c-tokenfield__token',
      tabindex: disabled ? '-1' : '0',
      dataset: { value: String(token.value) },
    });

    const custom = renderToken?.(token, { remove: () => removeAt(index) });
    if (custom instanceof Node) node.append(custom);
    else node.append(h('span', { class: 'c-tokenfield__label' }, token.label ?? String(token.value)));

    node.append(
      h('button', {
        class: 'c-tokenfield__remove',
        type: 'button',
        // 删除按钮不进 Tab 序列：token 本身已经可聚焦，再停一次会把 Tab 路程翻倍
        tabindex: '-1',
        'aria-label': `移除 ${token.label ?? token.value}`,
        disabled: disabled || null,
        html: icon('x', 10),
      })
    );

    return node;
  }

  function render() {
    for (const node of tokenEls) node.remove();
    tokenEls = items.map((token, index) => buildToken(token, index));
    input.before(...tokenEls);
    armed = -1;
    syncCount();
  }

  /* ---------------- 增删 ---------------- */

  function addToken(raw) {
    if (!raw) return false;
    const value = raw.value;
    if (value === undefined || value === null || value === '') return false;

    // 去重按 value：同一个收件人用 label 和用 id 敲进来都只留一条
    if (items.some((token) => String(token.value) === String(value))) return true;
    if (full()) {
      showError(`最多 ${limit} 个`);
      return false;
    }

    const token = { value, label: raw.label ?? String(value) };
    const message = validateToken?.(token);
    if (message) {
      showError(message);
      return false;
    }

    items.push(token);
    return true;
  }

  function removeAt(index) {
    if (disabled || index < 0 || index >= items.length) return;
    const hadFocus = tokenEls[index]?.contains(document.activeElement) ?? false;

    items.splice(index, 1);
    armed = -1;
    clearError();
    render();
    notify();

    if (hadFocus) {
      const next = tokenEls[Math.min(index, tokenEls.length - 1)];
      if (next) next.focus({ preventScroll: true });
      else input.focus({ preventScroll: true });
    }
  }

  /* ---------------- 提交文本 ---------------- */

  // 输入框里的一段文字 → token。对象（来自 parse / suggest）直接就绪，
  // 纯文本先精确对候选，再决定要不要当自建值。
  function resolve(piece) {
    if (piece && typeof piece === 'object') {
      const value = piece.value ?? piece.id;
      if (value === undefined || value === null || value === '') return null;
      return { value, label: piece.label ?? String(value) };
    }
    const text = String(piece ?? '').trim();
    if (!text) return null;

    const hit = suggestions.find(
      (option) => String(option.label) === text || String(option.value) === text
    );
    if (hit) return { value: hit.value, label: hit.label ?? String(hit.value) };
    if (allowCustom) return { value: text, label: text };

    showError(`没有匹配「${text}」的候选项`);
    return null;
  }

  function commitText(text) {
    const raw = String(text ?? '');
    if (!raw.trim()) return { added: 0, failed: 0 };

    let pieces = null;
    if (parse) {
      try {
        pieces = parse(raw);
      } catch {
        pieces = null;
      }
    }
    if (!Array.isArray(pieces) || !pieces.length) pieces = splitText(raw);

    let added = 0;
    let failed = 0;
    for (const piece of pieces) {
      const token = resolve(piece);
      if (!token) {
        failed += 1;
        continue;
      }
      if (addToken(token)) added += 1;
      else failed += 1;
    }

    // 批量解析也要走同一套出口：先落 DOM，再通知，避免 onChange 比画面早一步
    if (added) {
      render();
      notify();
    }
    return { added, failed };
  }

  function commitFromInput() {
    if (disabled) return false;
    if (full()) {
      showError(`最多 ${limit} 个`);
      return false;
    }
    const { added, failed } = commitText(input.value);
    if (!added) return false;
    // 有失败项就把原文留在框里，让用户改，别把输入吞掉
    if (!failed) {
      input.value = '';
      suggestions = [];
      suggestSeq += 1;
      closePanel('commit');
    }
    return true;
  }

  /* ---------------- 建议浮层 ---------------- */

  function paintActive(index) {
    if (optionEls[activeIndex]) optionEls[activeIndex].setAttribute('aria-selected', 'false');
    activeIndex = index;
    const node = optionEls[index];
    if (!node) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    node.setAttribute('aria-selected', 'true');
    // 焦点始终留在输入框，靠 aria-activedescendant 把「当前项」告诉读屏
    input.setAttribute('aria-activedescendant', node.id);
    node.scrollIntoView?.({ block: 'nearest' });
  }

  function moveActive(delta) {
    const total = optionEls.length;
    if (!total) return;
    for (let step = 0; step < total; step += 1) {
      const at =
        activeIndex < 0
          ? delta > 0
            ? 0
            : total - 1
          : (activeIndex + delta + total) % total;
      if (!suggestions[at]?.disabled) {
        paintActive(at);
        return;
      }
      activeIndex = at;
    }
  }

  function commitCandidate(index) {
    const option = suggestions[index];
    if (!option || option.disabled) return;
    if (!addToken({ value: option.value, label: option.label ?? String(option.value) })) return;

    clearError();
    render();
    notify();
    input.value = '';
    suggestions = [];
    suggestSeq += 1;
    closePanel('commit');
    input.focus({ preventScroll: true });
  }

  function renderOptions() {
    activeIndex = -1;
    optionEls = [];
    panel.replaceChildren();
    input.removeAttribute('aria-activedescendant');

    suggestions.forEach((option, index) => {
      const node = h(
        'div',
        {
          class: 'c-tokenfield__option',
          role: 'option',
          id: `${uid}-opt-${index}`,
          'aria-selected': 'false',
          'aria-disabled': option.disabled ? 'true' : null,
        },
        h('span', { class: 'c-tokenfield__option-label' }, option.label ?? String(option.value)),
        option.hint ? h('span', { class: 'c-tokenfield__option-hint' }, option.hint) : null
      );
      // pointerdown 而不是 click：click 之前焦点已经离开输入框，会被层栈判成外部点击
      node.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        commitCandidate(index);
      });
      node.addEventListener('pointerenter', () => {
        if (!option.disabled) paintActive(index);
      });

      optionEls.push(node);
      panel.append(node);
    });
  }

  function handleClose() {
    panelOpen = false;
    layer = null;
    pos?.stop();
    pos = null;
    activeIndex = -1;
    optionEls = [];
    panel.remove();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function closePanel(reason = 'api') {
    if (layer) {
      layer.close(reason);
      return;
    }
    if (panelOpen) handleClose();
  }

  function openPanel() {
    if (panelOpen || disposed || disabled) return;
    document.body.append(panel);
    panelOpen = true;

    layer = openLayer({
      el: panel,
      container: panel,
      modal: false,
      trap: false,
      dismissible: true,
      outside: true,
      // 字段本身与输入框都不算「外面」，否则在框里点一下就把候选关了
      ignore: [el, input],
      initialFocus: 'none',
      returnFocus: false,
      onClose: handleClose,
    });
    panel.style.zIndex = String(900 + layer.level * 20);

    pos = positionLayer(panel, {
      anchor: el,
      placement: 'bottom',
      align: 'start',
      gap: 6,
      matchWidth: true,
      onHidden: () => layer?.close('hidden'),
    });

    input.setAttribute('aria-expanded', 'true');
  }

  function requestSuggest(query) {
    const text = String(query ?? '').trim();
    if (!suggest || !text || disabled || full()) {
      suggestions = [];
      suggestSeq += 1;
      closePanel('reset');
      return;
    }

    const ticket = ++suggestSeq;
    let result;
    try {
      result = suggest(text);
    } catch {
      result = [];
    }

    Promise.resolve(result)
      .then((list) => {
        // 慢响应后到不能盖掉新结果：只认最后一次请求
        if (disposed || ticket !== suggestSeq) return;
        if (input.value.trim() !== text) return;
        suggestions = Array.isArray(list) ? list.filter(Boolean) : [];
        renderOptions();
        if (suggestions.length) {
          openPanel();
          pos?.update();
        } else {
          closePanel('empty');
        }
      })
      .catch(() => {
        if (disposed || ticket !== suggestSeq) return;
        suggestions = [];
        renderOptions();
        closePanel('error');
      });
  }

  /* ---------------- 键盘 ---------------- */

  function focusToken(index) {
    const node = tokenEls[index];
    if (!node) return;
    // 焦点换到别处，armed 的「待删」语义就不成立了
    clearArmed();
    node.focus({ preventScroll: true });
    node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function clearArmed() {
    if (armed >= 0 && tokenEls[armed]) delete tokenEls[armed].dataset.armed;
    armed = -1;
  }

  function arm(index) {
    clearArmed();
    if (!tokenEls[index]) return;
    armed = index;
    tokenEls[index].dataset.armed = '1';
  }

  function onInputKey(e) {
    const composingKey = e.isComposing || e.keyCode === 229;

    if (panelOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        moveActive(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        moveActive(-1);
        return;
      }
      if (e.key === 'Escape') {
        // 只收候选，文本留着 —— 用户按 Esc 是想改字，不是想清空
        e.preventDefault();
        e.stopPropagation();
        closePanel('escape');
        return;
      }
      if (e.key === 'Enter' && !composingKey) {
        e.preventDefault();
        e.stopPropagation();
        if (activeIndex >= 0) commitCandidate(activeIndex);
        else commitFromInput();
        return;
      }
    }

    if (e.key === 'ArrowLeft' && !input.value) {
      if (!tokenEls.length) return;
      e.preventDefault();
      focusToken(tokenEls.length - 1);
      return;
    }

    if (e.key === 'Backspace' && !input.value) {
      if (!tokenEls.length) return;
      e.preventDefault();
      const last = tokenEls.length - 1;
      if (armed === last) removeAt(last);
      else arm(last);
      return;
    }

    if (e.key === 'Enter') {
      if (composingKey) return; // 选词回车不是提交
      e.preventDefault();
      commitFromInput();
      return;
    }

    if ((e.key === ',' || e.key === '，') && !composingKey) {
      e.preventDefault();
      commitFromInput();
      return;
    }

    if (e.key === 'Tab') {
      // Tab 是「填完继续走」：提交但不拦焦点，让它照常往后移
      if (!panelOpen && input.value.trim()) commitFromInput();
      else closePanel('tab');
      return;
    }

    if (e.key === 'Escape') {
      if (!input.value) return; // 没东西可清就交给外层
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      clearArmed();
      clearError();
      closePanel('escape');
    }
  }

  function onTokenKey(e, node) {
    const index = tokenEls.indexOf(node);
    if (index < 0) return;
    const composingKey = e.isComposing || e.keyCode === 229;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) focusToken(index - 1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < tokenEls.length - 1) focusToken(index + 1);
      else {
        clearArmed();
        input.focus({ preventScroll: true });
      }
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      focusToken(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      focusToken(tokenEls.length - 1);
      return;
    }
    if (e.key === 'Delete') {
      // Delete 是「直接删掉这一个」，不需要两阶段确认
      e.preventDefault();
      removeAt(index);
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (armed === index) removeAt(index);
      else arm(index);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      // token 上没有激活动作；空格只吞掉，免得页面往下滚
      if (e.key !== 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      input.focus({ preventScroll: true });
      return;
    }
    // 聚焦在 token 上直接打字 = 想编辑查询：把焦点和这个字符一起交给输入框
    if (!composingKey && !full() && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      clearArmed();
      input.focus({ preventScroll: true });
      input.value += e.key;
      requestSuggest(input.value);
    }
  }

  disposer.on(el, 'keydown', (e) => {
    if (e.defaultPrevented) return;
    const target = e.target;
    // 删除按钮是鼠标入口，键盘删除走 token 自身的 Delete
    if (target.closest?.('.c-tokenfield__remove')) return;
    const tokenNode = target.closest?.('.c-tokenfield__token');
    if (tokenNode && tokenEls.includes(tokenNode)) onTokenKey(e, tokenNode);
    else if (target === input) onInputKey(e);
  });

  disposer.on(el, 'click', (e) => {
    const removeBtn = e.target.closest?.('.c-tokenfield__remove');
    if (!removeBtn) return;
    const tokenNode = removeBtn.closest('.c-tokenfield__token');
    const index = tokenNode ? tokenEls.indexOf(tokenNode) : -1;
    if (index >= 0) removeAt(index);
  });

  // 点在容器的空白处（padding / token 之间的缝）应该进入输入，
  // 否则 cursor:text 是在骗人
  disposer.on(el, 'pointerdown', (e) => {
    if (e.target !== el || disabled) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
  });

  /* ---------------- 输入与粘贴 ---------------- */

  disposer.on(input, 'compositionstart', () => {
    composing = true;
  });

  disposer.on(input, 'compositionend', () => {
    composing = false;
  });

  disposer.on(input, 'input', () => {
    // 组合期的 value 只是拼音串，分词会把「zhong」当成一个人
    if (composing) return;
    clearArmed();

    // 输入法上屏的「，」不会走 keydown，只能在值里认
    if (SEPARATORS.test(input.value)) {
      const { added, failed } = commitText(input.value);
      // commitText 已经把分隔出来的每一段都处理过了，成功就直接清空
      if (added && !failed) {
        input.value = '';
        suggestions = [];
        suggestSeq += 1;
        closePanel('commit');
      }
      return;
    }

    requestSuggest(input.value);
  });

  disposer.on(input, 'paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!text) return;

    // parse 在，整段交给它；否则只有确实带分隔符/换行的才当批量，单段文本照常粘贴
    const batch = !!parse || SEPARATORS.test(text);
    if (!batch) return;

    e.preventDefault();
    const { added, failed } = commitText(text);
    if (added && !failed) {
      input.value = '';
      suggestions = [];
      suggestSeq += 1;
      closePanel('paste');
    } else if (failed) {
      // 有段没通过校验：把原文留在框里，用户还能改，不要静默吞掉
      input.value = text;
    }
  });

  disposer.on(input, 'blur', () => {
    // 组合中被外部打断时 compositionend 不会来，别让标志位一直挂着
    composing = false;
  });

  /* ---------------- 对外接口 ---------------- */

  el.input = input;
  el.panel = panel;

  el.set = (next) => {
    items = normalize(next);
    armed = -1;
    clearError();
    // 程序赋值会换掉整份数据，候选浮层里的旧列表已经没有意义
    closePanel('set');
    render();
  };

  // 值就是 token 数组本身（{value,label}）。value() 与 tokens() 是同一件事的
  // 两个读法：前者对齐统一控件契约，后者在调用处读起来更明确。返回副本，
  // 避免外部直接 push 改到内部状态。
  el.value = () => items.map((token) => ({ ...token }));
  el.tokens = () => el.value();

  el.clear = () => {
    if (disabled) return;
    items = [];
    armed = -1;
    clearError();
    render();
    notify();
    input.focus({ preventScroll: true });
  };

  el.setDisabled = (v) => {
    disabled = !!v;
    applyControlState(el, { disabled });
    applyControlState(input, { disabled });
    if (disabled) closePanel('disabled');
    for (const node of tokenEls) {
      node.tabIndex = disabled ? -1 : 0;
      const button = node.querySelector('.c-tokenfield__remove');
      if (button) button.disabled = disabled;
    }
  };

  el.setInvalid = (v) => {
    if (v) {
      el.dataset.invalid = '1';
      applyControlState(input, { invalid: true });
    } else {
      clearError();
    }
  };

  el.focus = () => input.focus({ preventScroll: true });

  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    suggestSeq += 1;
    closePanel('dispose');
    pos?.stop();
    pos = null;
    disposer.dispose();
  };

  render();
  return el;
}
