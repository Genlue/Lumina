// Golden Gate · _shared/selection
import { createDisposer } from './disposer.js';

/* ==========================================================================
   集合选择模型（M2）

   List / Table / TreeView / CollectionView 共用同一套状态：
     selectedKeys  选中集（稳定 ID）
     focusedKey    键盘焦点项（与选中分离）
     anchorKey     范围选择的锚点（Shift 连选的起点）

   三条设计约束：
   1) 身份是 ID，不是索引。排序、筛选、刷新都不该改动 ID —— 也不该丢选中。
      被删除的项由调用方用 prune() 明确清掉，模型不猜。
   2) 焦点 ≠ 选中 ≠ 激活。方向键移动焦点，Space 切换选中，Enter 才是激活。
   3) 鼠标和键盘走同一组 intent（selectOnly / toggle / rangeTo），不允许两条路径各存一套状态。

   回调分工：
     onChange(keys, info)      选中集真的变了才触发
     onFocusChange(key, info)  焦点 / 锚点变了才触发（画焦点环用，不写业务状态）
   ========================================================================== */

const EMPTY = Object.freeze([]);

export function createSelection({
  mode = 'single', // 'single' | 'multiple'
  keys = EMPTY,
  selectedKeys = EMPTY,
  focusedKey = null,
  onChange,
  onFocusChange,
} = {}) {
  const disposer = createDisposer();
  const multi = mode === 'multiple';
  const normalize = (key) => (key == null ? null : String(key));
  const readKeys = (list) => (list ? [...list].map(normalize).filter((k) => k != null) : []);

  let ordered = readKeys(keys);
  /** @type {Set<string>} */
  let selected = new Set(readKeys(selectedKeys));
  let focused = ordered.includes(normalize(focusedKey)) ? normalize(focusedKey) : ordered[0] ?? null;
  let anchor = focused;
  let signature = '';

  const inOrder = (key) => ordered.indexOf(key);

  /** 按 ordered 的顺序输出；被筛掉但仍选中的项追加在末尾，保证不丢 */
  const listSelected = () => {
    const out = ordered.filter((k) => selected.has(k));
    for (const k of selected) if (!out.includes(k)) out.push(k);
    return out;
  };

  const info = (source) => ({
    selectedKeys: listSelected(),
    focusedKey: focused,
    anchorKey: anchor,
    mode,
    source,
  });

  /**
   * 统一出口：比较选中签名与焦点，分别触发两个回调。
   * @returns {{selection:boolean, focus:boolean}}
   */
  const sync = (source, { forceFocus = false } = {}) => {
    const next = listSelected();
    const nextSig = next.join('\u0000');
    const selectionChanged = nextSig !== signature;
    const focusChanged = forceFocus || nextSig !== signature;
    if (selectionChanged) {
      signature = nextSig;
      onChange?.(next, info(source));
    }
    if (focusChanged) onFocusChange?.(focused, info(source));
    return { selection: selectionChanged, focus: focusChanged };
  };

  const setSelectedRaw = (next, source, opts) => {
    selected = new Set(next);
    return sync(source, opts);
  };

  const api = {
    get mode() {
      return mode;
    },

    keys: () => [...ordered],
    selectedKeys: listSelected,
    focusedKey: () => focused,
    anchorKey: () => anchor,
    isSelected: (key) => selected.has(normalize(key)),
    size: () => selected.size,
    hasFocus: () => ordered.includes(focused),

    /** 更新可见/可导航序列；默认保留已选项（筛选隐藏不该丢选择） */
    setKeys(next) {
      ordered = readKeys(next);
      if (focused && !ordered.includes(focused)) focused = ordered[0] ?? null;
      if (anchor && !ordered.includes(anchor)) anchor = focused;
    },

    /** 明确删除已不存在的条目 */
    prune(existing) {
      const alive = new Set(readKeys(existing));
      const next = [...selected].filter((k) => alive.has(k));
      if (focused && !alive.has(focused)) focused = ordered.find((k) => alive.has(k)) ?? null;
      if (anchor && !alive.has(anchor)) anchor = focused;
      return setSelectedRaw(next, 'prune');
    },

    /** 程序化设置选中集 */
    setSelected(next, { source = 'set' } = {}) {
      return setSelectedRaw(readKeys(next), source, { forceFocus: true });
    },

    /** 设置焦点（不改变选中） */
    setFocused(key, { source = 'focus' } = {}) {
      const k = normalize(key);
      if (k && !ordered.includes(k)) return { selection: false, focus: false };
      if (focused === k) return { selection: false, focus: false };
      focused = k;
      return sync(source, { forceFocus: true });
    },

    focusFirst({ source = 'keyboard' } = {}) {
      return api.setFocused(ordered[0] ?? null, { source });
    },

    focusLast({ source = 'keyboard' } = {}) {
      return api.setFocused(ordered[ordered.length - 1] ?? null, { source });
    },

    /** 单选替换 */
    selectOnly(key, { source = 'pointer' } = {}) {
      const k = normalize(key);
      if (k == null) return { selection: false, focus: false };
      focused = k;
      anchor = k;
      return setSelectedRaw([k], source, { forceFocus: true });
    },

    toggle(key, { source = 'pointer' } = {}) {
      const k = normalize(key);
      if (k == null) return { selection: false, focus: false };
      focused = k;
      anchor = k;
      const next = new Set(selected);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return setSelectedRaw([...next], source, { forceFocus: true });
    },

    /** 从锚点到 key 的连续范围（替换原有选择） */
    rangeTo(key, { source = 'pointer' } = {}) {
      const k = normalize(key);
      if (k == null) return { selection: false, focus: false };
      const from = anchor ?? focused ?? k;
      const a = inOrder(from);
      const b = inOrder(k);
      if (a < 0 || b < 0) return api.selectOnly(k, { source });
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      focused = k;
      return setSelectedRaw(ordered.slice(lo, hi + 1), source, { forceFocus: true });
    },

    selectAll({ source = 'keyboard' } = {}) {
      if (!multi) return focused ? api.selectOnly(focused, { source }) : { selection: false, focus: false };
      return setSelectedRaw(ordered, source, { forceFocus: true });
    },

    clear({ source = 'command' } = {}) {
      return setSelectedRaw([], source, { forceFocus: true });
    },

    /** 把焦点按序列移动 steps 格；extend 时同步扩选（Shift） */
    move(steps, { extend = false, source = 'keyboard' } = {}) {
      if (!ordered.length) return null;
      const at = focused ? inOrder(focused) : -1;
      const base = at < 0 ? (steps > 0 ? -1 : ordered.length) : at;
      const next = Math.min(ordered.length - 1, Math.max(0, base + steps));
      const key = ordered[next];
      if (extend) {
        if (!anchor) anchor = ordered[at < 0 ? 0 : at];
        const a = inOrder(anchor);
        const [lo, hi] = a <= next ? [a, next] : [next, a];
        focused = key;
        setSelectedRaw(ordered.slice(lo, hi + 1), source, { forceFocus: true });
      } else if (!multi) {
        focused = key;
        anchor = key;
        setSelectedRaw([key], source, { forceFocus: true });
      } else {
        // 多选：方向键只移动焦点，Space 才改变选中
        api.setFocused(key, { source });
      }
      return key;
    },

    /** 指针意图：meta=切换，shift=范围，否则替换 */
    pointer(key, { meta = false, shift = false, source = 'pointer' } = {}) {
      const k = normalize(key);
      if (k == null) return { selection: false, focus: false };
      if (shift && anchor) return api.rangeTo(k, { source });
      if (meta && multi) return api.toggle(k, { source });
      return api.selectOnly(k, { source });
    },

    /**
     * 键盘意图。调用方决定什么时候把事件交给模型（例如输入框里不要拦）。
     * @returns {{handled:boolean, activate:boolean}}
     */
    key(e, { orientation = 'vertical', columns = 1 } = {}) {
      const mod = e.metaKey || e.ctrlKey;
      let steps = 0;

      switch (e.key) {
        case 'ArrowDown':
          steps = orientation === 'grid' ? columns : 1;
          break;
        case 'ArrowUp':
          steps = orientation === 'grid' ? -columns : -1;
          break;
        case 'ArrowRight':
          steps = orientation === 'grid' ? 1 : 0;
          break;
        case 'ArrowLeft':
          steps = orientation === 'grid' ? -1 : 0;
          break;
        case 'Home':
          api.move(-ordered.length, { extend: e.shiftKey, source: 'keyboard' });
          return { handled: true, activate: false };
        case 'End':
          api.move(ordered.length, { extend: e.shiftKey, source: 'keyboard' });
          return { handled: true, activate: false };
        case ' ':
        case 'Spacebar': {
          if (!focused) return { handled: false, activate: false };
          if (multi) api.toggle(focused, { source: 'keyboard' });
          else api.selectOnly(focused, { source: 'keyboard' });
          return { handled: true, activate: false };
        }
        case 'a':
        case 'A':
          if (!mod) return { handled: false, activate: false };
          api.selectAll({ source: 'keyboard' });
          return { handled: true, activate: false };
        case 'Enter':
          if (!focused) return { handled: false, activate: false };
          return { handled: true, activate: true };
        default:
          return { handled: false, activate: false };
      }

      if (steps === 0) return { handled: false, activate: false };
      api.move(steps, { extend: e.shiftKey, source: 'keyboard' });
      return { handled: true, activate: false };
    },

    dispose: disposer.dispose,
  };

  signature = listSelected().join('\u0000');
  return api;
}
