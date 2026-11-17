// Golden Gate · navigation/toolbar-overflow
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { createDisposer } from '../_shared/disposer.js';
import { closeMenu, openMenu } from '../overlays/menu.js';

/* ==========================================================================
   53. 工具栏溢出

   工具栏变窄时把「次要动作」收进更多菜单，而不是让整排按钮挤成一团。
   四个容易踩的坑，这里都按原因处理：

   1) 先量后放。被收进菜单的项是 `hidden`（display:none），宽度读出来是 0。
      所以每轮排布先给容器挂 `data-measuring`，让所有项按自然宽度铺开
      （CSS 负责 visibility:hidden + 不换行 + 不收缩），读完宽度再决定谁留下。

   2) 可用宽度不能只信自己。`el.clientWidth` 在「被内容撑开」的容器里会
      跟着我们隐藏掉的项一起缩 —— 越藏越窄，最后只剩一个「更多」。所以优先
      读父级的 border-box 宽度（布局上游给的数，不由本组件的内容决定），
      自身只是兜底；父级比自身宽得多（flex 行里旁边还有别的组）时退回自身。
      再加一道自激保护：这次变窄的量若正好约等于上一轮隐藏掉的那几项，
      说明那是自己的回声而不是外部变窄，沿用上一次的可用宽度。

   3) 不振荡。每轮都从「全部可见」重新算一遍，同一宽度永远得到同一答案；
      再加滞回：迁入「更多」用 `available < needed`，迁回用
      `available > needed + 一个项宽`，临界宽度上不会来回跳。

   4) 隐藏项仍可键盘访问：菜单项保留 disabled / checked 状态，
      键盘契约（↑↓ Home End、Enter/Space、Esc）由 Menu 自己提供。
   ========================================================================== */

const EPS = 1;
const DEBOUNCE = 50;

