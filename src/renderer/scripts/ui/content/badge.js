// Golden Gate · content/badge
import { h } from '../../core/dom.js';
import { iconEl } from '../../core/icons.js';

/* ==========================================================================
   11. 徽标 / 胶囊
   ========================================================================== */

export function Badge({ label, variant = '', icon: ic = '' } = {}) {
  return h(
    'span',
    { class: `c-badge ${variant ? `c-badge--${variant}` : ''}`.trim() },
    ic ? iconEl(ic, 11) : null,
    label
  );
}
