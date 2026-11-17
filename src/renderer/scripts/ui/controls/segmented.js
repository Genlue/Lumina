// Golden Gate · controls/segmented
import { h } from '../../core/dom.js';
import { iconEl } from '../../core/icons.js';

/* ==========================================================================
   2. 分段控件
   ========================================================================== */

export function Segmented({ options = [], value, onChange, size = '' } = {}) {
  const group = h('div', {
    class: `c-seg ${size === 'lg' ? 'c-seg--lg' : ''}`.trim(),
    role: 'radiogroup',
  });

  // 会滑动的选中块，而不是每个选项各自上色
  const ind = h('div', { class: 'c-seg__ind' });
  group.append(ind);

  let first = true;
  let disposed = false;
  let retryTimer = 0;
  let raf = 0;
  let ro = null;

  const place = (animate, retry = 4) => {
    if (disposed) return;
    clearTimeout(retryTimer);
    retryTimer = 0;
    const opt = group.querySelector(`.c-seg__opt[data-value="${group.dataset.value}"]`);
    if (!opt) return;
    const r = opt.getBoundingClientRect();

    // 元素可能还没挂载 / 还没排版，量到 0 就下一帧再试，别把滑块留在 width:0
    if (!r.width) {
      if (retry > 0) retryTimer = setTimeout(() => place(animate, retry - 1), 16);
      return;
    }

    // 参照系用分组自身的边框盒，而不是缓存的视口坐标 ——
    // 后者在页面滚动后就会失效，切换时会按滚动距离把滑块甩出去。
    const gr = group.getBoundingClientRect();
    const dx = Math.round((r.left - gr.left) * 100) / 100;
    const dy = Math.round((r.top - gr.top) * 100) / 100;

    const apply = () => {
      ind.style.transform = `translate(${dx}px, ${dy}px)`;
      ind.style.width = `${r.width}px`;
      ind.style.height = `${r.height}px`;
    };

    if (!animate || first) {
      first = false;
      // 首次定位不参与过渡：加临时类 + 强制一次回流
      ind.classList.add('is-static');
      apply();
      void ind.offsetWidth;
      ind.classList.remove('is-static');
      return;
    }
    apply();
  };

  const sync = (v) => {
    [...group.children].forEach((btn) => {
      if (btn === ind) return;
      const on = btn.dataset.value === v;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
  };

  for (const opt of options) {
    const btn = h(
      'button',
      {
        class: 'c-seg__opt',
        type: 'button',
        role: 'radio',
        dataset: { value: opt.value },
        title: opt.title || null,
        onclick: () => {
          if (group.dataset.value === opt.value) return;
          group.dataset.value = opt.value;
          sync(opt.value);
          place(true);
          onChange?.(opt.value);
        },
      },
      opt.icon ? iconEl(opt.icon, 14) : null,
      opt.label ? h('span', { class: 'c-seg__label' }, opt.label) : null
    );
    group.append(btn);
  }

  group.dataset.value = value ?? options[0]?.value;
  sync(group.dataset.value);

  // 键盘：左右方向键在选项间移动
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = [...group.querySelectorAll('.c-seg__opt')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.click();
    next.focus();
    e.preventDefault();
  });

  // 先同步摆一次（此时可能还没挂载，place 会自己重试），再交给 ResizeObserver 兜底
  place(false);
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => place(false));
    ro.observe(group);
    group._ro = ro;
  }
  raf = requestAnimationFrame(() => {
    raf = 0;
    place(false);
  });

  group.set = (v) => {
    group.dataset.value = v;
    sync(v);
    place(true);
  };
  group.dispose = () => {
    if (disposed) return;
    disposed = true;
    ro?.disconnect();
    clearTimeout(retryTimer);
    cancelAnimationFrame(raf);
  };
  return group;
}
