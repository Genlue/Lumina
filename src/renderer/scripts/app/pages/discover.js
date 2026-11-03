// ============================================================
// Lumina · 发现
// 一个页面三种形态：瀑布流 / 随机抽卡 / 幻灯片。
// 三者的 DOM 与观察器都在切换时销毁，不留在内存里。
// ============================================================

import { h, fill } from '../../core/dom.js';
import { Button, Capsule, IconButton, Segmented, Empty, Thumb, disposeComponentTree } from '../../ui/kit.js';
import { revealOnScroll } from '../../core/scrollbar.js';
import { mountGlassSurfaces } from '../../core/glass-lens.js';
import { S, allImages } from '../state.js';
import { shuffle, fmtSize } from '../util.js';
import * as api from '../api.js';
import * as shell from '../shell.js';
import * as router from '../router.js';
import { openLightbox } from '../lightbox.js';
import { openImageMenu } from './photo.js';

const TABS = [
  { value: 'waterfall', label: '瀑布流' },
  { value: 'draw', label: '抽卡' },
  { value: 'slide', label: '幻灯片' },
];

export function mount(ctx) {
  const tab = TABS.some((t) => t.value === S.route.tab) ? S.route.tab : 'waterfall';

  // 放进胶囊就不要传 size：胶囊自己会把控件调成 28 高、胶囊圆角，
  // 传 size:'lg' 会把内件压成 26 高 + r-sm，圆角就对不上外壳了。
  const seg = Segmented({
    value: tab,
    options: TABS,
    onChange: (v) => router.go({ page: 'discover', tab: v }),
  });

  shell.pageTopbar({
    title: '发现',
    subtitle: '换一种方式看你的照片',
    nav: router.navState(),
    pills: [Capsule({ children: [seg] })],
  });

  const page = h('div', { class: 'app-page app-page--flush' });
  ctx.stage.append(page);
  const detach = revealOnScroll(ctx.stage);

  let cleanup = () => {};

  if (tab === 'waterfall') cleanup = mountWaterfall(page, ctx);
  else if (tab === 'draw') cleanup = mountDraw(page, ctx);
  else cleanup = mountSlide(page, ctx);

  return {
    destroy() {
      cleanup();
      detach();
    },
  };
}

/* ==========================================================================
   瀑布流
   ========================================================================== */

function mountWaterfall(page, ctx) {
  const items = allImages();
  if (!items.length) {
    page.append(
      Empty({
        icon: 'images',
        title: '还没有照片',
        desc: '先往图库文件夹里放一些图片，再重新扫描。',
        action: Button({
          label: '去全部照片',
          variant: 'primary',
          onClick: () => router.go({ page: 'library' }),
        }),
      })
    );
    return () => {};
  }

  const width = ctx.stage.clientWidth || window.innerWidth;
  const cols = width <= 760 ? 2 : width <= 1080 ? 3 : 4;

  const grid = h('div', { class: 'app-waterfall' });
  grid.style.columnCount = String(cols);
  page.append(grid);

  /** 待取缩略图队列：按批合并，避免滚动时刷出上百个 IPC */
  let queue = [];
  let busy = false;
  let alive = true;

  const flush = () => {
    if (!alive || busy || !queue.length) return;
    busy = true;
    const batch = queue.splice(0, 10);
    api
      .getThumbs(
        batch.map((b) => ({ name: b.img.name, folder: b.img.folder })),
        Math.max(240, Math.round((S.settings.thumbnail_size ?? 400) * 1.25))
      )
      .then((res) => {
        if (!alive) return;
        res.forEach((r, i) => {
          const el = batch[i].thumb;
          if (!r?.dataUrl) return;
          const img = el.querySelector('img');
          if (img) img.src = r.dataUrl;
        });
      })
      .catch(() => {})
      .finally(() => {
        busy = false;
        if (alive && queue.length) requestAnimationFrame(flush);
      });
  };

  const io = new IntersectionObserver(
    (entries) => {
      let added = false;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        io.unobserve(el);
        const index = Number(el.dataset.index);
        const img = items[index];
        if (!img) continue;
        const thumb = el.firstElementChild;
        const hit = api.peekThumb(img.name, img.folder, S.settings.thumbnail_size ?? 400);
        if (hit?.dataUrl) {
          const im = thumb.querySelector('img');
          if (im) im.src = hit.dataUrl;
        } else {
          queue.push({ img, thumb });
          added = true;
        }
      }
      if (added) flush();
    },
    { root: ctx.stage, rootMargin: '640px 0px' }
  );

  const frag = document.createDocumentFragment();
  items.forEach((img, index) => {
    const thumb = Thumb({ src: '' });
    thumb.querySelector('img')?.removeAttribute('src');
    const cell = h('div', { class: 'app-waterfall__item', dataset: { index } }, thumb);
    cell.addEventListener('click', () => openLightbox(items, index));
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openImageMenu(img, { x: e.clientX, y: e.clientY });
    });
    frag.append(cell);
    io.observe(cell);
  });
  grid.append(frag);

  return () => {
    alive = false;
    queue = [];
    io.disconnect();
  };
}

/* ==========================================================================
   随机抽卡
   ========================================================================== */

