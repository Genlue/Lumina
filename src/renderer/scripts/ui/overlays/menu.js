// Golden Gate · overlays/menu
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { spring } from '../../core/spring.js';
import { mountGlassLens, disposeGlassTree } from '../../core/glass-lens.js';
import { createDisposer } from '../_shared/disposer.js';
import { openLayer, positionLayer } from '../_shared/overlay.js';

/* ==========================================================================
   14. 菜单

   菜单是「一串可选项」，键盘规则来自 WAI-ARIA Menu：
     ↑↓ 移动，Home/End 到两端，输入字母定位，Enter/Space 执行，
     → 进入子菜单，← 退回父菜单，Esc 只关一层。

   项必须有真正的 tabindex 与焦点，而不是只画一个 hover。勾选项用
   menuitemcheckbox / menuitemradio 表达语义 —— aria-checked 是给辅助技术看的，
   CSS 也要按同一属性上色，两者不能各写一套。
   ========================================================================== */

let rootMenu = null;

const TYPE_OF = (it) =>
  it.type === 'radio' || it.radio
    ? 'menuitemradio'
    : it.type === 'checkbox' || (it.checked !== undefined && !it.children)
      ? 'menuitemcheckbox'
      : 'menuitem';

/**
 * 打开一个浮动菜单。
 * @param {object} o
 * @param {HTMLElement} [o.anchor] 锚点元素；给了就贴着它出现，否则用 x/y
 * @param {Array} o.items [{label, icon, key, checked, type, danger, disabled, children, onClick} | {sep:true} | {header}]
 * @param {number|string} [o.width] 指定宽度（下拉选择要求菜单不比触发器宽）
 * @param {'bottom'|'top'} [o.placement]
 * @param {'start'|'center'|'end'} [o.align]
 * @param {(e:Event)=>void} [o.onClose]
 */
export function openMenu({
  anchor,
  items = [],
  x,
  y,
  width,
  placement = 'bottom',
  align = 'start',
  label = '菜单',
  className = '',
  onClose,
} = {}) {
  // 同一枚锚点再点一次 = 收起。
  // 没有这一条时：pointerdown 先被层栈判成「外部点击」把菜单关掉，
  // 紧接着 click 又把新菜单开出来 —— 看上去就是「点了一下，没收起，反而又展开一遍」。
  if (rootMenu && anchor && rootMenu._anchor === anchor) {
    closeMenu();
    return null;
  }

  // 菜单被外部从 DOM 上摘掉时 rootMenu 会变成悬空引用，别让下一枚锚点被误判成「已展开」
  if (rootMenu && !rootMenu.isConnected) rootMenu = null;

  closeMenu();

  const built = buildPanel(items, { className, label });
  const menu = built.el;
  document.body.append(menu);

  // 菜单也是玻璃面：挂渲染层，参数取「菜单」那一套
  menu.__glassLens = mountGlassLens(menu, { surface: 'menu' });
  if (width) {
    menu.style.width = typeof width === 'number' ? `${Math.round(width)}px` : width;
    menu.style.minWidth = '0';
  }

  const layer = openLayer({
    el: menu,
    container: menu,
    modal: false,
    trap: false,
    dismissible: true,
    outside: true,
    ignore: anchor ? [anchor] : [],
    initialFocus: 'none',
    onClose: () => {
      built.destroy();
      disposeGlassTree(menu);
      menu.remove();
      if (rootMenu === menu) rootMenu = null;
      onClose?.();
    },
  });
  menu.style.zIndex = String(900 + layer.level * 20);

  // 焦点落到第一项：菜单没有「只读」状态，打开就等于进入键盘上下文
  built.focusFirst();

  const pos = positionLayer(menu, {
    anchor,
    x,
    y,
    placement,
    align,
    gap: 6,
    onHidden: () => closeMenu(),
  });

  menu._layer = layer;
  menu._anchor = anchor || null; // 供「再点一次收起」判定
  menu._reposition = pos.update; // 供外壳在自定义滚动容器里主动校正
  menu._close = () => layer.close('menu');
  menu._focusables = built.focusables;
  rootMenu = menu;

  // —— 入场：材质浮现，不是单纯淡入 ——
  menu.style.transform = 'scale(0.96)';
  menu.style.opacity = '0';
  const enterSpring = spring({
    from: 0,
    to: 1,
    damping: 1,
    response: 0.24,
    onUpdate: (t) => {
      menu.style.opacity = String(t);
      menu.style.transform = `scale(${0.96 + 0.04 * t})`;
    },
  });
  menu._enterSpring = enterSpring;

  return menu;
}

