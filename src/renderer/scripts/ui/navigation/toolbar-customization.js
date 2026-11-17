// Golden Gate · navigation/toolbar-customization
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { spring } from '../../core/spring.js';
import { createDisposer } from '../_shared/disposer.js';
import { closeLayer, openLayer, positionLayer } from '../_shared/overlay.js';

/* ==========================================================================
   54. 工具栏自定义

   工具栏的第一层问题是「放不下」（ToolbarOverflow 收进更多），第二层是
   「用户想改」（macOS 的 Customize Toolbar…）。两件事不能混在一个控件里：
   溢出是宽度算出来的，自定义是应用设置，必须由调用方显式保存。

   面板从锚点（通常是工具栏的「自定义」按钮）下方弹出，贴右边缘。
   上半是已显示的项（可拖动排序），下半是被隐藏的项（勾选即加入）。
   没有「应用 / 取消」—— 每一次勾选、每一次落位都立即回调，真实面板就是实时的。

   集成路径（本组件不直接调用 ToolbarOverflow）：
     const custom = ToolbarCustomization({ items, visible, onChange: (ids) => {
       toolbar.setItems(allItems.filter((it) => ids.includes(it.id)));
     }});
   也就是说：`value()` 是有序的可见 id，调用方拿它去过滤传给
   ToolbarOverflow 的 items —— 自定义决定「有哪些」，溢出决定「放不放得下」。

   键盘契约：
     - 每一行都是真 <input type="checkbox">，Tab 可达，Space 切换；
     - 拖动手柄是按钮，Alt+↑ / Alt+↓ 把当前行上移 / 下移（纯拖拽不可访问，
       所以必须有一条键盘路径）；无修饰方向键不动，避免和 Tab 习惯打架；
     - Esc 关闭、点外部关闭、关闭后焦点回到锚点（由层栈负责，本组件补一次兜底）。
   ========================================================================== */

let uid = 0;

/**
 * 工具栏自定义面板。
 * @param {object} o
 * @param {Array<{id:string,label:string,icon?:string,group?:string,required?:boolean,hidden?:boolean}>} [o.items]
 *        所有可用项；`hidden` 只影响初始是否可见，仍可从「更多项」加入。
 * @param {string[]} [o.visible] 当前显示的 id（有序）；默认 = items 里非 hidden 的全部（必含 required）。
 * @param {string} [o.label] 面板可读名
 * @param {string} [o.storageKey] 传了就把可见 id 写进 localStorage（读写都 try/catch）
 * @param {(ids:string[])=>void} [o.onChange] 每次变更立即回调，参数是新的有序可见 id
 * @param {string} [o.className]
 * @returns {{el:HTMLElement, open:(anchor?:HTMLElement)=>void, close:()=>void,
 *   isOpen:()=>boolean, value:()=>string[], setItems:(list:Array)=>void,
 *   setVisible:(ids:string[])=>void, reset:()=>void, dispose:()=>void}}
 */
