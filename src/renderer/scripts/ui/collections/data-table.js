// Golden Gate · collections/data-table
import { h, clamp } from '../../core/dom.js';
import { iconEl } from '../../core/icons.js';
import { createSelection } from '../_shared/selection.js';
import { createDisposer } from '../_shared/disposer.js';
import { applyControlState } from '../_shared/control.js';

/* ==========================================================================
   DataTable 可交互数据表

   与 content/table.js 的分界：那张是「读」——一次渲染，不碰状态；这张是「改」——
   排序、拖列宽、改单元格、二维键盘、虚拟滚动。把这两套塞进一个控件，
   只读表格就得背十几个用不到的分支和一堆 observer。

   几条刻意为之的取舍：
   1) 列宽存在 widths Map 里，不回写 columns。调用方传进来的数组是数据，
      不是控件的状态；拖一次列宽不该让调用方的常量对象发生变化。
   2) 行身份在进入排序之前就定死（entries 里存 key）。否则 getKey(row, i)
      里的 i 会随排序变化，一排序选中就全丢。
   3) 焦点在「单元格」，不在行。二维导航必须有列位置，行级 tabindex 表达不了。
      选择模型只管行 key，列位置是表自己的 focusCol。
   4) 虚拟滚动用两个撑高行，而不是绝对定位：table 的布局引擎本来就会按行高
      排队，绝对定位会逼我们手算每行的 top，还要和 sticky 表头对账。
   5) 列顺序 / 隐藏 / 宽度合成一份「布局快照」（getLayout / setLayout）。
      组件自己不写 localStorage —— 存哪儿、什么时候存，是应用的事。
   6) manual: true 时既不本地排序也不切片，只把 { sort, page, pageSize } 发出去；
      分页条属于 Pagination，这张表只提供协议，不画页码。
   7) 单元格类型只改「怎么显示、怎么编辑」，不改数据形态：select 交回 options
      里的原值（数字还是数字），tags 交回数组，date 原样交回 ISO 字符串。
   ========================================================================== */

const DEFAULT_WIDTH = 160;
const MIN_COL_WIDTH = 64;
const PAGE_ROWS = 10;
/** 表头拖动阈值：小于它按「点击排序」处理，两者不能抢同一个手势 */
const DRAG_THRESHOLD = 5;
/** 非法输入的闪红时长：够看清，又不至于留在屏幕上 */
const INVALID_FLASH_MS = 700;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CELL_TYPES = new Set(['text', 'select', 'date', 'tags']);

function readWidth(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && !value.includes('%')) {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n; // '120px' / '120' 都按 px
  }
  return null;
}

/** select 的 options 允许简写成 '值' 或 { value, label } */
function normalizeOptions(list) {
  return (Array.isArray(list) ? list : []).map((raw, i) => {
    if (raw && typeof raw === 'object') {
      const value = raw.value ?? raw.label ?? i;
      return { value, label: String(raw.label ?? value ?? '') };
    }
    return { value: raw, label: String(raw ?? '') };
  });
}

/** 列模型规范化：补 minWidth、稳定 key，并剥掉调用方可能混进来的临时字段 */
function normalizeColumns(list) {
  return (Array.isArray(list) ? list : []).map((raw, i) => {
    const key = raw?.key != null ? String(raw.key) : `col-${i}`;
    return {
      key,
      label: raw?.label ?? key,
      width: readWidth(raw?.width),
      minWidth: readWidth(raw?.minWidth) ?? MIN_COL_WIDTH,
      maxWidth: readWidth(raw?.maxWidth),
      align: raw?.align === 'right' || raw?.align === 'center' ? raw.align : 'left',
      sortable: !!raw?.sortable,
      editable: !!raw?.editable,
      type: CELL_TYPES.has(raw?.type) ? raw.type : 'text',
      options: normalizeOptions(raw?.options),
      // 初始隐藏：visible !== false 才是可见（默认可见，缺省值是 false 的坑不踩）
      defaultHidden: raw?.visible === false,
      render: typeof raw?.render === 'function' ? raw.render : null,
      header: raw?.header ?? null,
    };
  });
}

