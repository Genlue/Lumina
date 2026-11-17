// Golden Gate · forms/file-picker
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { applyControlState } from '../_shared/control.js';
import { createDisposer } from '../_shared/disposer.js';

/* ==========================================================================
   FilePicker

   文件选择不是「值」：File 只能由用户手势产生，没法像字符串那样从外部 set，
   所以这里不给 set()，只给 files() / setFiles() / value() 读快照、clear() 清空。
   真正的上传任务由调用方接 onFiles 自己排（需要进度/取消/重试的那些状态属于
   StatusBar，不属于本控件）；本控件只负责「选到合法的文件」并展示已选清单。

   两条校验策略：
     validateEach = true（默认）逐文件判定 —— 一批里混进一个 .exe 不该把
       另外两个合格文件一起扔掉。合格进 files，不合格进 rejected: [{ file, reason }]，
       原因写得具体（「类型不支持（.exe）」「超过 20 MB」「最多 5 个」）。
     validateEach = false 保留旧的整批语义：一个不合格整批拒收，走 onError。
       这是兼容开关，不是推荐用法。

   隐藏 input 始终复用同一个实例：每点一次新建 input，浏览器会把它当成新的
   选择上下文（权限重新问、同一文件再选不触发 change），还会散落游离节点。
   ========================================================================== */

let seq = 0;

