// Golden Gate · forms/drop-zone
import { h } from '../../core/dom.js';
import { applyControlState } from '../_shared/control.js';
import { createDisposer } from '../_shared/disposer.js';
import { validateFiles } from './file-picker.js';

/* ==========================================================================
   DropZone

   拖放的高亮靠计数器，不靠「进入 / 离开」这一对事件：指针划过区域里的文字、
   按钮都会各发一次 dragenter/dragleave，只看单次事件的话高亮会一路闪。
   只有 dragDepth 归零才算真的离开。

   区域是 div（里面还要放一个真按钮），所以点击是鼠标的快捷方式，
   键盘入口交给 .c-dropzone__browse —— 不给 div 加 tabindex 冒充按钮。
   ========================================================================== */

let seq = 0;

/** dataTransfer.types 在不同浏览器里是数组或 DOMStringList，统一转数组 */
function hasFiles(e) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

export function DropZone({
  accept = '',
  multiple = true,
  maxFiles = 0,
  maxSize = 0,
  disabled = false,
  label = '把文件拖到这里',
  hint = '或点击选择文件',
  children = null,
  onFiles,
  onError,
  onDragStateChange,
} = {}) {
  const disposer = createDisposer();
  const errorId = `c-dropzone-err-${++seq}`;

  let depth = 0;
  let state = 'idle';
  let disabledNow = !!disabled;
  let disposed = false;
  let errorEl = null;

  const limit = multiple ? Math.max(0, maxFiles) : 1;

  const input = h('input', { type: 'file', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  if (accept) input.setAttribute('accept', accept);
  input.multiple = !!multiple;
  input.disabled = disabledNow;

  const browse = h(
    'button',
    { class: 'c-btn c-btn--sm c-dropzone__browse', type: 'button' },
    '浏览'
  );

  const el = h('div', {
    class: 'c-dropzone',
    role: 'group',
    'aria-label': label || '拖放文件',
  });
  el.dataset.state = disabledNow ? 'disabled' : 'idle';
  if (disabledNow) state = 'disabled';

  if (children) el.append(children);
  else {
    el.append(
      h('div', { class: 'c-dropzone__label' }, label),
      hint ? h('div', { class: 'c-dropzone__hint' }, hint) : null
    );
  }
  el.append(browse);

  const setState = (next) => {
    if (state === next) return;
    state = next;
    el.dataset.state = next;
    // 对外只暴露两态：禁用不是「拖拽状态」，不该让调用方去处理第三种值
    onDragStateChange?.(next === 'over' ? 'over' : 'idle');
  };

  const resetDrag = () => {
    depth = 0;
    if (!disabledNow) setState('idle');
  };

  const showErrors = (errors) => {
    if (!errors.length) {
      clearError();
      return;
    }
    if (!errorEl) {
      errorEl = h('div', { class: 'c-dropzone__error', id: errorId, role: 'alert' });
    }
    errorEl.textContent = errors.map((e) => e.message).join('；');
    // 错误提示放在虚线框外：塞进去会被当成「拖到这里」的一部分，读屏也会连着念
    if (!errorEl.isConnected) el.after(errorEl);
    el.setAttribute('aria-describedby', errorId);
    applyControlState(el, { invalid: true });
  };

  function clearError() {
    if (errorEl) {
      errorEl.remove();
      errorEl = null;
    }
    el.removeAttribute('aria-describedby');
    applyControlState(el, { invalid: false });
  }

  const handleFiles = (list) => {
    const files = [...list];
    if (!files.length) return;

    const errors = validateFiles(files, { accept, maxFiles: limit, maxSize });
    if (errors.length) {
      showErrors(errors);
      onError?.(errors);
      return;
    }

    clearError();
    onFiles?.(files.slice());
  };

  disposer.on(el, 'dragenter', (e) => {
    if (disabledNow || !hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    setState('over');
  });

  disposer.on(el, 'dragover', (e) => {
    if (disabledNow || !hasFiles(e)) return;
    // 不 preventDefault 浏览器既不认这里是放置目标，也不会派发 drop
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    // 少数浏览器先给 dragover 后给 dragenter，这里补一次计数，免得随后 dragleave 直接穿到负数
    if (depth === 0) depth = 1;
    setState('over');
  });

  disposer.on(el, 'dragleave', () => {
    if (disabledNow) return;
    depth -= 1;
    if (depth <= 0) resetDrag();
  });

  disposer.on(el, 'drop', (e) => {
    if (disabledNow) return;
    if (!hasFiles(e)) {
      resetDrag();
      return;
    }
    e.preventDefault(); // 不拦的话浏览器会把文件当导航目标直接打开
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    resetDrag(); // 先归零：无论校验成败，over 态都必须收掉
    handleFiles(files);
  });

  // 拖到窗口外松手时区域收不到 dragleave，靠窗口级事件兜底
  disposer.on(window, 'dragend', resetDrag);
  disposer.on(window, 'drop', resetDrag);

  // 鼠标点整个区域等于点「浏览」；按钮自己的 click 也冒泡到这里，只开一次
  disposer.on(el, 'click', () => el.open());

  disposer.on(input, 'change', () => {
    const files = input.files ? Array.from(input.files) : [];
    // 清空 value 后，同一文件再次选择仍会触发 change
    input.value = '';
    handleFiles(files);
  });

  el.open = () => {
    if (disabledNow || disposed) return;
    if (!input.isConnected) el.after(input);
    input.click();
  };

  el.setDisabled = (v) => {
    const wasOver = state === 'over';
    disabledNow = !!v;
    depth = 0;
    state = disabledNow ? 'disabled' : 'idle';
    el.dataset.state = state;
    el.setAttribute('aria-disabled', String(disabledNow));
    applyControlState(browse, { disabled: disabledNow });
    input.disabled = disabledNow;
    // 只有真的从 over 收掉才通知，否则每次切禁用都会播一遍 idle
    if (wasOver) onDragStateChange?.('idle');
  };

  el.setInvalid = (v) => applyControlState(el, { invalid: v });

  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    disposer.dispose();
    input.remove();
    errorEl?.remove();
    errorEl = null;
  };

  if (disabledNow) {
    el.setAttribute('aria-disabled', 'true');
    applyControlState(browse, { disabled: true });
  }
  el.after(input);
  return el;
}
