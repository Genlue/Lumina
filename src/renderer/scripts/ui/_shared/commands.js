// Golden Gate · _shared/commands
import { createDisposer } from './disposer.js';

/* ==========================================================================
   命令与撤销（M4）

   工具栏、菜单、右键菜单、命令搜索、快捷键共用一份命令定义 ——
   而不是每个入口各存一份 label / enabled / checked。

   分工：
     CommandRegistry  定义 + 快捷键派发 + 状态广播
     UndoManager      事务栈 + 连续输入合并 + 选择/焦点快照

   注意：命令里的 `key` 文本只是展示。真正注册快捷键必须走 keydown，
   并且先判断焦点是否在文本输入里 —— 否则 ⌘Z 会把输入框自己的撤销吃掉。
   ========================================================================== */

const isMacPlatform = () =>
  /Mac|iPhone|iPad|iPod/i.test(
    globalThis.navigator?.platform || globalThis.navigator?.userAgent || ''
  );

const MODIFIER_ALIASES = new Map([
  ['mod', 'mod'],
  ['cmd', 'meta'],
  ['command', 'meta'],
  ['meta', 'meta'],
  ['ctrl', 'ctrl'],
  ['control', 'ctrl'],
  ['alt', 'alt'],
  ['option', 'alt'],
  ['opt', 'alt'],
  ['shift', 'shift'],
]);

const KEY_ALIASES = new Map([
  ['esc', 'Escape'],
  ['escape', 'Escape'],
  ['del', 'Delete'],
  ['delete', 'Delete'],
  ['backspace', 'Backspace'],
  ['enter', 'Enter'],
  ['return', 'Enter'],
  ['space', ' '],
  ['up', 'ArrowUp'],
  ['down', 'ArrowDown'],
  ['left', 'ArrowLeft'],
  ['right', 'ArrowRight'],
  ['plus', '+'],
]);

/** 把 'Mod+Shift+Z' 解析成按键组合 */
function parseShortcut(text) {
  if (!text) return null;
  const parts = String(text)
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const combo = { mod: false, meta: false, ctrl: false, alt: false, shift: false, key: '' };
  for (const raw of parts) {
    const lower = raw.toLowerCase();
    const mod = MODIFIER_ALIASES.get(lower);
    if (mod) combo[mod] = true;
    else combo.key = KEY_ALIASES.get(lower) ?? raw;
  }
  if (!combo.key) return null;
  return combo;
}

function comboKey(combo) {
  const mods = ['mod', 'meta', 'ctrl', 'alt', 'shift'].filter((m) => combo[m]).join('|');
  return `${mods}::${combo.key.length === 1 ? combo.key.toLowerCase() : combo.key}`;
}

function comboFromEvent(e, mac = isMacPlatform()) {
  const combo = {
    mod: mac ? e.metaKey : e.ctrlKey,
    meta: mac ? false : e.metaKey,
    ctrl: mac ? false : e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    key: e.key,
  };
  // Mod 与显式修饰键互斥，避免同一快捷键在 mac 上被匹配两次
  if (combo.mod) {
    if (mac) combo.meta = false;
    else combo.ctrl = false;
  }
  return combo;
}

const TEXT_ENTRY = 'input,textarea,select,[contenteditable="true"],[contenteditable=""]';

function isTextEntry(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  const el = target.closest(TEXT_ENTRY);
  if (!el) return false;
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'].includes(
      el.type
    );
  }
  return true;
}

const pick = (value, ...args) => (typeof value === 'function' ? value(...args) : value);

/**
 * 命令注册表。
 * @param {{ platform?: 'mac'|'other' }} [o]
 */