export function ToolbarOverflow({
  items = [],
  moreLabel = '更多',
  gap = 4,
  label = '工具栏',
  className = '',
} = {}) {
  const disposer = createDisposer();

  let records = [];
  let menuOpen = false;
  let raf = 0;
  let timer = 0;
  let disposed = false;
  let lastAvail = -1;
  /** 上一轮「全部可见」时需要的宽度：识别自激变窄要用它做基准 */
  let lastNeeded = 0;
  let hiddenSig = '';
  /** 上一轮收进菜单的 id 集合：滞回与「自激」判定都靠它 */
  let prevHidden = new Set();
  /** 上一轮隐藏项实际省下的宽度（含间距、扣掉「更多」按钮本身） */
  let freedByHide = 0;
  let ro = null;
  let observedParent = null;

  const el = h('div', {
    class: `c-toolbaroverflow ${className}`.trim(),
    role: 'toolbar',
    'aria-label': label,
    'aria-orientation': 'horizontal',
    style: { gap: `${gap}px` },
  });

  const moreBtn = h('button', {
    class: 'c-iconbtn c-toolbaroverflow__more',
    type: 'button',
    title: moreLabel,
    'aria-label': moreLabel,
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    hidden: true,
    html: icon('more', 16),
    onclick: openMore,
  });

  /* ---------------- 小工具 ---------------- */

  // 菜单里的文字：优先用调用方给的 label，其次读控件自己的可读名
  const labelOf = (record) =>
    record.label ||
    record.node.getAttribute?.('aria-label') ||
    (record.node.textContent || '').trim() ||
    record.id ||
    '操作';

  const isDisabled = (record) =>
    record.disabled ||
    record.node.disabled === true ||
    record.node.getAttribute?.('aria-disabled') === 'true';

  /**
   * 菜单项要保住「勾选 / 可用」两个状态：
   * 数据里显式给了 checked 就用它，否则读控件自己的 aria-checked / aria-pressed。
   * 都没有时返回 undefined —— 不能传 false，那会把普通动作读成 menuitemcheckbox。
   */
  const checkedOf = (record) => {
    if (typeof record.checked === 'boolean') return record.checked;
    const raw =
      record.node.getAttribute?.('aria-checked') ?? record.node.getAttribute?.('aria-pressed');
    if (raw === 'true' || raw === 'false') return raw === 'true';
    return undefined;
  };

  // 真按钮走 click()；div 装的控件（分段、开关）派发冒泡的 click
  const clickNode = (node) => {
    if (node.tagName !== 'DIV' && typeof node.click === 'function') {
      node.click();
      return;
    }
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };

  /* ---------------- 度量 ---------------- */

  /** 父级内容盒宽度：父级的内边距不属于工具栏的可用空间 */
  function parentInnerWidth(parent) {
    const rect = parent.getBoundingClientRect();
    const cs = getComputedStyle(parent);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return Math.max(0, rect.width - padX);
  }

  /**
   * 可用宽度。父级优先，自身兜底 —— 但父级只有在「工具栏确实铺满它」时才算数，
   * 否则（flex 行里旁边还有别的组）父级会把别人的宽度也算进来。
   */
  function rawAvailable() {
    const own = el.getBoundingClientRect().width;
    const parent = el.parentElement;
    if (!parent) return own;
    const inner = parentInnerWidth(parent);
    if (inner > 0 && (own <= 0 || own >= inner - 1)) return inner;
    return own;
  }

  function measure() {
    const raw = rawAvailable();
    // 自激保护：max-content（含 max-width 封顶）的父级会随我们隐藏的项一起缩。
    // 缩完的宽度正好等于「上一轮全展开所需 - 本轮省下的」，那不是外部变窄，
    // 是我们自己的回声；沿用上一次的可用宽度，否则会越藏越窄直到只剩「更多」。
    if (
      lastAvail > 0 &&
      freedByHide > 0 &&
      raw < lastAvail - EPS &&
      Math.abs(raw - (lastNeeded - freedByHide)) <= 3
    ) {
      return lastAvail;
    }
    return raw;
  }

  function observeParent() {
    if (!ro) return;
    const parent = el.parentElement;
    if (parent === observedParent) return;
    if (observedParent) ro.unobserve(observedParent);
    observedParent = parent;
    if (parent) ro.observe(parent);
  }

  /* ---------------- 排布 ---------------- */

  function schedule() {
    if (disposed || raf) return;
    raf = requestAnimationFrame(layout);
  }

  /** 父级/自身的宽度变化统一走 50ms 去抖，避免拖窗口时每帧重排 */
  function scheduleDebounced() {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      schedule();
    }, DEBOUNCE);
  }

  const widthOf = (list) =>
    list.reduce((sum, index) => sum + records[index].width, 0) + gap * Math.max(0, list.length - 1);

  /** 回迁所需的额外余量：一个项宽（取隐藏项里最宽的那个） */
  function restoreSlack() {
    let max = 0;
    for (let i = 0; i < records.length; i += 1) {
      if (!prevHidden.has(records[i].id)) continue;
      max = Math.max(max, records[i].width);
    }
    return max || 0;
  }

  /**
   * 决定「谁留在工具栏上」。
   * 全部放得下但要放回隐藏项时，要求多出一个项宽的余量 —— 这就是滞回，
   * 否则临界宽度上「藏一项 / 放一项」会每帧来回跳。
   */
  function choose(avail, neededAll, moreWidth) {
    const all = records.map((_, index) => index);
    if (!records.length) return { keep: all, showMore: false };

    if (neededAll <= avail - EPS) {
      if (!prevHidden.size || avail > neededAll + restoreSlack()) {
        return { keep: all, showMore: false };
      }
      // 余量不够：维持上一轮的隐藏结果（前提是它仍然放得下）
      const keep = all.filter((index) => !prevHidden.has(records[index].id));
      const neededKeep = widthOf(keep) + (keep.length ? gap + moreWidth : 0);
      if (keep.length && neededKeep <= avail - EPS) return { keep, showMore: true };
      return { keep: all, showMore: false };
    }

    // 「更多」按钮永远占位：预算里先扣掉它，不留「收起后刚好又放下」的缝
    const budget = avail - moreWidth - gap;
    const keep = all.slice();
    // priority 小的先走；同优先级时后面的先走，保留靠前的核心动作
    const order = [...all].sort(
      (a, b) => records[a].priority - records[b].priority || b - a
    );
    for (const index of order) {
      if (widthOf(keep) <= budget - EPS) break;
      const at = keep.indexOf(index);
      if (at >= 0) keep.splice(at, 1);
    }
    return { keep, showMore: true };
  }

  function layout() {
    raf = 0;
    if (disposed || !el.isConnected) return;
    observeParent();

    // 注意在「正常态」读可用宽度：measuring 期间容器可能被内容撑大
    const avail = measure();
    if (avail <= 0) {
      lastAvail = -1;
      return;
    }
    lastAvail = avail;

    // —— 量：全部按自然宽度铺开，不可见但不参与换行/收缩 ——
    el.dataset.measuring = '1';
    moreBtn.hidden = false;
    moreBtn.style.visibility = 'hidden';
    for (const record of records) record.node.hidden = false;
    // 先全部显形再统一读，避免「读一次触发一次重排」
    for (const record of records) record.width = record.node.offsetWidth;
    const moreWidth = moreBtn.offsetWidth;

    const neededAll = widthOf(records.map((_, index) => index));
    lastNeeded = neededAll;
    const { keep, showMore } = choose(avail, neededAll, moreWidth);

    const keepSet = new Set(keep);
    const active = document.activeElement;
    let lostFocus = false;

    for (let index = 0; index < records.length; index += 1) {
      const hide = !keepSet.has(index);
      // 焦点所在的项马上要被藏起来：先记下来，稍后把焦点交给「更多」
      if (hide && records[index].node.contains(active)) lostFocus = true;
      records[index].node.hidden = hide;
    }

    moreBtn.style.visibility = '';
    moreBtn.hidden = !showMore;
    delete el.dataset.measuring;

    if (lostFocus && showMore) moreBtn.focus({ preventScroll: true });

    // 记录这一轮自己省下的宽度，供下一轮识别「自激变窄」
    const hiddenIndexes = records.map((_, index) => index).filter((index) => !keepSet.has(index));
    freedByHide = showMore
      ? hiddenIndexes.reduce((sum, index) => sum + records[index].width, 0) +
          gap * Math.max(0, hiddenIndexes.length - 1) -
          moreWidth
      : 0;

    prevHidden = new Set(hiddenIndexes.map((index) => records[index].id));

    // 菜单里的项是快照，隐藏集合一变就作废，否则会点到已经回到工具栏的项
    const sig = hiddenIndexes.map((index) => records[index].id).join('\u0000');
    if (sig !== hiddenSig) {
      hiddenSig = sig;
      if (menuOpen) closeMenu();
    }
  }

  /* ---------------- 更多菜单 ---------------- */

  function openMore() {
    if (disposed) return;
    if (menuOpen) {
      closeMenu();
      return;
    }
    const overflowed = records.filter((record) => record.node.hidden);
    if (!overflowed.length) return;

    const menu = openMenu({
      anchor: moreBtn,
      label: moreLabel,
      items: overflowed.map((record) => {
        const off = isDisabled(record);
        const checked = checkedOf(record);
        return {
          label: labelOf(record),
          disabled: off,
          // 只有真的有勾选语义时才写 checked：undefined 会让菜单保持普通 menuitem
          ...(checked === undefined ? null : { checked }),
          onClick: () => {
            if (!off) clickNode(record.node);
          },
        };
      }),
      onClose: () => {
        menuOpen = false;
        moreBtn.setAttribute('aria-expanded', 'false');
      },
    });

    // 同一枚锚点再点一次时 openMenu 直接收起并返回 null，不要把它当成「已打开」
    if (!menu) return;
    menuOpen = true;
    moreBtn.setAttribute('aria-expanded', 'true');
  }

  /* ---------------- 重建 ---------------- */

  function build(next) {
    if (menuOpen) closeMenu();
    for (const record of records) record.node.remove();

    records = (Array.isArray(next) ? next : [])
      .filter((item) => item && item.node instanceof Node)
      .map((item) => ({
        id: item.id ?? '',
        node: item.node,
        priority: Number(item.priority) || 0,
        label: item.label ?? '',
        disabled: !!item.disabled,
        checked: typeof item.checked === 'boolean' ? item.checked : undefined,
        width: 0,
      }));

    for (const record of records) {
      record.node.hidden = false;
      el.append(record.node);
    }
    el.append(moreBtn);
    moreBtn.hidden = true;

    lastAvail = -1;
    lastNeeded = 0;
    hiddenSig = '';
    prevHidden = new Set();
    freedByHide = 0;
    schedule();
  }

  /* ---------------- 监听 ---------------- */

  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (disposed) return;
      // 1px 阈值：亚像素抖动不触发重排
      if (Math.abs(measure() - lastAvail) < 1) return;
      scheduleDebounced();
    });
    ro.observe(el);
    disposer.observe(ro);
  }

  // 字体换掉后 label 宽度会变，但容器宽度没变，ResizeObserver 不会通知
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (!disposed) schedule();
    });
  }

  el.setItems = (next) => build(next);

  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (menuOpen) closeMenu();
    delete el.dataset.measuring;
    if (ro && observedParent) {
      ro.unobserve(observedParent);
      observedParent = null;
    }
    disposer.dispose();
  };

  build(items);
  return el;
}
