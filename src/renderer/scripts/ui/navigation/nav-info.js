// Golden Gate · navigation/nav-info
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { contrastOn } from '../_shared/contrast.js';
import { initials } from '../_shared/initials.js';

/**
 * 信息模块 —— 导航栏顶部的「我是谁 / 这是哪个应用」。
 * 系统设置里那一行 Apple 账户就是这个：头像 + 名称 + 副标题，整行一个跳转目标。
 *
 * 三种媒介，共用同一个 36px 的盒子，所以文字起点永远一致：
 *   avatar  圆形头像（账户）
 *   icon    圆角方形应用图标（某个应用的设置页）
 *   stack   重叠头像组（家人共享 / 协作者）
 *
 *   NavInfo({ avatar: 'me.jpg', title: '小 Q', subtitle: 'Apple 账户', onClick })
 *   NavInfo({ icon: 'sliders', iconBg: '#5b8def', title: '参数', subtitle: '应用设置' })
 *   NavInfo({ stack: ['a.jpg', 'b.jpg', 'c.jpg'], title: '家人共享' })
 */
export function NavInfo({
  avatar = '',
  icon: ic = '',
  iconSrc = '',
  iconBg = '',
  stack = [],
  title = '',
  subtitle = '',
  onClick,
  className = '',
} = {}) {
  let media;
  if (stack.length) {
    media = h(
      'span',
      { class: 'c-navinfo__media c-navinfo__media--stack' },
      stack.slice(0, 3).map((src) => h('img', { class: 'c-navinfo__face', src, alt: '', draggable: 'false' }))
    );
  } else if (iconSrc) {
    // 应用图标（图片）：软件自己有 .ico / .png 时不要再拿字形拼一个假的。
    // 媒介盒换成方形圆角，与 icon 模式的 .c-navinfo__app 同一个比例。
    media = h(
      'span',
      { class: 'c-navinfo__media c-navinfo__media--app' },
      h('img', { class: 'c-navinfo__appimg', src: iconSrc, alt: '', draggable: 'false' })
    );
  } else if (ic) {
    media = h(
      'span',
      { class: 'c-navinfo__media' },
      h('span', {
        class: 'c-navinfo__app',
        style: iconBg ? { '--navinfo-app-bg': iconBg, '--navinfo-app-fg': contrastOn(iconBg) } : null,
        html: icon(ic, 18),
      })
    );
  } else {
    media = h(
      'span',
      { class: 'c-navinfo__media' },
      avatar
        ? h('img', { src: avatar, alt: '', draggable: 'false' })
        : initials(title)
    );
  }

  const el = h(
    'div',
    {
      class: `c-navinfo ${onClick ? 'c-navinfo--interactive' : ''} ${className}`.trim(),
      role: onClick ? 'button' : null,
      tabindex: onClick ? '0' : null,
      onclick: onClick,
      onkeydown: onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick(e);
            }
          }
        : null,
    },
    media,
    h(
      'span',
      { class: 'c-navinfo__body' },
      h('span', { class: 'c-navinfo__title' }, title),
      subtitle ? h('span', { class: 'c-navinfo__sub' }, subtitle) : null
    )
  );
  return el;
}
