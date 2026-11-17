// Golden Gate · overlays/popover
import { h } from '../../core/dom.js';
import { spring } from '../../core/spring.js';
import { mountGlassLens, disposeGlassTree } from '../../core/glass-lens.js';
import { openLayer, positionLayer } from '../_shared/overlay.js';

/* ==========================================================================
   31. 浮层 Popover
   —— 菜单是「一串可选项」，浮层是「一块任意内容」。别互相顶替。
      浮层不拦人，但 Esc / 点外面同样要收起；焦点策略由 focus 决定：
      'none' 保持触发器的焦点（菜单式），'self' / 'first' 把焦点搬进来（检查器式）。
   ========================================================================== */

let activePopover = null;

export function openPopover({
  anchor,
  content,
  placement = 'bottom',
  align = 'center',
  width,
  label = '',
  focus = 'none',
  trap = false,
  onClose,
} = {}) {
  closePopover();

  const el = h(
    'div',
    {
      class: 'c-popover c-glass-sheet',
      role: 'dialog',
      'aria-label': label || null,
      tabindex: '-1',
    },
    content
  );
  document.body.append(el);
  el.__glassLens = mountGlassLens(el, { surface: 'sheet' });
  if (width) el.style.width = typeof width === 'number' ? `${width}px` : width;

  let layer = null;
  const pos = positionLayer(el, {
    anchor,
    placement,
    align,
    gap: 6,
    onHidden: () => closePopover(),
  });

  layer = openLayer({
    el,
    container: el,
    modal: false,
    trap,
    dismissible: true,
    outside: true,
    ignore: anchor ? [anchor] : [],
    initialFocus: focus,
    onClose: () => {
      pos.stop();
      disposeGlassTree(el);
      el.remove();
      if (activePopover === ctl) activePopover = null;
      onClose?.();
    },
  });
  el.style.zIndex = String(900 + layer.level * 20);

  el.style.opacity = '0';
  el.style.transform = 'scale(0.97)';
  spring({
    from: 0,
    to: 1,
    damping: 1,
    response: 0.22,
    onUpdate: (t) => {
      el.style.opacity = String(t);
      el.style.transform = `scale(${0.97 + 0.03 * t})`;
    },
  });

  const ctl = {
    el,
    layer,
    close: closePopover,
    /** 内容变高后重新贴着锚点（例如异步加载完） */
    reposition: pos.update,
  };
  activePopover = ctl;
  return ctl;
}

export function closePopover() {
  if (!activePopover) return;
  const c = activePopover;
  activePopover = null;
  c.layer.close('api');
}
