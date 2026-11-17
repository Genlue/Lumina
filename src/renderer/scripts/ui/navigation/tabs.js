// Golden Gate · navigation/tabs
import { h } from '../../core/dom.js';
import { icon, iconEl } from '../../core/icons.js';

/* ==========================================================================
   22. 页签

   关闭钮是真按钮（能 Tab、有名字、Enter/Space 可触发）；
   传了 panel（元素或 id）就把 tabpanel 的 role / aria-labelledby 一并接好，
   并在切换时同步 hidden —— 只画一条高亮、不告诉辅助技术哪块内容在显示，
   等于只做了一半。
   ========================================================================== */

let uid = 0;

const sameTab = (a, b) =>
  a.value === b.value &&
  a.label === b.label &&
  a.icon === b.icon &&
  a.title === b.title &&
  a.disabled === b.disabled &&
  a.panel === b.panel;

/**
 * 页签栏。原型是 macOS 的文档页签。
 * @param {object} [o]
 * @param {Array<{value:string,label?:string,icon?:string,title?:string,panel?:HTMLElement|string,disabled?:boolean}>} [o.tabs]
 * @param {string} [o.value]
 * @param {(value:string) => void} [o.onChange]
 * @param {boolean} [o.closable]
 * @param {(value:string) => void} [o.onClose]
 * @param {(value:string) => string} [o.closeLabel]
 * @param {boolean} [o.draggable]
 * @param {(newTabs:Array) => void} [o.onReorder]
 * @param {string} [o.className]
 */