/** 空值一律沉底：升序降序都不该让「没填」的行占住第一屏 */
function compareValues(a, b) {
  const ea = a == null || a === '';
  const eb = b == null || b === '';
  if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a - b;
  // 日期字符串走字典序就够了（ISO 前缀天然可比），数字串交给 numeric
  return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

/** ISO 日期的合法性：2026-02-30 这种「格式对、日期不存在」的也得挡掉 */
function isIsoDate(text) {
  const m = DATE_RE.exec(String(text));
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // 用 UTC 构造：本地时区遇到夏令时不存在的那一小时会把日期挪一天
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 逗号分隔的标签文本 → 数组；中英文逗号都认 */
function parseTags(text) {
  return String(text)
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 值比较：tags 是数组，String() 会把 ['a,b'] 和 ['a','b'] 看成一回事 */
function equalValue(a, b) {
  const arrayish = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = arrayish(a);
    const bb = arrayish(b);
    return aa.length === bb.length && aa.every((v, i) => String(v) === String(bb[i]));
  }
  return String(a ?? '') === String(b ?? '');
}

/**
 * @param {object} o
 * @param {Array<{key:string,label:string,width?:number|string,minWidth?:number,maxWidth?:number,
 *   align?:'left'|'right'|'center',sortable?:boolean,editable?:boolean,
 *   type?:'text'|'select'|'date'|'tags',options?:Array<{value:any,label:string}|any>,
 *   visible?:boolean,render?:(row:any,i:number,col:any)=>Node|string,header?:Node|string}>} [o.columns]
 * @param {Array<object>} [o.rows]
 * @param {(row:any,i:number)=>any} [o.getKey] 稳定 ID；在排序前求值一次
 * @param {{key:string,dir:'asc'|'desc'}|null} [o.sort]
 * @param {(sort:object|null)=>void} [o.onSort] 本地排序也会回调，方便受控
 * @param {'local'|'none'} [o.sorting] 服务端排序用 'none'：只回调，不动顺序
 * @param {boolean} [o.manual] 服务端分页：不本地排序/切片，改用 onQuery 协议
 * @param {number} [o.page] manual 模式的当前页（从 1 开始）
 * @param {number} [o.pageSize] manual 模式的每页条数，只随 onQuery 发出去
 * @param {number|null} [o.total] 数据集总行数；给了才显示「共 N 行」
 * @param {(q:{sort:{key:string,dir:string}|null,page:number,pageSize:number})=>void} [o.onQuery]
 * @param {(layout:{order:string[],widths:Record<string,number>,hidden:string[]})=>void} [o.onColumnsChange]
 * @param {boolean} [o.selectable]
 * @param {boolean} [o.multiple]
 * @param {(keys:string[],info:object)=>void} [o.onSelectionChange]
 * @param {(key:string,row:any)=>void} [o.onActivate]
 * @param {(e:{key:string,column:object,value:any,row:any})=>void} [o.onCellEdit]
 * @param {boolean} [o.editable] 表级开关，单元格还要 column.editable
 * @param {boolean} [o.resizable]
 * @param {boolean} [o.virtual]
 * @param {number} [o.rowHeight] 虚拟滚动按它算行位，实际行高由 CSS 变量同步
 * @param {number} [o.overscan]
 * @param {string} [o.emptyText]
 * @param {string} [o.label]
 * @param {string} [o.className]
 */
export function DataTable({
  columns = [],
  rows = [],
  getKey = (row, i) => row?.id ?? i,
  sort = null,
  onSort,
  sorting = 'local',
  manual = false,
  page = 1,
  pageSize = 20,
  total = null,
  onQuery,
  onColumnsChange,
  selectable = true,
  multiple = false,
  onSelectionChange,
  onActivate,
  onCellEdit,
  editable = false,
  resizable = true,
  virtual = false,
  rowHeight = 28,
  overscan = 6,
  emptyText = '没有数据',
  label = '数据表',
  className = '',
} = {}) {
  const disposer = createDisposer();

  let cols = normalizeColumns(columns);
  /** @type {Map<string, number>} 列宽状态：key → px。与 columns 解耦 */
  const widths = new Map();
  /** @type {Set<string>} 隐藏列的 key：宽度仍然保留，恢复显示时不用重新量 */
  let hidden = new Set();
  /** @type {Array} 可见列的渲染序列：顺序与宽度都按 key 取，隐藏只影响这一层 */
  let shown = [];
  /** @type {Array<{row:any,key:string,src:number}>} 原始顺序 + 稳定 key */
  let entries = [];
  /** @type {Array<{row:any,key:string,src:number}>} 当前呈现顺序 */
  let view = [];
  let sortState =
    sort && sort.key != null
      ? { key: String(sort.key), dir: sort.dir === 'desc' ? 'desc' : 'asc' }
      : null;
  let focusCol = 0;
  let disabled = false;
  let disposed = false;
  /** 服务端分页：页码从 1 开始，pageSize 只随查询发出去，控件不做切片 */
  let pageNo = Math.max(1, Math.floor(Number(page)) || 1);
  const pageRows = Math.max(1, Math.floor(Number(pageSize)) || 20);
  /** null 表示「总数未知」：此时 aria-rowcount 用当前行数，且不显示「共 N 行」 */
  let knownTotal = Number.isFinite(total) ? Math.max(0, Number(total)) : null;
  /** @type {{start:number,end:number}} 当前渲染窗口，虚拟滚动判断要不要重画 */
  let rendered = { start: -1, end: -1 };
  /** @type {null|{td:HTMLElement,entry:object,ci:number,col:object,field:HTMLElement,focusEl:HTMLElement,readValue:()=>any}} */
  let edit = null;
  /** @type {null|(() => void)} 进行中的列宽手势，dispose 时兜底结束 */
  let resizeEnd = null;
  /** @type {null|(() => void)} 进行中的列重排手势 */
  let dragEnd = null;
  /**
   * 拖完一次列之后浏览器还会补一个 click（落在排序按钮上）。
   * 这个开关让「整列搬走」不会被读成「顺手排个序」。
   */
  let suppressClick = false;
  /**
   * 表头每渲染一次就会换掉一批 resizer / 排序列按钮。
   * 这些元素上挂的手势监听必须整批回收，否则排序点一百次就有一百个
   * 已经脱离文档的节点被清理簿按着不放。
   */
  let headDisposer = createDisposer();

  /* ------------------------------------------------------------------ DOM */

  const colgroup = h('colgroup');
  const headRow = h('tr', { role: 'row' });
  const thead = h('thead', { role: 'rowgroup' }, headRow);
  const tbody = h('tbody', { role: 'rowgroup' });
  // table 退成纯排版壳（role=presentation），ARIA 结构由外层的 grid 统一持有
  const table = h(
    'table',
    { class: 'c-datatable__table', role: 'presentation' },
    colgroup,
    thead,
    tbody
  );
  const scroll = h('div', { class: 'c-datatable__scroll' }, table);
  // 只读的行数说明：manual 模式没有分页条，但用户仍要知道「一共多少条」
  const status = h('div', {
    class: 'c-datatable__status',
    role: 'status',
    'aria-live': 'polite',
    hidden: true,
  });
  const el = h(
    'div',
    {
      class: `c-datatable ${className}`.trim(),
      role: 'grid',
      'aria-label': label,
      'aria-colcount': String(cols.length),
      'aria-rowcount': '1',
      'aria-multiselectable': multiple && selectable ? 'true' : null,
      // 行高只有一份真值：CSS 与虚拟滚动的窗口计算都读它
      style: { '--dt-row-h': `${rowHeight}px` },
    },
    scroll,
    status
  );

  /* --------------------------------------------------------------- 选择模型 */

  const sel = createSelection({
    mode: multiple ? 'multiple' : 'single',
    keys: [],
    onChange: (keys, info) => {
      syncDom();
      onSelectionChange?.(keys, info);
    },
    onFocusChange: syncDom,
  });
  el.selection = sel;

  /* ---------------------------------------------------------------- 列宽 */

  function clampWidth(col, w) {
    return clamp(w, col.minWidth, col.maxWidth ?? 1e5);
  }

  function widthOf(col) {
    return widths.get(col.key) ?? clampWidth(col, col.width ?? DEFAULT_WIDTH);
  }

  function ensureWidths() {
    const alive = new Set(cols.map((c) => c.key));
    for (const k of [...widths.keys()]) if (!alive.has(k)) widths.delete(k);
    for (const c of cols) {
      // 同名列换数据时保留用户拖过的宽度，只补新列
      if (!widths.has(c.key)) widths.set(c.key, clampWidth(c, c.width ?? DEFAULT_WIDTH));
    }
  }

  function setWidth(ci, next) {
    const col = shown[ci];
    if (!col) return;
    const px = Math.round(clampWidth(col, next));
    widths.set(col.key, px);
    const colEl = colgroup.children[ci];
    if (colEl) colEl.style.width = `${px}px`;
    const resizer = headRow.children[ci]?.querySelector('.c-datatable__resizer');
    resizer?.setAttribute('aria-valuenow', String(px));
  }

  function startResize(e, col, ci, resizer) {
    const startX = e.clientX;
    const startW = widthOf(col);
    el.dataset.resizing = '1';
    resizer.classList.add('is-dragging');
    // 合成事件没有活动指针，capture 失败不该中断拖动
    try {
      resizer.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }

    const move = (ev) => setWidth(ci, startW + (ev.clientX - startX));
    const end = () => {
      delete el.dataset.resizing;
      resizer.classList.remove('is-dragging');
      resizeEnd = null;
      offMove();
      offUp();
      offCancel();
    };
    const offMove = disposer.on(resizer, 'pointermove', move);
    const offUp = disposer.on(resizer, 'pointerup', end);
    const offCancel = disposer.on(resizer, 'pointercancel', end);
    resizeEnd = end;
  }

  /* ------------------------------------------------------------ 列顺序 / 布局 */

  /** 可见列 = 列顺序 − 隐藏集。所有「第几列」的读法都只认它 */
  function syncShown() {
    shown = cols.filter((c) => !hidden.has(c.key));
    focusCol = clamp(focusCol, 0, Math.max(0, shown.length - 1));
  }

  function getLayout() {
    const map = {};
    for (const c of cols) map[c.key] = Math.round(widthOf(c));
    return {
      order: cols.map((c) => c.key),
      widths: map,
      hidden: cols.filter((c) => hidden.has(c.key)).map((c) => c.key),
    };
  }

  /**
   * 把「显示序列」的下标换算成列数组里的插入位置：
   * insertCi 是插入点（0…shown.length），锚到边界右侧那一列的前面。
   * 拖到自己身上（或自己右边那条缝）一律当作没动。
   */
  function reorderColumns(fromCi, insertCi) {
    const moving = shown[fromCi];
    if (!moving) return false;
    if (insertCi === fromCi || insertCi === fromCi + 1) return false;

    const anchorKey = insertCi < shown.length ? shown[insertCi].key : null;
    const rest = cols.filter((c) => c.key !== moving.key);
    const at = anchorKey == null ? rest.length : rest.findIndex((c) => c.key === anchorKey);
    const next = [...rest];
    next.splice(at < 0 ? rest.length : at, 0, moving);
    if (next.every((c, i) => c === cols[i])) return false;

    const focusedKey = shown[focusCol]?.key ?? null;
    const headHadFocus = headRow.contains(document.activeElement);

    cols = next;
    syncShown();
    if (focusedKey) {
      const ci = shown.findIndex((c) => c.key === focusedKey);
      if (ci >= 0) focusCol = ci;
    }

    renderHead();
    rendered = { start: -1, end: -1 };
    renderBody({ force: true });

    if (headHadFocus) {
      const th = headRow.children[focusCol];
      (th?.querySelector('.c-datatable__sort') ?? th?.querySelector('.c-datatable__resizer'))?.focus({
        preventScroll: true,
      });
    }
    onColumnsChange?.(getLayout());
    return true;
  }

  /** 指针落在哪条缝上：左半边插在这列前面，右半边插在后面 */
  function dropTargetAt(clientX) {
    let insert = 0;
    for (let i = 0; i < shown.length; i++) {
      const th = headRow.children[i];
      if (!th) continue;
      const r = th.getBoundingClientRect();
      if (clientX < r.left) return i;
      if (clientX <= r.right) return clientX < r.left + r.width / 2 ? i : i + 1;
      insert = i + 1;
    }
    return insert;
  }

  function startColumnDrag(e, ci, th) {
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let dropAt = null;

    // 上一次拖动如果结束在表格外，浏览器可能根本没补 click；
    // 这里清掉残留标记，免得把这一次正常的点击吃掉
    suppressClick = false;
    const clearMarks = () => {
      for (const node of headRow.children) node.classList?.remove('is-drop-before', 'is-drop-after');
    };
    const mark = (insert) => {
      clearMarks();
      if (insert == null || !shown.length) return;
      if (insert < shown.length) headRow.children[insert]?.classList.add('is-drop-before');
      else headRow.children[shown.length - 1]?.classList.add('is-drop-after');
    };

    const move = (ev) => {
      if (!moved) {
        if (
          Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
          Math.abs(ev.clientY - startY) < DRAG_THRESHOLD
        ) {
          return;
        }
        moved = true;
        el.dataset.colDragging = '1';
        th.classList.add('is-dragging');
      }
      dropAt = dropTargetAt(ev.clientX);
      mark(dropAt);
    };

    const finish = (commit) => {
      offMove();
      offUp();
      offCancel();
      delete el.dataset.colDragging;
      th.classList.remove('is-dragging');
      clearMarks();
      dragEnd = null;
      if (!moved) return; // 没超过阈值：交给原生 click 去排序
      suppressClick = true;
      if (commit && dropAt != null) reorderColumns(ci, dropAt);
    };

    // 监听挂在 window 上而不是用 pointer capture：capture 会把 click 的目标
    // 改成 th，表头里的排序按钮就再也收不到点击了。
    const offMove = headDisposer.on(window, 'pointermove', move);
    const offUp = headDisposer.on(window, 'pointerup', () => finish(true));
    const offCancel = headDisposer.on(window, 'pointercancel', () => finish(false));
    dragEnd = () => finish(false);
  }

  function setColumnVisible(key, visible) {
    const k = String(key);
    if (!cols.some((c) => c.key === k)) return false;
    const show = !!visible;
    // 状态没变就是空操作：避免调用方在 render 循环里顺手 set 触发抖动
    if (hidden.has(k) === !show) return false;
    if (show) hidden.delete(k);
    else hidden.add(k);
    syncShown();
    rendered = { start: -1, end: -1 };
    renderHead();
    renderBody({ force: true });
    onColumnsChange?.(getLayout());
    return true;
  }

  function setLayout(layout) {
    if (!layout || typeof layout !== 'object') return false;

    if (Array.isArray(layout.order)) {
      const byKey = new Map(cols.map((c) => [c.key, c]));
      const ordered = [];
      for (const raw of layout.order) {
        const col = byKey.get(String(raw));
        if (!col) continue; // 非法 key 忽略
        ordered.push(col);
        byKey.delete(col.key);
      }
      // 快照里没提到的列按原顺序补到末尾：布局是历史记录，不该悄悄丢新列
      for (const c of cols) if (byKey.has(c.key)) ordered.push(c);
      cols = ordered;
    }

    if (layout.widths && typeof layout.widths === 'object') {
      for (const c of cols) {
        if (!(c.key in layout.widths)) continue;
        const w = readWidth(layout.widths[c.key]);
        if (w != null) widths.set(c.key, Math.round(clampWidth(c, w)));
      }
    }

    if (Array.isArray(layout.hidden)) {
      const alive = new Set(cols.map((c) => c.key));
      hidden = new Set(layout.hidden.map(String).filter((k) => alive.has(k)));
    }

    syncShown();
    ensureWidths();
    rendered = { start: -1, end: -1 };
    renderHead();
    renderBody({ force: true });
    return true;
  }

  /* ---------------------------------------------------------------- 表头 */

  function resizerFor(col, ci) {
    const r = h('span', {
      class: 'c-datatable__resizer',
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': `调整「${col.label}」列宽`,
      'aria-valuenow': String(Math.round(widthOf(col))),
      'aria-valuemin': String(col.minWidth),
      'aria-valuemax': col.maxWidth != null ? String(col.maxWidth) : null,
      tabindex: disabled ? '-1' : '0',
      title: '拖动调整列宽，双击恢复默认',
    });

    headDisposer.on(r, 'pointerdown', (e) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      startResize(e, col, ci, r);
    });

    headDisposer.on(r, 'dblclick', (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      setWidth(ci, clampWidth(col, col.width ?? DEFAULT_WIDTH));
    });

    // 键盘也能调宽：命中区只有 7px，纯指针可达性不够
    headDisposer.on(r, 'keydown', (e) => {
      if (disabled) return;
      const step = e.shiftKey ? 32 : 16;
      let next;
      if (e.key === 'ArrowLeft') next = widthOf(col) - step;
      else if (e.key === 'ArrowRight') next = widthOf(col) + step;
      else if (e.key === 'Home') next = col.minWidth;
      else if (e.key === 'End' && col.maxWidth != null) next = col.maxWidth;
      else return;
      e.preventDefault();
      e.stopPropagation();
      setWidth(ci, next);
    });

    return r;
  }

  function thFor(col, ci) {
    const dir = sortState && sortState.key === col.key ? sortState.dir : '';
    const text = col.header ?? col.label;
    const th = h('th', {
      class: 'c-datatable__th',
      role: 'columnheader',
      dataset: { col: String(ci), align: col.align },
      // 只有可排序列才报排序状态；不可排序列挂 aria-sort 会让读屏以为能点
      'aria-sort': col.sortable ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : null,
    });

    if (col.sortable) {
      th.append(
        h(
          'button',
          {
            class: 'c-datatable__sort',
            type: 'button',
            disabled: disabled || null,
            onclick: (e) => {
              e.preventDefault();
              cycleSort(col.key);
            },
          },
          h('span', { class: 'c-datatable__sort-label' }, text),
          // 未排序时给一个中性的 sort 图标：让「这列能点」在 hover 前就有暗示
          iconEl(dir === 'asc' ? 'chevron-up' : dir === 'desc' ? 'chevron-down' : 'sort', 11)
        )
      );
    } else {
      th.append(h('span', { class: 'c-datatable__sort-label' }, text));
    }

    if (resizable) th.append(resizerFor(col, ci));

    // 拖动整列：阈值 5px 之内仍是「点表头排序」
    headDisposer.on(th, 'pointerdown', (e) => {
      if (disabled || e.button !== 0) return;
      if (e.target.closest?.('.c-datatable__resizer')) return;
      startColumnDrag(e, ci, th);
    });

    return th;
  }

  function renderHead() {
    headDisposer.dispose();
    headDisposer = createDisposer();
    // 末尾补一列「吃余量」的空列：table-layout:fixed 下，没有写宽度的列
    // 会分到剩余空间。没有它，容器比列宽总和大时，浏览器会把多出来的宽度
    // 按比例摊回每一列 —— 用户明明把「类型」拖到 90px，最后却变成 150px。
    colgroup.replaceChildren(
      ...shown.map((c) => h('col', { style: { width: `${Math.round(widthOf(c))}px` } })),
      h('col', { class: 'c-datatable__fill' })
    );
    headRow.replaceChildren(
      ...shown.map((c, ci) => thFor(c, ci)),
      h('th', { class: 'c-datatable__filler', role: 'presentation', 'aria-hidden': 'true' })
    );
  }

  /* ---------------------------------------------------------------- 单元格 */

  function tagsView(value) {
    const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
    const wrap = h('span', { class: 'c-datatable__tags' });
    for (const t of list) wrap.append(h('span', { class: 'c-datatable__tag' }, String(t)));
    return wrap;
  }

  function fillCell(td, entry, col) {
    if (col.render) {
      const out = col.render(entry.row, entry.src, col);
      if (out instanceof Node) td.replaceChildren(out);
      else td.textContent = out == null ? '' : String(out);
      return;
    }
    const value = entry.row?.[col.key];
    if (col.type === 'tags') {
      td.replaceChildren(tagsView(value));
      return;
    }
    if (col.type === 'select') {
      const hit = col.options.find((o) => String(o.value) === String(value));
      td.textContent = hit ? hit.label : value == null ? '' : String(value);
      return;
    }
    // date 原样显示字符串：不做时区换算，存储的就是用户看到的
    td.textContent = value == null ? '' : String(value);
  }

  function cellFor(entry, col, ci) {
    const td = h('td', {
      role: 'gridcell',
      class: 'c-datatable__cell',
      dataset: { col: String(ci), align: col.align, type: col.type },
      'aria-colindex': String(ci + 1),
      tabindex: '-1',
    });
    fillCell(td, entry, col);
    return td;
  }

  function rowFor(entry, ri) {
    const tr = h('tr', {
      role: 'row',
      class: 'c-datatable__row',
      // index 是「当前呈现顺序」的下标，键盘导航直接读它，不必再查一次数组
      dataset: { key: entry.key, index: String(ri) },
      // 表头占第 1 行；manual 模式下页内第 1 行对应的仍是数据集里的绝对行号
      'aria-rowindex': String(rowIndexBase() + ri + 2),
      'aria-selected': selectable ? String(sel.isSelected(entry.key)) : null,
    });
    for (let ci = 0; ci < shown.length; ci++) tr.append(cellFor(entry, shown[ci], ci));
    tr.append(h('td', { class: 'c-datatable__filler', role: 'presentation', 'aria-hidden': 'true' }));
    return tr;
  }

  function rowIndexBase() {
    return manual ? (pageNo - 1) * pageRows : 0;
  }

  function spacerRow(height) {
    return h(
      'tr',
      {
        class: 'c-datatable__spacer',
        'aria-hidden': 'true',
        style: { height: `${Math.max(0, Math.round(height))}px` },
      },
      h('td', { colspan: String(Math.max(shown.length + 1, 1)) })
    );
  }

  function emptyRow() {
    return h(
      'tr',
      { role: 'row', class: 'c-datatable__row' },
      h(
        'td',
        {
          role: 'gridcell',
          class: 'c-datatable__empty',
          colspan: String(Math.max(shown.length + 1, 1)),
          'aria-colindex': '1',
        },
        emptyText
      )
    );
  }

  /* ---------------------------------------------------------------- 渲染 */

  function windowRange(count) {
    const viewH = scroll.clientHeight || rowHeight * 12;
    const headH = thead.offsetHeight || 26;
    const top = Math.max(0, scroll.scrollTop - headH);
    const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
    const end = Math.min(count, Math.ceil((top + viewH) / rowHeight) + overscan);
    return { start, end: Math.max(start, end) };
  }

  /** 「共 N 行」只在总数已知时出现；manual 模式下这是唯一的分页反馈 */
  function updateStatus() {
    if (knownTotal == null) {
      status.hidden = true;
      if (status.textContent) status.textContent = '';
      return;
    }
    status.hidden = false;
    const text = `共 ${knownTotal} 行`;
    if (status.textContent !== text) status.textContent = text;
  }

  function renderBody({ force = false } = {}) {
    // 重画会把编辑框一起换掉，先落库，避免输入丢失
    if (edit) endEdit({ commit: true, refocus: false });

    const count = view.length;
    const rowTotal = knownTotal ?? count;
    el.setAttribute('aria-rowcount', String(rowTotal + 1));
    el.setAttribute('aria-colcount', String(shown.length));
    updateStatus();

    if (!count) {
      rendered = { start: 0, end: 0 };
      tbody.replaceChildren(emptyRow());
      return;
    }

    let start = 0;
    let end = count;
    if (virtual) {
      const r = windowRange(count);
      start = r.start;
      end = r.end;
      // 窗口没变就不重画：滚动事件每帧都有，重建 DOM 会把焦点冲掉
      if (!force && start === rendered.start && end === rendered.end && tbody.firstElementChild) {
        return;
      }
    }
    rendered = { start, end };

    // 重画期间焦点会掉到 body 上，先记住位置，画完还回去
    const active = document.activeElement;
    const hadFocus = !!active && tbody.contains(active) && active.classList?.contains('c-datatable__cell');
    const focusKey = hadFocus ? active.closest('tr')?.dataset.key ?? null : null;
    const focusIndex = hadFocus ? Number(active.dataset.col) : -1;

    const frag = document.createDocumentFragment();
    if (virtual && start > 0) frag.append(spacerRow(start * rowHeight));
    for (let i = start; i < end; i++) frag.append(rowFor(view[i], i));
    if (virtual && end < count) frag.append(spacerRow((count - end) * rowHeight));
    tbody.replaceChildren(frag);

    syncDom();
    if (focusKey) focusCell(focusKey, focusIndex, { scroll: false });
  }

  /** 把选中 / roving tabindex 落到当前 DOM 上，不重建节点 */
  function syncDom() {
    const focused = sel.focusedKey();
    const rowEls = tbody.querySelectorAll('tr[data-key]');
    let roving = null;

    for (const tr of rowEls) {
      const key = tr.dataset.key;
      if (selectable) tr.setAttribute('aria-selected', String(sel.isSelected(key)));
      for (const cell of tr.children) cell.tabIndex = -1;
      if (key === focused) roving = tr;
    }

    // 焦点行滚出渲染窗口时退到第一行：roving tabindex 必须有且只有一个，
    // 否则整个网格会被 Tab 跳过（虚拟滚动下的必然后果）
    if (!roving && rowEls.length) roving = rowEls[0];
    // 全部列被隐藏时没有可停的单元格，别把 roving tabindex 塞给余量列
    if (roving && !disabled && shown.length) {
      const cell = roving.children[Math.min(focusCol, shown.length - 1)];
      if (cell) cell.tabIndex = 0;
    }
  }

  function focusCell(key, ci, { scroll = true } = {}) {
    const row = [...tbody.querySelectorAll('tr[data-key]')].find((tr) => tr.dataset.key === key);
    if (!row) return false;
    const cell = row.children[Math.min(Math.max(ci, 0), Math.max(0, shown.length - 1))];
    if (!cell) return false;
    if (scroll) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    cell.focus({ preventScroll: true });
    return true;
  }

  /** 虚拟滚动下先把目标行滚进视口，再重画，否则焦点单元格根本不存在 */
  function ensureVisible(ri) {
    if (!virtual) return;
    const headH = thead.offsetHeight || 26;
    const top = ri * rowHeight + headH;
    const bottom = top + rowHeight;
    const viewTop = scroll.scrollTop;
    const viewBottom = viewTop + scroll.clientHeight;
    if (top < viewTop + headH) scroll.scrollTop = top - headH;
    else if (bottom > viewBottom) scroll.scrollTop = bottom - scroll.clientHeight;
  }

  /* ---------------------------------------------------------------- 排序 */

  function rebuildView() {
    if (!manual && sorting === 'local' && sortState) {
      const col = cols.find((c) => c.key === sortState.key);
      if (col) {
        const sign = sortState.dir === 'desc' ? -1 : 1;
        view = [...entries].sort(
          (a, b) => sign * compareValues(a.row?.[col.key], b.row?.[col.key])
        );
      } else {
        view = entries;
      }
    } else {
      // manual：顺序是服务端给的，本地只负责把 rows 原样铺出来
      view = entries;
    }
    sel.setKeys(view.map((e) => e.key));
  }

  /** 把查询条件交给应用。控件不发请求、不缓存页，只描述「我要哪一段」 */
  function emitQuery() {
    if (!manual) return;
    onQuery?.({
      sort: sortState ? { key: sortState.key, dir: sortState.dir } : null,
      page: pageNo,
      pageSize: pageRows,
    });
  }

  function cycleSort(key) {
    // 三态：升 → 降 → 取消。没有「取消」就只能靠刷新页面回到原序
    const next =
      !sortState || sortState.key !== key
        ? { key, dir: 'asc' }
        : sortState.dir === 'asc'
          ? { key, dir: 'desc' }
          : null;
    applySort(next, true);
  }

  function applySort(next, notify) {
    // 表头会被整批换掉，键盘用户按在排序按钮上的焦点得先记下来
    const active = document.activeElement;
    const headCi = headRow.contains(active) ? Number(active.closest('th')?.dataset.col) : -1;

    sortState = next;
    renderHead();
    rebuildView();
    rendered = { start: -1, end: -1 };
    renderBody({ force: true });

    if (headCi >= 0) {
      headRow.children[headCi]?.querySelector('.c-datatable__sort')?.focus({ preventScroll: true });
    }
    if (notify) {
      onSort?.(sortState);
      emitQuery();
    }
  }

  /* ---------------------------------------------------------------- 编辑 */

  function canEdit(col) {
    return !!col && editable && col.editable && !disabled;
  }

  function coerce(previous, text) {
    // 数值列的编辑结果要回成数值，否则调用方拿到 "42" 得自己 parse 一遍
    if (typeof previous === 'number') {
      const trimmed = text.trim();
      const n = Number(trimmed);
      return trimmed !== '' && Number.isFinite(n) ? n : text;
    }
    if (typeof previous === 'boolean') return text.trim() === 'true';
    return text;
  }

  /** 非法输入只闪一下红圈：不弹错、不写数据，值保持原样 */
  function flashInvalid(td) {
    if (!td?.isConnected) return;
    td.classList.add('is-invalid');
    disposer.timeout(() => td.classList.remove('is-invalid'), INVALID_FLASH_MS);
  }

  function makeInput(col, raw) {
    return h('input', {
      class: 'c-field__input',
      type: 'text',
      'aria-label': `编辑「${col.label}」`,
      value: raw == null ? '' : String(raw),
      autocomplete: 'off',
      spellcheck: 'false',
    });
  }

  function startEdit(td, entry, ci) {
    const col = shown[ci];
    if (!canEdit(col) || !td?.isConnected) return false;
    if (edit) endEdit({ commit: true, refocus: false });

    const raw = entry.row?.[col.key];
    let field;
    let focusEl;
    /** 提交时读当前输入 → 目标类型的值 */
    let readValue;

    if (col.type === 'select') {
      const current = raw == null ? '' : String(raw);
      const options = [...col.options];
      // 当前值不在候选里（脏数据）：补一条只读选项，否则下拉会显示第一项，
      // 用户一打开就「被改值」了
      if (current !== '' && !options.some((o) => String(o.value) === current)) {
        options.unshift({ value: current, label: current });
      }
      const typed = new Map(); // option.value（字符串）→ 原始值，保住数字/布尔类型
      const select = h('select', { class: 'c-field__input', 'aria-label': `编辑「${col.label}」` });
      for (const o of options) {
        const v = String(o.value);
        typed.set(v, o.value);
        select.append(h('option', { value: v, selected: v === current ? true : null }, o.label));
      }
      field = h('div', { class: 'c-field c-datatable__editor' }, select);
      focusEl = select;
      readValue = () => (typed.has(select.value) ? typed.get(select.value) : select.value);
    } else if (col.type === 'tags') {
      const list = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
      const input = makeInput(col, list.join(', '));
      field = h('div', { class: 'c-field c-datatable__editor' }, input);
      focusEl = input;
      readValue = () => parseTags(input.value);
    } else {
      // text / date 都是单行文本；date 的校验放在提交时，输入过程不打断
      const input = makeInput(col, raw);
      if (col.type === 'date') input.setAttribute('inputmode', 'numeric');
      field = h('div', { class: 'c-field c-datatable__editor' }, input);
      focusEl = input;
      readValue = () => (col.type === 'date' ? input.value.trim() : coerce(raw, input.value));
    }

    td.dataset.editing = '1';
    td.replaceChildren(field);
    edit = { td, entry, ci, col, field, focusEl, readValue };

    // 这个编辑控件是临时的，监听跟着元素一起回收，不进 disposer 登记簿
    focusEl.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // 输入法选词期间的回车不算提交
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        endEdit({ commit: true, refocus: true });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endEdit({ commit: false, refocus: true });
      } else if (e.key === 'Tab') {
        // 网格里的 Tab 是「下一格」，不是「下一个控件」：提交后自己挪，
        // 挪到头了再交还给浏览器（下表之外没有可聚焦单元格时 Tab 会离开表格）
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        endEdit({ commit: true, refocus: false });
        tabTo(td, dir);
      }
    });
    focusEl.addEventListener('blur', () => {
      if (edit && edit.focusEl === focusEl) endEdit({ commit: true, refocus: false });
    });
    // 原生下拉选完就提交：再按一次回车去确认是多余的
    if (col.type === 'select') {
      focusEl.addEventListener('change', () => {
        if (edit && edit.focusEl === focusEl) endEdit({ commit: true, refocus: true });
      });
    }

    focusEl.focus({ preventScroll: true });
    if (col.type !== 'select') focusEl.select();
    return true;
  }

  function endEdit({ commit = true, refocus = false } = {}) {
    const cur = edit;
    if (!cur) return;
    edit = null; // 先清空：移除 input 触发的 blur 不能再进来一次

    const { td, entry, ci, col, field, readValue } = cur;
    const before = entry.row?.[col.key];
    let next;
    let valid = true;

    if (commit) {
      next = readValue();
      // 日期是唯一会「拒绝提交」的类型：格式/日历不合法就回退并闪一下
      if (col.type === 'date' && next !== '' && !isIsoDate(next)) valid = false;
    }

    if (field.parentNode === td) td.removeChild(field);
    else td.replaceChildren();
    delete td.dataset.editing;

    // 单元格内容交还数据源：受控数据没变就显示旧值，变了等 setRows 重画
    fillCell(td, entry, col);

    if (commit && !valid) flashInvalid(td);
    else if (commit && !equalValue(next, before)) {
      onCellEdit?.({ key: entry.key, column: col, value: next, row: entry.row });
    }
    if (refocus) focusCell(entry.key, ci);
  }

  /** Tab / Shift+Tab：行内右移，到行尾折到下一行行首 */
  function tabTo(td, dir) {
    const tr = td.closest('tr[data-key]');
    if (!tr) return;
    const ri = Number(tr.dataset.index);
    let ci = Number(td.dataset.col) + dir;
    let nextRow = ri;
    if (ci < 0) {
      nextRow = ri - 1;
      ci = shown.length - 1;
    } else if (ci >= shown.length) {
      nextRow = ri + 1;
      ci = 0;
    }
    if (nextRow < 0 || nextRow >= view.length) return;
    moveTo(nextRow, ci);
  }

  /* ---------------------------------------------------------------- 键盘 */

  function moveTo(ri, ci) {
    const entry = view[ri];
    if (!entry) return;
    focusCol = clamp(ci, 0, Math.max(0, shown.length - 1));
    sel.setFocused(entry.key, { source: 'keyboard' });
    if (virtual) {
      ensureVisible(ri);
      renderBody();
    }
    syncDom();
    focusCell(entry.key, focusCol);
  }

  disposer.on(el, 'keydown', (e) => {
    if (disposed || disabled) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.target.closest?.('.c-datatable__resizer')) return; // 列宽手柄有自己的方向键
    const td = e.target.closest?.('.c-datatable__cell');
    if (!td || !el.contains(td)) return;
    if (e.target.closest('input, textarea, select, button, a')) return;

    const tr = td.closest('tr[data-key]');
    const count = view.length;
    const last = shown.length - 1;
    if (!tr || !count || last < 0) return;

    let ri = Number(tr.dataset.index);
    let ci = Number(td.dataset.col);
    if (!Number.isFinite(ri) || !Number.isFinite(ci)) return;

    // 焦点可能停在上一次渲染留下的「兜底 roving 单元格」上，先让模型跟上 DOM
    if (sel.focusedKey() !== tr.dataset.key) sel.setFocused(tr.dataset.key, { source: 'keyboard' });

    const mod = e.metaKey || e.ctrlKey;
    const key = tr.dataset.key;
    const entry = view[ri];
    let handled = true;
    let enteredEdit = false;

    switch (e.key) {
      case 'ArrowRight':
        if (ci < last) ci += 1;
        else if (ri < count - 1) {
          ri += 1;
          ci = 0;
        }
        break;
      case 'ArrowLeft':
        if (ci > 0) ci -= 1;
        else if (ri > 0) {
          ri -= 1;
          ci = last;
        }
        break;
      case 'ArrowDown':
        ri = Math.min(count - 1, ri + 1);
        break;
      case 'ArrowUp':
        ri = Math.max(0, ri - 1);
        break;
      case 'Home':
        if (mod) {
          ri = 0;
          ci = 0;
        } else ci = 0;
        break;
      case 'End':
        if (mod) {
          ri = count - 1;
          ci = last;
        } else ci = last;
        break;
      case 'PageDown':
        ri = Math.min(count - 1, ri + PAGE_ROWS);
        break;
      case 'PageUp':
        ri = Math.max(0, ri - PAGE_ROWS);
        break;
      case ' ':
      case 'Spacebar':
        if (!selectable) {
          handled = false;
          break;
        }
        if (multiple) sel.toggle(key, { source: 'keyboard' });
        else sel.selectOnly(key, { source: 'keyboard' });
        break;
      case 'Enter':
        // 可编辑单元格：Enter 进编辑（焦点要交给输入框，下面不能再抢回来）
        if (canEdit(shown[ci])) enteredEdit = startEdit(td, entry, ci);
        else onActivate?.(key, entry?.row);
        break;
      default:
        if ((e.key === 'a' || e.key === 'A') && mod && selectable) {
          sel.selectAll({ source: 'keyboard' });
          break;
        }
        handled = false;
        break;
    }

    if (!handled) return;
    e.preventDefault();
    if (enteredEdit) return;

    const changedOnly = e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter' ||
      (mod && (e.key === 'a' || e.key === 'A'));
    if (changedOnly) {
      // 选中/激活不移动焦点：原地把 roving tabindex 与状态刷一遍
      syncDom();
      focusCell(key, ci);
      return;
    }
    moveTo(ri, ci);
  });

  /* ---------------------------------------------------------------- 指针 */

  disposer.on(el, 'pointerdown', (e) => {
    if (disposed || disabled || e.button !== 0) return;
    if (e.target.closest?.('.c-datatable__resizer, button, a, input, textarea, select')) return;
    const td = e.target.closest?.('.c-datatable__cell');
    if (!td || !el.contains(td)) return;
    const tr = td.closest('tr[data-key]');
    if (!tr) return;

    const key = tr.dataset.key;
    focusCol = Number(td.dataset.col) || 0;
    if (selectable) {
      sel.pointer(key, { meta: e.metaKey || e.ctrlKey, shift: multiple && e.shiftKey });
    } else {
      sel.setFocused(key, { source: 'pointer' });
    }
    syncDom();
    td.focus({ preventScroll: true });
  });

  disposer.on(el, 'dblclick', (e) => {
    if (disposed || disabled) return;
    if (e.target.closest?.('.c-datatable__resizer, button, a, input, textarea, select')) return;
    const td = e.target.closest?.('.c-datatable__cell');
    if (!td) return;
    const tr = td.closest('tr[data-key]');
    const entry = view.find((it) => it.key === tr?.dataset.key);
    if (!entry) return;
    const ci = Number(td.dataset.col) || 0;
    if (canEdit(shown[ci])) startEdit(td, entry, ci);
    else onActivate?.(entry.key, entry.row);
  });

  // 拖完列后浏览器补的那一次 click 不能落到排序按钮上。放捕获阶段，
  // 抢在 th 内部的按钮之前把它吃掉。
  disposer.on(
    el,
    'click',
    (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  /* ------------------------------------------------------------ 虚拟滚动 */

  let windowOff = null;
  function scheduleWindow() {
    if (windowOff) return;
    windowOff = disposer.frame(() => {
      windowOff = null;
      renderBody();
    });
  }

  disposer.on(scroll, 'scroll', () => {
    if (disposed || !virtual) return;
    scheduleWindow();
  }, { passive: true });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (disposed || !virtual) return;
      scheduleWindow();
    });
    ro.observe(scroll);
    disposer.observe(ro);
  }

  /* ------------------------------------------------------------- 公开 API */

  /**
   * @param {Array<object>} next
   * @param {{total?:number}} [opts] manual 模式下用 total 报数据集总行数
   */
  function setRows(next, opts = {}) {
    const list = Array.isArray(next) ? next : [];
    if (opts && opts.total != null && Number.isFinite(Number(opts.total))) {
      knownTotal = Math.max(0, Number(opts.total));
    }
    if (edit) endEdit({ commit: false, refocus: false });
    // key 在排序前定死：getKey 里的下标是源数组下标，不能被 view 的顺序污染
    entries = list.map((row, i) => ({ row, key: String(getKey(row, i)), src: i }));
    rebuildView();
    sel.prune(entries.map((e) => e.key));
    rendered = { start: -1, end: -1 };
    renderBody({ force: true });
  }

  function setColumns(next) {
    if (edit) endEdit({ commit: false, refocus: false });
    cols = normalizeColumns(next);
    // 隐藏集按新列裁剪；新列自己声明的 visible:false 也收进来
    const alive = new Set(cols.map((c) => c.key));
    hidden = new Set([...hidden].filter((k) => alive.has(k)));
    for (const c of cols) if (c.defaultHidden) hidden.add(c.key);
    syncShown();
    ensureWidths();
    renderHead();
    rendered = { start: -1, end: -1 };
    renderBody({ force: true });
  }

  el.setRows = setRows;
  el.rows = () => view.map((e) => e.row);
  el.setColumns = setColumns;
  el.columns = () => cols.map((c) => ({ ...c }));
  el.value = () => sel.selectedKeys();

  el.getLayout = getLayout;
  el.setLayout = setLayout;
  el.setColumnVisible = setColumnVisible;

  /** manual：翻页。只发查询，不切片 —— 新数据由调用方 setRows 送回来 */
  el.setPage = (next) => {
    const n = Math.max(1, Math.floor(Number(next)) || 1);
    if (n === pageNo) return false;
    pageNo = n;
    if (!manual) return false;
    rendered = { start: -1, end: -1 };
    emitQuery();
    return true;
  };
  el.page = () => pageNo;
  /** 手动重发一次查询（例如「刷新」按钮） */
  el.query = () => emitQuery();

  el.setSort = (next) => {
    sortState =
      next && next.key != null
        ? { key: String(next.key), dir: next.dir === 'desc' ? 'desc' : 'asc' }
        : null;
    applySort(sortState, false);
  };

  el.setDisabled = (v) => {
    disabled = !!v;
    applyControlState(el, { disabled });
    if (disabled && edit) endEdit({ commit: false, refocus: false });
    for (const r of el.querySelectorAll('.c-datatable__resizer')) r.tabIndex = disabled ? -1 : 0;
    for (const b of el.querySelectorAll('.c-datatable__sort')) b.disabled = disabled;
    syncDom();
  };

  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    if (edit) endEdit({ commit: false, refocus: false });
    resizeEnd?.();
    dragEnd?.();
    delete el.dataset.resizing;
    delete el.dataset.colDragging;
    sel.dispose();
    disposer.dispose();
  };

  /* ---------------------------------------------------------------- 初始化 */

  disposer.add(() => headDisposer.dispose());
  for (const c of cols) if (c.defaultHidden) hidden.add(c.key);
  syncShown();
  ensureWidths();
  renderHead();
  setRows(rows);
  return el;
}