export function ToolbarCustomization({
  items: itemsIn = [],
  visible: visibleIn,
  label = '自定义工具栏',
  storageKey,
  onChange,
  className = '',
} = {}) {
  const disposer = createDisposer();
  const descId = `gg-tbc-desc-${++uid}`;

  let items = normalizeItems(itemsIn);
  let disposed = false;
  let layer = null;
  let position = null;
  let enter = null;
  let drag = null;

  /* ---------------- 可用项与初始值 ---------------- */

  // 默认值：items 里非 hidden 的全部（顺序照 items），required 无论如何都在。
  const defaults = resolveVisible(
    Array.isArray(visibleIn) ? visibleIn : items.filter((it) => !it.hidden).map((it) => it.id)
  );
  // reset() 的目标。注意它取的是「应用给的默认可见集」，不是 storage 里的值 ——
  // 否则「恢复默认」只会把用户改回上次保存的样子，看起来像没生效。
  const initialIds = [...defaults];

  const stored = readStored();
  let ids = stored ? resolveVisible(stored) : [...defaults];

  /* ---------------- 内部工具 ---------------- */

  function normalizeItems(list) {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== 'object') continue;
      const id = raw.id == null ? '' : String(raw.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: raw.label == null ? id : String(raw.label),
        icon: raw.icon ? String(raw.icon) : '',
        group: raw.group ? String(raw.group) : '',
        required: !!raw.required,
        hidden: !!raw.hidden,
      });
    }
    return out;
  }

  // 过滤不存在的 id、去重、补齐 required；顺序完全按传进来的列表。
  function resolveVisible(list) {
    const known = new Set(items.map((it) => it.id));
    const seen = new Set();
    const out = [];
    for (const value of Array.isArray(list) ? list : []) {
      const id = String(value);
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    for (const it of items) {
      if (it.required && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it.id);
      }
    }
    return out;
  }

  function readStored() {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((v) => typeof v === 'string');
    } catch {
      // 存的是坏 JSON / 隐私模式禁用 storage：当作没存过，不能让整块面板打不开
      return null;
    }
  }

  function persist() {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(ids));
    } catch {
      // 配额满 / 无权限都不影响本次会话
    }
  }

  const itemOf = (id) => items.find((it) => it.id === id) || null;

  function rowElOf(id) {
    for (const row of el.querySelectorAll('.c-toolbarcustom__row')) {
      if (row.dataset.id === id) return row;
    }
    return null;
  }

  function focusRowControl(id, control) {
    const row = rowElOf(id);
    if (!row) return;
    const node = row.querySelector(
      control === 'grip' ? '.c-toolbarcustom__grip' : '.c-toolbarcustom__input'
    );
    node?.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: 'nearest' });
  }

  /* ---------------- 面板骨架 ---------------- */

  const el = h('div', {
    class: `c-toolbarcustom ${className}`.trim(),
    role: 'dialog',
    'aria-label': label,
    'aria-describedby': descId,
    tabindex: '-1',
  });

  /* ---------------- 渲染 ---------------- */

  function render() {
    if (disposed) return;

    // 空态没有列表可描述：把 aria-describedby 摘掉，别指向不存在的节点
    if (!items.length) el.removeAttribute('aria-describedby');
    else el.setAttribute('aria-describedby', descId);

    if (!items.length) {
      el.replaceChildren(
        h('p', { class: 'c-toolbarcustom__empty' }, '没有可自定义的项'),
        h(
          'div',
          { class: 'c-toolbarcustom__foot' },
          h(
            'button',
            { class: 'c-toolbarcustom__close', type: 'button', onclick: close },
            '关闭'
          )
        )
      );
      el.dataset.empty = '1';
      return;
    }
    delete el.dataset.empty;

    const currentSet = new Set(ids);
    const currentItems = ids.map(itemOf).filter(Boolean);
    const hiddenItems = items.filter((it) => !currentSet.has(it.id));

    const currentList = h(
      'div',
      { class: 'c-toolbarcustom__list' },
      currentItems.length
        ? currentItems.map((it) => row(it, { visible: true }))
        : h('p', { class: 'c-toolbarcustom__empty c-toolbarcustom__empty--inline' }, '没有显示的项')
    );

    // 「更多项」按 items 顺序显示；相邻的同 group 项合成一段，中间只出一次小标题。
    // 用「连续段」而不是 Map 归并：后者会把 A、B、A 重排成 A、A、B，顺序就变了。
    const moreKids = [];
    let lastGroup = null;
    for (const it of hiddenItems) {
      if (it.group && it.group !== lastGroup) {
        moreKids.push(h('div', { class: 'c-toolbarcustom__group' }, it.group));
      }
      lastGroup = it.group;
      moreKids.push(row(it, { visible: false }));
    }
    if (!moreKids.length) {
      moreKids.push(
        h('p', { class: 'c-toolbarcustom__empty c-toolbarcustom__empty--inline' }, '已全部显示')
      );
    }

    const body = h(
      'div',
      { class: 'c-toolbarcustom__body' },
      h(
        'section',
        {
          class: 'c-toolbarcustom__section',
          dataset: { region: 'current' },
          role: 'group',
          'aria-label': '当前项',
        },
        h('div', { class: 'c-toolbarcustom__title' }, '当前项'),
        currentList
      ),
      h(
        'section',
        {
          class: 'c-toolbarcustom__section',
          dataset: { region: 'more' },
          role: 'group',
          'aria-label': '更多项',
        },
        h('div', { class: 'c-toolbarcustom__title' }, '更多项'),
        h('div', { class: 'c-toolbarcustom__list' }, moreKids)
      )
    );

    const foot = h(
      'div',
      { class: 'c-toolbarcustom__foot' },
      h(
        'button',
        { class: 'c-toolbarcustom__reset', type: 'button', onclick: reset },
        '恢复默认'
      )
    );

    el.replaceChildren(
      h('p', { class: 'c-toolbarcustom__hint', id: descId }, '勾选显示，拖动排序'),
      body,
      foot
    );
  }

  function row(item, { visible }) {
    const cbId = `gg-tbc-cb-${++uid}`;
    const input = h('input', {
      class: 'c-toolbarcustom__input',
      type: 'checkbox',
      id: cbId,
      checked: visible,
      // 必需项在「当前项」里不可取消；「更多项」里永远不会出现必需项
      disabled: visible && item.required,
      onchange: () => {
        if (input.disabled || disposed) return;
        if (input.checked && !ids.includes(item.id)) ids.push(item.id);
        else if (!input.checked) ids = ids.filter((id) => id !== item.id);
        commit({ focusCheckbox: item.id });
      },
    });

    const labelEl = h(
      'label',
      { class: 'c-toolbarcustom__label', for: cbId },
      h('span', {
        class: 'c-toolbarcustom__box',
        'aria-hidden': 'true',
        html: icon('check', 11),
      }),
      item.icon
        ? h('span', { class: 'c-toolbarcustom__ico', 'aria-hidden': 'true', html: icon(item.icon, 13) })
        : null,
      h('span', { class: 'c-toolbarcustom__text' }, item.label),
      item.required ? h('span', { class: 'c-toolbarcustom__req' }, '必需') : null
    );

    const node = h(
      'div',
      {
        class: 'c-toolbarcustom__row',
        dataset: { id: item.id },
        title: item.required && visible ? '必需项，不能隐藏' : null,
        onkeydown: onRowKey,
      },
      visible
        ? h('button', {
            class: 'c-toolbarcustom__grip',
            type: 'button',
            'aria-label': `拖动排序 ${item.label}`,
            html: icon('grip', 10),
            onpointerdown: onGripDown,
          })
        : null,
      input,
      labelEl
    );
    return node;
  }

  /* ---------------- 变更 ---------------- */

  // 所有「顺序 / 可见集合」的变化都从这里走：落盘 → 重画 → 回调。
  // 先重画再回调，是因为回调里常常会 setItems 再次进入；先画能保证 DOM 已是新状态。
  function commit({ focusCheckbox = '', focusGrip = '' } = {}) {
    if (disposed) return;
    persist();
    render();
    onChange?.([...ids]);
    if (focusGrip) focusRowControl(focusGrip, 'grip');
    else if (focusCheckbox) focusRowControl(focusCheckbox, 'checkbox');
  }

  function reset() {
    if (disposed) return;
    ids = resolveVisible(initialIds);
    commit();
  }

  function setVisible(list) {
    if (disposed) return;
    ids = resolveVisible(Array.isArray(list) ? list : []);
    commit();
  }

  function setItems(list) {
    if (disposed) return;
    const before = new Set(items.map((it) => it.id));
    items = normalizeItems(list);
    const known = new Set(items.map((it) => it.id));

    // 还存在的保持原顺序与原勾选状态；第一次出现的新项按 hidden 决定默认值。
    // 不能「所有非 hidden 都补进来」—— 那会把用户取消过的项每轮刷新都复活。
    const next = ids.filter((id) => known.has(id));
    for (const it of items) {
      if (before.has(it.id) || next.includes(it.id)) continue;
      if (!it.hidden || it.required) next.push(it.id);
    }
    ids = resolveVisible(next);
    commit();
  }

  /* ---------------- 排序：拖拽 ---------------- */

  const rowsIn = (list) => [...list.querySelectorAll(':scope > .c-toolbarcustom__row')];

  function onGripDown(e) {
    if (disposed || drag) return;
    if (e.button != null && e.button !== 0) return;
    const grip = e.currentTarget;
    const rowNode = grip.closest('.c-toolbarcustom__row');
    const list = rowNode?.parentElement;
    if (!rowNode || !list) return;

    drag = {
      grip,
      row: rowNode,
      list,
      id: rowNode.dataset.id,
      pointerId: e.pointerId,
    };
    rowNode.dataset.dragging = '1';
    el.dataset.dragging = '1';
    try {
      grip.setPointerCapture?.(e.pointerId);
    } catch {
      // 合成事件 / 非活动指针没有捕获，窗口级监听仍然兜得住
    }
    e.preventDefault();
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(e) {
    if (!drag) return;
    if (e.pointerId != null && drag.pointerId != null && e.pointerId !== drag.pointerId) return;
    const { row: rowNode, list } = drag;
    if (!rowNode.isConnected) return;
    e.preventDefault?.();

    // 以每行中线为界：指针越过谁的中线，就把被拖行插到谁前面。
    // 只动 DOM 的兄弟节点顺序，不做 transform —— 松手后一次 render 收口。
    const siblings = rowsIn(list).filter((node) => node !== rowNode);
    let before = null;
    for (const sibling of siblings) {
      const rect = sibling.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        before = sibling;
        break;
      }
    }
    if (before === rowNode.nextElementSibling) return;
    if (!before && !rowNode.nextElementSibling) return;
    list.insertBefore(rowNode, before);
  }

  function onDragEnd(e) {
    if (!drag) return;
    if (e?.type === 'pointerup' && e.pointerId != null && drag.pointerId != null) {
      if (e.pointerId !== drag.pointerId) return;
    }
    const { grip, row: rowNode, list, id, pointerId } = drag;
    detachDrag();
    delete rowNode.dataset.dragging;
    delete el.dataset.dragging;
    try {
      grip.releasePointerCapture?.(pointerId);
    } catch {
      // 同上：没有捕获就没有可释放的
    }
    drag = null;

    const order = rowsIn(list).map((node) => node.dataset.id);
    if (order.join('\u0000') === ids.join('\u0000')) return;
    ids = resolveVisible(order);
    commit({ focusGrip: id });
  }

  function detachDrag() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
  }

  function cancelDrag() {
    if (!drag) return;
    detachDrag();
    delete drag.row.dataset.dragging;
    delete el.dataset.dragging;
    drag = null;
  }

  /* ---------------- 排序：键盘 ---------------- */

  // 挂在行上：手柄和 checkbox 的 keydown 都会冒泡到这里，一处处理即可。
  // 修饰键必须带 Alt —— 无修饰方向键留给将来的行间移动，避免和 Tab 习惯打架。
  function onRowKey(e) {
    if (e.defaultPrevented || disposed) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!e.altKey) return;

    const at = e.target.closest('.c-toolbarcustom__row')?.dataset.id;
    const index = ids.indexOf(at);
    if (index < 0) return;
    const to = index + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= ids.length) return;

    e.preventDefault();
    ids.splice(to, 0, ids.splice(index, 1)[0]);
    const fromGrip = e.target.classList.contains('c-toolbarcustom__grip');
    commit({ focusGrip: fromGrip ? at : '', focusCheckbox: fromGrip ? '' : at });
  }

  /* ---------------- 开合 ---------------- */

  function open(anchor = null) {
    if (disposed || layer) return; // 重复 open 不叠层

    render();
    document.body.append(el);
    el.style.opacity = '0';
    el.style.transform = 'scale(0.98)';

    const anchorNode = anchor instanceof HTMLElement ? anchor : null;
    position = positionLayer(el, {
      anchor: anchorNode,
      placement: 'bottom',
      align: 'end',
      gap: 6,
      pad: 8,
      onHidden: () => close(),
    });

    layer = openLayer({
      el,
      container: el,
      modal: false,
      trap: false,
      dismissible: true,
      outside: true,
      ignore: anchorNode ? [anchorNode] : [],
      initialFocus: 'self',
      // 焦点归还自己接管：关面板时可能已经把锚点换掉，openLayer 只认得打开瞬间的焦点
      returnFocus: false,
      onClose: () => {
        layer = null;
        position?.stop();
        position = null;
        enter?.stop();
        enter = null;
        el.remove();
        if (!disposed && anchorNode?.isConnected) {
          requestAnimationFrame(() => anchorNode.focus?.({ preventScroll: true }));
        }
      },
    });
    el.style.zIndex = String(900 + layer.level * 20);

    enter = spring({
      from: 0,
      to: 1,
      damping: 1,
      response: 0.22,
      onUpdate: (t) => {
        el.style.opacity = String(t);
        el.style.transform = `scale(${0.98 + 0.02 * t})`;
      },
    });
  }

  function close() {
    if (!layer) return;
    closeLayer(layer, 'api');
  }

  /* ---------------- 对外控制器 ---------------- */

  render();

  return {
    el,
    open,
    close,
    isOpen: () => !!layer,
    value: () => [...ids],
    setItems,
    setVisible,
    reset,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelDrag();
      // closeLayer 会同步走 onClose（摘 DOM / 停定位）；disposed 已置位，那里不再抢焦点
      if (layer) closeLayer(layer, 'dispose');
      disposer.dispose();
      el.remove();
    },
  };
}
