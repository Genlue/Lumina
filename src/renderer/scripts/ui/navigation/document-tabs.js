// Golden Gate · navigation/document-tabs
import { h } from '../../core/dom.js';
import { icon, iconEl } from '../../core/icons.js';
import { createDisposer } from '../_shared/disposer.js';
import { applyControlState } from '../_shared/control.js';

/* ==========================================================================
   文档页签 DocumentTabs

   为什么需要它：`Tabs` 是「同一个窗口换一种看法」的分段页签 —— 没有未保存状态、
   没有固定页签、没有关闭确认，也没有会话恢复。文档型应用（编辑器 / 终端 /
   设置窗口）要的是「文档会话」：每颗页签有 dirty / pinned / closable，
   关闭要走 closeRequest（可能异步、可能被拒绝），整条会话能序列化后恢复。

   原型：macOS 的文档页签（Safari / 终端 / Xcode 那一排）。选中仍然是
   Tabs 的「抬起 / 落下」：抬起来的那一颗是实心亮面 + 一条发丝边，不是下划线。

   边界：组件只管「一排页签 + 会话状态」。文档内容、多窗口、⌘W 的绑定、
   未保存确认面板长什么样，都在应用侧 —— 这里只给一个可等待的 closeRequest。

   API（返回 `.c-documenttabs`）：
     el.setDocuments(list) / el.setActive(id) / el.markDirty(id, bool)
     el.close(id) / el.closeActive() → Promise<boolean>
     el.value() / el.serialize() / el.restore(state) / el.dispose()
     el.setDisabled(bool)（aria-disabled，禁止选中与关闭）

   键盘：←/→ 移动焦点（roving tabindex，不自动激活）、Home/End 首尾、
   Enter/Space 激活焦点页签、Delete/Backspace 关闭焦点页签。
   ⌘W 刻意不绑：应用可能要先处理「窗口 vs 页签」的语义。
   ========================================================================== */

const DRAG_THRESHOLD = 4; // px：小于它当点击，不启动重排
const EMPTY_TEXT = '没有打开的文档';
let uid = 0;

/**
 * @param {object} [o]
 * @param {Array<{id:string,title?:string,icon?:string,dirty?:boolean,pinned?:boolean,closable?:boolean,tooltip?:string,panel?:HTMLElement|string}>} [o.documents]
 * @param {string|null} [o.activeId]
 * @param {(id:string) => void} [o.onSelect]
 * @param {(id:string) => void} [o.onClose]          真正移除后
 * @param {(doc:object) => boolean|Promise<boolean>} [o.onCloseRequest] 返回 false 拒绝关闭
 * @param {() => void} [o.onNew]
 * @param {(documents:Array) => void} [o.onReorder]
 * @param {string} [o.persistKey]  localStorage 键：只存会话结构，不存文档内容
 * @param {string} [o.label]       tablist 的可访问名
 * @param {string} [o.className]
 */
