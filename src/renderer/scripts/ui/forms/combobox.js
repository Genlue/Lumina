// Golden Gate · forms/combobox
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { createDisposer } from '../_shared/disposer.js';
import { applyControlState } from '../_shared/control.js';
import { openLayer, positionLayer } from '../_shared/overlay.js';

/* ==========================================================================
   47. 组合框 Combobox

   和 Select 只差一件事，但决定了整个实现：输入框里的文字是「查询」，
   选中的值是「id」。两者分开放 —— 打字只改文本、把值置空（文本正好等于
   某项 label 时才顺手认一个值），确认后两者一起更新。合成一个字段的话，
   「已输入但未选中」这个中间态就表达不出来，onChange 还会每敲一键响一次。

   焦点始终留在输入框：候选只画高亮，用 aria-activedescendant 指过去。
   真把焦点移进列表会连带三个麻烦 —— 输入法候选窗被顶掉、继续打字要先
   Tab 回来、关闭后焦点归属还得单独记账。

   异步数据源有两条防线：AbortController 掐断在途请求，token 只认最新结果。
   只有前者不够 —— abort 是异步生效的，旧响应仍可能先回来覆盖新结果。

   面板挂在「最近的层容器」而不是 document.body：模态 Dialog / Sheet 会把
   背景节点设为 inert，面板如果留在 body 上，打开的那一刻连输入框一起被冻住。
   选项超过 200 条时只渲染窗口内的行（固定 28px），其余用上下占位撑高度。
   ========================================================================== */

let seq = 0;

