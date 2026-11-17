// Golden Gate · _shared/overlay
import { createDisposer } from './disposer.js';

/* ==========================================================================
   浮层与焦点管理（M1）

   所有「盖在别的东西上面」的层 —— 模态、菜单、Popover、下拉、日期面板、
   Sheet、命令面板 —— 都从这里过。层栈只做四件事：

   1) 层级：只有最上面一层响应 Esc 和外部点击。一次 Esc 只关一层。
   2) 焦点：模态层把背景真正隔离（inert），Tab 在层内循环；空层也不把焦点漏出去。
   3) 归还：关闭后焦点回到仍然存在的触发器；触发器没了就回到上一层。
   4) 定位：贴着锚点，越界翻转，锚点滚出视口就收起。

   inert 的保存/恢复按 LIFO 快照：进入时记下每个背景节点原本的 inert 与
   aria-hidden，退出时逐项还原。这样不会顺手清掉应用自己禁用的区域。
   ========================================================================== */

const layers = [];
const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 当前层数（0 = 没有浮层） */
export const layerDepth = () => layers.length;

/** 栈顶图层 */
export const topLayer = () => layers[layers.length - 1] ?? null;

/** 这个元素是不是当前最上层 */
export const isTopLayer = (el) => topLayer()?.el === el || topLayer()?.container === el;

/** 层内可聚焦元素，按 DOM 顺序；排除禁用、inert、不可见 */
export function focusableWithin(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.closest('[inert]')) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    return el.getClientRects().length > 0;
  });
}

/* ---------------- 背景隔离 ---------------- */

const IGNORE_SELECTOR =
  '[data-layer-ignore],[aria-live="polite"],[aria-live="assertive"],[role="status"],[role="alert"]';

function isolateBackground(container) {
  const saved = [];
  for (const child of [...document.body.children]) {
    if (child === container) continue;
    if (child.matches?.(IGNORE_SELECTOR)) continue;
    saved.push({
      node: child,
      inert: child.hasAttribute('inert'),
      hidden: child.getAttribute('aria-hidden'),
    });
    child.setAttribute('inert', '');
    child.setAttribute('aria-hidden', 'true');
  }
  return saved;
}

function restoreBackground(saved) {
  for (const item of saved) {
    if (!item.node.isConnected) continue;
    if (!item.inert) item.node.removeAttribute('inert');
    if (item.hidden == null) item.node.removeAttribute('aria-hidden');
    else item.node.setAttribute('aria-hidden', item.hidden);
  }
}

/* ---------------- 全局监听 ---------------- */

let listening = false;

function ensureListeners() {
  if (listening) return;
  listening = true;
  // keydown 用冒泡：层内控件若已经消化了 Esc（例如候选列表收起但保留输入），
  // 会 stopPropagation，这里就收不到，也就不会把整个层关掉。
  document.addEventListener('keydown', onDocumentKey);
  // 外部点击必须在其它 pointerdown 之前判定，否则触发器会先 toggle，变成「关了又开」
  document.addEventListener('pointerdown', onDocumentPointer, true);
}