function mountDraw(page, ctx) {
  const all = allImages();
  if (!all.length) {
    page.append(
      Empty({
        icon: 'sparkles',
        title: '还没有照片',
        desc: '抽卡需要先有图片。',
        action: Button({
          label: '去全部照片',
          variant: 'primary',
          onClick: () => router.go({ page: 'library' }),
        }),
      })
    );
    return () => {};
  }

  const count = Math.max(1, Math.min(30, Number(S.settings.draw_count) || 10));
  const area = h('div');
  page.append(area);

  let picked = [];
  let alive = true;

  function draw() {
    picked = shuffle([...all]).slice(0, count);
    fill(area);

    // 列数交给 CSS：容器多宽就铺几列（docs/04 §5 的画廊配方）。
    // 不要用「张数 × 固定列宽」算 max-width —— 窄窗口下最后一张会被窗口切掉。
    const grid = h('div', { class: 'app-draw' });
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(140px, 1fr))';

    picked.forEach((img, i) => {
      const thumb = Thumb({ src: '' });
      thumb.querySelector('img')?.removeAttribute('src');
      api
        .getThumb(img.name, img.folder, S.settings.thumbnail_size ?? 400)
        .then((r) => {
          if (!alive) return;
          const im = thumb.querySelector('img');
          if (im && r?.dataUrl) im.src = r.dataUrl;
        })
        .catch(() => {});

      const card = h(
        'div',
        { class: 'app-draw__card' },
        thumb,
        h('div', { class: 'app-draw__name' }, img.name)
      );
      card.style.animationDelay = `${i * 45}ms`;
      card.addEventListener('click', () => openLightbox(picked, i));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openImageMenu(img, { x: e.clientX, y: e.clientY });
      });
      grid.append(card);
    });

    area.append(
      grid,
      h(
        'div',
        { class: 'l-row l-row--4', style: { justifyContent: 'center', padding: 'var(--s-7) 0' } },
        Button({
          label: '再抽一次',
          variant: 'primary',
          icon: 'shuffle',
          onClick: () => draw(),
        }),
        Button({
          label: '张数设置',
          variant: 'plain',
          icon: 'sliders',
          onClick: () => router.go({ page: 'settings' }),
        })
      )
    );
  }

  draw();

  return () => {
    alive = false;
  };
}

/* ==========================================================================
   幻灯片
   ========================================================================== */

function mountSlide(page, ctx) {
  const all = allImages();
  if (!all.length) {
    page.append(
      Empty({
        icon: 'play',
        title: '还没有照片',
        desc: '幻灯片需要先有图片。',
        action: Button({
          label: '去全部照片',
          variant: 'primary',
          onClick: () => router.go({ page: 'library' }),
        }),
      })
    );
    return () => {};
  }

  page.style.display = 'none';

  const list = shuffle([...all]);
  let idx = 0;
  let paused = false;
  let alive = true;
  let timer = 0;

  const imgEl = h('img', { class: 'app-slide__img', alt: '' });
  const nameEl = h('div', { class: 'app-lightbox__name' });
  const subEl = h('div', { class: 'app-lightbox__sub' });
  const meta = h('div', { class: 'app-slide__meta c-glass-sheet' }, nameEl, subEl);

  const pauseBtn = IconButton({
    icon: 'pause',
    label: '暂停（空格）',
    onClick: () => togglePause(),
  });

  const bar = h(
    'div',
    { class: 'app-slide__bar c-glass-sheet' },
    h(
      'div',
      { class: 'l-row l-row--2' },
      IconButton({ icon: 'chevron-left', label: '上一张', onClick: () => step(-1) }),
      pauseBtn,
      IconButton({ icon: 'chevron-right', label: '下一张', onClick: () => step(1) }),
      IconButton({ icon: 'fullscreen', label: '全屏（Enter）', onClick: () => toggleFullscreen() }),
      IconButton({ icon: 'x', label: '退出（Esc）', onClick: () => exit() })
    )
  );

  const root = h('div', { class: 'app-slide' }, imgEl, meta, bar);
  ctx.main.append(root);
  mountGlassSurfaces(root);

  function paint() {
    const img = list[idx];
    if (!img) return;
    nameEl.textContent = img.displayName || img.name;
    const parts = [];
    if (img.size) parts.push(fmtSize(img.size));
    if (img.folder) parts.push(img.folder);
    parts.push(`${idx + 1} / ${list.length}`);
    subEl.textContent = parts.join(' · ');
  }

  async function show() {
    const img = list[idx];
    if (!img) return;
    paint();
    try {
      const r = await api.getThumb(img.name, img.folder, 1600);
      if (!alive || list[idx] !== img) return;
      imgEl.src = r.dataUrl;
    } catch {
      // 单张失败就停在这一张
    }
    // 预取下一张
    const next = list[(idx + 1) % list.length];
    if (next) api.getThumb(next.name, next.folder, 1600).catch(() => {});
  }

  function step(delta) {
    idx = (idx + delta + list.length) % list.length;
    show();
  }

  function togglePause() {
    paused = !paused;
    pauseBtn.classList.toggle('c-iconbtn--on', paused);
    pauseBtn.title = paused ? '继续（空格）' : '暂停（空格）';
    pauseBtn.setAttribute('aria-label', pauseBtn.title);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else root.requestFullscreen?.().catch(() => {});
  }

  function exit() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    router.go({ page: 'discover', tab: 'waterfall' });
  }

  const onKey = (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === ' ') {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      toggleFullscreen();
    } else if (e.key === 'ArrowLeft') {
      step(-1);
    } else if (e.key === 'ArrowRight') {
      step(1);
    } else if (e.key === 'Escape' && !document.fullscreenElement) {
      exit();
    }
  };
  document.addEventListener('keydown', onKey);

  const interval = Math.max(1, Number(S.settings.random_interval) || 3) * 1000;
  timer = setInterval(() => {
    if (!paused) step(1);
  }, interval);

  show();

  return () => {
    alive = false;
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    disposeComponentTree(root);
    root.remove();
  };
}
