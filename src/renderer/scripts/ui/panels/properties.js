// Golden Gate · panels/properties
import { h } from '../../core/dom.js';

/** 属性分组：一组相关键值，标题可选 */
export function PropGroup({ title = '', children = [] } = {}) {
  return h(
    'div',
    { class: 'c-props__group' },
    title ? h('div', { class: 'c-props__title' }, title) : null,
    children
  );
}

/** 一行键值。mono 用于 ID、路径这类等宽内容 */
export function PropRow({ label = '', value = '', mono = false } = {}) {
  return h(
    'div',
    { class: 'c-props__row' },
    h('span', { class: 'c-props__label' }, label),
    h('span', { class: `c-props__value${mono ? ' is-mono' : ''}` }, value)
  );
}

/** 属性列表容器：负责组与组之间的间距 */
export function PropList({ children = [] } = {}) {
  return h('div', { class: 'c-props' }, children);
}