export function Tabs({
  tabs = [],
  value,
  onChange,
  closable = false,
  onClose,
  closeLabel,
  draggable = false,
  onReorder = null,
  className = '',
} = {}) {
  // 页签是「文档页签」：一条轨道 + 抬起来的那一颗。没有滑动指示条 ——
  // 指示条是 web 的做法，macOS 靠「抬起 / 落下」表达选中。
  const scroller = h('div', { class: 'c-tabs__scroll' });
  // 页签横向滚轮支持（上滑向左，下滑向右）
  scroller.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        scroller.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );
  const el = h('div', { class: `c-tabs ${className}`.trim(), role: 'tablist' }, scroller);

  let tabList = [...tabs];
  let current = value ?? tabList[0]?.value;

  /** 把 tab 和它的 panel 关联起来；未传 panel 就不伪造 aria-controls */
  const linkPanel = (btn, t) => {
    if (!t.panel) return null;
    const panel = typeof t.panel === 'string' ? document.getElementById(t.panel) : t.panel;
    if (!panel) return null;
    if (!panel.id) panel.id = `gg-tabpanel-${++uid}`;
    if (!btn.id) btn.id = `gg-tab-${++uid}`;
    btn.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', btn.id);
    panel.tabIndex = 0;
    return panel;
  };

  const sync = () => {
    for (const btn of scroller.querySelectorAll('.c-tabs__tab')) {
      const on = btn.dataset.value === current;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      const panel = btn._panel;
      if (panel) panel.hidden = !on;
    }
  };

  let draggedVal = null;
  let draggedBtn = null;

  const render = () => {
    scroller.innerHTML = '';
    for (const t of tabList) {
      let dragDepth = 0;
      // 页签本身用 div[role=tab]：关闭钮必须是真 <button>，
      // 而 <button> 里不能再嵌 <button>。div 上补 Enter/Space 就等价。
      const btn = h(
        'div',
        {
          class: 'c-tabs__tab',
          role: 'tab',
          title: t.title || null,
          'aria-disabled': t.disabled ? 'true' : null,
          draggable: draggable ? 'true' : null,
          dataset: { value: t.value },
          onclick: () => {
            if (t.disabled || current === t.value) return;
            current = t.value;
            sync();
            onChange?.(t.value);
          },
          onkeydown: (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target !== btn) return;
            e.preventDefault();
            if (t.disabled) return;
            if (current === t.value) return;
            current = t.value;
            sync();
            onChange?.(t.value);
          },
        },
        t.icon ? iconEl(t.icon, 13) : null,
        t.label ? h('span', null, t.label) : null,
        closable
          ? h('button', {
              class: 'c-tabs__close',
              type: 'button',
              draggable: 'false',
              'aria-label': closeLabel?.(t.value) ?? `关闭 ${t.label || t.value}`,
              title: `关闭 ${t.label || t.value}`,
              html: icon('x', 9),
              onclick: (e) => {
                e.stopPropagation();
                onClose?.(t.value);
              },
            })
          : null
      );

      const panel = linkPanel(btn, t);
      if (panel) btn._panel = panel;

      if (draggable) {
        btn.setAttribute('draggable', 'true');

        btn.addEventListener('dragstart', (e) => {
          if (e.target.closest('.c-tabs__close')) {
            e.preventDefault();
            return;
          }
          draggedVal = t.value;
          draggedBtn = btn;
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', t.value);
          }
          setTimeout(() => {
            if (draggedBtn === btn) {
              btn.classList.add('is-dragging');
            }
          }, 0);
        });

        btn.addEventListener('dragenter', (e) => {
          if (!draggedVal || draggedVal === t.value) return;
          e.preventDefault();
          dragDepth++;
          btn.classList.add('is-dragover');
        });

        btn.addEventListener('dragover', (e) => {
          if (!draggedVal || draggedVal === t.value) return;
          e.preventDefault();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
          }
        });

        btn.addEventListener('dragleave', () => {
          if (!draggedVal || draggedVal === t.value) return;
          dragDepth--;
          if (dragDepth <= 0) {
            dragDepth = 0;
            btn.classList.remove('is-dragover');
          }
        });

        btn.addEventListener('drop', (e) => {
          e.preventDefault();
          dragDepth = 0;
          btn.classList.remove('is-dragover');
          if (!draggedVal || draggedVal === t.value) return;

          const fromIdx = tabList.findIndex((item) => item.value === draggedVal);
          const toIdx = tabList.findIndex((item) => item.value === t.value);

          if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
            const [moved] = tabList.splice(fromIdx, 1);
            tabList.splice(toIdx, 0, moved);
            render();
            onReorder?.([...tabList]);
          }
        });

        btn.addEventListener('dragend', () => {
          btn.classList.remove('is-dragging');
          for (const b of scroller.querySelectorAll('.c-tabs__tab')) {
            b.classList.remove('is-dragover');
          }
          draggedVal = null;
          draggedBtn = null;
          dragDepth = 0;
        });
      }

      scroller.append(btn);
    }
    sync();
  };

  render();

  // 左右方向键在页签间移动；Home/End 到两端
  el.addEventListener('keydown', (e) => {
    const list = [...scroller.querySelectorAll('.c-tabs__tab')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;

    let next = null;
    if (e.key === 'ArrowLeft') next = list[(i + list.length - 1) % list.length];
    else if (e.key === 'ArrowRight') next = list[(i + 1) % list.length];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    if (!next) return;

    e.preventDefault();
    next.click();
    next.focus();
  });

  el.set = (v) => {
    current = v;
    sync();
  };
  el.value = () => current;
  el.setTabs = (newTabs) => {
    const nextList = Array.isArray(newTabs) ? [...newTabs] : [];
    // 比较完整视图数据：只比 value/label 会让图标、标题、禁用态、panel 的变更不重绘
    const isSame = nextList.length === tabList.length && nextList.every((t, i) => sameTab(t, tabList[i] ?? {}));

    tabList = nextList;
    if (!tabList.some((t) => t.value === current)) {
      current = tabList[0]?.value ?? null;
      onChange?.(current);
    }
    if (!isSame) {
      render();
    } else {
      sync();
    }
  };
  el.addTab = (tab) => {
    if (!tab || typeof tab !== 'object' || !tab.value) return;
    const existing = tabList.findIndex((t) => t.value === tab.value);
    if (existing >= 0) {
      tabList[existing] = tab;
    } else {
      tabList.push(tab);
    }
    if (current == null) {
      current = tab.value;
      onChange?.(current);
    }
    render();
  };
  el.removeTab = (val) => {
    const idx = tabList.findIndex((t) => t.value === val);
    if (idx < 0) return;
    tabList.splice(idx, 1);
    if (current === val) {
      current = tabList[idx]?.value ?? tabList[idx - 1]?.value ?? null;
      onChange?.(current);
    }
    render();
  };
  el.tabs = () => [...tabList];
  el.dispose = () => {};
  return el;
}
