// Golden Gate · overlays/dialog
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { spring } from '../../core/spring.js';
import { mountGlassLens, disposeGlassTree } from '../../core/glass-lens.js';
import { openLayer } from '../_shared/overlay.js';
import { Button } from '../controls/button.js';

/* ==========================================================================
   30. 模态
   ========================================================================== */

/* 模态栈：可以一层压一层。
   一级 = 直接盖在页面上；二级 = 盖在另一个模态上（下面那层会变暗并 inert）。
   焦点、背景隔离、Tab 循环、Esc 只关一层，全部交给 _shared/overlay 的层栈；
   这里只负责材质、结构和开关。 */
const dialogStack = [];

/** 当前打开的模态层数（0 = 没有） */
export const dialogDepth = () => dialogStack.length;

/**
 * 模态。返回控制器 `{ el, sheet, close, level, closed }`，`ctl.close()` 关闭。
 * 材质走 L4（.c-glass-sheet）—— 模态必须比它盖住的一切都实。
 *
 * 在另一个 Dialog 的 actions / body 里再调一次，就自动变成**二级弹窗**：
 * 它盖在上一级之上、四周压暗、上一级同时变暗并失去交互。
 *
 * @param {number} [o.level] 强制层级；不传则按栈深度自动算
 */
export function Dialog({
  title = '',
  desc = '',
  body = null,
  icon: ic = '',
  tone = '', // '' | 'danger'
  width = '',
  actions = null,
  closable = true,
  level = 0,
  onClose,
} = {}) {
  const depth = level > 0 ? level : dialogStack.length + 1;
  // 二级默认比一级窄一档：两层都居中，尺寸一样就会完全盖住下面那层，
  // 于是「压在谁上面」根本读不出来。窄 80px 才露出上一级的轮廓。
  const w = width || (depth > 1 ? '300px' : '');

  const sheet = h(
    'div',
    {
      class: `c-dialog c-glass-sheet ${depth > 1 ? 'c-dialog--sub' : ''}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title || '对话框',
      dataset: { level: String(depth) },
      style: w ? { '--dlg-w': w } : null,
    },
    ic || title
      ? h(
          'div',
          { class: 'c-dialog__head' },
          ic
            ? h('span', {
                class: `c-dialog__icon ${tone === 'danger' ? 'c-dialog__icon--danger' : ''}`.trim(),
                html: icon(ic, 17),
              })
            : null,
          h(
            'div',
            { class: 'l-fill' },
            title ? h('div', { class: 'c-dialog__title' }, title) : null,
            desc ? h('div', { class: 'c-dialog__desc' }, desc) : null
          )
        )
      : null,
    body ? h('div', { class: 'c-dialog__body' }, body) : null,
    actions ? h('div', { class: 'c-dialog__actions' }, actions) : null
  );

  const scrim = h(
    'div',
    {
      class: 'c-dialog-scrim',
      // 层级写在属性上，CSS 按层调遮罩浓度；z-index 每层拉开 20
      dataset: { level: String(depth) },
      style: { zIndex: String(500 + (depth - 1) * 20) },
    },
    sheet
  );

  document.body.append(scrim);
  sheet.__glassLens = mountGlassLens(sheet, { surface: 'sheet' });

  let settled = false;
  let pending; // 关闭结果（按钮点的是确定/取消，Esc 是 undefined）

  /** 只走一次：摘 DOM、出栈、通知调用方。 */
  function finalize(value) {
    if (settled) return;
    settled = true;
    const at = dialogStack.indexOf(ctl);
    if (at >= 0) dialogStack.splice(at, 1);
    disposeGlassTree(scrim);
    scrim.remove();
    onClose?.(value);
  }

  // 层栈负责：首层背景 inert、Tab 循环、Esc 只关栈顶、焦点归还与嵌套恢复。
  const layer = openLayer({
    el: sheet,
    container: scrim,
    modal: true,
    dismissible: closable,
    initialFocus: 'self',
    returnFocus: true,
    onClose: () => finalize(pending),
  });

  const ctl = {
    el: scrim,
    sheet,
    level: depth,
    /** 关闭；可传入任意结果供 onClose 读取 */
    close(value) {
      if (settled) return;
      pending = value;
      layer.close('api');
    },
    /** 已关闭？ */
    get closed() {
      return settled;
    },
  };

  dialogStack.push(ctl);

  if (closable) {
    scrim.addEventListener('pointerdown', (e) => {
      // 只有点遮罩本身（不是弹窗内部）才关；且必须是最上层
      if (e.target === scrim && layer.isTop()) ctl.close();
    });
  }

  // 入场：二级比一级起得更「远」，读起来是压在上一层之上
  const from = depth > 1 ? 0.9 : 0.96;
  sheet.style.opacity = '0';
  sheet.style.transform = `scale(${from}) translateY(6px)`;
  spring({
    from: 0,
    to: 1,
    damping: 0.9,
    response: depth > 1 ? 0.26 : 0.3,
    onUpdate: (t) => {
      sheet.style.opacity = String(t);
      sheet.style.transform = `scale(${from + (1 - from) * t}) translateY(${(1 - t) * 6}px)`;
    },
  });

  return ctl;
}

/**
 * 确认框。返回 Promise<boolean>。
 *   if (await confirmDialog({ title: '删除？', tone: 'danger' })) remove()
 */
export function confirmDialog({
  title = '确定吗？',
  desc = '',
  confirmLabel = '确定',
  cancelLabel = '取消',
  tone = '',
  icon: ic = '',
} = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const ctl = Dialog({
      title,
      desc,
      icon: ic || (tone === 'danger' ? 'trash' : 'info'),
      tone,
      actions: [
        Button({ label: cancelLabel, variant: 'plain', onClick: () => { finish(false); ctl.close(); } }),
        Button({
          label: confirmLabel,
          variant: tone === 'danger' ? 'danger' : 'primary',
          onClick: () => { finish(true); ctl.close(); },
        }),
      ],
      onClose: () => finish(false),
    });
  });
}
