// Golden Gate · collections/collection-view
import { h, append, clamp } from '../../core/dom.js';
import { applyControlState } from '../_shared/control.js';
import { createDisposer } from '../_shared/disposer.js';
import { disposeComponentTree } from '../_shared/lifecycle.js';
import { createSelection } from '../_shared/selection.js';

/* ==========================================================================
   CollectionView —— 列表 / 网格 + 窗口化虚拟滚动

   为什么不用 CSS Grid / flex 直接排：
   万条数据时浏览器排一次就是几万次盒计算，滚动必然掉帧。这里把「内容总高」
   交给一个 spacer 撑开，可见项绝对定位，滚动只改 top/left。DOM 里永远只有
   可见区间 ± overscan 的项（几十个），节点数与数据量无关。

   高度缓存：offsets 是每行行首偏移的前缀和，sizes 是每行高度。
   列表一行一项；网格一行一组，列数由容器宽度算出。
   实测高度写回缓存并整体重排，没测到的项沿用估算（itemHeight / cellH），
   所以是「已测量精确、未测量估算」——滚到哪补到哪，不需要一次量完。
   ========================================================================== */

let seq = 0;

/** 调用方不给 renderItem 时的兜底文本。集合里常见的是字符串或 {label} 结构 */
const defaultContent = (item) => {
  if (item == null) return '';
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  return String(item.label ?? item.title ?? item.name ?? item.id ?? '');
};

/**
 * @param {object} o
 * @param {any[]} [o.items]
 * @param {(item:any, i:number)=>string|number} [o.getKey] 稳定身份；排序/筛选不该改它
 * @param {'list'|'grid'} [o.layout]
 * @param {number} [o.itemHeight] 列表行高 / 网格单元高（未测量前的估算值）
 * @param {number} [o.itemWidth] 网格单元最小宽，列数据此推算
 * @param {number} [o.gap] 行/列间距
 * @param {number} [o.overscan] 视口外多渲染几行，抵消快速滚动时的空白
 * @param {boolean} [o.virtual] 关掉就是全量渲染（小数据集或调试用）
 * @param {boolean} [o.multiple]
 * @param {string} [o.label] 列表的可读名字
 * @param {(item:any, info:{index:number,key:string,selected:boolean})=>Node|string} [o.renderItem]
 * @param {(keys:string[], info:object)=>void} [o.onSelectionChange]
 * @param {(key:string, item:any)=>void} [o.onActivate]
 * @param {string} [o.className]
 */
