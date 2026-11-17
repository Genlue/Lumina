// Golden Gate · panels/sheet
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { mountGlassLens, disposeGlassTree } from '../../core/glass-lens.js';
import { openLayer, layerDepth } from '../_shared/overlay.js';
import { Button } from '../controls/button.js';

/* ==========================================================================
   49. 流程面板 Sheet

   和 Dialog 的区别不在尺寸，而在「归属」：Dialog 是一次问答，回答完就没了；
   Sheet 属于某个窗口/面板的**流程层** —— 它有标题栏（能一直看见自己在改什么）、
   可滚动的身体（内容可以很长）、固定的动作区（滚到哪儿都够得到取消/保存）。

   所以这里不复用 Dialog 的居中卡片，而是三段式结构：head / body / foot。
   遮罩、焦点、Esc、Tab 循环仍然全部交给 _shared/overlay 的层栈。

   两条关闭策略值得单独说：
   ① 提交中不关。异步提交把层临时降级成不可关闭，结束后恢复 —— 否则用户
      点一下遮罩就把写了一半的请求丢在后台，回来时状态已经对不上了。
  ② 有改动不静默丢。第一次关闭会先把焦点送回第一个改动过的输入并打上
      data-dirty，由调用方决定要不要弹确认；第二次才真的关 —— 这里不替
      调用方决定「改了就一定不能走」。

   busy 状态机（setBusy / setPending 是同一个东西的两种叫法）：
     idle ──setBusy(true)──▶ busy ──setBusy(false)──▶ idle
   busy 时同时做四件事：面板 aria-busy + data-pending、关闭钮禁用、
   **主操作按钮**文案换成 busyLabel 并打 aria-busy、其余动作禁用；层降级为不可关闭。
   自定义 actions 与默认 actions 走同一条记录表（primary / 原文案 / 原禁用态），
   所以两条路径的行为不会分叉。解除 busy 只还原「控件自己的」可用态，
   层是否可关仍由应用给的 canDismiss 决定 —— busy 是额外一道闸，不是替代品。
   ========================================================================== */

let sheetSeq = 0;

const CLOSE_REASONS = ['escape', 'outside', 'cancel', 'submit'];

/** 找最后一个非空文本节点：没有 .c-btn__label 的第三方按钮靠它换文案，图标不会被抹掉 */
function lastTextNode(node) {
  for (let i = node.childNodes.length - 1; i >= 0; i -= 1) {
    const child = node.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim()) return child;
  }
  return null;
}

