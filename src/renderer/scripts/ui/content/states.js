// Golden Gate · content/states
import { h, clamp } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

/* ==========================================================================
   12. 空状态 / 加载 / 进度
   ========================================================================== */

/** 空状态。默认图标是「空框」而不是「相册」—— 空列表、空搜索、空文件夹都用它 */
export function Empty({ icon: ic = 'square-dashed', title = '', desc = '', action = null } = {}) {
  return h(
    'div',
    { class: 'c-empty' },
    h('span', { class: 'c-empty__icon', html: icon(ic, 32) }),
    title ? h('div', { class: 'c-empty__title' }, title) : null,
    desc ? h('div', { class: 'c-empty__desc' }, desc) : null,
    action
  );
}

/** 转圈。给一个名字，避免读屏只报「进度条」 */
export const Spinner = ({ label = '加载中' } = {}) =>
  h('span', { class: 'c-spinner', role: 'status', 'aria-label': label });

/**
 * 进度条。
 * - 有确定总量：aria-valuemin/max/now 三个都要有，值是归一化后的数字
 * - 不知道总量：indeterminate，去掉 aria-valuenow，只报「进行中」
 *   —— 不要拿一个会来回跳的假百分比冒充进度
 */
export function Progress({ value = 0, max = 100, label = '', indeterminate = false } = {}) {
  const bar = h('div', { class: 'c-progress__bar' });
  let current = clamp(Number(value), 0, max);

  const el = h(
    'div',
    {
      class: 'c-progress',
      role: 'progressbar',
      'aria-label': label || null,
      'aria-valuemin': '0',
      'aria-valuemax': String(max),
    },
    bar
  );

  const set = (v) => {
    current = clamp(Number(v), 0, max);
    el.setAttribute('aria-valuenow', String(current));
    el.removeAttribute('data-indeterminate');
    el.removeAttribute('aria-valuetext');
    bar.style.width = `${(current / (max || 1)) * 100}%`;
    return current;
  };

  el.set = set;
  el.value = () => current;
  el.setIndeterminate = (on = true) => {
    if (on) {
      el.setAttribute('data-indeterminate', '1');
      el.removeAttribute('aria-valuenow');
      el.setAttribute('aria-valuetext', '进行中');
      bar.style.width = '100%';
    } else {
      set(current);
    }
  };
  el.dispose = () => {};

  if (indeterminate) el.setIndeterminate(true);
  else set(value);

  return el;
}