/* ---------------- 菜单面板 ---------------- */

/**
 * 建一块菜单（根菜单或子菜单）。
 * @returns {{el:HTMLElement, focusFirst:Function, focusables:Function, destroy:Function}}
 */
function buildPanel(items, { className = '', label = '菜单', parentRecord = null } = {}) {
  const disposer = createDisposer();
  const el = h('div', {
    class: `c-menu ${className}`.trim(),
    role: 'menu',
    'aria-label': label,
    tabindex: '-1',
  });

  /** @type {Map<HTMLElement, object>} */
  const records = new Map();
  let submenu = null; // { el, layer, record }
  let subTimer = 0;
  let typeBuffer = '';
  let typeTimer = 0;

  const itemEls = () => [...el.querySelectorAll('.c-menu__item')];
  const focusables = () =>
    itemEls().filter((node) => node.getAttribute('aria-disabled') !== 'true');

  const focusItem = (node) => {
    if (!node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView?.({ block: 'nearest' });
  };

  const focusFirst = () => {
    const list = focusables();
    const preferred = list.find((node) => records.get(node)?.item.checked) ?? list[0] ?? el;
    focusItem(preferred);
  };

  const move = (delta) => {
    const list = focusables();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement);
    const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : (at + delta + list.length) % list.length;
    focusItem(list[next]);
  };

  const closeSub = () => {
    clearTimeout(subTimer);
    subTimer = 0;
    if (!submenu) return;
    const { layer, record } = submenu;
    submenu = null;
    record.el.setAttribute('aria-expanded', 'false');
    layer.close('submenu');
  };

  const openSub = (record, { focus = false } = {}) => {
    if (submenu?.record === record) {
      if (focus) submenu.focusFirst();
      return;
    }
    closeSub();
    if (!record.item.children?.length) return;

    const sub = buildPanel(record.item.children, {
      className: record.item.menuClass ?? '',
      label: record.item.label || '子菜单',
      parentRecord: record,
    });
    document.body.append(sub.el);
    sub.el.style.zIndex = String(1000);

    record.el.setAttribute('aria-expanded', 'true');
    const layer = openLayer({
      el: sub.el,
      container: sub.el,
      modal: false,
      trap: false,
      dismissible: true,
      outside: true,
      ignore: [record.el],
      initialFocus: 'none',
      onClose: () => {
        sub.destroy();
        disposeGlassTree(sub.el);
        sub.el.remove();
        record.el.setAttribute('aria-expanded', 'false');
        if (submenu?.record === record) submenu = null;
        // 焦点回到父项，不要掉到 body
        if (record.el.isConnected) record.el.focus({ preventScroll: true });
      },
    });
    sub.el.style.zIndex = String(900 + layer.level * 20);
    const pos = positionLayer(sub.el, {
      anchor: record.el,
      placement: 'right',
      align: 'start',
      gap: 2,
      onHidden: () => layer.close('hidden'),
    });
    sub.el.style.opacity = '0';
    sub.el.style.transform = 'scale(0.98)';
    spring({
      from: 0,
      to: 1,
      damping: 1,
      response: 0.18,
      onUpdate: (t) => {
        sub.el.style.opacity = String(t);
        sub.el.style.transform = `scale(${0.98 + 0.02 * t})`;
      },
    });

    menu.style.zIndex = String(900 + layer.level * 20);
    menu._closeSelf = () => layer.close('back');

    submenu = { el: sub.el, layer, record, focusFirst: sub.focusFirst, update: pos.update };
    if (focus) sub.focusFirst();
  };

  const run = (record, e) => {
    const { item } = record;
    if (item.disabled) return;
    if (item.children?.length) {
      openSub(record, { focus: true });
      return;
    }
    e?.stopPropagation?.();
    const menu = rootMenu;
    closeMenu();
    item.onClick?.(e, menu);
  };

  const typeahead = (char) => {
    clearTimeout(typeTimer);
    typeBuffer += char.toLowerCase();
    typeTimer = setTimeout(() => {
      typeBuffer = '';
    }, 500);
    const list = focusables();
    const start = Math.max(0, list.indexOf(document.activeElement));
    const order = [...list.slice(start), ...list.slice(0, start)];
    const hit = order.find((node) => (records.get(node)?.item.label ?? '').toLowerCase().startsWith(typeBuffer));
    if (hit) focusItem(hit);
  };

  for (const item of items) {
    if (item?.sep) {
      el.append(h('div', { class: 'c-menu__sep', role: 'separator' }));
      continue;
    }
    if (item?.header) {
      el.append(h('div', { class: 'c-menu__header', role: 'presentation' }, item.header));
      continue;
    }
    if (!item) continue;

    const role = item.children?.length ? 'menuitem' : TYPE_OF(item);
    const node = h(
      'div',
      {
        class: `c-menu__item ${item.danger ? 'c-menu__item--danger' : ''} ${
          item.children?.length ? 'c-menu__item--parent' : ''
        }`
          .trim()
          .replace(/\s+/g, ' '),
        role,
        tabindex: '-1',
        'aria-checked':
          role === 'menuitemcheckbox' || role === 'menuitemradio'
            ? String(!!item.checked)
            : null,
        'aria-disabled': item.disabled ? 'true' : null,
        'aria-haspopup': item.children?.length ? 'menu' : null,
        'aria-expanded': item.children?.length ? 'false' : null,
        dataset: { label: item.label ?? '' },
        onclick: (e) => run(records.get(node), e),
      },
      role === 'menuitemcheckbox' || role === 'menuitemradio'
        ? h('span', {
            class: 'c-menu__check',
            dataset: { role },
            html: icon('check', 12),
          })
        : null,
      item.icon ? h('span', { style: { width: 14, display: 'grid' }, html: icon(item.icon, 14) }) : null,
      h('span', { class: 'c-menu__label' }, item.label),
      item.key ? h('span', { class: 'c-menu__key' }, item.key) : null,
      item.children?.length
        ? h('span', { class: 'c-menu__sub-arrow', html: icon('chevron-right', 11) })
        : null
    );

    // 悬停切换：进入别的项就收起旧的子菜单；带子项的项延迟一点再开，
    // 否则鼠标横扫整列时会一路弹出每一层
    node.addEventListener('pointerenter', () => {
      if (submenu && submenu.record !== records.get(node)) closeSub();
      clearTimeout(subTimer);
      if (item.children?.length) {
        subTimer = setTimeout(() => {
          const record = records.get(node);
          if (record && node.isConnected) openSub(record, { focus: false });
        }, 90);
      }
    });
    node.addEventListener('pointerleave', () => clearTimeout(subTimer));

    records.set(node, { el: node, item });
    el.append(node);
  }

  const onKey = (e) => {
    if (e.defaultPrevented) return;
    const at = document.activeElement;
    const record = records.get(at);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(focusables()[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      const list = focusables();
      focusItem(list[list.length - 1]);
    } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      if (!record) return;
      e.preventDefault();
      e.stopPropagation();
      if (record.item.children?.length) openSub(record, { focus: true });
      else run(record, e);
    } else if (e.key === 'ArrowRight') {
      if (!record?.item.children?.length) return;
      e.preventDefault();
      e.stopPropagation();
      openSub(record, { focus: true });
    } else if (e.key === 'ArrowLeft') {
      if (!parentRecord) return;
      // 只退一层：子菜单回到父项，父项由触发它的那一层自己接住焦点
      e.preventDefault();
      e.stopPropagation();
      el._closeSelf?.();
    } else if (e.key === 'Tab') {
      // 菜单不是模态：Tab 应该收起菜单并把焦点交回触发器
      e.preventDefault();
      closeMenu();
      parentRecord?.el?.focus?.();
    } else if (e.key === 'Escape') {
      // 子菜单开着时 Esc 只收子菜单（子层自己会处理）；这一层是栈顶才继续
      if (submenu) {
        e.preventDefault();
        e.stopPropagation();
        closeSub();
      }
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      typeahead(e.key);
    }
  };

  disposer.on(el, 'keydown', onKey);
  disposer.add(() => clearTimeout(subTimer));
  disposer.add(() => clearTimeout(typeTimer));

  return {
    el,
    focusFirst,
    focusables,
    destroy: () => {
      closeSub();
      disposer.dispose();
      records.clear();
    },
  };
}

/** 收起根菜单（子菜单会随层栈一起收掉） */
export function closeMenu() {
  if (!rootMenu) return;
  const m = rootMenu;
  rootMenu = null;
  m._enterSpring?.stop();
  m._close?.();
}

/**
 * 右键菜单。事件坐标或显式坐标都行。
 *   el.addEventListener('contextmenu', (e) => openContextMenu(e, items));
 */
export function openContextMenu(event, items, opts = {}) {
  event?.preventDefault?.();
  const x = opts.x ?? event?.clientX ?? 0;
  const y = opts.y ?? event?.clientY ?? 0;
  return openMenu({ ...opts, items, x, y, anchor: null });
}