export function Sheet({
  title = '',
  description = '',
  body = null,
  actions = null, // 自定义底部：Node / Node[] / [{ label, primary, variant, disabled, onClick, node }]
  owner = null, // 所属窗口/面板元素，仅用于 aria 关联与宽度参考
  width = '420px',
  submitLabel = '保存',
  cancelLabel = '取消',
  busyLabel = '保存中…', // 提交中主按钮临时文案
  canDismiss = true, // boolean 或 () => boolean
  onSubmit,
  onCancel,
  onClose,
  className = '',
} = {}) {
  const uid = `c-sheet-${++sheetSeq}`;
  const titleId = `${uid}-title`;

  /* ---------------- 结构 ---------------- */

  const closeBtn = h(
    'button',
    { class: 'c-sheet__close', type: 'button', 'aria-label': '关闭', onclick: () => close('cancel') },
    h('span', { class: 'c-sheet__close-icon', html: icon('x', 13) })
  );

  const head = h(
    'div',
    { class: 'c-sheet__head' },
    h('h2', { class: 'c-sheet__title', id: title ? titleId : null }, title || ''),
    closeBtn,
    description ? h('p', { class: 'c-sheet__desc' }, description) : null
  );

  const bodyEl = h('div', { class: 'c-sheet__body' }, body);

  /* ---------------- 动作区 ---------------- */

  // 自定义动作归一：Node、Node[] 或 { label, primary, variant, disabled, onClick, node } 描述对象。
  // 默认动作也走同一条归一流程，下面只维护一份「主操作 / 原文案 / 原禁用态」记录表，
  // 提交中的行为就不会出现「默认会换文案、自定义不会」这种分叉。
  const normalizeAction = (item) => {
    if (item && typeof item === 'object' && !(item instanceof Node)) {
      const node =
        item.node instanceof Node
          ? item.node
          : Button({
              label: item.label ?? '',
              variant: item.variant ?? (item.primary ? 'primary' : 'plain'),
              disabled: Boolean(item.disabled),
              onClick: item.onClick,
            });
      return { node, primary: item.primary === true };
    }
    return { node: item, primary: false };
  };

  const customActions = Boolean(actions);
  const submitBtn = customActions
    ? null
    : Button({ label: submitLabel, variant: 'primary', onClick: () => runSubmit() });
  const cancelBtn = customActions
    ? null
    : Button({ label: cancelLabel, variant: 'plain', onClick: () => close('cancel') });

  const actionItems = customActions
    ? (Array.isArray(actions) ? actions : [actions]).filter(Boolean).map(normalizeAction)
    : [
        { node: cancelBtn, primary: false },
        { node: submitBtn, primary: true },
      ];

  // 主操作三档兜底：显式 primary:true > 视觉主按钮 > 第一个动作。
  // 只给一个自定义按钮时也能拿到 busyLabel，不然「保存中…」就永远不出现。
  const primaryIndex = (() => {
    const explicit = actionItems.findIndex((item) => item.primary);
    if (explicit >= 0) return explicit;
    const visual = actionItems.findIndex((item) => item.node.classList?.contains('c-btn--primary'));
    return visual >= 0 ? visual : 0;
  })();

  const actionRecords = actionItems.map((item, index) => {
    const node = item.node;
    const labelEl = node.querySelector?.('.c-btn__label') ?? null;
    // 没有 .c-btn__label 的按钮改写最后一个文本节点：图标是兄弟节点，不能被 textContent 抹掉
    const textNode = labelEl ? null : lastTextNode(node);
    return {
      node,
      primary: index === primaryIndex,
      labelEl,
      textNode,
      text: labelEl ? labelEl.textContent : textNode?.nodeValue ?? '',
      ariaLabel: node.getAttribute('aria-label'),
      disabled: Boolean(node.disabled),
    };
  });

  const foot = h(
    'div',
    { class: 'c-sheet__foot' },
    actionRecords.map((record) => record.node)
  );

  /** 只换可见文案；纯图标按钮退回 aria-label，读屏至少能听到状态 */
  function applyActionText(record, text) {
    if (record.labelEl) {
      record.labelEl.textContent = text;
      return;
    }
    if (record.textNode) {
      record.textNode.nodeValue = text;
      return;
    }
    record.node.setAttribute('aria-label', text);
  }

  // owner 只做两件事：把宽度夹进宿主窗口，以及在没有标题时借宿主的名字当对话框名。
  // 它不是父节点 —— Sheet 永远挂在 body 上，否则遮罩盖不住宿主之外的区域。
  let widthValue = width || '420px';
  const ownerEl = owner instanceof HTMLElement ? owner : null;
  if (ownerEl) {
    const hostW = ownerEl.getBoundingClientRect().width;
    const px = /^([\d.]+)px$/.exec(widthValue);
    if (hostW > 0 && px) {
      widthValue = `${Math.max(240, Math.min(parseFloat(px[1]), Math.round(hostW - 24)))}px`;
    }
  }

  const sheet = h(
    'div',
    {
      class: `c-sheet c-glass-sheet ${className}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': title ? titleId : null,
      'aria-label': title ? null : ownerEl?.getAttribute('aria-label') || '流程面板',
      tabindex: '-1',
      dataset: { sheet: uid },
      style: { '--sheet-w': widthValue },
    },
    head,
    bodyEl,
    foot
  );

  // 层级与 Dialog 同一条公式：500 + (层级 - 1) * 20
  const depth = layerDepth() + 1;
  const scrim = h('div', {
    class: 'c-sheet-scrim',
    dataset: { level: String(depth) },
    style: { zIndex: String(500 + (depth - 1) * 20) },
  });
  scrim.append(sheet);
  document.body.append(scrim);

  sheet.__glassLens = mountGlassLens(sheet, { surface: 'sheet' });

  /* ---------------- 状态 ---------------- */

  let pending = false;
  let closed = false;
  let dirty = false;
  let dirtyAcknowledged = false;
  let firstDirty = null;
  const userClosable = Boolean(canDismiss);

  const layer = openLayer({
    el: sheet,
    container: scrim,
    modal: true,
    dismissible: userClosable,
    outside: userClosable,
    initialFocus: 'first',
    returnFocus: true,
    onClose: (reason) => finalize(reason),
  });

  /* ---------------- 未提交内容 ---------------- */

  // 一个委托监听就够：body 里的输入框可能随时被调用方换掉，
  // 逐个绑定会在重建后全部失效。
  bodyEl.addEventListener('input', (e) => {
    const target = e.target;
    if (!(target instanceof Element) || !target.matches('input, textarea')) return;
    dirty = true;
    if (!firstDirty || !firstDirty.isConnected) firstDirty = target;
  });

  /* ---------------- 关闭 ---------------- */

  function normalizeReason(reason) {
    return CLOSE_REASONS.includes(reason) ? reason : 'api';
  }

  function finalize(reason) {
    if (closed) return;
    closed = true;
    // 层已经出栈，这里只负责回收自己这一份：材质 → DOM → 通知调用方
    disposeGlassTree(scrim);
    scrim.remove();
    onClose?.(normalizeReason(reason));
  }

  /**
   * 关闭。reason 走层栈，最终由 onClose 收到。
   * 用户发起的三种（Esc / 点遮罩 / 取消）要先过 canDismiss 和「有改动」两道闸；
   * api / submit 是程序自己的决定，不再问。
   */
  function close(reason = 'api') {
    if (closed || pending) return;

    const user = reason === 'escape' || reason === 'outside' || reason === 'cancel';
    if (user) {
      if (canDismiss === false) return;
      if (typeof canDismiss === 'function' && !canDismiss()) return;

      if (dirty && !dirtyAcknowledged) {
        // 不静默丢弃：先把焦点送回改动处并打标，让调用方有机会弹自己的确认。
        // 第二次关闭才放行 —— 否则这里就成了「永远关不掉的表单」。
        dirtyAcknowledged = true;
        sheet.dataset.dirty = '1';
        firstDirty?.focus?.({ preventScroll: false });
        return;
      }
    }

    if (reason === 'cancel') onCancel?.();
    layer.close(reason);
  }

  /* ---------------- 提交 ---------------- */

  /** 应用自己的允许关闭判断：busy 解除后要回到它，而不是无条件 true */
  function dismissibleByApp() {
    if (canDismiss === false) return false;
    if (typeof canDismiss === 'function') return Boolean(canDismiss());
    return true;
  }

  function setBusy(next) {
    const value = Boolean(next);
    if (pending === value) return;
    pending = value;

    sheet.setAttribute('aria-busy', value ? 'true' : 'false');
    if (value) sheet.dataset.pending = '1';
    else delete sheet.dataset.pending;

    // 按钮被 disabled 的同时会把焦点丢到 body，模态层里焦点落到 body 就等于漏出去了。
    // 先把焦点收回到面板本身，再禁用。
    if (value) {
      const active = document.activeElement;
      if (active && active !== sheet && sheet.contains(active) && active.closest('.c-sheet__head, .c-sheet__foot')) {
        sheet.focus({ preventScroll: true });
      }
    }

    closeBtn.disabled = value;

    for (const record of actionRecords) {
      if (value) {
        // 主操作换文案 + aria-busy，其余动作只禁用；两者都不可再点（防重复提交）
        if (record.primary) {
          applyActionText(record, busyLabel);
          record.node.setAttribute('aria-busy', 'true');
        }
        record.node.disabled = true;
      } else {
        if (record.primary) {
          applyActionText(record, record.text);
          record.node.removeAttribute('aria-busy');
          if (!record.labelEl && !record.textNode && record.ariaLabel != null) {
            record.node.setAttribute('aria-label', record.ariaLabel);
          }
        }
        record.node.disabled = record.disabled;
      }
    }

    // 提交中把层降级成不可关闭；解除时回到「应用允许的状态」。
    // 只改 layer 不够 —— 关闭按钮和动作按钮也要一起失效，否则看上去还能点。
    layer.setDismissible(value ? false : dismissibleByApp());
  }

  // 兼容旧调用：setPending 与 setBusy 是同一条状态机
  const setPending = setBusy;

  async function runSubmit() {
    if (pending || closed) return;

    let result;
    try {
      result = onSubmit?.();
    } catch (err) {
      // 同步抛错：保持打开，错误由调用方渲染在表单里
      console.warn('[golden-gate] Sheet 提交失败', err);
      return;
    }

    if (!result || typeof result.then !== 'function') {
      close('submit');
      return;
    }

    setPending(true);
    try {
      await result;
    } catch (err) {
      // 失败不关：用户填的内容还在，重试成本最小
      setPending(false);
      console.warn('[golden-gate] Sheet 提交失败', err);
      return;
    }
    setPending(false);
    close('submit');
  }

  /* ---------------- 交互 ---------------- */

  // Esc 自己接管：层栈的 Esc 是无条件关的，而这里要先过 canDismiss 和改动检查。
  // 监听挂在 sheet 上（冒泡早于 document），并且只在自己是栈顶时处理，
  // 内层菜单/下拉的 Esc 仍然由它们先吃掉。
  sheet.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    if (!layer.isTop()) return;
    e.preventDefault();
    e.stopPropagation();
    close('escape');
  });

  // 点遮罩：只有点到的确实是遮罩本身（不是面板内部）才算 outside
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target !== scrim || !layer.isTop()) return;
    close('outside');
  });

  /* ---------------- 控制器 ---------------- */

  return {
    el: scrim,
    sheet,
    close,
    setBusy,
    setPending, // 旧名，同一条状态机
    /** busy 时换文案的那颗按钮，调用方做二次确认/埋点时用得到 */
    primaryAction: () => actionRecords.find((record) => record.primary)?.node ?? null,
    /** 控制器没有第二条释放路径：关闭就是释放，重复调用无副作用。提交中也强制收掉 */
    dispose: () => {
      if (closed) return;
      pending = false;
      close('api');
    },
    get pending() {
      return pending;
    },
    get busy() {
      return pending;
    },
    get closed() {
      return closed;
    },
  };
}
