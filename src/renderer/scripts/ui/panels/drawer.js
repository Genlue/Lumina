// Golden Gate · panels/drawer
import { h, clamp } from '../../core/dom.js';
import { mountGlassLens, disposeGlassTree } from '../../core/glass-lens.js';

/* ==========================================================================
   33. 抽屉
   —— 从容器任意一条边拉出的面板。和模态的区别在「贴边」：
      只有拉出那一侧有圆角，另一侧永远和容器边缘齐平。
      拉出侧留一条抓握带：点一下切换，拖一段跟手，松手按位移和速度决定去向。

   两条设计约束：
   ① **不做遮罩也能用。** 抽屉多半是「把一个次要面板推到边上」，不是拦截式流程，
      所以 scrim 默认关闭，只有真要打断用户时才打开。
   ② **抓握带不能被 inert。** 收起后面板会离开可视区，整块 inert 掉的话抓握带
      也一起失灵，抽屉就再也打不开了。所以 inert 只加在 body 上。
   ========================================================================== */

const DRAWER_SIDES = ['top', 'bottom', 'left', 'right'];

export function Drawer({
  side = 'bottom',
  open = false,
  peek = 0,
  size = '',
  scrim = false,
  dismissible = true,
  resizable = true,
  minSize = 160,
  label = '抽屉',
  children = null,
  className = '',
  onOpen,
  onClose,
} = {}) {
  const dir = DRAWER_SIDES.includes(side) ? side : 'bottom';
  const vertical = dir === 'bottom' || dir === 'top';
  // 往「开」的方向拖 = 进度增加。bottom/right 是反向拖动打开，top/left 是正向。
  const openSign = dir === 'bottom' || dir === 'right' ? -1 : 1;
  const peekPx = Math.max(0, Number(peek) || 0);

  const grip = h(
    'button',
    {
      class: 'c-drawer__grip',
      type: 'button',
      'aria-label': label,
      'aria-expanded': String(Boolean(open)),
    },
    h('i', { class: 'c-drawer__bar' })
  );

  const body = h('div', { class: 'c-drawer__body' }, children);
  const sheet = h(
    'div',
    {
      class: 'c-drawer__sheet c-glass-sheet',
      role: 'region',
      'aria-label': label,
      tabindex: '-1',
    },
    grip,
    body
  );
  const scrimEl = scrim ? h('div', { class: 'c-drawer__scrim' }) : null;

  const root = h(
    'div',
    {
      class: `c-drawer ${className}`.trim(),
      dataset: { side: dir, open: open ? '1' : '0' },
      style: {
        '--dw-size': size || (vertical ? '62%' : '78%'),
        '--dw-peek': `${peekPx}px`,
        '--dw-p': open ? '1' : '0',
      },
    },
    scrimEl,
    sheet
  );

  // 玻璃比 CSS 兜底多一层折射；不支持时 mountGlassLens 自己返回 null，样式照旧。
  sheet.__glassLens = mountGlassLens(sheet, { surface: 'sheet' });

  let isOpen = Boolean(open);
  let drag = null;
  let speed = 0;
  let swallowClick = false;

  const progress = () => Number(root.style.getPropertyValue('--dw-p')) || 0;
  const extent = () => (vertical ? sheet.offsetHeight : sheet.offsetWidth) || 1;
  const travel = () => Math.max(1, extent() - peekPx);
  const pointOf = (e) => (vertical ? e.clientY : e.clientX);

  const syncState = () => {
    root.dataset.open = isOpen ? '1' : '0';
    grip.setAttribute('aria-expanded', String(isOpen));
    // 收起到完全不可见时，内容不能再被 Tab 进去；抓握带必须留在外面。
    if (isOpen) body.removeAttribute('inert');
    else body.setAttribute('inert', '');
  };

  const setOpen = (next, { animate = true, silent = false } = {}) => {
    const value = Boolean(next);
    const changed = value !== isOpen;
    isOpen = value;

    if (!animate) {
      // 先关掉过渡，改完值再放开，否则「瞬间归位」会变成一段动画
      root.dataset.jump = '1';
      root.style.setProperty('--dw-p', value ? '1' : '0');
      void sheet.offsetWidth;
      requestAnimationFrame(() => delete root.dataset.jump);
    } else {
      root.style.setProperty('--dw-p', value ? '1' : '0');
    }

    syncState();
    if (changed && !silent) (value ? onOpen : onClose)?.();
    if (changed) {
      root.dispatchEvent(new CustomEvent(value ? 'drawer:open' : 'drawer:close', { bubbles: true }));
    }
    return value;
  };

  /* ---------------- 拖拽 ---------------- */

  const onDown = (e) => {
    if (e.button !== 0) return;
    const host = vertical ? root.clientHeight : root.clientWidth;
    drag = {
      id: e.pointerId,
      start: pointOf(e),
      from: progress(),
      lastP: progress(),
      lastT: performance.now(),
      // 拉开之后继续拖 = 改高度；还没拉开时拖 = 拉开。两个动作共用同一条抓握带。
      mode: resizable && isOpen ? 'resize' : 'open',
      size0: extent(),
      max: Math.max(extent(), host * 0.92),
      moved: false,
    };
    speed = 0;
    swallowClick = false;
    root.dataset.dragging = '1';
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const travelPx = pointOf(e) - drag.start;
    if (Math.abs(travelPx) > 3) drag.moved = true;

    const delta = travelPx * openSign;

    if (drag.mode === 'resize') {
      // 上限按容器算，下限按 minSize —— 但不该把原本更小的面板「撑大」，所以取两者较小
      const floor = Math.min(minSize, drag.size0);
      const next = clamp(drag.size0 + delta, floor, drag.max);
      root.style.setProperty('--dw-size', `${Math.round(next)}px`);
      return;
    }

    const p = clamp(drag.from + delta / travel(), 0, 1);
    root.style.setProperty('--dw-p', String(p));

    const now = performance.now();
    const dt = now - drag.lastT;
    if (dt > 4) {
      // 每毫秒的进度变化。0.0025 ≈ 0.25/秒，正常甩一下就能到这个量级。
      speed = (p - drag.lastP) / dt;
      drag.lastP = p;
      drag.lastT = now;
    }
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { mode, size0, moved } = drag;
    drag = null;
    delete root.dataset.dragging;

    // 没挪动就是一次点击，交给 click 去切换开合
    if (!moved) {
      swallowClick = false;
      return;
    }

    swallowClick = true;

    if (mode === 'resize') {
      const held = extent();
      if (held <= peekPx + 28) {
        // 拖到几乎收没了就当是关闭，并且把尺寸还原成拖之前的高度
        root.style.setProperty('--dw-size', `${Math.round(size0)}px`);
        setOpen(false);
        return;
      }
      root.dispatchEvent(new CustomEvent('drawer:resize', { bubbles: true, detail: { size: held } }));
      return;
    }

    const p = progress();
    const flick = Math.abs(speed) > 0.0025;
    // 甩一下按方向走，慢慢拖按过没过中线 —— 两种习惯都要照顾。
    setOpen(flick ? speed > 0 : p > 0.4);
  };

  grip.addEventListener('pointerdown', onDown);
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onUp);

  grip.addEventListener('click', () => {
    // 拖完松手会补一个 click，不吞掉就会「刚拉开又关上」
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    setOpen(!isOpen);
  });

  scrimEl?.addEventListener('pointerdown', (e) => {
    if (e.target === scrimEl && dismissible) setOpen(false);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen || !dismissible) return;
    e.stopPropagation();
    setOpen(false);
    grip.focus?.();
  });

  syncState();

  // 方法挂在节点上：调用方拿到 DOM 就能用，不必再记一个控制器对象
  root.setOpen = setOpen;
  root.open = () => setOpen(true);
  root.close = () => setOpen(false);
  root.toggle = () => setOpen(!isOpen);
  root.isOpen = () => isOpen;
  root.sheet = sheet;
  root.body = body;
  root.grip = grip;

  let disposed = false;
  /** 只结束手势与材质，不摘 DOM —— 是否移除由调用方决定 */
  root.dispose = () => {
    if (disposed) return;
    disposed = true;
    if (drag) {
      try {
        grip.releasePointerCapture(drag.id);
      } catch {}
      drag = null;
    }
    speed = 0;
    delete root.dataset.dragging;
    disposeGlassTree(sheet);
  };
  /** dispose + 摘掉自己，给「换一个抽屉」的重建路径用 */
  root.destroy = () => {
    root.dispose();
    root.remove();
  };

  return root;
}
