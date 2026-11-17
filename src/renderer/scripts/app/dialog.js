// ============================================================
// Lumina · 对话框
// 全部走控件库的 Dialog：L4 玻璃（.c-glass-sheet）+ 遮罩 + 模态栈 + Esc/点外关闭。
// 不再手搓第二套 scrim —— 那样焦点、层级、关闭键都各有一套行为。
// ============================================================

import { h } from '../core/dom.js';
import { Button } from '../ui/controls/button.js';
import { Field } from '../ui/forms/field.js';
import { Dialog, confirmDialog } from '../ui/overlays/dialog.js';

let current = null;

function closeCurrent() {
  const ctl = current;
  current = null;
  ctl?.close?.();
}

/**
 * 打开一个面板（设置页的「搜索语法」这类只读说明也复用它）。
 * @returns {{ card: HTMLElement, destroy: () => void }}
 */
export function openPanel(title, bodyNode, actions, { onEscape } = {}) {
  closeCurrent();

  let done = false;
  const ctl = Dialog({
    title,
    body: bodyNode,
    actions,
    onClose: () => {
      if (current === ctl) current = null;
      if (done) return;
      done = true;
      onEscape?.();
    },
  });
  current = ctl;

  return {
    card: ctl.sheet,
    destroy: () => {
      if (current === ctl) current = null;
      done = true;
      ctl.close();
    },
  };
}

/**
 * 确认框。
 * @returns {Promise<boolean>} 点主按钮为 true
 */
export function confirm({
  title = '确认',
  body = '',
  okLabel = '确定',
  cancelLabel = '取消',
  danger = false,
} = {}) {
  closeCurrent();
  return confirmDialog({
    title,
    desc: typeof body === 'string' ? body : '',
    confirmLabel: okLabel,
    cancelLabel,
    tone: danger ? 'danger' : '',
  });
}

/**
 * 多选一（用于「删除相册：移回根目录 / 一并删除 / 取消」这类）。
 * @param {Array<{label:string, variant?:string}>} options
 * @returns {Promise<number>} 选中项下标；取消为 -1
 */
export function choose({ title = '', body = '', options = [] } = {}) {
  closeCurrent();

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      current = null;
      ctl.close();
      resolve(v);
    };

    const actions = options.map((opt, i) =>
      Button({
        label: opt.label,
        variant: opt.variant || (i === 0 ? 'primary' : ''),
        onClick: () => finish(i),
      })
    );

    const ctl = Dialog({
      title,
      body: body ? h('div', { class: 'c-subtitle' }, body) : null,
      actions,
      onClose: () => {
        if (done) return;
        done = true;
        resolve(-1);
      },
    });
    current = ctl;
  });
}

/**
 * 文本输入框。
 * @returns {Promise<string|null>} 取消为 null
 */
export function prompt({
  title = '',
  body = '',
  value = '',
  placeholder = '',
  okLabel = '确定',
  cancelLabel = '取消',
} = {}) {
  closeCurrent();

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      current = null;
      ctl.close();
      resolve(v);
    };

    const field = Field({
      value,
      placeholder,
      onEnter: (v) => finish(v || null),
    });

    const ctl = Dialog({
      title,
      body: [
        body ? h('div', { class: 'c-subtitle' }, body) : null,
        field,
      ],
      actions: [
        Button({ label: cancelLabel, variant: 'plain', onClick: () => finish(null) }),
        Button({
          label: okLabel,
          variant: 'primary',
          onClick: () => finish(field.input.value || null),
        }),
      ],
      onClose: () => {
        if (done) return;
        done = true;
        resolve(null);
      },
    });
    current = ctl;

    requestAnimationFrame(() => {
      field.input.focus();
      field.input.select();
    });
  });
}

/** 关闭当前对话框（路由切换时兜底） */
export function closeDialog() {
  closeCurrent();
}
