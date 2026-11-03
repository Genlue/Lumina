// ============================================================
// Lumina · 灯箱
// 覆盖层，不是页面。背景是当前图的放大 + 模糊 + 暗化副本（不是 backdrop-filter），
// 工具条是一条 L4 玻璃胶囊。翻页时旋转角度必须重置。
// ============================================================

import { h } from '../core/dom.js';
import { IconButton, Spinner, disposeComponentTree, toast } from '../ui/kit.js';
import { spring } from '../core/spring.js';
import { mountGlassSurfaces } from '../core/glass-lens.js';
import * as api from './api.js';
import { S } from './state.js';
import { fmtDate, fmtSize } from './util.js';
import { toggleFavorite, moveToTrash } from './actions.js';

let instance = null;

/**
 * 打开灯箱。
 * @param {Array} items 当前浏览序列（网格过滤后的结果）
 * @param {number} index 起始下标
 */
export function openLightbox(items, index) {
  closeLightbox();
  if (!items?.length) return;

  const state = {
    items,
    idx: Math.max(0, Math.min(items.length - 1, index)),
    rot: 0,
    zoom: 1,
    x: 0,
    y: 0,
    dragging: false,
    dragX: 0,
    dragY: 0,
    loadSeq: 0,
  };

  /* ---------------- DOM ---------------- */

  // 背景用 div + background-image：SVG/小图被 <img> 承载时，blur 会按
  // 内在尺寸栅格化，大半径直接把整张图糊成透明。背景图按元素尺寸采样才稳。
  const bg = h('div', { class: 'app-lightbox__bg' });
  const img = h('img', { class: 'app-lightbox__img', alt: '', draggable: 'false' });
  const spinner = h('div', { class: 'app-lightbox__spinner' }, Spinner());

  const nameEl = h('div', { class: 'app-lightbox__name' });
  const subEl = h('div', { class: 'app-lightbox__sub' });
  const meta = h('div', { class: 'app-lightbox__meta' }, nameEl, subEl);

  const stage = h('div', { class: 'app-lightbox__stage' }, img, spinner);

  const btn = (opts) => IconButton({ ...opts, size: '' });

  const favBtn = btn({ icon: 'star', label: '收藏（空格）', onClick: () => toggleFav() });
  // 灯箱工具条走 L4（docs/02 §6「模态、灯箱工具条用 .c-glass-sheet」）：
  // 一整块玻璃 + 3px 内边距（34 高外壳 / 28 高按钮，同心 17−14=3），
  // 里面不再给每个按钮各自上底色 —— 否则就是胶囊里套胶囊。
  const bar = h(
    'div',
    { class: 'app-lightbox__bar c-glass-sheet' },
    h(
      'div',
      { class: 'l-row l-row--2' },
      btn({ icon: 'chevron-left', label: '上一张（←）', onClick: () => step(-1) }),
      btn({ icon: 'zoom-out', label: '缩小（-）', onClick: () => zoomBy(-0.25) }),
      btn({ icon: 'zoom-in', label: '放大（+）', onClick: () => zoomBy(0.25) }),
      btn({ icon: 'rotate-ccw', label: '逆时针旋转（Shift+R）', onClick: () => rotate(-90) }),
      btn({ icon: 'rotate-cw', label: '顺时针旋转（R）', onClick: () => rotate(90) }),
      favBtn,
      btn({ icon: 'trash', label: '移到回收站', onClick: () => removeCurrent() }),
      btn({ icon: 'chevron-right', label: '下一张（→）', onClick: () => step(1) }),
      btn({ icon: 'x', label: '关闭（Esc）', onClick: () => closeLightbox() })
    )
  );

  const root = h('div', { class: 'app-lightbox', role: 'dialog', 'aria-modal': 'true' }, bg, stage, meta, bar);

  /* ---------------- 渲染 ---------------- */

  function applyTransform() {
    img.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.zoom}) rotate(${state.rot}deg)`;
    img.dataset.zoomed = state.zoom > 1.01 ? '1' : '0';
  }

  function paintMeta() {
    const it = state.items[state.idx];
    if (!it) return;
    nameEl.textContent = it.displayName || it.name;
    const parts = [];
    if (it.size) parts.push(fmtSize(it.size));
    if (it.date) parts.push(fmtDate(it.date));
    if (it.folder) parts.push(it.folder);
    parts.push(`${state.idx + 1} / ${state.items.length}`);
    subEl.textContent = parts.join(' · ');

    const fav = S.favoriteSet.has(it.key);
    favBtn.classList.toggle('c-iconbtn--on', fav);
    favBtn.setAttribute('aria-pressed', String(fav));
    favBtn.title = fav ? '取消收藏（空格）' : '收藏（空格）';
  }

  async function show() {
    const it = state.items[state.idx];
    if (!it) return;

    // 翻页即重置：旋转、缩放、位移都不跨图
    state.rot = 0;
    state.zoom = 1;
    state.x = 0;
    state.y = 0;
    applyTransform();
    paintMeta();

    const seq = ++state.loadSeq;
    spinner.style.display = '';
    img.style.opacity = '0';

    try {
      const quick = await api.getThumb(it.name, it.folder, 900);
      if (seq !== state.loadSeq) return;
      if (quick?.dataUrl) {
        img.src = quick.dataUrl;
        bg.style.backgroundImage = `url("${quick.dataUrl}")`;
        img.style.opacity = '1';
      }
    } catch {
      // 缩略图失败就直接等原图
    }

    try {
      const full = await api.getFullImage(it.name, it.folder);
      if (seq !== state.loadSeq) return;
      img.src = full.dataUrl;
      bg.style.backgroundImage = `url("${full.dataUrl}")`;
      img.style.opacity = '1';
    } catch {
      if (seq === state.loadSeq && !img.src) {
        toast('无法读取这张图片', { icon: 'x-circle', tone: 'danger' });
      }
    } finally {
      if (seq === state.loadSeq) spinner.style.display = 'none';
    }
  }

  /* ---------------- 交互 ---------------- */

  function step(delta) {
    const next = state.idx + delta;
    if (next < 0 || next >= state.items.length) return;
    state.idx = next;
    show();
  }

  function rotate(deg) {
    state.rot = (state.rot + deg + 360) % 360;
    applyTransform();
  }

  function zoomBy(delta) {
    state.zoom = Math.min(5, Math.max(0.2, Math.round((state.zoom + delta) * 100) / 100));
    if (state.zoom <= 1) {
      state.x = 0;
      state.y = 0;
    }
    applyTransform();
  }

  async function toggleFav() {
    const it = state.items[state.idx];
    if (!it) return;
    await toggleFavorite(it);
    paintMeta();
  }

  async function removeCurrent() {
    const it = state.items[state.idx];
    if (!it) return;
    const n = await moveToTrash([it]);
    if (n > 0) closeLightbox();
  }

  /* ---------------- 事件 ---------------- */

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'r') {
      e.preventDefault();
      rotate(90);
    } else if (e.key === 'R') {
      e.preventDefault();
      rotate(-90);
    } else if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      toggleFav();
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomBy(0.25);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomBy(-0.25);
    } else if (e.key === '0') {
      e.preventDefault();
      state.zoom = 1;
      state.x = 0;
      state.y = 0;
      applyTransform();
    }
  };
  document.addEventListener('keydown', onKey, true);

  const onWheel = (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.25 : -0.25);
  };
  stage.addEventListener('wheel', onWheel, { passive: false });

  // 拖拽平移（放大后才有意义，但小图也允许轻微拖动）
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target !== img && e.target !== stage) return;
    state.dragging = true;
    state.dragX = e.clientX - state.x;
    state.dragY = e.clientY - state.y;
    img.setPointerCapture?.(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (!state.dragging) return;
    state.x = e.clientX - state.dragX;
    state.y = e.clientY - state.dragY;
    applyTransform();
  });

  const endDrag = (e) => {
    if (!state.dragging) return;
    state.dragging = false;
    img.releasePointerCapture?.(e.pointerId);
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // 点空白处关闭（点图片不关）
  stage.addEventListener('click', (e) => {
    if (e.target === stage) closeLightbox();
  });

  document.body.append(root);
  // 灯箱工具条是页面直接写的 .c-glass-sheet：挂上液态玻璃渲染层
  mountGlassSurfaces(root);
  instance = { root, onKey };

  // 入场：只动透明度与缩放，不动 blur
  root.style.opacity = '0';
  spring({
    from: 0,
    to: 1,
    damping: 1,
    response: 0.28,
    onUpdate: (t) => {
      root.style.opacity = String(t);
    },
  });

  show();
}

export function closeLightbox() {
  if (!instance) return;
  const { root, onKey } = instance;
  instance = null;
  document.removeEventListener('keydown', onKey, true);
  disposeComponentTree(root);
  root.remove();
}

export const isLightboxOpen = () => !!instance;
