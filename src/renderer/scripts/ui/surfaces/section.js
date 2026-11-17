// Golden Gate · surfaces/section
import { h } from '../../core/dom.js';

export function SectionTitle({ children }) {
  return h('div', { class: 'c-section' }, children);
}

export function Divider() {
  return h('div', { class: 'c-divider' });
}