export function Combobox({
  value = null,
  query = '',
  options = [],
  loadOptions,
  allowCustom = false,
  placeholder = '',
  label = '',
  width = '240px',
  emptyText = '没有匹配项',
  loadingText = '正在搜索…',
  debounce = 140,
  clearable = false,
  onChange,
  onInput,
  renderOption,
  filter,
  className = '',
} = {}) {
  const uid = `cbx-${++seq}`;
  const panelId = `${uid}-list`;

  let allOptions = Array.isArray(options) ? [...options] : [];
  let results = [];
  let currentValue = value ?? null;
  let state = 'ready'; // ready | loading | error
  let errorText = '';
  let lastQuery = null; // 最近一次真正查过的文本：重开列表时不必再请求一遍
  let activeIndex = -1;
  let optionEls = [];
  let openFlag = false;
  let layer = null;
  let pos = null;
  let controller = null;
  let requestToken = 0;
  let debounceTimer = 0;
  let notifyTimer = 0;
  let composing = false;
  let disabled = false;
  let disposed = false;

  /* 虚拟滚动：只给「大列表」用。阈值以内保持全量渲染 —— 两条路径并存
     意味着两套 bug，能不分叉就不分叉。 */
  const VIRTUAL_AFTER = 200;
  const ROW_H = 28;
  const OVERSCAN = 6;
  let virtual = false;
  let winStart = 0;
  let winEnd = 0;

  const disposer = createDisposer();

  const matches =
    filter ??
    ((opt, q) => {
      const text = String(q ?? '').trim().toLowerCase();
      if (!text) return true;
      return String(opt.label ?? '').toLowerCase().includes(text);
    });

  // 还没输入时也要有内容：空查询是一次合法的过滤条件，不是「没有结果」。
  // 之前 results 从 [] 起步，第一次聚焦打开只画出空态行。
  results = allOptions.filter((opt) => matches(opt, ''));

  /* ---------------- DOM ---------------- */

  const input = h('input', {
    class: 'c-combobox__input',
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder,
    'aria-label': label || placeholder || '搜索',
    'aria-expanded': 'false',
    'aria-controls': panelId,
    'aria-autocomplete': 'list',
  });

  const list = h('div', { class: 'c-combobox__list' });

  const panel = h(
    'div',
    { class: 'c-combobox__panel', id: panelId, role: 'listbox', 'aria-label': label || '候选' },
    list
  );

  // 箭头只是可发现性的提示，点击一律交给输入框，所以不吃指针事件
  const caret = h('span', {
    class: 'c-combobox__caret',
    'aria-hidden': 'true',
    html: icon('chevron-down', 12),
  });

  /* 清空按钮：只在 clearable 且有内容时出现。用 pointerdown 拦焦点，
     否则按下的一瞬输入框就失焦，清空完还得再把焦点抢回来。 */
  const clearBtn = clearable
    ? h('button', {
        class: 'c-combobox__clear',
        type: 'button',
        'aria-label': '清除',
        hidden: true,
        html: icon('x', 10),
        onpointerdown: (e) => e.preventDefault(),
        onclick: (e) => {
          e.preventDefault();
          clearAll();
        },
      })
    : null;

  const wrap = h(
    'div',
    {
      class: `c-combobox ${className}`.trim(),
      style: { width },
      dataset: clearable ? { clearable: '1' } : null,
    },
    input,
    clearBtn,
    caret
  );

  /* ---------------- 取值辅助 ---------------- */

  const labelOf = (v) => {
    if (v == null) return null;
    const hit = [...results, ...allOptions].find((o) => o.value === v);
    return hit ? String(hit.label ?? '') : null;
  };

  const findExact = (text) => {
    const t = String(text ?? '').trim();
    if (!t) return null;
    return (
      [...results, ...allOptions].find(
        (o) => !o.disabled && String(o.label ?? '').trim() === t
      ) ?? null
    );
  };

  const setText = (text) => {
    input.value = text == null ? '' : String(text);
    syncClear();
  };

  /** 清空按钮只在「有内容」时出现；空输入框上挂一个✕只是噪音 */
  const syncClear = () => {
    if (!clearBtn) return;
    clearBtn.hidden = !input.value;
  };

  function clearAll() {
    if (disabled || disposed) return;
    const had = currentValue != null || input.value !== '';
    currentValue = null;
    setText('');
    state = 'ready';

    if (loadOptions) {
      // 远程源：清空等于一次空查询，开着面板就立刻重取
      lastQuery = '';
      if (openFlag) beginQuery('', { immediate: true });
    } else {
      results = allOptions.filter((opt) => matches(opt, ''));
      lastQuery = '';
      if (openFlag) renderResults();
    }

    // 焦点必须留在输入框：用户下一步就是重新打字
    input.focus({ preventScroll: true });
    if (had) {
      onChange?.('', null);
      onInput?.('');
    }
  }

  /* ---------------- 渲染 ---------------- */

  function resetActive() {
    if (optionEls[activeIndex]) delete optionEls[activeIndex].dataset.active;
    activeIndex = -1;
    input.removeAttribute('aria-activedescendant');
  }

  /** 键盘走到窗口外时，先把面板滚过去，再重建窗口 */
  function revealIndex(index) {
    const viewH = panel.clientHeight || 260;
    const top = index * ROW_H;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (top + ROW_H > panel.scrollTop + viewH) panel.scrollTop = top + ROW_H - viewH;
  }

  function paintActive(index, { scroll = true } = {}) {
    if (optionEls[activeIndex]) delete optionEls[activeIndex].dataset.active;
    activeIndex = index;

    // 虚拟模式：目标行可能还没被渲染（滚出窗口了），先补进窗口
    if (virtual && !optionEls[index] && results[index]) {
      revealIndex(index);
      renderVirtual(index);
    }

    const node = optionEls[index];
    if (!node) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    node.dataset.active = '1';
    // 焦点没动，靠这个属性把「当前高亮」告诉辅助技术
    input.setAttribute('aria-activedescendant', node.id);
    if (scroll) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function move(delta) {
    // 虚拟模式下 optionEls 是稀疏数组（只有窗口内的行），总数必须看 results
    const total = results.length;
    if (!total) return;
    let at = activeIndex;
    // 跳过禁用项；到列表两端就停住，不绕回另一端 —— 输入框里方向键绕回
    // 会让人分不清「到头了」还是「跳回去了」
    for (let step = 0; step < total; step += 1) {
      const from = at;
      at = at < 0 ? (delta > 0 ? 0 : total - 1) : Math.min(total - 1, Math.max(0, at + delta));
      if (at === from) return;
      if (!results[at]?.disabled) {
        paintActive(at);
        return;
      }
    }
  }

  function stateRow(text, kind) {
    return h(
      'div',
      { class: 'c-combobox__state', role: 'presentation', dataset: { kind } },
      text
    );
  }

  function buildOption(opt, index) {
    const node = h('div', {
      class: 'c-combobox__option',
      role: 'option',
      id: `${uid}-opt-${index}`,
      'aria-selected': String(opt.value === currentValue),
      'aria-disabled': opt.disabled ? 'true' : null,
    });

    const custom = renderOption?.(opt);
    if (custom instanceof Node) node.append(custom);
    else if (typeof custom === 'string') node.textContent = custom;
    else {
      node.append(h('span', { class: 'c-combobox__label' }, opt.label ?? String(opt.value ?? '')));
      if (opt.hint) node.append(h('span', { class: 'c-combobox__hint' }, opt.hint));
    }

    // 用 pointerdown 而不是 click：click 之前浏览器已经把焦点从输入框挪走，
    // 焦点一离开，层栈就会把这次按下之后的状态判成「外部点击」把列表收掉。
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (opt.disabled) return;
      commitOption(opt);
    });
    // 指针悬停与键盘移动共用同一个高亮位置，不然会出现两个高亮
    node.addEventListener('pointerenter', () => {
      if (!opt.disabled) paintActive(index, { scroll: false });
    });

    return node;
  }

  /**
   * 窗口化渲染：上下两块占位把滚动高度撑回全量高度，中间只放可见行 + overscan。
   * 面板的内边距算进 scrollTop 里会有几像素误差，overscan 6 行足够盖住。
   */
  function renderVirtual(anchor = null) {
    const total = results.length;
    const viewH = panel.clientHeight || 260;
    let first = Math.floor(panel.scrollTop / ROW_H) - OVERSCAN;
    let last = Math.ceil((panel.scrollTop + viewH) / ROW_H) + OVERSCAN;

    // 键盘落到窗口外时把目标行也纳入窗口，否则渲染完还是没有它
    if (anchor != null) {
      first = Math.min(first, anchor - OVERSCAN);
      last = Math.max(last, anchor + OVERSCAN + 1);
    }
    first = Math.max(0, Math.min(Math.max(0, total - 1), first));
    last = Math.max(first + 1, Math.min(total, last));
    winStart = first;
    winEnd = last;

    optionEls = new Array(total);
    list.replaceChildren();
    const padTop = h('div', { class: 'c-combobox__pad', 'aria-hidden': 'true' });
    padTop.style.height = `${first * ROW_H}px`;
    const padBottom = h('div', { class: 'c-combobox__pad', 'aria-hidden': 'true' });
    padBottom.style.height = `${Math.max(0, total - last) * ROW_H}px`;
    list.append(padTop);

    for (let i = first; i < last; i += 1) {
      const node = buildOption(results[i], i);
      // 窗口化以后 tag 顺序不等于集合顺序，读写屏必须靠 setsize/posinset 还原
      node.setAttribute('aria-setsize', String(total));
      node.setAttribute('aria-posinset', String(i + 1));
      optionEls[i] = node;
      list.append(node);
    }
    list.append(padBottom);

    // 重建后接回高亮；行已经不在窗口里就撤掉属性 —— 不能留一个悬空 id
    if (activeIndex >= 0 && optionEls[activeIndex]) {
      optionEls[activeIndex].dataset.active = '1';
      input.setAttribute('aria-activedescendant', optionEls[activeIndex].id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function renderResults() {
    resetActive();
    optionEls = [];
    list.replaceChildren();
    virtual = false;
    delete panel.dataset.virtual;

    if (state === 'loading') {
      list.append(stateRow(loadingText, 'loading'));
      return;
    }

    if (state === 'error') {
      list.append(
        h(
          'div',
          { class: 'c-combobox__state', role: 'presentation', dataset: { kind: 'error' } },
          h('span', { title: errorText || null }, '加载失败'),
          h(
            'button',
            {
              type: 'button',
              // 按下时别让按钮抢走焦点，否则列表会因为输入框失焦而收起
              onpointerdown: (e) => e.preventDefault(),
              onclick: (e) => {
                e.preventDefault();
                retry();
              },
            },
            '重试'
          )
        )
      );
      return;
    }

    if (!results.length) {
      list.append(stateRow(emptyText, 'empty'));
      return;
    }

    // 大列表才窗口化：小列表全量渲染，行为和过去完全一致
    if (results.length > VIRTUAL_AFTER) {
      virtual = true;
      panel.dataset.virtual = '1';
      panel.scrollTop = 0;
      renderVirtual();
      return;
    }

    results.forEach((opt, index) => {
      const node = buildOption(opt, index);
      optionEls.push(node);
      list.append(node);
    });
  }

  /* ---------------- 查询 ---------------- */

  function retry() {
    beginQuery(input.value, { immediate: true });
  }

  async function runRemote(text) {
    if (disposed || !loadOptions) return;
    const token = ++requestToken;

    controller?.abort();
    const ac = new AbortController();
    controller = ac;

    lastQuery = text;
    state = 'loading';
    renderResults();

    try {
      const next = await loadOptions(text, { signal: ac.signal });
      // token 比 signal 更可信：abort 是异步生效的，旧请求的结果仍可能先到
      if (disposed || token !== requestToken) return;
      results = Array.isArray(next) ? next.filter(Boolean) : [];
      state = 'ready';
      renderResults();
    } catch (err) {
      if (disposed || token !== requestToken) return;
      if (ac.signal.aborted || err?.name === 'AbortError') return;
      results = [];
      errorText = err?.message ? String(err.message) : '';
      state = 'error';
      renderResults();
    } finally {
      if (controller === ac) controller = null;
    }
  }

  function beginQuery(text, { immediate = false } = {}) {
    if (disposed) return;
    clearTimeout(debounceTimer);
    debounceTimer = 0;

    // 本地过滤是同步的，没有请求可等：直接出结果，比先闪一下 loading 好
    if (!loadOptions) {
      controller?.abort();
      controller = null;
      results = allOptions.filter((opt) => matches(opt, text));
      state = 'ready';
      lastQuery = text;
      renderResults();
      return;
    }

    const wait = immediate ? 0 : Math.max(0, debounce);
    if (wait > 0) {
      // 防抖窗口里先给「正在搜索」的反馈，否则连续敲字时列表像死了一样
      state = 'loading';
      renderResults();
      debounceTimer = setTimeout(() => {
        debounceTimer = 0;
        runRemote(text);
      }, wait);
      return;
    }

    runRemote(text);
  }

  function scheduleNotify(text) {
    clearTimeout(notifyTimer);
    notifyTimer = 0;
    if (!onInput) return;
    const wait = Math.max(0, debounce);
    if (!wait) {
      onInput(text);
      return;
    }
    notifyTimer = setTimeout(() => {
      notifyTimer = 0;
      onInput(text);
    }, wait);
  }

  /* ---------------- 确认 ---------------- */

  function commitOption(opt, { focus = true } = {}) {
    if (!opt || opt.disabled) return;
    currentValue = opt.value;
    setText(opt.label ?? String(opt.value ?? ''));
    // 记成已查过：再次打开时不必为一个「已经选好的文本」重新请求
    lastQuery = input.value;
    state = 'ready';
    closePanel('commit');
    if (focus && document.activeElement !== input) input.focus({ preventScroll: true });
    onChange?.(opt.value, opt);
  }

  function commitText(text) {
    const exact = findExact(text);
    if (exact) {
      commitOption(exact);
      return;
    }
    if (!allowCustom) return;
    const raw = String(text ?? '');
    if (!raw.trim()) {
      closePanel('empty');
      return;
    }
    currentValue = raw;
    lastQuery = raw;
    state = 'ready';
    closePanel('commit');
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    onChange?.(raw, null);
  }

  /* ---------------- 输入文本变化 ---------------- */

  function handleText(text) {
    syncClear();
    // 文本正好命中某个 label 才认值，否则置空 —— 这是「输入」与「选中」的分界
    const exact = findExact(text);
    currentValue = exact ? exact.value : null;

    if (!openFlag) openPanel();
    else beginQuery(text);

    scheduleNotify(text);
  }

  /* ---------------- 浮层 ---------------- */

  function handleClose() {
    openFlag = false;
    layer = null;
    pos?.stop();
    pos = null;
    activeIndex = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    delete wrap.dataset.open;
    panel.remove();
  }

  function closePanel(reason = 'api') {
    if (layer) {
      layer.close(reason);
      return;
    }
    if (openFlag) handleClose();
  }

  function openPanel({ focusFirst = false } = {}) {
    if (disposed || openFlag || disabled) return;

    const hadFocus = document.activeElement === input;

    /* 面板挂在「最近的层容器」里：模态对话框会把 body 的其它子节点设为
       inert，挂在 body 上的面板会连输入框一起被冻住。挂在同一层容器后，
       inert 的范围与面板无关；定位仍是 fixed + 视口坐标。
       不能直接挂 .c-dialog / .c-sheet 本身 —— 它们带 transform，
       会成为 fixed 的包含块，坐标整体偏掉。 */
    const host = layerHostFor(wrap);
    host.append(panel);
    openFlag = true;

    // 同文本的结果还在就复用，避免每次聚焦都闪一下 loading
    if (lastQuery !== input.value) beginQuery(input.value, { immediate: true });
    else renderResults();

    layer = openLayer({
      el: panel,
      container: panel,
      modal: false,
      trap: false,
      dismissible: true,
      outside: true,
      // 点输入框 / 清空按钮不算「外面」，否则刚点开就被自己关掉
      ignore: [input, clearBtn, wrap].filter(Boolean),
      initialFocus: 'none',
      // 候选列表和输入框是同一个交互单元：父容器（Dialog / Sheet 的遮罩）
      // 不能被设为 inert，否则输入框在面板打开的一瞬间就失焦。
      isolateParent: false,
      // 关闭时把焦点拽回输入框是错的：点外面关列表就该让焦点留在点击处
      returnFocus: false,
      onClose: handleClose,
    });
    if (hadFocus && document.activeElement !== input) input.focus({ preventScroll: true });
    panel.style.zIndex = String(900 + layer.level * 20);

    pos = positionLayer(panel, {
      anchor: wrap,
      placement: 'bottom',
      align: 'start',
      gap: 6,
      matchWidth: true,
      onHidden: () => layer?.close('hidden'),
    });

    input.setAttribute('aria-expanded', 'true');
    wrap.dataset.open = '1';

    if (focusFirst) {
      requestAnimationFrame(() => {
        if (openFlag) move(1);
      });
    }
  }

  /* ---------------- 键盘 ---------------- */

  disposer.on(input, 'keydown', (e) => {
    const composingKey = e.isComposing || e.keyCode === 229;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!openFlag) {
        openPanel({ focusFirst: true });
        return;
      }
      move(1);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!openFlag) {
        openPanel();
        move(-1);
        return;
      }
      move(-1);
      return;
    }

    if (e.key === 'Enter') {
      // 输入法选词的回车不是提交：放过去，否则中文选字会把半截拼音当成值
      if (composingKey) return;

      if (openFlag && activeIndex >= 0) {
        const opt = results[activeIndex];
        if (opt && !opt.disabled) {
          e.preventDefault();
          commitOption(opt);
        }
        return;
      }

      // 加载失败时回车重试：错误行里的按钮键盘用户够不到（焦点在输入框）
      if (state === 'error' && openFlag) {
        e.preventDefault();
        retry();
        return;
      }

      if (allowCustom) {
        e.preventDefault();
        commitText(input.value);
        return;
      }

      const exact = findExact(input.value);
      if (exact) {
        e.preventDefault();
        commitOption(exact);
      }
      return;
    }

    if (e.key === 'Escape') {
      if (!openFlag) return; // 没开列表就让外层（对话框等）去关
      // 只收列表：保留文本与焦点，并且不让 Esc 继续往上关掉整层
      e.preventDefault();
      e.stopPropagation();
      closePanel('escape');
      return;
    }

    if (e.key === 'Tab' && openFlag) {
      // 不拦 Tab：接受当前高亮项，然后让焦点照常往后走
      const opt = activeIndex >= 0 ? results[activeIndex] : null;
      if (opt && !opt.disabled) commitOption(opt, { focus: false });
      else closePanel('tab');
    }
  });

  /* ---------------- 输入 ---------------- */

  // 点一下输入框就把候选铺开，这是复合框与普通输入框的区别
  disposer.on(input, 'pointerdown', () => {
    if (!openFlag) openPanel();
  });

  disposer.on(input, 'input', (e) => {
    syncClear();
    // 组合期的 value 只是拼音串，查了也是白查，还会打断候选
    if (composing || e.isComposing) return;
    handleText(input.value);
  });

  disposer.on(input, 'compositionstart', () => {
    composing = true;
  });

  disposer.on(input, 'compositionend', () => {
    composing = false;
    // 有的浏览器 compositionend 之后不再补 input 事件，这里主动补一次；
    // 若随后还会来一个 input，两者共用同一个防抖计时器，不会重复请求
    handleText(input.value);
  });

  disposer.on(input, 'blur', () => {
    // 组合中被外部打断时 compositionend 不会来，别让标志位一直挂着
    composing = false;
  });

  // 虚拟滚动：滚动只重算窗口，不动查询
  disposer.on(panel, 'scroll', () => {
    if (!virtual || !openFlag) return;
    renderVirtual();
  });

  /* ---------------- 对外接口 ---------------- */

  wrap.input = input;
  wrap.panel = panel;

  wrap.set = (v, opts = {}) => {
    currentValue = v ?? null;
    if (opts.query !== undefined) setText(opts.query);
    else if (v == null) setText('');
    else {
      const text = labelOf(v);
      // 值不在现有候选里又没有显式文本时保留当前文本，宁可旧一点也别抹掉用户输入
      if (text != null) setText(text);
    }

    if (!loadOptions) {
      // 本地数据源可以立刻把候选与选中态对齐，下一次打开就是对的
      results = allOptions.filter((opt) => matches(opt, input.value));
      state = 'ready';
      lastQuery = input.value;
      if (openFlag) renderResults();
      return;
    }

    // 远程源：静默设置不主动发请求，只把缓存标记作废，等下次打开时再取
    lastQuery = null;
    if (openFlag) beginQuery(input.value, { immediate: true });
  };

  wrap.value = () => currentValue;
  wrap.query = () => input.value;

  wrap.setOptions = (next) => {
    allOptions = Array.isArray(next) ? [...next] : [];
    if (!loadOptions) {
      results = allOptions.filter((opt) => matches(opt, input.value));
      state = 'ready';
    }
    if (openFlag) renderResults();
  };

  wrap.open = () => openPanel();
  wrap.close = () => closePanel();
  wrap.isOpen = () => openFlag;
  wrap.focus = () => input.focus();

  wrap.setDisabled = (v) => {
    disabled = !!v;
    applyControlState(input, { disabled: v });
    if (clearBtn) clearBtn.disabled = disabled;
    if (disabled) closePanel('disabled');
  };

  wrap.setInvalid = (v) => {
    applyControlState(input, { invalid: v });
  };

  wrap.dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(debounceTimer);
    clearTimeout(notifyTimer);
    debounceTimer = 0;
    notifyTimer = 0;
    // dispose 之后再回来的响应一律丢弃，避免写进已经拆掉的浮层
    requestToken += 1;
    controller?.abort();
    controller = null;
    if (openFlag || layer) closePanel('dispose');
    pos?.stop();
    pos = null;
    disposer.dispose();
    // 不摘 wrap 自身：释放资源与移除 DOM 是两件事
  };

  if (query) setText(query);
  else if (value != null) {
    const text = labelOf(value);
    if (text != null) setText(text);
  }

  return wrap;
}

/**
 * 最近的「层容器」：优先挂到遮罩（Dialog / Sheet 的 scrim），
 * 它是层里唯一不带变换的元素，fixed 坐标才还是视口坐标。
 * 没有遮罩的自定义层只有在自身不带 transform / filter 时才敢挂进去 ——
 * 否则 position: fixed 会退化成「相对这个祖先」，面板会整体偏移。
 */
function layerHostFor(node) {
  const scope = node.closest('[data-layer-root], .c-dialog, .c-sheet, .c-drawer, [role="dialog"]');
  if (!scope) return document.body;
  const box = scope.closest('[data-layer-root], .c-dialog-scrim, .c-sheet-scrim');
  if (box) return box;
  try {
    const cs = getComputedStyle(scope);
    if (
      cs.transform !== 'none' ||
      cs.filter !== 'none' ||
      cs.backdropFilter !== 'none' ||
      cs.perspective !== 'none'
    ) {
      return document.body;
    }
  } catch {
    return document.body;
  }
  return scope;
}