export function CollectionView({
  items = [],
  getKey = (item, i) => item?.id ?? i,
  layout = 'list',
  itemHeight = 28,
  itemWidth = 140,
  gap = 4,
  overscan = 4,
  virtual = true,
  multiple = false,
  label = '集合',
  renderItem,
  onSelectionChange,
  onActivate,
  className = '',
} = {}) {
  const uid = `c-collection-${++seq}`;
  const disposer = createDisposer();
  const grid = layout === 'grid';

  let data = [...items];
  let keys = [];
  /** @type {Map<string, number>} 反查下标：键盘移动时不能每次 indexOf 扫一遍 */
  let keyIndex = new Map();

  let cols = 1;
  let cellW = itemWidth;
  let lastAvail = -1;

  let offsets = []; // 行首偏移（前缀和）
  let sizes = []; // 每行高度
  let totalH = 0;
  let layoutDirty = true;

  let rafId = 0;
  let disposed = false;
  let disabled = false;

  const sizeCache = new Map(); // 列表：key -> 实测行高
  let estHeight = itemHeight; // 未测项的估高：已测项等高时沿用实测值
  let mixedHeights = false; // 已测项高度不一致 → 估高退回 itemHeight
  const rowSizes = new Map(); // 网格：行号 -> 实测行高
  let cellH = itemHeight; // 网格：单元估高（取已测最大值）
  const nodes = new Map(); // 数据下标 -> 已挂载节点

  const el = h('div', {
    class: `c-collection ${grid ? 'c-collection--grid' : 'c-collection--list'} ${className}`.trim(),
    role: 'listbox',
    'aria-label': label,
    'aria-multiselectable': multiple ? 'true' : null,
    tabindex: '-1',
    style: { '--item-h': `${itemHeight}px` },
  });

  // spacer 只负责撑出总高；选项绝对定位在它上面，所以它不能 aria-hidden，
  // 否则 role="option" 的后代会被整段从无障碍树里摘掉。
  const spacer = h('div', { class: 'c-collection__spacer' });
  const empty = h(
    'div',
    { class: 'c-collection__empty', 'data-state': 'empty' },
    '没有内容'
  );
  el.append(spacer, empty);
  empty.hidden = true;

  const readKeys = (list) => list.map((item, index) => String(getKey(item, index)));

  const rebuildKeys = () => {
    keys = readKeys(data);
    keyIndex = new Map();
    keys.forEach((key, index) => {
      if (!keyIndex.has(key)) keyIndex.set(key, index);
    });
  };

  rebuildKeys();

  const sel = createSelection({
    mode: multiple ? 'multiple' : 'single',
    keys,
    focusedKey: keys[0] ?? null,
    onChange: (selected, info) => {
      syncSelection();
      onSelectionChange?.(selected, info);
    },
    onFocusChange: () => syncSelection(),
  });
  el.selection = sel;
  disposer.add(() => sel.dispose());

  /* ---------- 尺寸与布局 ---------- */

  const indexOfKey = (key) => keyIndex.get(String(key));

  const viewportHeight = () => el.clientHeight || 0;

  const lineCount = () => (grid ? Math.ceil(data.length / Math.max(1, cols)) : data.length);

  const lineHeight = (line) =>
    grid
      ? rowSizes.get(line) ?? cellH
      : sizeCache.get(keys[line]) ?? (mixedHeights ? itemHeight : estHeight);

  /**
   * 记一条实测高度。
   * 如果目前量到的项全都一样高（同一套行模板的常态），就把这个高度当作
   * 未测项的估高 —— 否则滚过一段之后总高会突然变长，滚动条会跳。
   * 一旦出现不同高度，估高退回 itemHeight，宁可低估也不虚构。
   */
  const rememberHeight = (key, height) => {
    if (!sizeCache.size) estHeight = height;
    else if (!mixedHeights && Math.abs(height - estHeight) > 0.5) mixedHeights = true;
    sizeCache.set(key, height);
  };

  const markDirty = () => {
    layoutDirty = true;
  };

  /**
   * 列数按容器宽度推：max(1, floor((w + gap) / (itemWidth + gap)))。
   * 返回「列数 / 宽度到底变没变」—— 变了才需要作废高度缓存、恢复滚动锚点。
   */
  const measureColumns = () => {
    const width = el.clientWidth;
    const widthChanged = Math.abs(width - lastAvail) > 1;
    lastAvail = width;

    if (!grid) {
      cols = 1;
      return { colsChanged: false, widthChanged };
    }

    const next = Math.max(1, Math.floor((width + gap) / (itemWidth + gap)));
    const colsChanged = next !== cols;
    cols = next;
    cellW = width > 0 ? Math.max(1, (width - gap * (cols - 1)) / cols) : itemWidth;
    return { colsChanged, widthChanged };
  };

  /**
   * 断行变了，旧行高就全部作废：同一个「行号」装的是另一批内容，之前的测量
   * 值不再对应现在的排版。清完缓存立刻重排 + 重新量可见区，不等滚回来再校正。
   */
  const resetMeasurements = () => {
    sizeCache.clear();
    rowSizes.clear();
    estHeight = itemHeight;
    mixedHeights = false;
    cellH = itemHeight;
    markDirty();
  };

  /** 滚动锚点：第一条可见行的 key + 它距视口顶的偏移 */
  const captureAnchor = () => {
    if (!data.length || !offsets.length) return null;
    const line = clamp(lineAt(el.scrollTop), 0, offsets.length - 1);
    const index = grid ? line * cols : line;
    const key = keys[index];
    if (key == null) return null;
    return { key, delta: (offsets[line] ?? 0) - el.scrollTop };
  };

  const restoreAnchor = (anchor) => {
    if (!anchor) return;
    const index = indexOfKey(anchor.key);
    if (index == null) return;
    const line = grid ? Math.floor(index / cols) : index;
    if (offsets[line] == null) return;
    el.scrollTop = Math.max(0, offsets[line] - anchor.delta);
  };

  /** 前缀和重排；只有脏了才算，10k 条数据滚一屏不该重建整个数组 */
  const relayout = () => {
    if (!layoutDirty) return;
    layoutDirty = false;

    const count = lineCount();
    offsets = new Array(count);
    sizes = new Array(count);
    let y = 0;
    for (let line = 0; line < count; line++) {
      const size = lineHeight(line);
      offsets[line] = y;
      sizes[line] = size;
      y += size + gap;
    }
    totalH = count ? Math.max(0, y - gap) : 0;
    spacer.style.height = `${totalH}px`;
  };

  /** 第一条「底边越过 y」的行；二分，避免滚到大列表末尾时线性扫 */
  const lineAt = (y) => {
    let lo = 0;
    let hi = offsets.length - 1;
    let ans = offsets.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] + sizes[mid] > y) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans;
  };

  const rangeOf = () => {
    const n = data.length;
    if (!n) return { start: 0, end: -1 };
    if (!virtual) return { start: 0, end: n - 1 };

    const count = offsets.length;
    if (!count) return { start: 0, end: -1 };

    const first = clamp(lineAt(el.scrollTop), 0, count - 1);
    const last = clamp(lineAt(el.scrollTop + viewportHeight()), 0, count - 1);
    const from = Math.max(0, first - overscan);
    const to = Math.min(count - 1, last + overscan);

    if (!grid) return { start: from, end: to };
    return { start: from * cols, end: Math.min(n - 1, (to + 1) * cols - 1) };
  };

  /* ---------- 渲染 ---------- */

  const optionId = (index) => `${uid}-${index}`;

  const makeItem = (index) => {
    const key = keys[index];
    const selected = sel.isSelected(key);
    const node = h('div', {
      class: 'c-collection__item',
      role: 'option',
      id: optionId(index),
      dataset: { key, index: String(index) },
      'aria-selected': String(selected),
      'aria-setsize': String(data.length),
      'aria-posinset': String(index + 1),
      tabindex: !disabled && key === sel.focusedKey() ? '0' : '-1',
    });
    append(node, [
      renderItem ? renderItem(data[index], { index, key, selected }) : defaultContent(data[index]),
    ]);
    return node;
  };

  const dropItem = (index) => {
    const node = nodes.get(index);
    if (!node) return;
    nodes.delete(index);
    itemRO?.unobserve(node);

    // 焦点项被滚出渲染窗口时，DOM 焦点会随节点一起消失。
    // 先把焦点挂回容器（容器是 -1，可编程聚焦），等它回到窗口再交还给选项，
    // 否则键盘用户滚一下滚轮就彻底丢了键盘入口。
    const hadFocus = node === document.activeElement || node.contains(document.activeElement);
    disposeComponentTree(node);
    node.remove();
    if (hadFocus && !disposed) el.focus({ preventScroll: true });
  };

  const reconcile = ({ start, end }) => {
    for (const index of [...nodes.keys()]) {
      if (index < start || index > end) dropItem(index);
    }
    for (let index = start; index <= end; index++) {
      if (nodes.has(index)) continue;
      const node = makeItem(index);
      nodes.set(index, node);
      spacer.append(node);
      itemRO?.observe(node);
    }
  };

  const position = () => {
    if (grid) {
      for (const [index, node] of nodes) {
        const row = Math.floor(index / cols);
        const col = index - row * cols;
        node.style.left = `${col * (cellW + gap)}px`;
        node.style.top = `${offsets[row] ?? 0}px`;
        node.style.width = `${cellW}px`;
        node.style.height = `${sizes[row] ?? itemHeight}px`;
        node.style.right = '';
      }
      return;
    }

    // 列表项高度交给内容（支持动态行高），宽度撑满容器
    for (const [index, node] of nodes) {
      node.style.left = '0px';
      node.style.right = '0px';
      node.style.top = `${offsets[index] ?? 0}px`;
      node.style.width = '';
      node.style.height = '';
    }
  };

  const syncSelection = () => {
    if (disposed) return;
    const focused = sel.focusedKey();
    const focusedIndex = focused == null ? null : indexOfKey(focused);

    for (const [index, node] of nodes) {
      const key = keys[index];
      const selected = sel.isSelected(key);
      if (node.getAttribute('aria-selected') !== String(selected)) {
        node.setAttribute('aria-selected', String(selected));
      }
      const tabIndex = !disabled && index === focusedIndex ? 0 : -1;
      if (node.tabIndex !== tabIndex) node.tabIndex = tabIndex;
      node.dataset.focused = index === focusedIndex ? '1' : '0';
    }

    // 焦点项被滚出渲染窗口时没有选项可承载 roving tabindex，
    // 整个控件就会从 Tab 序列里消失。此时把 tabindex 兜到容器上，
    // 用户按 Tab 仍能进得来，进来后方向键会把焦点交还给选项。
    const carry = !disabled && (focusedIndex == null || !nodes.has(focusedIndex));
    const elTabIndex = carry ? 0 : -1;
    if (el.tabIndex !== elTabIndex) el.tabIndex = elTabIndex;
  };

  /**
   * 网格行高：每次布局都按「当前行内最高项」重算，允许变矮。
   * 两步走 —— 先把所有已挂载项的高度放开成 auto，再统一读一遍 —— 同一行里的
   * 项不会边量边改互相推挤；量完立刻把行高钉回去，用户看不到「瞬间变 auto」。
   * 行高记在 rowSizes 里（行号 → 高度），未测量的行继续用 cellH 估算。
   */
  const measureGridRows = () => {
    if (!nodes.size) return false;
    const mounted = [...nodes].filter(([, node]) => node.isConnected);
    if (!mounted.length) return false;

    for (const [, node] of mounted) node.style.height = 'auto';

    const rowMax = new Map();
    for (const [index, node] of mounted) {
      const row = Math.floor(index / cols);
      const h = Math.max(itemHeight, Math.round(node.getBoundingClientRect().height));
      rowMax.set(row, Math.max(rowMax.get(row) ?? 0, h));
    }

    let changed = false;
    for (const [row, h] of rowMax) {
      if (Math.abs((rowSizes.get(row) ?? 0) - h) > 0.5) {
        rowSizes.set(row, h);
        changed = true;
      }
    }

    // 估高跟着实测的最大行高走：只增不减会让「内容变矮」永远生效不了
    let tallest = 0;
    for (const h of rowSizes.values()) tallest = Math.max(tallest, h);
    if (tallest && Math.abs(cellH - tallest) > 0.5) {
      cellH = tallest;
      changed = true;
    }

    // 缓存变了就要重排：少了这一步，递归重渲染会拿到旧的 offsets，
    // 表现成「缓存里是新行高、DOM 里还是旧行高」
    if (changed) markDirty();

    // 把钉好的高度写回 DOM（changed 时下一轮 relayout 会换成新值）
    position();
    return changed;
  };

  /** 量当前挂载的项，把实测值写回缓存；返回是否需要重排 */
  const measure = () => {
    if (grid) return measureGridRows();
    let changed = false;
    for (const [index, node] of nodes) {
      if (!node.isConnected) continue;

      const key = keys[index];
      const height = Math.max(itemHeight, node.offsetHeight);

      // 每一项都要落进缓存，哪怕它正好等于估高：
      // 否则第一个被量到的「异常高」项会把全局估高带偏，而大量普通项根本没进缓存。
      const prevEst = mixedHeights ? itemHeight : estHeight;
      const before = sizeCache.get(key) ?? prevEst;
      rememberHeight(key, height);
      const nextEst = mixedHeights ? itemHeight : estHeight;
      const after = sizeCache.get(key) ?? nextEst;

      // 自身高度变了、或者全局估高被改写，都要重排
      if (Math.abs(before - after) > 0.5 || Math.abs(prevEst - nextEst) > 0.5) changed = true;
    }
    if (changed) markDirty();
    return changed;
  };

  const nodeOfKey = (key) => {
    const index = indexOfKey(key);
    return index == null ? null : nodes.get(index) ?? null;
  };

  /** 焦点是否仍归本控件：只认容器和选项本身，别把选项内输入框的焦点抢走 */
  const ownsFocus = () => {
    const active = document.activeElement;
    if (!active) return false;
    if (active === el) return true;
    return active.classList?.contains('c-collection__item') === true;
  };

  const focusFocusedNode = () => {
    const key = sel.focusedKey();
    if (key == null) return;
    const node = nodeOfKey(key);
    if (node) node.focus({ preventScroll: true });
    else if (document.activeElement !== el) el.focus({ preventScroll: true });
  };

  /**
   * 重排期间暂存的滚动锚点。
   * 为什么不在 relayout 之后立刻还原：列数一变，高度缓存整批作废，这一刻的
   * offsets 还是「按估高算的」，拿它落位会把视口算歪。必须等这一轮把可见区
   * 量完、行高定下来，再用真实的 offsets 还原。
   */
  let pendingAnchor = null;

  const render = (depth = 0) => {
    if (disposed) return;

    // 锚点要在改列数之前取：capture 用的是旧 offsets，还原用的是新 offsets
    const anchor = depth === 0 ? captureAnchor() : null;
    const shift = measureColumns();
    /**
     * 列数变了才整批作废高度缓存：断行换了，同一个「行号」装的就是另一批内容。
     * 只变宽度（列数没变）不清缓存 —— 清一次总高就变，滚动条可能跟着出现/消失，
     * 宽度再抖回去，缓存永远清不完；可见区的高度由 measure() 每轮现量现补。
     */
    if (shift.colsChanged) resetMeasurements();
    if ((shift.colsChanged || shift.widthChanged) && anchor) pendingAnchor = anchor;
    relayout();

    const hasItems = data.length > 0;
    empty.hidden = hasItems;

    if (!hasItems) {
      for (const index of [...nodes.keys()]) dropItem(index);
      spacer.style.height = '0px';
      totalH = 0;
      pendingAnchor = null;
      syncSelection();
      return;
    }

    reconcile(rangeOf());
    position();
    syncSelection();

    // 重渲染会换掉节点：焦点跟着「焦点项」走，不能留在被移除的旧节点上
    if (ownsFocus()) focusFocusedNode();

    // 第一轮量到的高度可能和估算不同（动态行高、图片撑开），
    // 重排一次就能对齐；两轮封顶，避免极端内容反复增长时死循环。
    if (measure() && depth < 2) render(depth + 1);

    // 行高定下来之后再落锚点：这时 offsets 才是这一版排版真值
    if (depth === 0 && pendingAnchor) {
      const restored = pendingAnchor;
      pendingAnchor = null;
      restoreAnchor(restored);
      reconcile(rangeOf());
      position();
    }
  };

  const schedule = () => {
    if (disposed || rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (disposed) return;
      render();
    });
  };

  /* ---------- 观察器 ---------- */

  const hasRO = typeof ResizeObserver !== 'undefined';

  /** @type {ResizeObserver|null} */
  let itemRO = null;

  // 容器尺寸变了（列数、视口高）。用 rAF 而不是同步重排：
  // 重排可能让滚动条出现/消失，进而再次改变宽度 —— 同步写会触发 RO 循环告警。
  const containerRO = hasRO
    ? new ResizeObserver(() => {
        if (disposed) return;
        schedule();
      })
    : null;
  if (containerRO) {
    containerRO.observe(el);
    disposer.observe(containerRO);
  }

  // 项自己长高（异步图片、字体回退）不会触发滚动，只能靠观察器补一次重算
  if (hasRO) {
    itemRO = new ResizeObserver((entries) => {
      if (disposed) return;
      const alive = entries.some((entry) => {
        const index = Number(entry.target.dataset.index);
        return nodes.get(index) === entry.target;
      });
      if (alive) schedule();
    });
    disposer.observe(itemRO);
  }

  disposer.on(el, 'scroll', schedule, { passive: true });

  /* ---------- 交互 ---------- */

  const isInteractiveChild = (target) =>
    !!target?.closest?.('button,a,input,select,textarea,[contenteditable="true"]');

  const itemFromTarget = (target) => {
    const node = target?.closest?.('.c-collection__item');
    if (!node || !el.contains(node)) return null;
    const index = Number(node.dataset.index);
    return Number.isFinite(index) && nodes.get(index) === node ? { node, index } : null;
  };

  disposer.on(el, 'pointerdown', (e) => {
    if (disposed || disabled || e.button !== 0) return;
    const hit = itemFromTarget(e.target);
    if (!hit || isInteractiveChild(e.target)) return;

    sel.pointer(keys[hit.index], { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
    // 指针也要落在项上：Safari 不一定会因为点击而聚焦 div
    hit.node.focus({ preventScroll: true });
  });

  disposer.on(el, 'click', (e) => {
    if (disposed || disabled) return;
    if (e.detail !== 2) return;
    const hit = itemFromTarget(e.target);
    if (!hit || isInteractiveChild(e.target)) return;
    onActivate?.(keys[hit.index], data[hit.index]);
  });

  disposer.on(el, 'keydown', (e) => {
    if (disposed || disabled) return;
    // 中文输入法组合期的按键不是命令
    if (e.isComposing || e.keyCode === 229) return;
    // 选项里如果放了输入框，方向键和空格属于文本编辑
    const target = e.target;
    if (target && target !== el && isInteractiveChild(target)) return;
    if (!data.length) return;

    const result = sel.key(e, { orientation: grid ? 'grid' : 'vertical', columns: cols });
    if (!result.handled) return;
    e.preventDefault();

    const key = sel.focusedKey();
    if (key != null) el.scrollToKey(key, { align: 'nearest' });
    render();
    focusFocusedNode();

    if (result.activate) {
      const index = indexOfKey(key);
      onActivate?.(key, index == null ? undefined : data[index]);
    }
  });

  /* ---------- 对外接口 ---------- */

  el.scrollToKey = (key, { align = 'nearest' } = {}) => {
    if (disposed) return false;
    const index = indexOfKey(key);
    if (index == null) return false;

    relayout();
    const line = grid ? Math.floor(index / cols) : index;
    const top = offsets[line];
    if (top == null) return false;

    const vh = viewportHeight();
    if (vh <= 0) return true; // 还没上屏，高度未知，别把滚动位置算歪

    const height = sizes[line] ?? itemHeight;
    if (align === 'start') {
      el.scrollTop = clamp(top, 0, Math.max(0, totalH - vh));
    } else {
      const cur = el.scrollTop;
      if (top < cur) el.scrollTop = top;
      else if (top + height > cur + vh) el.scrollTop = clamp(top + height - vh, 0, Math.max(0, totalH - vh));
    }
    render();
    return true;
  };

  /**
   * 外部内容变了（文字、缩略图、图片加载完）但尺寸没跨过观察器阈值时，
   * 手动重测一次。行高「只增不减」的旧问题就是在这里补上的：
   * 重测会按当前内容重算每一行，允许变矮。
   */
  el.refresh = () => {
    if (disposed) return;
    const anchor = captureAnchor();
    resetMeasurements();
    if (anchor) pendingAnchor = anchor;
    render();
  };

  /** 换数据：保留选中集与滚动锚点，不回到顶部 */
  el.setItems = (next = []) => {
    if (disposed) return;

    // 锚点 = 当前第一条可见行 + 它在视口里的偏移
    const anchor = captureAnchor();

    data = [...(next ?? [])];
    rebuildKeys();

    // 已消失的项留着高度只会污染后续估算
    for (const key of [...sizeCache.keys()]) if (!keyIndex.has(key)) sizeCache.delete(key);
    if (!sizeCache.size) {
      estHeight = itemHeight;
      mixedHeights = false;
    }
    rowSizes.clear();
    markDirty();

    sel.setKeys(keys);
    for (const index of [...nodes.keys()]) dropItem(index);

    measureColumns();
    relayout();

    if (anchor) restoreAnchor(anchor);
    // 锚点项被删了就保持原 scrollTop，由浏览器自己夹到合法范围 —— 不要硬回顶部

    render();
  };

  el.value = () => {
    const selected = sel.selectedKeys();
    return multiple ? selected : selected[0] ?? null;
  };

  el.setDisabled = (value) => {
    disabled = !!value;
    applyControlState(el, { disabled });
    syncSelection();
  };

  /** 幂等：断开观察器、取消 rAF、释放选择模型；不摘自己的 DOM */
  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    containerRO?.disconnect();
    itemRO?.disconnect();
    disposer.dispose();
    for (const node of nodes.values()) disposeComponentTree(node);
    nodes.clear();
  };

  measureColumns();
  relayout();
  render();

  return el;
}
