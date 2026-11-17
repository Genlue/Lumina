// Golden Gate · content/progress-ring
import { clamp } from '../../core/dom.js';

/* ==========================================================================
   29. 环形进度 / 骨架屏
   ========================================================================== */

export function ProgressRing({ value = 0, size = '', label = '' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('class', `c-ring ${size === 'lg' ? 'c-ring--lg' : ''}`.trim());
  svg.setAttribute('role', 'progressbar');
  svg.setAttribute('aria-valuemin', '0');
  svg.setAttribute('aria-valuemax', '100');
  if (label) svg.setAttribute('aria-label', label);

  const mk = (cls) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '18');
    c.setAttribute('cy', '18');
    c.setAttribute('r', '15.9155');
    c.setAttribute('class', cls);
    return c;
  };
  svg.append(mk('c-ring__track'), mk('c-ring__bar'));

  const set = (v) => {
    const p = clamp(v, 0, 100);
    svg.style.setProperty('--v', String(p / 100));
    svg.setAttribute('aria-valuenow', String(p));
  };
  set(value);

  svg.set = set;
  svg.value = () => Number(svg.getAttribute('aria-valuenow'));
  return svg;
}
