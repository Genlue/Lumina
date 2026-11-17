// Golden Gate · content/list
import { h } from '../../core/dom.js';
import { icon, iconEl } from '../../core/icons.js';
import { createSelection } from '../_shared/selection.js';

/* ==========================================================================
   20. 列表
   —— 桌面应用里出现频率最高的控件。以前这套库只有「照片格子」，
      于是任何非相册的页面都得手写列表 —— 这是最大的泛化缺口。

   可选中列表（selectable）走共享选择模型：
   roving tabindex（只有焦点行在 Tab 序列里）、Shift 连选、Cmd/Ctrl 切换、
   方向键移动、Space 切换、Enter 激活。以前每行都 tabindex=0，
   一个 30 行的列表要按 30 次 Tab 才能穿过去。
   ========================================================================== */

/**
 * @param {object} o
 * @param {''|'inset'|'flush'} [o.variant] inset = 圆角卡里的分组列表
 * @param {boolean} [o.selectable] 开启选择模型
 * @param {boolean} [o.multiple] 多选
 * @param {(keys:string[], info:object)=>void} [o.onSelectionChange]
 * @param {(key:string, row:HTMLElement)=>void} [o.onActivate]
 */
export function List({
  children,
  variant = '',
  className = '',
  label = '列表',
  selectable = false,
  multiple = false,
  onSelectionChange,
  onActivate,
} = {}) {
  const el = h(
    'div',
    {
      class: `c-list ${variant ? `c-list--${variant}` : ''} ${className}`.trim(),
      role: 'listbox',
      'aria-label': label,
      'aria-multiselectable': multiple ? 'true' : null,
    },
    children
  );

  if (!selectable) return el;

  const rows = () => [...el.querySelectorAll('.c-list__row[data-key]')];
  const keys = () => rows().map((row) => row.dataset.key);

  const sync = () => {
    const focused = sel.focusedKey();
    for (const row of rows()) {
      const key = row.dataset.key;
      row.setAttribute('aria-selected', String(sel.isSelected(key)));
      row.tabIndex = key === focused ? 0 : -1;
      row.dataset.focused = key === focused ? '1' : '0';
    }
  };

  const sel = createSelection({
    mode: multiple ? 'multiple' : 'single',
    keys: keys(),
    focusedKey: keys()[0] ?? null,
    onChange: (selected, info) => {
      sync();
      onSelectionChange?.(selected, info);
    },
    onFocusChange: sync,
  });
  el.selection = sel;

  const keyOf = (node) => node?.closest?.('.c-list__row[data-key]')?.dataset.key ?? null;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const key = keyOf(e.target);
    if (key == null) return;
    // 点在行内按钮/复选框上时不抢选择，交给控件自己
    if (e.target.closest('button,a,input,select,textarea')) return;
    sel.pointer(key, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
  });

  el.addEventListener('click', (e) => {
    const key = keyOf(e.target);
    if (key == null) return;
    if (e.target.closest('button,a,input,select,textarea')) return;
    if (e.detail === 2) onActivate?.(key, e.target.closest('.c-list__row'));
  });

  el.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('.c-list__row');
    if (!row || !el.contains(row)) return;
    const result = sel.key(e, { orientation: 'vertical' });
    if (!result.handled) return;
    e.preventDefault();
    sync();
    rows().find((r) => r.dataset.key === sel.focusedKey())?.scrollIntoView({ block: 'nearest' });
    if (result.activate) onActivate?.(sel.focusedKey(), row);
  });

  el.syncSelection = () => {
    sel.setKeys(keys());
    sync();
  };
  el.dispose = () => sel.dispose();

  sync();
  return el;
}

/**
 * 一行。
 * leading 优先级：media（自定义节点）> avatar > icon。
 * 有 onClick 才变成可交互行，否则就是纯展示 —— 不给没有行为的东西加 hover。
 */
export function ListRow({
  icon: ic = '',
  avatar = null,
  media = null,
  title = '',
  subtitle = '',
  meta = '',
  trailing = null,
  chevron = false,
  selected = false,
  key = '',
  onClick,
  className = '',
} = {}) {
  const leading = media
    ? h('div', { class: 'c-list__leading' }, media)
    : avatar
      ? avatar
      : ic
        ? h('div', { class: 'c-list__leading' }, h('span', { class: 'c-list__icon', html: icon(ic, 16) }))
        : null;

  return h(
    'div',
    {
      class: `c-list__row ${onClick ? 'c-list__row--interactive' : ''} ${className}`.trim(),
      role: 'option',
      'aria-selected': String(selected),
      dataset: key !== '' ? { key: String(key) } : null,
      tabindex: onClick ? '0' : null,
      onclick: onClick,
      onkeydown: onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick(e);
            }
          }
        : null,
    },
    leading,
    h(
      'div',
      { class: 'c-list__body' },
      h('div', { class: 'c-list__title' }, title),
      subtitle ? h('div', { class: 'c-list__subtitle' }, subtitle) : null
    ),
    meta ? h('div', { class: 'c-list__meta' }, meta) : null,
    trailing || chevron
      ? h(
          'div',
          { class: 'c-list__trailing' },
          trailing,
          chevron ? iconEl('chevron-right', 13) : null
        )
      : null
  );
}

/** 列表里的分组小标题 */
export const ListHeader = (label) => h('div', { class: 'c-list__header', role: 'presentation' }, label);