export function CommandRegistry({ platform } = {}) {
  const disposer = createDisposer();
  const mac = platform ? platform === 'mac' : isMacPlatform();
  /** @type {Map<string, object>} */
  const commands = new Map();
  /** @type {Map<string, string>} */
  const shortcuts = new Map();
  const listeners = new Set();

  const notify = (id) => {
    for (const fn of listeners) fn(id, commands.get(id));
  };

  const bindShortcut = (id, shortcut) => {
    // 先摘掉该命令的旧快捷键
    for (const [combo, owner] of [...shortcuts]) if (owner === id) shortcuts.delete(combo);
    const parsed = parseShortcut(shortcut);
    if (parsed) shortcuts.set(comboKey(parsed), id);
  };

  const api = {
    mac,

    /** @returns {() => void} 注销句柄 */
    register(def) {
      if (!def?.id) throw new Error('命令需要 id');
      const command = {
        id: def.id,
        label: def.label ?? def.id,
        shortcut: def.shortcut ?? '',
        group: def.group ?? '',
        scope: def.scope ?? '',
        enabled: def.enabled ?? true,
        checked: def.checked,
        run: def.run ?? (() => {}),
      };
      commands.set(command.id, command);
      if (command.shortcut) bindShortcut(command.id, command.shortcut);
      notify(command.id);
      return () => api.unregister(command.id);
    },

    unregister(id) {
      if (!commands.has(id)) return;
      commands.delete(id);
      for (const [combo, owner] of [...shortcuts]) if (owner === id) shortcuts.delete(combo);
      notify(id);
    },

    get: (id) => commands.get(id) ?? null,
    list: () => [...commands.values()],

    /** 当前可用性 / 勾选状态（支持函数式） */
    isEnabled: (id, ...args) => {
      const c = commands.get(id);
      return !!c && pick(c.enabled, ...args) !== false;
    },
    isChecked: (id, ...args) => {
      const c = commands.get(id);
      return c ? !!pick(c.checked, ...args) : false;
    },

    setEnabled(id, value) {
      const c = commands.get(id);
      if (!c) return;
      c.enabled = value;
      notify(id);
    },

    setChecked(id, value) {
      const c = commands.get(id);
      if (!c) return;
      c.checked = value;
      notify(id);
    },

    /** 同一个 id 的所有入口（工具栏 / 菜单 / 快捷键）走这一条 */
    run(id, ...args) {
      const c = commands.get(id);
      if (!c) return false;
      if (pick(c.enabled, ...args) === false) return false;
      c.run(...args);
      return true;
    },

    /** 订阅状态变化；返回解绑函数 */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * 处理一次 keydown。返回是否消费了事件。
     * @param {KeyboardEvent} e
     * @param {{ scope?: string }} [o]
     */
    keydown(e, { scope = '' } = {}) {
      if (e.defaultPrevented || e.isComposing || e.key === 'Process') return false;
      const combo = comboFromEvent(e, mac);
      const id = shortcuts.get(comboKey(combo));
      if (!id) return false;

      const c = commands.get(id);
      if (!c) return false;
      // 作用域：命令声明了 scope 就必须在对应上下文里
      if (c.scope && c.scope !== scope) return false;
      // 纯按键（无修饰）在文本输入里一律不拦，交给输入框自己
      const hasModifier = combo.mod || combo.meta || combo.ctrl || combo.alt;
      if (!hasModifier && isTextEntry(e.target)) return false;
      if (pick(c.enabled, e) === false) return false;

      e.preventDefault();
      c.run(e);
      return true;
    },

    dispose() {
      listeners.clear();
      commands.clear();
      shortcuts.clear();
      disposer.dispose();
    },
  };

  return api;
}

/**
 * 撤销栈。push 时事务已经由调用方执行完毕；apply 只用于 redo。
 *
 * @example
 * const undo = UndoManager();
 * const before = rows.slice();
 * rows.splice(2, 1);
 * undo.push({ label: '删除行', revert: () => { rows = before; }, apply: () => { rows.splice(2,1); } });
 */
export function UndoManager({ limit = 100, coalesceMs = 600, onChange } = {}) {
  /** @type {Array<object>} */
  let undoStack = [];
  /** @type {Array<object>} */
  let redoStack = [];
  const listeners = new Set();

  const emit = (kind) => {
    for (const fn of listeners) fn(api.state(), kind);
    onChange?.(api.state(), kind);
  };

  const api = {
    /**
     * @param {object} entry
     * @param {string} entry.label
     * @param {Function} entry.revert 回到事务前
     * @param {Function} [entry.apply] 重做（缺省表示不可重做）
     * @param {string} [entry.coalesceKey] 相同 key 且在合并窗口内 → 合成一次
     * @param {any} [entry.selection] 选择快照，撤销时由应用恢复
     * @param {any} [entry.focus] 焦点快照
     */
    push(entry) {
      if (!entry || typeof entry.revert !== 'function') throw new Error('事务需要 revert');
      const now = Date.now();
      const top = undoStack[undoStack.length - 1];
      const mergeable =
        !!entry.coalesceKey &&
        !!top &&
        top.coalesceKey === entry.coalesceKey &&
        now - top.time <= coalesceMs;

      if (mergeable) {
        // 连续的同类输入合成一次：revert 保留最早的，apply 取最新的
        top.apply = entry.apply ?? top.apply;
        top.time = now;
        top.label = entry.label ?? top.label;
        top.selection = entry.selection ?? top.selection;
        top.focus = entry.focus ?? top.focus;
      } else {
        undoStack.push({ ...entry, time: now });
        if (undoStack.length > limit) undoStack.shift();
      }
      redoStack = [];
      emit('push');
    },

    /** 执行 + 记录一步（apply 失败则不压栈） */
    run(entry) {
      entry.apply?.();
      api.push(entry);
    },

    undo() {
      const entry = undoStack.pop();
      if (!entry) return null;
      entry.revert?.();
      redoStack.push(entry);
      emit('undo');
      return entry;
    },

    redo() {
      const entry = redoStack.pop();
      if (!entry) return null;
      entry.apply?.();
      undoStack.push(entry);
      emit('redo');
      return entry;
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack[undoStack.length - 1]?.label ?? '',
    redoLabel: () => redoStack[redoStack.length - 1]?.label ?? '',

    state: () => ({
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoLabel: undoStack[undoStack.length - 1]?.label ?? '',
      redoLabel: redoStack[redoStack.length - 1]?.label ?? '',
      depth: undoStack.length,
    }),

    /** 订阅栈状态；返回解绑 */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    clear() {
      undoStack = [];
      redoStack = [];
      emit('clear');
    },
  };

  return api;
}
