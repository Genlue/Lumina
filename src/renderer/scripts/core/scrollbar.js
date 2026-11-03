// ============================================================
// Lumina · Scrollbar
// Golden Gate 的滚动条是覆盖层：滚动时浮现，停下后淡出。
// 关键：WebKit 的原生滚动条会占 16px 布局宽度，导致「左边距 10、右边距 26」。
// 所以这里把原生滚动条宽度归零，改成自绘的覆盖层，不参与布局。
// ============================================================

const HIDE_DELAY = 900;

/**
 * 给滚动容器装上覆盖式滚动条。
 * @param {HTMLElement} el 滚动容器（父级需可定位，或会被自动设为 relative）
 * @returns {() => void} 解绑函数
 */
export function revealOnScroll(el) {
  if (!el) return () => {};

  el.classList.add('c-scroller');
  const host = el.parentElement;
  if (!host) return () => {};
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const bar = document.createElement('div');
  bar.className = 'c-overlay-scroll';
  const thumb = document.createElement('i');
  thumb.className = 'c-overlay-scroll__thumb';
  bar.append(thumb);
  host.append(bar);

  let timer = 0;

  const sync = () => {
    const range = el.scrollHeight - el.clientHeight;
    if (range <= 1) {
      bar.dataset.on = '0';
      return;
    }
    const h = el.clientHeight;
    // 轨道 = 覆盖层的实际高度（上下各留 2px 呼吸位）。
    // 拇指行程必须按「轨道高 - 拇指高」算，不能用容器高 —— 否则滚到底时
    // 拇指会从轨道末端探出去 4px，圆头和底色对不上（拖拽那边早就是按 -4 算的，两边原本不一致）。
    const trackH = h - 4;
    const t = Math.min(trackH, Math.max(36, (h / el.scrollHeight) * h));
    const y = (el.scrollTop / range) * Math.max(0, trackH - t);

    // 覆盖层贴着容器的可视区，容器自己滚动不影响它
    const r = el.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    bar.style.top = `${r.top - hr.top + 2}px`;
    bar.style.height = `${trackH}px`;
    thumb.style.height = `${t}px`;
    thumb.style.transform = `translateY(${y}px)`;
  };

  const show = () => {
    bar.dataset.on = '1';
    el.dataset.scrolling = '1';
    clearTimeout(timer);
    timer = setTimeout(() => {
      bar.dataset.on = '0';
      delete el.dataset.scrolling;
    }, HIDE_DELAY);
  };

  const onScroll = () => {
    sync();
    show();
  };

  /* ---------------- 拖拽 ---------------- */
  // 拇指是唯一可点区域：bar 本身 pointer-events:none，不会挡住内容点击。
  // 它虽然平时透明，但仍然可命中 —— 鼠标移到右边缘就能「摸到」并唤醒。
  let drag = null;

  const onThumbDown = (e) => {
    if (e.button !== 0) return;
    const range = el.scrollHeight - el.clientHeight;
    if (range <= 1) return;
    e.preventDefault();
    e.stopPropagation();

    const trackH = el.clientHeight - 4;
    const thumbH = thumb.offsetHeight;
    const k = range / Math.max(1, trackH - thumbH);

    drag = {
      id: e.pointerId,
      y0: e.clientY,
      s0: el.scrollTop,
      k,
    };
    try { thumb.setPointerCapture(e.pointerId); } catch {}
    el.style.userSelect = 'none';
    bar.dataset.on = '1';
    clearTimeout(timer);
  };

  const onThumbMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    el.scrollTop = drag.s0 + (e.clientY - drag.y0) * drag.k;
    sync();
  };

  const endDrag = (e) => {
    if (!drag) return;
    try { thumb.releasePointerCapture(e.pointerId); } catch {}
    drag = null;
    el.style.userSelect = '';
    show();
  };

  thumb.addEventListener('pointerdown', onThumbDown);
  thumb.addEventListener('pointermove', onThumbMove);
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
  // 悬到右边缘即使拇指是透明的也要亮起来，否则根本不知道能拖
  thumb.addEventListener('pointerenter', show);

  el.addEventListener('scroll', onScroll, { passive: true });
  el.addEventListener('pointerenter', sync);

  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          sync();
          // 内容不再溢出时立刻收起，别留一条悬在空中的拇指
          if (el.scrollHeight - el.clientHeight <= 1) bar.dataset.on = '0';
        })
      : null;
  ro?.observe(el);
  // 内容高度变化（例如列表重建）也要重新量
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(sync) : null;
  mo?.observe(el, { childList: true, subtree: true });

  requestAnimationFrame(sync);

  return () => {
    clearTimeout(timer);
    el.removeEventListener('scroll', onScroll);
    el.removeEventListener('pointerenter', sync);
    thumb.removeEventListener('pointerdown', onThumbDown);
    thumb.removeEventListener('pointermove', onThumbMove);
    thumb.removeEventListener('pointerup', endDrag);
    thumb.removeEventListener('pointercancel', endDrag);
    thumb.removeEventListener('pointerenter', show);
    ro?.disconnect();
    mo?.disconnect();
    bar.remove();
    el.classList.remove('c-scroller');
    delete el.dataset.scrolling;
  };
}
