// Golden Gate · content/skeleton
import { h } from '../../core/dom.js';

/**
 * 骨架屏。lines > 1 时返回一组文本行（最后一根短一截），否则返回单块。
 * 知道大概长什么样才用它；不知道就用 Spinner。
 */
export function Skeleton({ width = '100%', height = '12px', lines = 0, circle = false, className = '' } = {}) {
  const one = (w, ht, extra = '') =>
    h('div', {
      class: `c-skeleton ${circle ? 'c-skeleton--circle' : ''} ${extra} ${className}`.trim(),
      style: { width: w, height: ht },
    });

  if (lines <= 1) return one(width, height, 'c-skeleton--text');
  return h(
    'div',
    { class: 'l-stack l-stack--3', style: { width } },
    Array.from({ length: lines }, (_, i) =>
      one(i === lines - 1 ? '62%' : '100%', height, 'c-skeleton--text')
    )
  );
}
