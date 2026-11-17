// Golden Gate · surfaces/card
import { h } from '../../core/dom.js';

/* ==========================================================================
   8. 表面：卡片 / 行 / 分节
   ========================================================================== */

export function Card({ children, className = '' } = {}) {
  return h('section', { class: `c-card ${className}`.trim() }, children);
}

export function CardGroup({ title, children } = {}) {
  return h(
    'section',
    { class: 'l-stack l-stack--3' },
    title ? h('div', { class: 'c-section' }, title) : null,
    h('div', { class: 'c-card' }, children)
  );
}