export function DocumentTabs({
  documents = [],
  activeId,
  onSelect,
  onClose,
  onCloseRequest,
  onNew,
  onReorder,
  persistKey,
  label = '文档',
  className = '',
} = {}) {
  const disposer = createDisposer();

  const scroll = h('div', { class: 'c-documenttabs__scroll' });
  const dropLine = h('div', { class: 'c-documenttabs__drop', 'aria-hidden': 'true' });
  const newBtn =
    typeof onNew === 'function'
      ? h('button', {
          class: 'c-documenttabs__new',
          type: 'button',
          'aria-label': '新建文档',
          title: '新建文档',
          html: icon('plus', 12),
          onclick: () => {
            if (el.getAttribute('aria-disabled') === 'true') return;
            onNew();
          },
        })
      : null;

  const el = h(
    'div',
    {
      class: `c-documenttabs ${className}`.trim(),
      role: 'tablist',
      'aria-label': label || '文档',
    },
    scroll,
    newBtn,
    dropLine
  );

  /* ---------------- 会话状态 ---------------- */

  let docs = [];
  let current = null;
  let skipClick = false; // 拖动结束后吞掉那一次 click
  let drag = null;
  const closing = new Set(); // 正在等 closeRequest 的 id，防止重复关闭

  const normalize = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id == null ? '' : String(raw.id);
    if (!id) return null;
    return {
      ...raw,
      id,
      title: raw.title == null || raw.title === '' ? id : String(raw.title),
      icon: raw.icon || null,
      dirty: !!raw.dirty,
      pinned: !!raw.pinned,
      closable: raw.closable !== false,
    };
  };

  /** 顺手去重：同 id 的第二颗页签没有意义，还会让 activeId 指向两颗 */
  const normalizeList = (list) => {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
      const doc = normalize(item);
      if (!doc || seen.has(doc.id)) continue;
      seen.add(doc.id);
      out.push(doc);
    }
    // 固定页签永远排在前面：这是重排的边界，不是可选偏好
    out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return out;
  };

  /** 会话只存结构。坏数据静默丢弃，绝不能因为一条脏记录让整个页面起不来。 */
  const readSaved = () => {
    if (!persistKey) return null;
    try {
      const raw = localStorage.getItem(persistKey);
      if (!raw) return null;
      const state = JSON.parse(raw);
      const valid =
        state &&
        typeof state === 'object' &&
        Array.isArray(state.documents) &&
        state.documents.every(
          (d) => d && typeof d === 'object' && typeof d.id === 'string' && typeof d.title === 'string'
        );
      if (!valid) return null;
      return {
        activeId: state.activeId == null ? null : String(state.activeId),
        documents: state.documents,
      };
    } catch {
      return null;
    }
  };

  const persist = () => {
    if (!persistKey) return;
    try {
      localStorage.setItem(persistKey, JSON.stringify(el.serialize()));
    } catch {
      // 隐私模式 / 配额满：会话恢复是增强，不是功能前提
    }
  };

  const saved = readSaved();
  docs = normalizeList(saved ? saved.documents : documents);
  const wanted = saved ? saved.activeId : activeId == null ? null : String(activeId);
  current = docs.some((d) => d.id === wanted) ? wanted : docs[0]?.id ?? null;

  /* ---------------- 查询 ---------------- */

  const tabOf = (id) =>
    [...scroll.querySelectorAll('.c-documenttabs__tab')].find((t) => t.dataset.docid === id) ?? null;

  const docOf = (id) => docs.find((d) => d.id === id) ?? null;

  /** 传了 panel 才接 aria-controls；没传就只保留 tablist 语义，不伪造关联 */
  const linkPanel = (btn, doc) => {
    if (!doc.panel) return null;
    const panel = typeof doc.panel === 'string' ? document.getElementById(doc.panel) : doc.panel;
    if (!panel) return null;
    if (!panel.id) panel.id = `gg-doctabpanel-${++uid}`;
    if (!btn.id) btn.id = `gg-doc-tab-${++uid}`;
    btn.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', btn.id);
    panel.tabIndex = 0;
    return panel;
  };

  /* ---------------- 渲染 ---------------- */

  const sync = () => {
    for (const tab of scroll.querySelectorAll('.c-documenttabs__tab')) {
      const on = tab.dataset.docid === current;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (tab._panel) tab._panel.hidden = !on;
    }
  };

  /** roving tabindex：焦点可以落在非选中页签上（手动激活模型） */
  const setRoving = (id) => {
    for (const tab of scroll.querySelectorAll('.c-documenttabs__tab')) {
      tab.tabIndex = tab.dataset.docid === id ? 0 : -1;
    }
  };

  const focusTab = (id) => {
    const tab = tabOf(id);
    if (!tab) return;
    tab.focus();
    setRoving(id);
  };

  const reveal = (id) => {
    const tab = tabOf(id);
    // block: 'nearest' —— 只让这颗进视口，不把整页滚走
    if (tab) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const buildTab = (doc) => {
    const pinned = doc.pinned;
    const tab = h(
      'div',
      {
        class: `c-documenttabs__tab${pinned ? ' c-documenttabs__tab--pinned' : ''}`,
        role: 'tab',
        tabindex: '-1',
        'aria-selected': 'false',
        title: doc.tooltip || (doc.dirty ? `${doc.title} — 未保存` : doc.title),
        // 固定页签只剩图标，标题必须由 aria-label 提供，否则读屏只听到「标签页」
        'aria-label': pinned ? doc.title : null,
        dataset: { docid: doc.id },
        onpointerdown: (e) => beginDrag(e, doc, tab),
        onclick: (e) => {
          if (skipClick) {
            skipClick = false;
            return;
          }
          if (e.target.closest('.c-documenttabs__close')) return;
          activate(doc.id, true);
        },
      },
      doc.icon ? iconEl(doc.icon, 13) : pinned ? iconEl('file-text', 13) : null,
      // 固定页签没有可见文字：宽度只够一颗图标
      pinned
        ? null
        : h(
            'span',
            { class: 'c-documenttabs__label' },
            h('span', { class: 'c-documenttabs__title' }, doc.title),
            h('span', {
              class: 'c-documenttabs__dirty',
              'aria-hidden': 'true',
              hidden: !doc.dirty,
            })
          ),
      doc.closable && !pinned
        ? h('button', {
            class: 'c-documenttabs__close',
            type: 'button',
            tabindex: '-1', // 鼠标可达，不占 Tab 序列（键盘用 Delete）
            'aria-label': `关闭 ${doc.title}`,
            title: `关闭 ${doc.title}`,
            html: icon('x', 9),
            onclick: (e) => {
              e.stopPropagation();
              requestClose(doc.id);
            },
          })
        : null
    );

    const panel = linkPanel(tab, doc);
    if (panel) tab._panel = panel;
    if (doc.dirty) tab.dataset.dirty = '1';
    return tab;
  };

  const render = () => {
    const active = document.activeElement;
    const focusedId = el.contains(active) ? active?.dataset?.docid ?? null : null;
    const newFocused = newBtn && active === newBtn;
    const keepScroll = scroll.scrollLeft;

    scroll.replaceChildren();
    if (!docs.length) {
      scroll.append(h('div', { class: 'c-documenttabs__empty' }, EMPTY_TEXT));
    }
    for (const doc of docs) scroll.append(buildTab(doc));

    scroll.scrollLeft = keepScroll;
    sync();

    if (newFocused) newBtn.focus();
    else if (focusedId && tabOf(focusedId)) focusTab(focusedId);
  };

  /* ---------------- 选中 ---------------- */

  const activate = (id, notify) => {
    if (el.getAttribute('aria-disabled') === 'true') return;
    if (!docs.some((d) => d.id === id)) return;
    const changed = current !== id;
    current = id;
    sync();
    reveal(id);
    if (changed) {
      if (notify) onSelect?.(id);
      persist();
    }
  };

  /* ---------------- 关闭 ---------------- */

  const setBusy = (id, busy) => {
    const tab = tabOf(id);
    if (!tab) return;
    if (busy) tab.setAttribute('aria-busy', 'true');
    else tab.removeAttribute('aria-busy');
    const closeBtn = tab.querySelector('.c-documenttabs__close');
    if (closeBtn) {
      if (busy) closeBtn.setAttribute('aria-disabled', 'true');
      else closeBtn.removeAttribute('aria-disabled');
    }
  };

  const removeDoc = (id) => {
    const i = docs.findIndex((d) => d.id === id);
    if (i < 0) return false;

    const wasActive = current === id;
    const hadFocus = el.contains(document.activeElement);

    docs.splice(i, 1);
    if (wasActive) current = docs[i]?.id ?? docs[i - 1]?.id ?? null;

    onClose?.(id); // 已经真移除，回调里读到的会话是移除后的
    render();
    persist();

    if (wasActive) {
      if (current) reveal(current);
      // 键盘用户关掉一颗后不能把焦点丢到 body
      if (hadFocus) {
        if (current) focusTab(current);
        else if (newBtn) newBtn.focus();
      }
    }
    return true;
  };

  const requestClose = async (id) => {
    if (disposer.disposed) return false;
    const doc = docOf(id);
    if (!doc) return false;
    if (doc.closable === false) return false;
    if (closing.has(id)) return false; // 异步询问期间不接受第二次关闭
    if (el.getAttribute('aria-disabled') === 'true') return false;

    // 只有 dirty 才询问：干净的页签关掉不该再弹一次
    if (doc.dirty && typeof onCloseRequest === 'function') {
      closing.add(id);
      setBusy(id, true);
      let allowed = false;
      try {
        allowed = await onCloseRequest({ ...doc });
      } catch (err) {
        allowed = false;
        console.warn('[golden-gate] DocumentTabs 的 onCloseRequest 抛错，按拒绝关闭处理', err);
      }
      closing.delete(id);
      if (disposer.disposed) return false;
      setBusy(id, false);

      if (!allowed) {
        // 拒绝关闭：焦点回到这颗页签，别让用户不知道刚才点的是谁
        focusTab(id);
        return false;
      }
    }

    if (disposer.disposed) return false;
    return removeDoc(id);
  };

  /* ---------------- 拖动重排 ---------------- */

  const computeDrop = (clientX, d) => {
    const order = docs.filter((doc) => doc.id !== d.id);
    let at = order.length;
    for (let i = 0; i < order.length; i++) {
      const tab = tabOf(order[i].id);
      if (!tab) continue;
      const r = tab.getBoundingClientRect();
      if (clientX < r.left + r.width / 2) {
        at = i;
        break;
      }
    }
    // 固定页签是重排的硬边界：插入点不可能落在它们前面
    const pinnedCount = order.filter((doc) => doc.pinned).length;
    if (at < pinnedCount) at = pinnedCount;
    return { order, at };
  };

  const updateDrop = (clientX, d) => {
    const { order, at } = computeDrop(clientX, d);
    d.dropAt = at;
    const rect = el.getBoundingClientRect();
    let x = 3;
    if (at >= order.length) {
      const last = order.length ? tabOf(order[order.length - 1].id) : null;
      x = last ? last.getBoundingClientRect().right - rect.left : rect.width - 3;
    } else {
      const next = tabOf(order[at].id);
      if (next) x = next.getBoundingClientRect().left - rect.left;
    }
    dropLine.style.left = `${Math.round(x) - 1}px`;
    dropLine.classList.add('is-on');
  };

  const beginDrag = (e, doc, tab) => {
    if (drag) return;
    if (el.getAttribute('aria-disabled') === 'true') return;
    if (doc.pinned) return; // 固定页签是重排的边界，不参与拖动
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('.c-documenttabs__close')) return;
    if (closing.has(doc.id)) return;
    drag = {
      id: doc.id,
      tab,
      x0: e.clientX,
      y0: e.clientY,
      pointerId: e.pointerId,
      started: false,
      dropAt: 0,
    };
  };

  const endDrag = (e, cancelled) => {
    if (!drag || (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
    const d = drag;

    dropLine.classList.remove('is-on');
    delete el.dataset.dragging;
    d.tab.classList.remove('is-dragging');

    // 没越过阈值 = 一次点击，交给 click 处理（不能吞掉选中）
    if (!d.started) {
      drag = null;
      return;
    }

    drag = null;
    skipClick = true;
    disposer.timeout(() => {
      skipClick = false;
    }, 0);

    if (cancelled || disposer.disposed) return;

    const { order, at } = computeDrop(e?.clientX ?? d.x0, d);
    const moved = docOf(d.id);
    if (!moved) return;
    order.splice(at, 0, moved);
    const changed = order.some((doc, i) => doc !== docs[i]);
    if (!changed) return;

    docs = order;
    render();
    reveal(d.id);
    onReorder?.(docs.map((doc) => ({ ...doc })));
    persist();
  };

  disposer.on(
    window,
    'pointermove',
    (e) => {
      if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
      if (!drag.started) {
        const dx = e.clientX - drag.x0;
        const dy = e.clientY - drag.y0;
        if (Math.abs(dx) < DRAG_THRESHOLD) return; // 4px 阈值：避免和点击抢
        if (Math.abs(dx) <= Math.abs(dy)) return; // 竖向手势留给滚动
        drag.started = true;
        drag.tab.classList.add('is-dragging');
        el.dataset.dragging = '1';
        try {
          drag.tab.setPointerCapture?.(e.pointerId);
        } catch {
          // 合成事件没有真实指针，捕获失败不影响重排
        }
      }
      if (e.cancelable) e.preventDefault();
      updateDrop(e.clientX, drag);
    },
    { passive: false }
  );

  disposer.on(window, 'pointerup', (e) => endDrag(e, false));
  disposer.on(window, 'pointercancel', (e) => endDrag(e, true));

  /* ---------------- 事件 ---------------- */

  // 竖向滚轮映射为横向滚动：一排页签不该让整页跳
  disposer.on(
    scroll,
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      scroll.scrollLeft += e.deltaY;
    },
    { passive: false }
  );

  disposer.on(el, 'keydown', (e) => {
    // 关闭钮是原生 button，Enter/Space 自己会派发 click
    if (e.target.closest?.('.c-documenttabs__close')) return;

    const tabs = [...scroll.querySelectorAll('.c-documenttabs__tab')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      focusTab(next.dataset.docid);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusTab(tabs[e.key === 'Home' ? 0 : tabs.length - 1].dataset.docid);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(tabs[i].dataset.docid, true);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      requestClose(tabs[i].dataset.docid);
    }
  });

  // 焦点离开整组时把 roving tabindex 还给选中页签
  disposer.on(el, 'focusout', (e) => {
    if (el.contains(e.relatedTarget)) return;
    sync();
  });

  /* ---------------- 公开方法 ---------------- */

  el.setDocuments = (list) => {
    docs = normalizeList(list);
    if (!docs.some((d) => d.id === current)) current = docs[0]?.id ?? null;
    render();
    persist();
  };

  el.setActive = (id) => {
    const next = id == null ? null : String(id);
    if (next !== null && !docs.some((d) => d.id === next)) return;
    if (current === next) return;
    current = next;
    sync();
    if (next) reveal(next);
    persist();
  };

  el.markDirty = (id, value = true) => {
    const doc = docOf(id);
    if (!doc) return;
    doc.dirty = !!value;
    const tab = tabOf(id);
    if (tab) {
      if (doc.dirty) tab.dataset.dirty = '1';
      else delete tab.dataset.dirty;
      tab.title = doc.tooltip || (doc.dirty ? `${doc.title} — 未保存` : doc.title);
      const dot = tab.querySelector('.c-documenttabs__dirty');
      if (dot) dot.hidden = !doc.dirty;
    }
    persist();
  };

  el.close = (id) => requestClose(id == null ? null : String(id));
  el.closeActive = () => (current == null ? Promise.resolve(false) : requestClose(current));

  el.value = () => ({ activeId: current, documents: docs.map((doc) => ({ ...doc })) });

  el.serialize = () => ({
    activeId: current,
    documents: docs.map(({ id, title, icon: ico, dirty, pinned }) => ({
      id,
      title,
      icon: ico ?? null,
      dirty: !!dirty,
      pinned: !!pinned,
    })),
  });

  el.restore = (state) => {
    if (!state || !Array.isArray(state.documents)) return;
    docs = normalizeList(state.documents);
    const next = state.activeId == null ? null : String(state.activeId);
    current = docs.some((d) => d.id === next) ? next : docs[0]?.id ?? null;
    render(); // 静默：不触发 onSelect
    persist();
  };

  el.setDisabled = (value) => {
    applyControlState(el, { disabled: !!value });
  };

  el.dispose = () => {
    drag = null;
    skipClick = false;
    disposer.dispose();
  };

  render();
  return el;
}
