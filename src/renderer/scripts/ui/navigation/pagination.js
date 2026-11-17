// Golden Gate · navigation/pagination
import { h, clamp } from '../../core/dom.js';
import { iconEl } from '../../core/icons.js';
import { Select } from '../forms/select.js';
import { createDisposer } from '../_shared/disposer.js';
import { applyControlState } from '../_shared/control.js';

/* ==========================================================================
   59. 分页

   为什么需要它：DataTable 只吃全量数据。应用一旦改成服务端分页，缺的不是一根
   「上一页 / 下一页」的装饰条，而是三件协议层面的事：
     1) 查询条件要能序列化进 URL（page + size，或 cursor + size）；
     2) 总数可能未知（游标协议），这时不能画总页数，也不知道末页在哪；
     3) 翻页有竞态 —— 请求在飞时又点了一下，旧响应回来不能盖住新页。
   所以控件只负责「状态 + 乐观更新」，请求归应用：每次用户动作只发一次 onQuery，
   setBusy(true) 期间按钮收手，失败时应用 set({ page: 旧页 }) 回滚。

   原型：macOS 没有系统级分页条（系统 App 走增量加载 /「载入更多」）。
   这是 07-coverage.md 里登记的补位控件，所以不自创视觉：
   翻页按钮沿用 .c-iconbtn 的语言（透明面、悬停灰、按下缩），
   当前页沿用 Segmented 的实心强调色块（同一语义：这就是你现在选中的那一个），
   高度 / 字号 / 圆角全部读 --ctl-* 与 --fs-12。

   三条边界：
   - total === null → 只画「第 N 页」，next 由 hasNext 决定；
   - mode === 'cursor' → 只看 hasPrev / hasNext，不计算总页数，cursor 原样带回；
   - 当前页仍是可聚焦的按钮（不是禁用灰），翻页后焦点要落回「你所在页」。
   ========================================================================== */

const GAP = 'gap';

/** 页码窗口：首页、末页、当前页 ±1；≤7 页时全部显示，其余折叠成省略号。 */
function pageModel(current, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const wanted = new Set([1, totalPages, current, current - 1, current + 1]);
  const nums = [...wanted].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);

  const out = [];
  let prev = 0;
  for (const n of nums) {
    const missing = n - prev - 1;
    if (prev && missing === 1) out.push(prev + 1); // 只空一页时直接补数字，不画省略号
    else if (prev && missing > 1) out.push(GAP);
    out.push(n);
    prev = n;
  }
  return out;
}

/**
 * 分页条。页码协议与游标协议共用一根轨道。
 * @param {object} [o]
 * @param {number} [o.page] 当前页，从 1 开始
 * @param {number} [o.pageSize] 每页条数
 * @param {number|null} [o.total] 总条数；null 表示未知
 * @param {number[]} [o.pageSizes] 可选的每页条数；长度 > 1 时才渲染下拉
 * @param {'page'|'cursor'} [o.mode]
 * @param {boolean} [o.hasPrev] 游标模式：还有上一页
 * @param {boolean} [o.hasNext] 游标模式 / 未知总数时：还有下一页
 * @param {string|null} [o.cursor] 游标模式：当前位置标记
 * @param {string} [o.label] 无障碍名称
 * @param {boolean} [o.compact] 窄容器形态：只留 ‹ N/M › 与每页条数
 * @param {boolean} [o.disabled]
 * @param {(v:{page:number,pageSize:number,mode:string,cursor:string|null}) => void} [o.onChange]
 * @param {(q:{page?:number,cursor?:string|null,size:number}) => void} [o.onQuery]
 * @param {string} [o.className]
 */
