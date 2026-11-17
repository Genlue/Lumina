// Golden Gate · collections/tree-view
import { h } from '../../core/dom.js';
import { iconEl } from '../../core/icons.js';
import { createSelection } from '../_shared/selection.js';
import { applyControlState } from '../_shared/control.js';

/* ==========================================================================
   TreeView 层级资源树

   两条与「递归画 DOM」相反的取舍：
   1) 只渲染可见行。收起的子树根本不在 DOM 里 —— 文件树展开三层只多三行；
      用 display:none 藏整棵树，在万级节点上会让布局每次都算一遍。
   2) 扁平 DOM + aria-level，不嵌套 role="group"。可见行本来就是一维序列，
      扁平结构让「下移一行」等于数组下标 +1，键盘逻辑不必进出子树。

   展开集合 / 焦点 / 选中分开存：收起父节点不该丢选中；多选时方向键
   也不该顺手改选中（Space 才是切换）。
   ========================================================================== */

const TYPEAHEAD_MS = 500;
const MAX_DEPTH = 64;

/**
 * @param {object} o
 * @param {Array} [o.nodes] 根节点数组：{ id, label, icon?, children?, disabled?, badge?, loading?, error? }
 * @param {(node:any)=>any} [o.getKey] 取稳定 ID
 * @param {string} [o.label] 树的可见名字
 * @param {Array} [o.expandedKeys] 初始展开集
 * @param {Array} [o.selectedKeys] 初始选中集
 * @param {boolean} [o.multiple] 多选
 * @param {(node:any)=>Promise<Array>} [o.loadChildren] 懒加载；有它才允许展开无 children 的节点
 * @param {(key:string, expanded:boolean, node:any)=>void} [o.onToggle]
 * @param {(keys:string[], info:object)=>void} [o.onSelectionChange]
 * @param {(key:string, node:any)=>void} [o.onActivate]
 * @param {(node:any)=>Node|string} [o.renderLabel] 自定义行内容
 */
