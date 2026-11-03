// ============================================================
// Lumina · 图片网格
// 网格 / 列表两种形态共用一套窗口化渲染：
//   · 容器高度 = 总行数 × 行距，只渲染可视区 ±1 屏的单元格
//   · 单元格绝对定位，滚动时只改 transform，不触发重排
//   · 缩略图按帧合批，一次 IPC 取多张（绝不一张一张 invoke）
// ============================================================

import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { Thumb } from '../ui/kit.js';
import * as api from './api.js';
import { fmtDate, fmtSize } from './util.js';

/** 从 :root 读一个长度令牌，读不到就用兜底值（--grid-gap 是 4px） */
function tokenPx(name, fallback) {
  try {
    const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** 网格缝：docs/04 §5 规定用 --grid-gap，不要在 JS 里另写一个字面量 */
const GRID_GAP = tokenPx('--grid-gap', 4);
const LIST_ROW_H = 40;
const LIST_GAP = 8;

export function createGrid({
  scroller,
  items = [],
  viewMode = 'grid',
  thumbSize = 400,
  thumbW = 140,
  listColumns = 3,
  columns = 0,
  gap = GRID_GAP,
  selection = new Set(),
  multi = false,
  onOpen,
  onMenu,
  onClick,
  onLongPress,
  onDragStart,
}) {
  const el = h('div', { class: 'app-grid' });
  const spacer = h('div', { class: 'app-grid__spacer' });
  el.append(spacer);

  /** index → 单元格 */
  const cells = new Map();
  /** 待取缩略图的队列 */
  let pending = [];
  let rafId = 0;
  let layoutRaf = 0;
  let generation = 0;
  let lastRange = [-1, -1];
  let destroyed = false;
  /** 选择模式：决定多选勾是否显示 */
  let multiMode = multi;

  let cols = 1;
  let cellW = thumbW;
  let cellH = thumbW;
  let colGap = GRID_GAP;
  let rowGap = GRID_GAP;

  /* ---------------- 缩略图批取 ---------------- */

  function setImg(thumb, url) {
    const img = thumb.querySelector('img');
    if (!img || !url) return;
    // 不判断 isConnected：单元格常常是先建好再挂到文档上（frag 批量插入），
    // 这一刻还没连上，但图片地址照样要写进去，否则会永远空着。
    if (img.getAttribute('src') !== url) img.src = url;
  }

  function flush() {
    rafId = 0;
    if (destroyed || !pending.length) return;
    const batch = pending.splice(0, 32);
    const gen = generation;

    api
      .getThumbs(
        batch.map((it) => ({ name: it.img.name, folder: it.img.folder })),
        thumbSize
      )
      .then((res) => {
        if (destroyed || gen !== generation) return;
        res.forEach((r, i) => {
          if (r?.dataUrl) setImg(batch[i].thumb, r.dataUrl);
        });
      })
      .catch(() => {
        // 单张失败就让格子保持底色，不弹提示（大量图片时噪音太大）
      })
      .finally(() => {
        if (!destroyed && pending.length) schedule();
      });
  }

  function schedule() {
    if (rafId) return;
    rafId = requestAnimationFrame(flush);
  }

  function wantThumb(img, thumb) {
    const hit = api.peekThumb(img.name, img.folder, thumbSize);
    if (hit?.dataUrl) {
      setImg(thumb, hit.dataUrl);
      return;
    }
    pending.push({ img, thumb });
    schedule();
  }

  /* ---------------- 单元格 ---------------- */

  /**
   * 点击模型：
   *   普通模式 —— 单击/双击都是「打开」（长按才进选择模式）
   *   选择模式 —— 单击是「选中」
   * 长按用指针计时实现：按住 460ms 不动才触发，移动超过 6px 取消。
   */
  let pressTimer = 0;
  let pressFrom = null;
  let longPressed = false;

  function bind(el2, index) {
    el2.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pressFrom = { x: e.clientX, y: e.clientY };
      longPressed = false;
      clearTimeout(pressTimer);
      if (!onLongPress) return;
      pressTimer = setTimeout(() => {
        longPressed = true;
        onLongPress(index, e);
      }, 460);
    });

    const cancel = () => clearTimeout(pressTimer);
    el2.addEventListener('pointerup', cancel);
    el2.addEventListener('pointercancel', cancel);
    el2.addEventListener('pointerleave', cancel);
    el2.addEventListener('pointermove', (e) => {
      if (!pressFrom) return;
      if (Math.abs(e.clientX - pressFrom.x) > 6 || Math.abs(e.clientY - pressFrom.y) > 6) {
        clearTimeout(pressTimer);
        pressFrom = null;
      }
    });

    el2.addEventListener('click', (e) => {
      // 长按结束后浏览器还会补一个 click，必须吃掉，否则会顺手打开灯箱
      if (longPressed) {
        longPressed = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onClick?.(index, e);
    });

    el2.addEventListener('dblclick', () => {
      if (!longPressed) onOpen?.(index);
    });

    el2.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      onMenu?.(index, e);
    });
  }

  function makeGridCell(img, index) {
    const thumb = Thumb({
      src: '',
      selected: selection.has(img.key),
      multi: multiMode,
      fav: !!img.fav,
    });
    // Thumb 默认给 src=""，会指向当前文档；先摘掉，等真正的地址
    thumb.querySelector('img')?.removeAttribute('src');
    bind(thumb, index);
    wantThumb(img, thumb);
    return thumb;
  }

  function makeListCell(img, index) {
    const thumb = Thumb({ src: '', selected: false, multi: false, fav: false });
    thumb.querySelector('img')?.removeAttribute('src');
    wantThumb(img, thumb);

    const row = h(
      'div',
      {
        class: 'c-row app-listrow',
        'aria-selected': String(selection.has(img.key)),
        dataset: { key: img.key },
      },
      h('div', { class: 'app-listrow__thumb' }, thumb),
      h(
        'div',
        { class: 'app-listrow__name' },
        img.fav ? h('span', { class: 'app-ic', html: icon('star', 12) }) : null,
        h('span', null, img.displayName || img.name)
      ),
      h('div', { class: 'app-listrow__meta' }, img.size ? fmtSize(img.size) : '--'),
      h('div', { class: 'app-listrow__meta' }, img.date ? fmtDate(img.date) : '--'),
      h('div', { class: 'app-listrow__folder' }, img.folder || '根目录')
    );
    bind(row, index);
    return row;
  }

  function makeCell(img, index) {
    const inner = viewMode === 'list' ? makeListCell(img, index) : makeGridCell(img, index);
    const cell = h('div', { class: 'app-grid__cell' }, inner);
    if (onDragStart) {
      cell.draggable = true;
      cell.addEventListener('dragstart', (e) => onDragStart(index, e));
    }
    cell.style.width = `${cellW}px`;
    cell.style.height = `${cellH}px`;
    return cell;
  }

  /* ---------------- 布局 ---------------- */

  function measure() {
    const width = el.clientWidth;
    if (!width) return false;

    if (viewMode === 'list') {
      cols = Math.max(1, Math.min(5, Number(listColumns) || 3));
      colGap = LIST_GAP;
      rowGap = 0;
      cellW = (width - colGap * (cols - 1)) / cols;
      cellH = LIST_ROW_H;
    } else {
      colGap = Math.max(0, Number(gap) || 0);
      rowGap = colGap;
      const want = Number(columns) || 0;
      if (want > 0) {
        // 指定列数时也要防一手：窗口太窄就别硬塞，至少留 72px 一格
        cols = Math.max(1, Math.min(want, Math.floor((width + colGap) / 72)));
      } else {
        cols = Math.max(1, Math.floor((width + colGap) / (thumbW + colGap)));
      }
      cellW = (width - colGap * (cols - 1)) / cols;
      cellH = cellW;
    }
    return true;
  }

  function offsetInScroller() {
    const r = el.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    return r.top - sr.top + scroller.scrollTop;
  }

  function clearCells() {
    for (const [, node] of cells) node.remove();
    cells.clear();
    lastRange = [-1, -1];
  }

  function renderRange(force = false) {
    if (destroyed || !items.length) {
      if (force) {
        clearCells();
        spacer.style.height = '0px';
      }
      return;
    }

    const rowStride = cellH + rowGap;
    const rows = Math.ceil(items.length / cols);
    const total = Math.max(0, rows * rowStride - rowGap);
    const totalCss = `${total}px`;
    // 只在真的变了才写：每帧写一次高度会白白触发一次布局
    if (spacer.style.height !== totalCss) spacer.style.height = totalCss;

    const viewTop = scroller.scrollTop - offsetInScroller();
    const viewH = scroller.clientHeight;

    let firstRow = Math.floor(viewTop / rowStride) - 1;
    let lastRow = Math.ceil((viewTop + viewH) / rowStride) + 1;
    firstRow = Math.max(0, Math.min(rows - 1, firstRow));
    lastRow = Math.max(0, Math.min(rows - 1, lastRow));

    const from = firstRow * cols;
    const to = Math.min(items.length, (lastRow + 1) * cols);

    if (!force && from === lastRange[0] && to === lastRange[1]) {
      // 范围没变：滚动时什么都不用做（位置只跟行列号有关，列数没变就不会动）
      return;
    }
    lastRange = [from, to];

    // 移出窗口的
    for (const [i, node] of cells) {
      if (i < from || i >= to) {
        node.remove();
        cells.delete(i);
      }
    }

    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i += 1) {
      let node = cells.get(i);
      if (!node) {
        node = makeCell(items[i], i);
        cells.set(i, node);
        placeCell(i, node);
        frag.append(node);
      }
    }
    if (frag.childNodes.length) el.append(frag);

    // 列数或尺寸变了（窗口缩放、切页、侧栏变宽）时，已经存在的格子也必须重摆。
    // 少了这一步，旧坐标的格子会留在原地 —— 窄窗口下就只剩最左一列，看着像「竖排」。
    if (force) positionAll();
  }

  /** 把某一格摆到它的行列位置上（只在新建或布局变化时调用） */
  function placeCell(i, node) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = Math.round(col * (cellW + colGap));
    const y = Math.round(row * (cellH + rowGap));
    node.style.width = `${cellW}px`;
    node.style.height = `${cellH}px`;
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function positionAll() {
    for (const [i, node] of cells) placeCell(i, node);
  }

  function layout() {
    layoutRaf = 0;
    if (destroyed) return;
    if (!measure()) {
      layoutRaf = requestAnimationFrame(layout);
      return;
    }
    lastRange = [-1, -1];
    // 尺寸变了，已渲染单元格要按新尺寸重建（缩略图尺寸也可能变）
    renderRange(true);
  }

  function scheduleLayout() {
    if (layoutRaf) return;
    layoutRaf = requestAnimationFrame(layout);
  }

  const onScroll = () => {
    if (destroyed) return;
    renderRange(false);
  };

  scroller.addEventListener('scroll', onScroll, { passive: true });

  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scheduleLayout())
      : null;
  ro?.observe(el);
  // 容器本身（滚动舞台）变宽变窄也要重排：窗口缩放时 el 的宽度会跟着变，
  // 但某些情况下（切页瞬间、侧栏宽度变化）先量到的宽度不可靠，多挂一层更稳。
  ro?.observe(scroller);

  // 首帧：等容器量到宽度
  scheduleLayout();

  /* ---------------- 对外 ---------------- */

  return {
    el,

    /** 数据或形态变化后重画 */
    update(next = {}) {
      if ('items' in next) {
        items = next.items;
        generation += 1;
        pending = [];
        clearCells();
      }
      if ('viewMode' in next && next.viewMode !== viewMode) {
        viewMode = next.viewMode;
        // 网格单元和列表行是两种结构，换形态必须重建
        generation += 1;
        pending = [];
        clearCells();
      }
      if ('thumbSize' in next) thumbSize = next.thumbSize;
      if ('thumbW' in next) thumbW = next.thumbW;
      if ('listColumns' in next) listColumns = next.listColumns;
      if ('columns' in next) columns = next.columns;
      if ('gap' in next) gap = next.gap;
      if ('selection' in next) selection = next.selection;
      scheduleLayout();
    },

    /** 只更新选中态，不重建 DOM */
    setSelection(set, isMulti = multiMode) {
      selection = set;
      multiMode = isMulti;
      const multi = isMulti;
      for (const [i, node] of cells) {
        const img = items[i];
        if (!img) continue;
        const on = set.has(img.key);
        if (viewMode === 'list') {
          node.firstElementChild?.setAttribute('aria-selected', String(on));
        } else {
          node.firstElementChild?.setAttribute('aria-selected', String(on));
          node.firstElementChild?.setAttribute('data-multi', String(multi));
        }
      }
    },

    /** 键盘导航：把某一项滚进视野 */
    scrollToIndex(index) {
      const rowStride = cellH + rowGap;
      const row = Math.floor(index / cols);
      const top = offsetInScroller() + row * rowStride;
      const bottom = top + cellH;
      const viewTop = scroller.scrollTop;
      const viewBottom = viewTop + scroller.clientHeight;
      if (top < viewTop + 8) scroller.scrollTop = top - 8;
      else if (bottom > viewBottom - 8) scroller.scrollTop = bottom - scroller.clientHeight + 8;
    },

    destroy() {
      destroyed = true;
      generation += 1;
      pending = [];
      if (rafId) cancelAnimationFrame(rafId);
      if (layoutRaf) cancelAnimationFrame(layoutRaf);
      scroller.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      cells.clear();
      el.remove();
    },
  };
}
