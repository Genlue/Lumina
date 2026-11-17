// Golden Gate · navigation/nav-search
import { h } from '../../core/dom.js';
import { Field } from '../forms/field.js';

/**
 * 搜索模块（可选）—— 全局搜索的入口，只负责「找到并跳过去」。
 * 结果**内联展开**在导航栏里，不做浮层：导航栏上禁止开菜单。
 *
 *   NavSearch({
 *     placeholder: '搜索全部内容',
 *     search: (q) => [{ label: '滑块', hint: '控件陈列', onPick: () => go() }],
 *   })
 */
export function NavSearch({ placeholder = '搜索', search, onPick, className = '' } = {}) {
  const listHost = h('div', { class: 'c-navsearch__results', hidden: true });

  const paint = (q) => {
    const query = q.trim();
    listHost.replaceChildren();
    if (!query) {
      listHost.hidden = true;
      return;
    }
    const items = search?.(query) ?? [];
    listHost.hidden = false;
    if (!items.length) {
      listHost.append(h('div', { class: 'c-navsearch__empty' }, '没有匹配项'));
      return;
    }
    for (const it of items) {
      const pick = () => {
        onPick?.(it);
        field.set('');
        listHost.hidden = true;
      };
      listHost.append(
        h(
          'div',
          {
            class: 'c-navsearch__result',
            role: 'option',
            tabindex: '0',
            onclick: pick,
            onkeydown: (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                pick();
              }
            },
          },
          h('span', { class: 'l-fill' }, it.label),
          it.hint ? h('span', { class: 'c-navsearch__hint' }, it.hint) : null
        )
      );
    }
  };

  const field = Field({
    placeholder,
    icon: 'search',
    width: '100%',
    onInput: paint,
  });

  const el = h('div', { class: `c-navsearch ${className}`.trim() }, field, listHost);
  el.input = field.input;
  el.clear = () => {
    field.set('');
    listHost.hidden = true;
  };
  return el;
}