export function TreeView({
  nodes = [],
  getKey = (n) => n.id,
  label = '树',
  expandedKeys = [],
  selectedKeys = [],
  multiple = false,
  loadChildren,
  onToggle,
  onSelectionChange,
  onActivate,
  renderLabel,
  className = '',
} = {}) {
  const el = h('div', {
    class: `c-tree ${className}`.trim(),
    role: 'tree',
    'aria-label': label,
    'aria-multiselectable': multiple ? 'true' : null,
  });

  const keyOf = (node) => String(getKey(node));

  let roots = Array.isArray(nodes) ? nodes : [];
  /** @type {Set<string>} 展开集：只存 key，重画时据此算可见序列 */
  const expanded = new Set();
  /** @type {Map<string, Array>} 懒加载结果缓存，不写回调用方的 node 对象 */
  const loaded = new Map();
  /** @type {Map<string, {state:'loading'|'error', message?:string}>} */
  const status = new Map();
  /** @type {Map<string, number>} 每个节点的请求代号；收起/重开时 +1 即可作废旧 Promise */
  const tokens = new Map();

  /** @type {Map<string, {node:any,parentKey:string|null,level:number,pos:number,size:number}>} */
  let index = new Map();
  /** 可见节点行（不含 loading / error 占位行），键盘序列用 */
  let visible = [];
  let disposed = false;
  let disabled = false;
  let typed = '';
  let typedAt = 0;

  /* ---------------------------------------------------------------- 数据 */

  const childrenOf = (node, key) => {
    if (Array.isArray(node.children)) return node.children;
    // children === undefined 才可能是懒加载位；null / 其它值按叶子处理
    if (node.children === undefined) return loaded.get(key) ?? null;
    return null;
  };

  const canExpand = (node, key) => {
    const kids = childrenOf(node, key);
    if (kids) return kids.length > 0;
    return node.children === undefined && typeof loadChildren === 'function';
  };

  function buildIndex() {
    const map = new Map();
    const walk = (list, parentKey, level) => {
      if (!Array.isArray(list) || level > MAX_DEPTH) return;
      list.forEach((node, i) => {
        if (!node) return;
        const key = keyOf(node);
        map.set(key, { node, parentKey, level, pos: i + 1, size: list.length });
        const kids = childrenOf(node, key);
        if (kids && kids.length) walk(kids, key, level + 1);
      });
    };
    walk(roots, null, 1);
    index = map;
  }

  /** 节点自带 loading / error 也算占位状态：数据源在外部推进时不必再造一层 */
  function stateOf(node, key) {
    const st = status.get(key);
    if (st) return st;
    if (node.loading) return { state: 'loading' };
    if (node.error) {
      return { state: 'error', message: typeof node.error === 'string' ? node.error : '加载失败' };
    }
    return null;
  }

  /** 递归展开后的可见序列。占位行也在这里生成，渲染端不再关心层级 */
  function buildItems() {
    const out = [];
    const walk = (list, level) => {
      if (!Array.isArray(list) || level > MAX_DEPTH) return;
      for (const node of list) {
        if (!node) continue;
        const key = keyOf(node);
        const meta = index.get(key);
        out.push({
          kind: 'node',
          key,
          node,
          level,
          pos: meta?.pos ?? 1,
          size: meta?.size ?? list.length,
        });
        if (!expanded.has(key)) continue;

        const st = stateOf(node, key);
        if (st?.state === 'loading') {
          out.push({ kind: 'loading', key, level: level + 1 });
          continue;
        }
        if (st?.state === 'error') {
          out.push({ kind: 'error', key, level: level + 1, message: st.message });
          continue;
        }
        const kids = childrenOf(node, key);
        if (kids && kids.length) walk(kids, level + 1);
      }
    };
    walk(roots, 1);
    return out;
  }

  /* ---------------------------------------------------------------- 渲染 */

  function rowFor(item) {
    if (item.kind !== 'node') return stateRow(item);
    const { key, node, level, pos, size } = item;
    const branch = canExpand(node, key);
    const open = expanded.has(key);
    const loading = stateOf(node, key)?.state === 'loading';

    const row = h('div', {
      class: 'c-tree__row',
      role: 'treeitem',
      'aria-level': String(level),
      'aria-posinset': String(pos),
      'aria-setsize': String(size),
      'aria-selected': String(sel.isSelected(key)),
      'aria-expanded': branch ? String(open) : null,
      'aria-disabled': node.disabled ? 'true' : null,
      'aria-busy': loading ? 'true' : null,
      dataset: { key },
      style: { '--tree-depth': String(level - 1) },
      tabindex: '-1',
    });

    row.append(
      h('span', { class: 'c-tree__indent', 'aria-hidden': 'true' }),
      h(
        'span',
        { class: 'c-tree__twisty', role: 'presentation', 'aria-hidden': 'true' },
        branch ? iconEl('chevron-right', 12) : null
      )
    );

    if (node.icon) {
      row.append(h('span', { class: 'c-tree__icon', 'aria-hidden': 'true' }, iconEl(node.icon, 14)));
    }

    const custom = typeof renderLabel === 'function' ? renderLabel(node) : null;
    row.append(h('span', { class: 'c-tree__label' }, custom ?? String(node.label ?? '')));

    if (node.badge !== undefined && node.badge !== null && node.badge !== '') {
      row.append(h('span', { class: 'c-tree__badge' }, String(node.badge)));
    }

    return row;
  }

  /** 占位行：结构与节点行同高同缩进，但不可聚焦、不进选择序列 */
  function stateRow(item) {
    const loading = item.kind === 'loading';
    const row = h(
      'div',
      {
        class: 'c-tree__row c-tree__row--state',
        role: 'treeitem',
        'aria-level': String(item.level),
        'aria-posinset': '1',
        'aria-setsize': '1',
        'aria-disabled': 'true',
        'aria-busy': loading ? 'true' : null,
        dataset: { state: loading ? 'loading' : 'error', for: item.key },
        style: { '--tree-depth': String(item.level - 1) },
        tabindex: '-1',
      },
      h('span', { class: 'c-tree__indent', 'aria-hidden': 'true' }),
      h('span', { class: 'c-tree__twisty', role: 'presentation', 'aria-hidden': 'true' }),
      h('span', { class: 'c-tree__state' }, loading ? '正在加载…' : item.message || '加载失败')
    );

    if (!loading) {
      row.append(
        h('button', { class: 'c-tree__retry', type: 'button', 'aria-label': '重试加载' }, '重试')
      );
    }
    return row;
  }

  function syncRows() {
    const focused = sel.focusedKey();
    for (const row of el.querySelectorAll('.c-tree__row[data-key]')) {
      const key = row.dataset.key;
      const node = index.get(key)?.node;
      row.setAttribute('aria-selected', String(sel.isSelected(key)));
      const focusable = !disabled && !node?.disabled;
      row.tabIndex = focusable && key === focused ? 0 : -1;
      if (key === focused) row.dataset.focused = '1';
      else delete row.dataset.focused;
    }
  }

  function focusRow(key) {
    if (!key) return;
    for (const row of el.querySelectorAll('.c-tree__row[data-key]')) {
      if (row.dataset.key !== key) continue;
      // 禁用行不接受焦点：方向键与 Tab 都该落在可用的行上
      if (row.getAttribute('aria-disabled') === 'true') return;
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
      return;
    }
  }

  function render({ focus = false } = {}) {
    const items = buildItems();
    visible = items.filter((it) => it.kind === 'node');

    // 导航序列只含可见且可用的节点：禁用项不该被方向键停住
    sel.setKeys(visible.filter((it) => !it.node.disabled).map((it) => it.key));

    if (items.length) el.replaceChildren(...items.map(rowFor));
    else
      el.replaceChildren(
        h(
          'div',
          { class: 'c-tree__empty', role: 'treeitem', 'aria-level': '1', 'aria-disabled': 'true' },
          '暂无内容'
        )
      );

    syncRows();
    if (focus) focusRow(sel.focusedKey());
  }

  /* -------------------------------------------------------------- 选择模型 */

  buildIndex();

  for (const k of expandedKeys || []) expanded.add(String(k));
  for (const k of [...expanded]) if (!index.has(k)) expanded.delete(k);

  const initialNav = buildItems()
    .filter((it) => it.kind === 'node' && !it.node.disabled)
    .map((it) => it.key);

  const sel = createSelection({
    mode: multiple ? 'multiple' : 'single',
    keys: initialNav,
    selectedKeys: (selectedKeys || []).map(String),
    onChange: (keys, info) => {
      syncRows();
      onSelectionChange?.(keys, info);
    },
    onFocusChange: syncRows,
  });
  el.selection = sel;

  /** 焦点跟随：单选模式下移动焦点即选中；多选只挪焦点，Space 才改选中 */
  function moveFocus(key) {
    if (!key) return;
    if (multiple) sel.setFocused(key, { source: 'keyboard' });
    else sel.selectOnly(key, { source: 'keyboard' });
    syncRows();
    focusRow(key);
  }

  /**
   * Cmd/Ctrl+A 的语义对齐 AppKit 的文件树：全选只作用于「当前可见的项」。
   * 折叠着的子树里的节点用户根本看不见（也不在 DOM 里），把它们一起选中，
   * 之后一展开就会冒出一堆自己没点过的选中行 —— 那是浏览器的做法，不是树的。
   * 禁用行同样跳过：它们本来就点不中。
   */
  function selectAllVisible() {
    const keys = visible.filter((it) => !it.node.disabled).map((it) => it.key);
    if (!keys.length) return false;
    sel.setSelected(keys, { source: 'keyboard' });
    syncRows();
    return true;
  }

  const isDescendant = (key, ancestor) => {
    let p = index.get(key)?.parentKey ?? null;
    while (p) {
      if (p === ancestor) return true;
      p = index.get(p)?.parentKey ?? null;
    }
    return false;
  };

  /* -------------------------------------------------------------- 展开/加载 */

  const invalidate = (key) => tokens.set(key, (tokens.get(key) || 0) + 1);

  function load(key) {
    const meta = index.get(key);
    if (!meta || typeof loadChildren !== 'function') return Promise.resolve(false);
    if (disposed) return Promise.resolve(false);

    invalidate(key);
    const token = tokens.get(key);
    status.set(key, { state: 'loading' });
    render({ focus: el.contains(document.activeElement) });

    return Promise.resolve()
      .then(() => loadChildren(meta.node))
      .then(
        (kids) => {
          // 收起 / 重新展开 / 销毁都会让代号失配，迟到的结果一律丢弃
          if (disposed || tokens.get(key) !== token || !expanded.has(key)) return false;
          loaded.set(key, Array.isArray(kids) ? kids : []);
          status.delete(key);
          buildIndex();
          render({ focus: el.contains(document.activeElement) });
          return true;
        },
        (err) => {
          if (disposed || tokens.get(key) !== token || !expanded.has(key)) return false;
          status.set(key, { state: 'error', message: err?.message || '加载失败' });
          render({ focus: el.contains(document.activeElement) });
          return false;
        }
      );
  }

  function setExpanded(key, next) {
    const meta = index.get(key);
    if (!meta) return Promise.resolve(false);

    const want = !!next;
    if (expanded.has(key) === want) return Promise.resolve(want);
    if (want && !canExpand(meta.node, key)) return Promise.resolve(false);

    if (want) {
      expanded.add(key);
      onToggle?.(key, true, meta.node);
      const kids = childrenOf(meta.node, key);
      if (!kids && typeof loadChildren === 'function') return load(key);
      render({ focus: el.contains(document.activeElement) });
      return Promise.resolve(true);
    }

    // 收起：作废在途请求，清掉占位状态，焦点若在子树里就回到本节点
    invalidate(key);
    status.delete(key);
    expanded.delete(key);
    onToggle?.(key, false, meta.node);

    const focused = sel.focusedKey();
    const hadFocus = el.contains(document.activeElement);
    if (focused && focused !== key && isDescendant(focused, key)) {
      sel.setFocused(key, { source: 'keyboard' });
    }
    render({ focus: hadFocus && el.contains(document.activeElement) });
    return Promise.resolve(false);
  }

  /* ---------------------------------------------------------------- 键盘 */

  function typeahead(ch) {
    const now = Date.now();
    if (now - typedAt > TYPEAHEAD_MS) typed = '';
    typedAt = now;
    typed += ch.toLowerCase();

    const pool = visible.filter((it) => !it.node.disabled);
    if (!pool.length) return false;

    const from = pool.findIndex((it) => it.key === sel.focusedKey());
    const ordered = [...pool.slice(from < 0 ? 0 : from + 1), ...pool.slice(0, from < 0 ? 0 : from + 1)];
    const hit = ordered.find((it) => String(it.node.label ?? '').toLowerCase().startsWith(typed));
    if (!hit) return false;
    moveFocus(hit.key);
    return true;
  }

  el.addEventListener('keydown', (e) => {
    if (disposed || disabled) return;
    if (e.isComposing || e.keyCode === 229) return; // 输入法组合期不参与任何按键

    const row = e.target.closest?.('.c-tree__row');
    if (!row || !el.contains(row)) return;
    // 行内真按钮（重试）自己处理 Space/Enter
    if (e.target.closest('button, a, input, select, textarea')) return;

    const mod = e.metaKey || e.ctrlKey;

    // 全选不需要先有焦点行：焦点落在任意一行上就作用于整棵「可见树」
    if ((e.key === 'a' || e.key === 'A') && mod) {
      e.preventDefault();
      selectAllVisible();
      return;
    }

    const focusedKey = sel.focusedKey();
    if (!focusedKey) return;
    const node = index.get(focusedKey)?.node;
    let handled = false;

    switch (e.key) {
      case 'ArrowDown':
        sel.move(1, { extend: multiple && e.shiftKey, source: 'keyboard' });
        handled = true;
        break;
      case 'ArrowUp':
        sel.move(-1, { extend: multiple && e.shiftKey, source: 'keyboard' });
        handled = true;
        break;
      case 'Home':
        sel.move(-visible.length - 1, { extend: multiple && e.shiftKey, source: 'keyboard' });
        handled = true;
        break;
      case 'End':
        sel.move(visible.length + 1, { extend: multiple && e.shiftKey, source: 'keyboard' });
        handled = true;
        break;
      case ' ':
      case 'Spacebar':
        // 禁用行即使被程序化聚焦也不能切换：只吞掉按键，不改状态
        handled = true;
        if (node?.disabled) break;
        if (multiple) sel.toggle(focusedKey, { source: 'keyboard' });
        else sel.selectOnly(focusedKey, { source: 'keyboard' });
        break;
      case 'Enter':
        handled = true;
        if (node?.disabled) break;
        onActivate?.(focusedKey, node);
        break;
      case 'ArrowRight': {
        handled = true;
        if (!node || !canExpand(node, focusedKey)) break;
        if (!expanded.has(focusedKey)) {
          setExpanded(focusedKey, true);
          break;
        }
        // 已展开：进入第一个子节点；子节点还没到（加载中）就原地等
        const first = childrenOf(node, focusedKey)?.[0];
        const firstKey = first ? keyOf(first) : null;
        if (firstKey) moveFocus(firstKey);
        break;
      }
      case 'ArrowLeft': {
        handled = true;
        if (expanded.has(focusedKey)) {
          setExpanded(focusedKey, false);
          break;
        }
        const parent = index.get(focusedKey)?.parentKey;
        if (parent) moveFocus(parent);
        break;
      }
      default:
        if (e.key.length === 1 && !mod && !e.altKey) handled = typeahead(e.key);
        break;
    }

    if (!handled) return;
    // 只吃掉本层已处理的键，不 stopPropagation —— Esc 要能交给外层浮层
    e.preventDefault();
    syncRows();
    focusRow(sel.focusedKey());
  });

  /* --------------------------------------------------------------- 指针 */

  el.addEventListener('pointerdown', (e) => {
    if (disposed || disabled || e.button !== 0) return;
    const row = e.target.closest?.('.c-tree__row');
    if (!row || !el.contains(row)) return;
    if (e.target.closest('button, a, input, select, textarea')) return;

    const key = row.dataset.key;
    if (!key) return;
    const node = index.get(key)?.node;
    if (!node || node.disabled) return;

    // 箭头：只展开/收起，不改选中（和文件浏览器的习惯一致）
    if (e.target.closest('.c-tree__twisty') && canExpand(node, key)) {
      e.preventDefault();
      setExpanded(key, !expanded.has(key));
      focusRow(key);
      return;
    }

    sel.pointer(key, {
      meta: e.metaKey || e.ctrlKey,
      shift: multiple && e.shiftKey, // 单选树不做范围选择，否则会选出多个
    });
    syncRows();
    focusRow(key);
  });

  el.addEventListener('click', (e) => {
    if (disposed) return;
    const retry = e.target.closest?.('.c-tree__retry');
    if (!retry || !el.contains(retry)) return;
    e.preventDefault();
    const key = retry.closest('.c-tree__row')?.dataset.for;
    if (key) load(key);
  });

  el.addEventListener('dblclick', (e) => {
    if (disposed || disabled) return;
    const row = e.target.closest?.('.c-tree__row[data-key]');
    if (!row || !el.contains(row)) return;
    if (e.target.closest('.c-tree__twisty, button')) return;
    const key = row.dataset.key;
    onActivate?.(key, index.get(key)?.node);
  });

  /* ---------------------------------------------------------------- 公开 API */

  el.expand = (key) => setExpanded(String(key), true);
  el.collapse = (key) => setExpanded(String(key), false);
  el.toggle = (key) => {
    const k = String(key);
    return setExpanded(k, !expanded.has(k));
  };

  /**
   * 换一批节点：展开集与选中集按 key 保留。
   * 已消失的 key 从展开集移除、从选中集 prune —— 模型不猜「是不是临时隐藏」，
   * 由调用方决定重新传进来。
   */
  el.setNodes = (next) => {
    roots = Array.isArray(next) ? next : [];
    buildIndex();

    for (const k of [...expanded]) {
      if (index.has(k)) continue;
      expanded.delete(k);
      invalidate(k);
    }
    for (const k of [...loaded.keys()]) if (!index.has(k)) loaded.delete(k);
    for (const k of [...status.keys()]) if (!index.has(k)) status.delete(k);

    const hadFocus = el.contains(document.activeElement);
    sel.prune([...index.keys()]);
    render({ focus: hadFocus });
  };

  el.expandedKeys = () => [...expanded];
  el.value = () => sel.selectedKeys();

  /** 全选「当前可见且已加载」的节点（折叠子树不在其中），跳过禁用行 */
  el.selectAll = () => selectAllVisible();
  el.clearSelection = () => {
    sel.clear({ source: 'command' });
    syncRows();
  };

  el.setDisabled = (v) => {
    disabled = !!v;
    applyControlState(el, { disabled });
    syncRows();
  };

  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    tokens.clear(); // 在途结果回来时代号必不匹配，不会再碰 DOM
    sel.dispose();
  };

  sel.prune([...index.keys()]);
  render();

  // 初始就展开的懒节点得自己发请求，否则会画成「展开着但空无一物」
  for (const k of [...expanded]) {
    const meta = index.get(k);
    if (meta && !childrenOf(meta.node, k) && typeof loadChildren === 'function') load(k);
  }

  return el;
}