function onDocumentKey(e) {
  const layer = topLayer();
  if (!layer) return;

  if (e.key === 'Escape') {
    if (!layer.dismissible || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    layer.close('escape');
    return;
  }

  if (e.key === 'Tab' && layer.trap) trapTab(e, layer);
}

function onDocumentPointer(e) {
  const layer = topLayer();
  if (!layer || !layer.outside) return;
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (layer.container?.contains(target)) return;
  if (layer.ignore?.some((node) => node?.contains?.(target))) return;
  if (target.closest('[data-layer-ignore]')) return;
  layer.close('outside');
}

function trapTab(e, layer) {
  const root = layer.el;
  const active = document.activeElement;
  const list = focusableWithin(root);

  if (!list.length) {
    // 空层 / 只有文字：焦点钉在层本身，不往背景漏
    e.preventDefault();
    if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
    root.focus?.();
    return;
  }

  if (!root.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? list[list.length - 1] : list[0]).focus();
    return;
  }

  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------------- 层的开合 ---------------- */

/**
 * 打开一层。
 * @param {object} o
 * @param {HTMLElement} o.el 焦点边界（通常是面板本身）
 * @param {HTMLElement} [o.container] 整体容器（Dialog 的遮罩层）；默认同 el
 * @param {boolean} [o.modal] 是否隔离背景
 * @param {boolean} [o.trap] 是否 Tab 循环；默认同 modal
 * @param {boolean} [o.dismissible] 是否响应 Esc
 * @param {boolean} [o.outside] 点击容器外是否关闭（非模态浮层）
 * @param {HTMLElement[]} [o.ignore] 外部点击时不算「外面」的元素（触发器）
 * @param {'self'|'first'|'none'|HTMLElement|Function} [o.initialFocus]
 * @param {boolean} [o.returnFocus]
 * @param {boolean} [o.isolateParent] 子层是否把父容器设为 inert；默认 true。
 *        输入框 + 候选列表这类「同一交互单元」的层传 false，否则输入框会失焦。
 * @param {(reason:string)=>void} [o.onClose]
 */
export function openLayer({
  el,
  container = el,
  modal = false,
  trap = modal,
  dismissible = true,
  outside = false,
  ignore = [],
  initialFocus = 'self',
  returnFocus = true,
  isolateParent = true,
  onClose,
} = {}) {
  ensureListeners();
  if (!el) throw new Error('openLayer 需要 el');

  const previousFocus = document.activeElement;
  const parent = topLayer();

  const layer = {
    el,
    container,
    modal,
    trap,
    dismissible,
    outside,
    ignore,
    level: layers.length + 1,
    parent,
    returnFocus,
    onClose,
    _returnTo: previousFocus,
    isTop: () => topLayer() === layer,
    close: (reason = 'api') => closeLayer(layer, reason),
    /** 已打开后再改策略（例如提交中禁止关闭） */
    setDismissible(value) {
      layer.dismissible = !!value;
    },
    setOutside(value) {
      layer.outside = !!value;
    },
  };

  layers.push(layer);

  // 模态层：先把焦点从背景挪走，再隔离。反过来的话浏览器会因为
  // 「被 aria-hidden 的元素里还有焦点」在控制台报警，焦点也会掉到 body。
  if (modal && previousFocus instanceof HTMLElement && !container.contains(previousFocus)) {
    previousFocus.blur?.();
  }
  focusInitial(el, initialFocus);
  if (modal) layer._saved = isolateBackground(container);

  if (parent?.container) {
    // 非模态子层默认会把父容器设为 inert，这样焦点不会漏回父面板。
    // 但「输入框 + 候选列表」这种组合是同一个交互单元：列表只是给输入框
    // 画高亮，焦点必须留在输入框里。把父容器关掉会让输入框立刻失焦。
    // 这类层传 isolateParent: false，父层保持可交互。
    if (isolateParent) {
      layer._parentInert = {
        node: parent.container,
        had: parent.container.hasAttribute('inert'),
      };
      parent.container.setAttribute('inert', '');
    }
    // 模态子层还要把父面板本身标成 inert + aria-hidden：
    // 只隔离 bg 的话，读屏仍能从辅助技术树里走到父面板；
    // 非模态子层（菜单 / Popover）不能这么做 —— 那会把打开菜单的对话框一起藏掉。
    if (modal && parent.el) {
      layer._parentHidden = {
        node: parent.el,
        inert: parent.el.hasAttribute('inert'),
        hidden: parent.el.getAttribute('aria-hidden'),
      };
      parent.el.setAttribute('inert', '');
      parent.el.setAttribute('aria-hidden', 'true');
    }
    // 父子关系：关父层时先收掉压在它上面的子层，避免留下孤儿浮层
    (parent.children ??= []).push(layer);
  }

  return layer;
}

function focusInitial(el, target) {
  if (target === 'none' || target === null) return;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;

  const run = () => {
    let node = null;
    if (typeof target === 'function') node = target();
    else if (target instanceof HTMLElement) node = target;
    else if (target === 'first') node = focusableWithin(el)[0] ?? el;
    else node = el;
    node?.focus?.({ preventScroll: true });
  };
  // 等一帧让入场动画/布局落位，避免焦点环落在还没定位好的元素上
  requestAnimationFrame(run);
}

/** 关闭一层。可重复调用。 */
export function closeLayer(layer, reason = 'api') {
  if (!layer || layer._closed || layer._closing) return;
  layer._closing = true;

  // 先收子层：父层没了，压在它上面的浮层不该继续存在
  for (const child of [...(layer.children ?? [])].reverse()) closeLayer(child, 'parent');
  layer.children = [];
  if (layer.parent) {
    const siblings = layer.parent.children;
    const at = siblings ? siblings.indexOf(layer) : -1;
    if (at >= 0) siblings.splice(at, 1);
  }

  layer._closed = true;
  const index = layers.indexOf(layer);
  if (index >= 0) layers.splice(index, 1);

  if (layer._parentInert) {
    if (!layer._parentInert.had) layer._parentInert.node.removeAttribute('inert');
    layer._parentInert = null;
  }
  if (layer._parentHidden) {
    const { node, inert, hidden } = layer._parentHidden;
    if (!inert) node.removeAttribute('inert');
    if (hidden == null) node.removeAttribute('aria-hidden');
    else node.setAttribute('aria-hidden', hidden);
    layer._parentHidden = null;
  }
  if (layer._saved) {
    restoreBackground(layer._saved);
    layer._saved = null;
  }

  if (layer.returnFocus) {
    const previous = layer._returnTo;
    const target =
      previous instanceof HTMLElement && previous.isConnected
        ? previous
        : layer.parent?.el?.isConnected
          ? layer.parent.el
          : null;
    if (target) requestAnimationFrame(() => target.focus?.({ preventScroll: true }));
  }

  layer.onClose?.(reason);
}

/** 关闭所有层（页面切换、测试 teardown 用） */
export function closeAllLayers() {
  for (const layer of [...layers].reverse()) closeLayer(layer, 'reset');
}

/* ---------------- 定位 ---------------- */

/**
 * 把浮层贴到锚点上。越界翻转、两侧夹紧、锚点消失即收起。
 * @param {HTMLElement} el
 * @param {object} o
 * @param {HTMLElement} [o.anchor]
 * @param {number} [o.x]
 * @param {number} [o.y]
 * @param {'bottom'|'top'} [o.placement]
 * @param {'start'|'center'|'end'} [o.align]
 * @param {number} [o.gap]
 * @param {number} [o.pad]
 * @param {boolean} [o.matchWidth] 让浮层宽度跟触发器一致（下拉选择用）
 * @param {()=>void} [o.onHidden] 锚点离开视口 / 被移除
 * @returns {{update:()=>void, stop:()=>void}}
 */
export function positionLayer(
  el,
  {
    anchor = null,
    x = 8,
    y = 8,
    placement = 'bottom',
    align = 'center',
    gap = 6,
    pad = 8,
    matchWidth = false,
    onHidden,
  } = {}
) {
  const disposer = createDisposer();
  let lastTop = null;
  let lastLeft = null;
  let stopped = false;
  let hiddenPending = false;

  // onHidden 必须延后一帧：定位是打开流程里的同步一步，此时调用方可能还在
  // 给面板挂监听。同步回调会把层关掉，调用方接着就往已销毁的节点上写 ——
  // 「Cannot read properties of null」大多来自这里。
  const hide = () => {
    if (hiddenPending) return;
    hiddenPending = true;
    requestAnimationFrame(() => onHidden?.());
  };

  const update = () => {
    if (stopped || !el.isConnected) return;
    const r = anchor?.getBoundingClientRect?.() ?? null;

    if (anchor && (!anchor.isConnected || !r)) {
      hide();
      return;
    }
    if (
      r &&
      (r.bottom < -pad ||
        r.top > window.innerHeight + pad ||
        r.right < -pad ||
        r.left > window.innerWidth + pad)
    ) {
      hide();
      return;
    }

    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left;
    let top;

    if (r) {
      if (placement === 'right' || placement === 'left') {
        left = placement === 'right' ? r.right + gap : r.left - w - gap;
        top =
          align === 'start' ? r.top : align === 'end' ? r.bottom - h : r.top + r.height / 2 - h / 2;
        // 左右翻转
        if (placement === 'right' && left + w > window.innerWidth - pad && r.left - w - gap >= pad) {
          left = r.left - w - gap;
        } else if (placement === 'left' && left < pad && r.right + w + gap <= window.innerWidth - pad) {
          left = r.right + gap;
        }
        if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
        if (top < pad) top = pad;
        el.style.setProperty('--origin', placement === 'right' ? 'top left' : 'top right');
      } else {
        left =
          align === 'start' ? r.left : align === 'end' ? r.right - w : r.left + r.width / 2 - w / 2;
        top = placement === 'bottom' ? r.bottom + gap : r.top - h - gap;

        // 翻转：下面放不下且上面放得下
        if (placement === 'bottom' && top + h > window.innerHeight - pad && r.top - h - gap >= pad) {
          top = r.top - h - gap;
        } else if (placement === 'top' && top < pad && r.bottom + h + gap <= window.innerHeight - pad) {
          top = r.bottom + gap;
        }
        if (matchWidth) el.style.width = `${Math.round(r.width)}px`;
        el.style.setProperty('--origin', placement === 'bottom' ? 'top center' : 'bottom center');
      }
    } else {
      left = x;
      top = y;
      el.style.setProperty('--origin', 'top left');
    }

    left = Math.min(Math.max(pad, left), Math.max(pad, window.innerWidth - w - pad));
    top = Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - h - pad));

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    lastTop = top;
    lastLeft = left;
  };

  disposer.add(() => {
    stopped = true;
  });

  // 逐帧比对锚点：布局抖动、内层滚动容器、某些环境不派发 scroll 都能兜住
  let raf = 0;
  const track = () => {
    if (stopped) return;
    const r = anchor?.getBoundingClientRect?.();
    if (!r || lastTop == null || Math.abs(r.top - lastTop) > 0.5 || Math.abs(r.left - lastLeft) > 0.5) {
      update();
    }
    if (anchor) raf = requestAnimationFrame(track);
  };
  if (anchor) raf = requestAnimationFrame(track);
  disposer.add(() => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  });

  disposer.on(window, 'resize', update);
  disposer.on(window, 'scroll', update, true);

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    disposer.observe(ro);
  }

  update();

  return { update, stop: disposer.dispose };
}

/* ---------------- 独立焦点域 ---------------- */

/**
 * 给自定义层（不属于任何内置控件）一个焦点域。
 * 返回 `{ el, release, focus, focusables }`；release 可重复调用。
 */
export function focusScope(
  root,
  { modal = false, initialFocus = 'self', returnFocus = true, onClose } = {}
) {
  if (!root) throw new Error('focusScope 需要 root');
  const layer = openLayer({
    el: root,
    container: root,
    modal,
    trap: true,
    dismissible: false,
    outside: false,
    initialFocus,
    returnFocus,
    onClose,
  });
  return {
    el: root,
    focus: () => focusInitial(root, initialFocus),
    focusables: () => focusableWithin(root),
    release: () => closeLayer(layer, 'release'),
  };
}