/** 按钮文案里放得下的长度：中间省略，保住开头的辨识段和结尾的扩展名 */
function middleEllipsis(name, max = 18) {
  const s = String(name ?? '');
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function parseAccept(accept) {
  return String(accept || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** 按 accept 的三类写法匹配：扩展名 .png、通配 image/*、精确 image/png */
function matchesAccept(file, tokens) {
  if (!tokens.length) return true;
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

/** 文件名里的扩展名（小写、带点），用于「类型不支持（.exe）」这种具体文案 */
function extensionOf(name) {
  const s = String(name || '');
  const dot = s.lastIndexOf('.');
  if (dot <= 0 || dot === s.length - 1) return '';
  return s.slice(dot).toLowerCase();
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * 校验一组文件（整批语义）。FilePicker(validateEach: false) 与 DropZone 共用，
 * 保证「拖进来」和「点选」两个入口的判定不会跑偏。
 * @returns {Array<{ code:'type'|'size'|'count', message:string, file?:File }>}
 */
export function validateFiles(files, { accept = '', maxFiles = 0, maxSize = 0 } = {}) {
  const list = [...files];
  const tokens = parseAccept(accept);
  const errors = [];

  if (maxFiles > 0 && list.length > maxFiles) {
    errors.push({
      code: 'count',
      message:
        maxFiles === 1 ? '一次只能选择 1 个文件' : `一次最多选择 ${maxFiles} 个文件`,
    });
  }

  for (const file of list) {
    if (!matchesAccept(file, tokens)) {
      errors.push({ code: 'type', message: `不支持的文件类型：${file.name}`, file });
      continue;
    }
    // 超限只报一次，后面的文件不必再带同一句文案
    if (maxSize > 0 && file.size > maxSize) {
      errors.push({ code: 'size', message: `${file.name} 超过 ${formatSize(maxSize)}`, file });
    }
  }

  return errors;
}

/** 单个文件的具体原因；合格返回空串。文案要能直接念给用户听，不带文件名前缀 */
function reasonFor(file, { tokens, maxSize }) {
  if (!matchesAccept(file, tokens)) {
    const ext = extensionOf(file.name);
    return `类型不支持（${ext || '未知类型'}）`;
  }
  if (maxSize > 0 && file.size > maxSize) return `超过 ${formatSize(maxSize)}`;
  return '';
}

const codeOfReason = (reason) => {
  if (reason.startsWith('类型')) return 'type';
  if (reason.startsWith('超过')) return 'size';
  return 'count';
};

export function FilePicker({
  accept = '',
  multiple = false,
  maxFiles = 0,
  maxSize = 0,
  label = '选择文件',
  variant = '',
  disabled = false,
  validateEach = true,
  onFiles,
  onReject,
  onError,
} = {}) {
  const disposer = createDisposer();
  const errorId = `c-filepicker-err-${++seq}`;

  let selected = [];
  let rejected = [];
  let disabledNow = !!disabled;
  let disposed = false;
  let errorEl = null;
  let listEl = null;

  // 单选天然只能一个：把 multiple 折进 maxFiles，校验就只剩一套判断
  const limit = multiple ? Math.max(0, maxFiles) : 1;

  const input = h('input', { type: 'file', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  // 空 accept 不要写成 accept=""：部分浏览器会理解成「只接受空 MIME」而不是「不限」
  if (accept) input.setAttribute('accept', accept);
  input.multiple = !!multiple;
  input.disabled = disabledNow;

  const labelEl = h('span', { class: 'c-filepicker__label' }, label);
  const el = h(
    'button',
    {
      class: ['c-btn', variant ? `c-btn--${variant}` : '', 'c-filepicker'].filter(Boolean).join(' '),
      type: 'button',
    },
    h('span', { class: 'c-filepicker__glyph', 'aria-hidden': 'true', html: icon('upload', 14) }),
    labelEl
  );

  // 文件名与数量必须落在按钮上：只弹 toast 的话，用户回头看不见自己选了什么
  const paint = () => {
    if (!selected.length) {
      labelEl.textContent = label;
      el.removeAttribute('title');
      return;
    }
    if (selected.length === 1) {
      labelEl.textContent = middleEllipsis(selected[0].name);
      el.title = selected[0].name; // 截断后仍能看全名
      return;
    }
    labelEl.textContent = `已选 ${selected.length} 个文件`;
    el.title = selected.map((f) => f.name).join('\n');
  };

  /* ---------------- 已选清单 ---------------- */

  // 清单挂在按钮后面（兄弟节点），不能塞进 button：块级内容会被读进按钮名
  const ensureList = () => {
    if (!listEl) listEl = h('ul', { class: 'c-filepicker__list', 'aria-label': '已选文件' });
    if (!listEl.isConnected) el.after(listEl);
    return listEl;
  };

  function removeFile(file) {
    const at = selected.indexOf(file);
    if (at < 0) return;
    selected = selected.slice(0, at).concat(selected.slice(at + 1));
    paint();
    renderList();
    clearError();
    if (disposed) return;
    // 被删的那颗按钮已经不在文档里，焦点会掉到 body —— 交还浏览按钮
    if (document.activeElement === document.body) el.focus({ preventScroll: true });
  }

  function renderList() {
    if (!selected.length) {
      if (listEl) {
        listEl.replaceChildren();
        listEl.remove();
      }
      return;
    }
    const list = ensureList();
    list.replaceChildren(
      ...selected.map((file) =>
        h(
          'li',
          { class: 'c-filepicker__item' },
          h('span', { class: 'c-filepicker__item-name', title: file.name }, file.name),
          h('span', { class: 'c-filepicker__item-size' }, formatSize(file.size)),
          h(
            'button',
            {
              class: 'c-filepicker__remove',
              type: 'button',
              'aria-label': `移除 ${file.name}`,
              title: `移除 ${file.name}`,
              onclick: () => removeFile(file),
            },
            h('span', { class: 'c-filepicker__remove-icon', 'aria-hidden': 'true', html: icon('x', 11) })
          )
        )
      )
    );
  }

  /* ---------------- 错误行 ---------------- */

  const showErrors = (messages) => {
    if (!messages.length) return;
    if (!errorEl) {
      errorEl = h('div', { class: 'c-filepicker__error', id: errorId, role: 'alert' });
    }
    errorEl.textContent = messages.join('；');
    // 提示是按钮的兄弟节点：button 里塞块级文本会被读进按钮名，还会吃掉点击区。
    // 控件通常在用户操作后才报错，此时已挂进文档；未挂载时留着等下次再插。
    if (!errorEl.isConnected) {
      if (listEl?.isConnected) listEl.after(errorEl);
      else el.after(errorEl);
    }
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

  /* ---------------- 收文件 ---------------- */

  /**
   * @param {FileList|File[]} list
   * @param {{ silent?: boolean }} [options] silent = 不触发任何回调（setFiles 用）
   */
  function handleFiles(list, { silent = false } = {}) {
    const files = [...list];
    if (!files.length) return { files: [], rejected: [] };

    // —— 兼容路径：整批语义，一个不合格整批拒收 ——
    if (!validateEach) {
      const errors = validateFiles(files, { accept, maxFiles: limit, maxSize });
      if (errors.length) {
        showErrors(errors.map((e) => e.message));
        if (!silent) onError?.(errors);
        return { files: [], rejected: errors.map((e) => ({ file: e.file, reason: e.message })) };
      }
      selected = files;
      rejected = [];
      paint();
      renderList();
      clearError();
      if (!silent) onFiles?.(files.slice(), { rejected: [] });
      return { files: files.slice(), rejected: [] };
    }

    // —— 逐文件语义：合格的要留下，不合格的带原因退回 ——
    const tokens = parseAccept(accept);
    const accepted = [];
    const refused = [];
    for (const file of files) {
      const reason = reasonFor(file, { tokens, maxSize });
      if (reason) {
        refused.push({ file, reason });
        continue;
      }
      // 数量上限按「已经收下的合格文件」算：前面不合格的文件不占名额
      if (limit > 0 && accepted.length >= limit) {
        refused.push({ file, reason: `最多 ${limit} 个` });
        continue;
      }
      accepted.push(file);
    }

    selected = accepted;
    rejected = refused;
    paint();
    renderList();

    if (refused.length) showErrors(refused.map((item) => `${item.file.name}：${item.reason}`));
    else clearError();

    if (!silent) {
      onReject?.(refused.slice());
      onFiles?.(accepted.slice(), { rejected: refused.slice() });
      // 兼容旧回调：逐文件模式下也通知，便于沿用原来那套错误提示
      if (refused.length) {
        onError?.(
          refused.map((item) => ({
            code: codeOfReason(item.reason),
            message: `${item.file.name}：${item.reason}`,
            file: item.file,
          }))
        );
      }
    }

    return { files: accepted.slice(), rejected: refused.slice() };
  }

  disposer.on(el, 'click', () => el.open());
  disposer.on(input, 'change', () => {
    const files = input.files ? Array.from(input.files) : [];
    // 先留快照再清空：value 不清空，同一个文件再选一次不会触发 change
    input.value = '';
    handleFiles(files);
  });

  el.open = () => {
    if (disabledNow || disposed) return;
    // 构造时控件可能还没进文档，after() 会静默跳过；真要点的时候补挂一次
    if (!input.isConnected) el.after(input);
    input.click();
  };

  el.files = () => selected.slice();
  /** 被拒的文件快照；下一次选择/clear 时清空 */
  el.rejected = () => rejected.slice();
  /** 静默设定已选文件（受同一套校验约束，但不触发回调）。返回本次的收/拒结果 */
  el.setFiles = (list) => handleFiles(list ? [...list] : [], { silent: true });
  // button 自带 value 访问器，直接赋值会调原型上的 setter 把函数转成字符串；
  // 必须定义自有属性盖过它，value() 才拿得到文件名数组。
  Object.defineProperty(el, 'value', {
    configurable: true,
    value: () => selected.map((f) => f.name),
  });

  el.clear = () => {
    selected = [];
    rejected = [];
    input.value = '';
    paint();
    renderList();
    clearError();
  };

  el.setAccept = (v) => {
    accept = v || '';
    if (accept) input.setAttribute('accept', accept);
    else input.removeAttribute('accept');
  };

  el.setDisabled = (v) => {
    disabledNow = !!v;
    applyControlState(el, { disabled: disabledNow });
    input.disabled = disabledNow;
  };

  el.setInvalid = (v) => applyControlState(el, { invalid: v });

  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    disposer.dispose();
    // 只回收自己造的三个旁挂节点，按钮本身留给调用方决定怎么摘
    input.remove();
    errorEl?.remove();
    errorEl = null;
    listEl?.remove();
    listEl = null;
  };

  if (disabledNow) applyControlState(el, { disabled: true });
  el.after(input);
  return el;
}
