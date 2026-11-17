// Golden Gate · navigation/traffic-lights
import { h } from '../../core/dom.js';

/* ==========================================================================
   17. 红绿灯
   几何与配色取自 aw3r1se/macOS-traffic-lights（macOS 26 实测）：
   28 单位栅格里画 14pt 圆，外圈 r=14 深一档作描边，内圈 r=13 是本体。
   ========================================================================== */

const TL_GLYPH = {
  close:
    '<path d="M9 9l10 10M19 9L9 19" fill="none" stroke="currentColor" ' +
    'stroke-width="4.5" stroke-linecap="round"/>',
  min:
    '<path d="M8 14h12" fill="none" stroke="currentColor" ' +
    'stroke-width="4" stroke-linecap="round"/>',
  zoom: '<path d="M8 8h10L8 18zM20 20H10l10-10z" fill="currentColor"/>',
};

function tlSvg(mod, withBusy = false) {
  return (
    '<svg class="c-traffic__svg" viewBox="0 0 28 28" aria-hidden="true">' +
    // 外圈是「描边环」，不是压在下面的实心圆：实心圆会被 body 半透明时透出来，
    // 失焦那套 alpha 灰就会叠成两倍深。r=13.5 + stroke 1 与原来 14/13 的环完全同形。
    '<circle class="c-traffic__rim" cx="14" cy="14" r="13.5"/>' +
    '<circle class="c-traffic__body" cx="14" cy="14" r="13"/>' +
    (withBusy ? '<circle class="c-traffic__dot" cx="14" cy="14" r="5"/>' : '') +
    `<g class="c-traffic__glyph">${TL_GLYPH[mod]}</g>` +
    '</svg>'
  );
}

/**
 * 窗口红绿灯。
 * @param {object} o
 * @param {boolean} [o.focused=true] 失焦时三灯统一深灰且不出图形
 * @param {boolean} [o.maximized=false] 仅用于语义记录（macOS 两态同形）
 * @param {boolean} [o.dirty=false] 有未保存修改时红灯中心显示圆点
 * @param {boolean} [o.reveal=false] 规范展示用：强制显示图形
 * @param {Function} [o.onClose]
 * @param {Function} [o.onMinimize]
 * @param {Function} [o.onZoom]
 */
export function TrafficLights({
  focused = true,
  maximized = false,
  dirty = false,
  reveal = false,
  active = false,
  onClose,
  onMinimize,
  onZoom,
} = {}) {
  let maxed = maximized;

  const mkLight = (mod, title, label, busy = false) =>
    h('button', {
      class: `c-traffic__light c-traffic__light--${mod}`,
      type: 'button',
      title,
      'aria-label': label,
      dataset: active ? { active: '1' } : {},
      html: tlSvg(mod, busy),
    });

  const closeBtn = mkLight('close', '关闭', '关闭窗口', dirty);
  closeBtn.addEventListener('click', () => onClose?.());

  const minBtn = mkLight('min', '最小化', '最小化窗口');
  minBtn.addEventListener('click', () => onMinimize?.());

  const zoomBtn = mkLight('zoom', '最大化', '最大化窗口');
  zoomBtn.addEventListener('click', () => onZoom?.());

  const el = h(
    'div',
    {
      class: 'c-traffic',
      // 契约是 0/1，不是布尔字符串：CSS 写的是 [data-focused="0"]。
      // 用 String(focused) 会得到 "true"/"false"，选择器永远不命中，失焦态静默失效。
      'data-focused': focused ? '1' : '0',
      'data-dirty': dirty ? '1' : null,
      'data-reveal': reveal ? '1' : null,
    },
    closeBtn,
    minBtn,
    zoomBtn
  );

  el.setFocused = (v) => el.setAttribute('data-focused', (focused = v) ? '1' : '0');
  el.setDirty = (v) => el.setAttribute('data-dirty', v ? '1' : null);
  el.setMaximized = (v) => {
    maxed = v; // macOS 两个方向同形，这里只记录状态
  };
  return el;
}
