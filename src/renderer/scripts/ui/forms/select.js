// Golden Gate · forms/select
import { h } from '../../core/dom.js';
import { openMenu } from '../overlays/menu.js';
import { iconEl } from '../../core/icons.js';

/* ==========================================================================
   6. 下拉选择

   外观是按钮，语义是「弹出菜单 + 一组互斥选项」：
   aria-haspopup=menu、aria-expanded，选项用 menuitemradio 表达选中。
   键盘入口（↓ / Enter / Space）真能打开菜单并落到当前项，
   而不是只有鼠标能点开。
   ========================================================================== */

export function Select({
  options = [],
  value,
  onChange,
  width = 'auto',
  label = '',
  disabled = false,
  className = '',
} = {}) {
  let list = [...options];
  let current = value ?? list[0]?.value;
  if (!list.some((o) => o.value === current)) current = list[0]?.value;

  const labelEl = h('span', { class: 'l-fill', style: { textAlign: 'left' } }, '');
  // 收起时箭头朝下，展开时转正朝上 —— 一眼能看出「现在能收起」
  const chev = iconEl('chevron-up', 12);
  chev.style.transform = 'rotate(180deg)';
  chev.style.opacity = '0.5';

  const sync = () => {
    const hit = list.find((o) => o.value === current);
    labelEl.textContent = hit?.label ?? '';
    btn.setAttribute('aria-expanded', 'false');
  };

  const setOpen = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    chev.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
  };

  const open = () => {
    if (btn.disabled) return null;
    const menu = openMenu({
      anchor: btn,
      width: btn.getBoundingClientRect().width,
      label: label || '选择',
      onClose: () => setOpen(false),
      items: list.map((o) => ({
        label: o.label,
        checked: o.value === current,
        type: 'radio',
        disabled: o.disabled,
        onClick: () => {
          if (o.value === current) return;
          current = o.value;
          sync();
          onChange?.(o.value);
        },
      })),
    });
    setOpen(!!menu);
    if (menu) {
      // 打开时落在当前项上：长列表里不用从头找
      requestAnimationFrame(() => {
        const checked = menu.querySelector('.c-menu__item[aria-checked="true"]');
        const list_ = [...menu.querySelectorAll('.c-menu__item')];
        (checked ?? list_[0])?.focus({ preventScroll: true });
      });
    }
    return menu;
  };

  const btn = h(
    'button',
    {
      class: `c-btn ${className}`.trim(),
      type: 'button',
      'aria-label': label || null,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      disabled: disabled || null,
      style: { width, justifyContent: 'space-between' },
      onclick: () => {
        // openMenu 自己会判「同一枚锚点已展开 → 收起」，返回 null 表示这一次是收起
        open();
      },
      onkeydown: (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          open();
        }
      },
    },
    labelEl,
    chev
  );

  // 与其它有值控件统一：set 静默、value 读取、setOptions 换数据源
  btn.set = (v) => {
    current = v;
    sync();
  };
  btn.value = () => current;
  btn.setOptions = (next) => {
    list = [...next];
    if (!list.some((o) => o.value === current)) current = list[0]?.value;
    sync();
  };
  btn.options = () => [...list];
  btn.setDisabled = (v) => {
    btn.disabled = !!v;
    if (v) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  };
  btn.open = open;
  // 菜单由层栈接管，控件本身没有需要单独释放的资源
  btn.dispose = () => {};

  sync();
  return btn;
}