export function Pagination({
  page = 1,
  pageSize = 20,
  total = null,
  pageSizes = [20, 50, 100],
  mode = 'page',
  hasPrev = true,
  hasNext = true,
  cursor = null,
  label = '分页',
  compact = false,
  disabled = false,
  onChange,
  onQuery,
  className = '',
} = {}) {
  const isCursor = mode === 'cursor';
  const disposer = createDisposer();
  let disposed = false;

  // —— 状态 ——
  let sizes = (Array.isArray(pageSizes) ? pageSizes : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  const firstSize = Number(pageSize) > 0 ? Number(pageSize) : 20;
  if (!sizes.length) sizes = [firstSize];
  // 传进来的 pageSize 不在候选里也要能显示，否则下拉会是一片空白
  if (!sizes.includes(firstSize)) sizes.unshift(firstSize);

  const state = {
    page: Math.max(1, Math.trunc(Number(page) || 1)),
    pageSize: firstSize,
    total: total == null ? null : Math.max(0, Number(total) || 0),
    mode: isCursor ? 'cursor' : 'page',
    hasPrev: !!hasPrev,
    hasNext: !!hasNext,
    cursor: cursor ?? null,
    disabled: !!disabled,
    busy: false,
  };

  const totalPages = () =>
    state.total == null ? null : Math.max(1, Math.ceil(state.total / state.pageSize));

  const clampPage = (n) => {
    const tp = totalPages();
    const v = Math.max(1, Math.trunc(Number(n) || 1));
    return tp == null ? v : Math.min(v, tp);
  };

  state.page = clampPage(state.page);

  /** size 只接受候选值；不在候选里就取最接近的一档，避免下拉空白 */
  const nearestSize = (n) =>
    sizes.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), sizes[0]);

  // —— DOM ——
  const pagesEl = h('div', { class: 'c-pagination__pages' });

  const navButton = (dir, text) => {
    const ic = iconEl(dir < 0 ? 'chevron-left' : 'chevron-right', 14);
    // 游标模式没有页码可数，按钮必须带字：‹ 上一页 / 下一页 ›（箭头在外侧）
    const txt = isCursor ? h('span', { class: 'c-pagination__nav-label' }, text) : null;
    return h(
      'button',
      {
        class: 'c-pagination__btn c-pagination__nav',
        type: 'button',
        'aria-label': text,
        title: text,
        onclick: () => step(dir),
      },
      dir < 0 ? [ic, txt] : [txt, ic]
    );
  };

  const prevBtn = navButton(-1, '上一页');
  const nextBtn = navButton(1, '下一页');

  const pager = h(
    'div',
    { class: 'c-pagination__pager', role: 'group', 'aria-label': '页码' },
    prevBtn,
    pagesEl,
    nextBtn
  );

  // 总数是唯一会「自己说话」的文本：翻页后读屏要知道现在到哪了
  const summary = h('span', {
    class: 'c-pagination__summary',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });

  const sizeSel =
    sizes.length > 1
      ? Select({
          options: sizes.map((n) => ({ value: n, label: String(n) })),
          value: state.pageSize,
          width: '58px',
          label: '每页条数',
          className: 'c-pagination__size-btn',
          onChange: (v) => {
            if (!applySize(v, true)) return;
            render();
            emit();
          },
        })
      : null;

  const sizeWrap = sizeSel
    ? h(
        'div',
        { class: 'c-pagination__size' },
        h('span', { class: 'c-pagination__size-text' }, '每页'),
        sizeSel,
        h('span', { class: 'c-pagination__size-text' }, '条')
      )
    : null;

  const meta = h('div', { class: 'c-pagination__meta' }, summary, sizeWrap);

  const el = h(
    'nav',
    {
      class: ['c-pagination', isCursor && 'c-pagination--cursor', compact && 'c-pagination--compact', className]
        .filter(Boolean)
        .join(' '),
      role: 'navigation',
      'aria-label': label || '分页',
      dataset: { mode: state.mode },
    },
    pager,
    meta
  );

  // —— 渲染 ——
  const setAd = (btn, on) => {
    if (on) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  };

  /** 下一次渲染后要把焦点放到哪一页（页码按钮会被重建，焦点不能就这么掉到 body） */
  let focusPage = null;

  const render = () => {
    const tp = totalPages();
    // 防御：总数变小（筛选条件变严）时页码可能悬在末页之外
    if (tp != null && state.page > tp) state.page = tp;
    pagesEl.replaceChildren();

    if (compact) {
      // 窄容器：中间段整体折叠成「第 3 / 20 页」，不画任何页码按钮
      pagesEl.append(
        h(
          'span',
          { class: 'c-pagination__status c-pagination__status--compact' },
          tp == null ? `第 ${state.page} 页` : `${state.page} / ${tp}`
        )
      );
    } else if (tp == null) {
      pagesEl.append(h('span', { class: 'c-pagination__status' }, `第 ${state.page} 页`));
    } else {
      for (const item of pageModel(state.page, tp)) {
        if (item === GAP) {
          pagesEl.append(
            h('span', { class: 'c-pagination__gap', 'aria-hidden': 'true' }, '…')
          );
          continue;
        }
        const current = item === state.page;
        pagesEl.append(
          h(
            'button',
            {
              class: 'c-pagination__btn c-pagination__page',
              type: 'button',
              dataset: { page: String(item) },
              'aria-current': current ? 'page' : null,
              // 当前页也能聚焦：它是「你所在页」，翻页后焦点落到这儿才说得通
              'aria-label': current ? `第 ${item} 页，当前页` : `第 ${item} 页`,
              onclick: () => goTo(item),
            },
            String(item)
          )
        );
      }
    }

    // 两端：页码模式按已知总页数算，未知总数与游标模式听 hasPrev / hasNext
    const atFirst = isCursor ? !state.hasPrev : state.page <= 1;
    const atLast = isCursor
      ? !state.hasNext
      : tp == null
        ? !state.hasNext
        : state.page >= tp;

    // 用 aria-disabled 而不是 disabled：原生 disabled 会把焦点踢回 body，
    // 翻到第一页时「上一页」刚好被禁用，焦点就丢了。
    setAd(prevBtn, atFirst || state.disabled || state.busy);
    setAd(nextBtn, atLast || state.disabled || state.busy);

    for (const btn of pagesEl.querySelectorAll('.c-pagination__page')) {
      const current = btn.getAttribute('aria-current') === 'page';
      // 当前页不参与 busy 变灰：它表示位置，不表示可点
      setAd(btn, state.disabled || (state.busy && !current));
    }

    // 说明文字：已知总数时写全；未知总数 / 游标模式的「第 N 页」已经在轨道里，
    // 这里退回 sr-only，避免同一句话在屏幕上出现两遍（aria-live 依然生效）。
    summary.textContent =
      tp == null
        ? `第 ${state.page} 页`
        : `第 ${state.page} 页，共 ${tp} 页，${state.total} 项`;
    summary.classList.toggle('sr-only', compact || tp == null);

    sizeSel?.setDisabled(state.disabled || state.busy);

    if (focusPage != null) {
      const target = compact
        ? // 紧凑形态没有页码按钮，焦点留在原来的翻页按钮上
          null
        : pagesEl.querySelector(`[data-page="${focusPage}"]`) ??
          pagesEl.querySelector('[aria-current="page"]');
      target?.focus({ preventScroll: true });
      focusPage = null;
    }
  };

  // —— 动作 ——
  /** 用户动作后统一出口：先乐观改 UI，再通知应用（onChange + onQuery 各一次） */
  const emit = () => {
    onChange?.(el.value());
    onQuery?.(el.query());
  };

  const applySize = (v, resetPage) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return false;
    const next = sizes.includes(n) ? n : nearestSize(n);
    if (next === state.pageSize) return false;
    state.pageSize = next;
    if (resetPage) state.page = 1; // 换每页条数等于换了一套分页，页码必须回到第一页
    sizeSel?.set(next);
    return true;
  };

  const step = (dir) => {
    if (state.disabled || state.busy) return; // 请求在飞：重复点击直接吞掉
    const tp = totalPages();
    if (dir < 0) {
      if (isCursor ? !state.hasPrev : state.page <= 1) return;
      state.page -= 1;
    } else {
      const blocked = isCursor ? !state.hasNext : tp == null ? !state.hasNext : state.page >= tp;
      if (blocked) return;
      state.page += 1;
    }
    // prev / next 是常驻节点，不会被重建，焦点自然还留在被点的那一颗上
    render();
    emit();
  };

  const goTo = (n) => {
    if (state.disabled || state.busy) return;
    const tp = totalPages();
    const target = tp == null ? Math.max(1, Math.trunc(Number(n) || 1)) : clamp(n, 1, tp);
    if (target === state.page) return;
    state.page = target;
    focusPage = target;
    render();
    emit();
  };

  // Home / End：只在焦点位于分页条内部时接管，不抢页面的全局快捷键
  disposer.on(el, 'keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'Home' && e.key !== 'End') return;
    if (!el.contains(document.activeElement)) return;
    const tp = totalPages();
    if (tp == null) return; // 总数未知 / 游标模式：没有「末页」这个坐标
    e.preventDefault();
    goTo(e.key === 'Home' ? 1 : tp);
  });

  // —— 公共 API ——
  el.value = () => ({
    page: state.page,
    pageSize: state.pageSize,
    mode: state.mode,
    cursor: state.cursor,
  });

  /** 静默赋值：不触发 onChange / onQuery（回滚、外部同步都走这里） */
  el.set = (patch = {}) => {
    if (patch.pageSize !== undefined) applySize(patch.pageSize, false);
    if (patch.total !== undefined) {
      state.total = patch.total == null ? null : Math.max(0, Number(patch.total) || 0);
    }
    if (patch.hasPrev !== undefined) state.hasPrev = !!patch.hasPrev;
    if (patch.hasNext !== undefined) state.hasNext = !!patch.hasNext;
    if (patch.cursor !== undefined) state.cursor = patch.cursor;
    if (patch.page !== undefined) state.page = Math.max(1, Math.trunc(Number(patch.page) || 1));
    // total / pageSize 都可能刚落过，最后统一夹一次
    state.page = clampPage(state.page);
    render();
  };

  el.setTotal = (n) => {
    state.total = n == null ? null : Math.max(0, Number(n) || 0);
    state.page = clampPage(state.page);
    render();
  };

  /** 请求中：按钮收手 + aria-busy，但当前页照样显示（不要闪成骨架） */
  el.setBusy = (v) => {
    state.busy = !!v;
    applyControlState(el, { busy: state.busy });
    if (state.busy) el.dataset.busy = '1';
    else delete el.dataset.busy;
    render();
  };

  el.setDisabled = (v) => {
    state.disabled = !!v;
    applyControlState(el, { disabled: state.disabled });
    render();
  };

  el.query = () =>
    state.mode === 'cursor'
      ? { cursor: state.cursor, size: state.pageSize }
      : { page: state.page, size: state.pageSize };

  /** 从 URL 查询串恢复。静默（应用拿到值自己去请求），非法/越界值夹到合法范围。 */
  el.setQuery = (input) => {
    let params = null;
    if (input instanceof URLSearchParams) params = input;
    else if (typeof input === 'string') {
      try {
        params = new URLSearchParams(input.replace(/^\?/, ''));
      } catch {
        return;
      }
    }
    if (!params) return;

    // size 先落：page 的合法上界要用新的 pageSize 才算得对
    const rawSize = params.get('size');
    if (rawSize) applySize(rawSize, false);

    if (state.mode === 'cursor') {
      const c = params.get('cursor');
      if (c != null) state.cursor = c;
    } else {
      const rawPage = params.get('page');
      const n = Number(rawPage);
      if (rawPage && Number.isFinite(n)) state.page = clampPage(Math.trunc(n));
    }
    render();
  };

  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    sizeSel?.dispose?.();
    disposer.dispose();
  };

  // 构造时就把禁用态落一次，别等调用方手动 setDisabled —— 首帧不该是可点的
  if (state.disabled) applyControlState(el, { disabled: true });

  render();
  return el;
}
