// Golden Gate · content/inline-message
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { createDisposer } from '../_shared/disposer.js';
import { Button } from '../controls/button.js';

/* ==========================================================================
   54. 行内消息

   和 Toast 的分工：Toast 是「刚才发生了一件事」的瞬时反馈，行内消息是
   「这块内容现在处于某种状态」的持久说明。所以它不自动消失、不浮在别处，
   就待在出问题的任务旁边 —— 表单提交失败、列表加载出错、离线提示。

   语义按「要不要打断」分三档，而不是按颜色：
     role=note    live=off     纯说明，读屏不主动播报
     role=status  live=polite  状态变化，等当前朗读结束再说
     role=alert   危险 / 强提醒 立刻打断
   role=alert 自带 assertive，再写 aria-live 反而会双重播报。
   ========================================================================== */

const TONE_ICON = {
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'x-circle',
};

const roleOf = (tone, live) => {
  if (live === 'off') return 'note';
  if (tone === 'danger' || live === 'assertive') return 'alert';
  return 'status';
};

export function InlineMessage({
  tone = 'info',
  title = '',
  description = '',
  actions = [],
  live = 'polite',
  dismissible = false,
  onDismiss,
  icon: iconOverride,
} = {}) {
  const disposer = createDisposer();

  const state = { tone, title, description };
  let dismissed = false;

  const iconEl = h('span', { class: 'c-inline__icon', 'aria-hidden': 'true' });
  const titleEl = h('div', { class: 'c-inline__title' });
  const descEl = h('div', { class: 'c-inline__desc' });
  const actionsEl = h('div', { class: 'c-inline__actions' });

  const el = h(
    'div',
    {
      class: 'c-inline',
      role: roleOf(state.tone, live),
      // role=alert 已经隐含 assertive，不能再叠 aria-live
      'aria-live': roleOf(state.tone, live) === 'alert' ? null : live === 'off' ? null : live,
    },
    iconEl,
    h('div', { class: 'c-inline__body' }, titleEl, descEl, actionsEl),
    dismissible
      ? h('button', {
          class: 'c-inline__close',
          type: 'button',
          'aria-label': '关闭',
          html: icon('x', 12),
          onclick: () => el.dismiss(),
        })
      : null
  );

  const paint = () => {
    const current = TONE_ICON[state.tone] ? state.tone : 'info';
    el.className = `c-inline c-inline--${current}`;
    iconEl.innerHTML = icon(iconOverride || TONE_ICON[current], 16);

    titleEl.textContent = state.title || '';
    titleEl.hidden = !state.title;
    descEl.textContent = state.description || '';
    descEl.hidden = !state.description;

    const role = roleOf(current, live);
    el.setAttribute('role', role);
    if (role === 'alert' || live === 'off') el.removeAttribute('aria-live');
    else el.setAttribute('aria-live', live);
  };

  if (actions.length) {
    for (const action of actions) {
      actionsEl.append(
        Button({
          label: action.label ?? '',
          variant: action.variant ?? '',
          size: 'sm',
          disabled: !!action.disabled,
          onClick: action.onClick,
        })
      );
    }
  }
  actionsEl.hidden = !actions.length;

  el.set = (next = {}) => {
    if ('tone' in next) state.tone = next.tone || 'info';
    if ('title' in next) state.title = next.title ?? '';
    if ('description' in next) state.description = next.description ?? '';
    paint();
  };

  // 用户主动关掉：通知调用方并把自己摘掉。dispose 只释放资源、不摘 DOM，
  // 两者是不同语义，所以这里不合并。
  el.dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    onDismiss?.();
    el.remove();
  };

  el.dispose = () => {
    disposer.dispose();
  };

  paint();
  return el;
}
