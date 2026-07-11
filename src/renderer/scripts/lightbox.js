// ============================================================
// Photo Album — Lightbox
// ============================================================

const Lb = {
  /** Open lightbox to index */
  async open(idx) {
    if (idx < 0 || idx >= S.filteredImages.length) return;
    S.lbIdx = idx;
    S.lbZoom = 1;
    S.lbPanX = 0;
    S.lbPanY = 0;

    // Sync random slideshow position when lightbox opened from random mode
    if (S._lbFromRandom) S._randomIdx = idx;

    document.getElementById('lightbox').classList.remove('hidden');
    this._update();
    this._resetZoom();
  },

  /** Close lightbox */
  close() {
    document.getElementById('lightbox').classList.add('hidden');
    S.lbIdx = -1;
    S.lbZoom = 1;
    S.lbPanX = 0;
    S.lbPanY = 0;
    S._lbFromRandom = false;
  },

  /** Update image, info and star button */
  async _update() {
    const idx = S.lbIdx;
    if (idx < 0) return;
    const img = S.filteredImages[idx];
    if (!img) return;

    const lbImg = document.getElementById('lightbox-img');

    // 1. Update info immediately
    document.getElementById('lightbox-name').textContent = img._displayName || img.name;
    const metaParts = [];
    if (img.size) metaParts.push(U.fmtSize(img.size));
    if (img.lastModified) metaParts.push(U.fmtDate(img.lastModified));
    document.getElementById('lightbox-meta').textContent = metaParts.join(' · ');

    // 2. Sync star button
    const starBtn = document.getElementById('lightbox-star');
    const isFav = S.favoritesSet.has(img._key);
    if (starBtn) {
      if (isFav) {
        starBtn.innerHTML = Icons.icon('star', 14).replace('fill="none"', 'fill="var(--c-accent)"').replace('stroke="currentColor"', 'stroke="var(--c-accent)"');
      } else {
        starBtn.innerHTML = Icons.icon('star', 14);
      }
    }

    // 3. Create spinner if needed
    let spinner = document.getElementById('lb-spinner');
    if (!spinner) {
      spinner = document.createElement('div');
      spinner.id = 'lb-spinner';
      spinner.className = 'lb-spinner';
      document.getElementById('lightbox').appendChild(spinner);
    }

    // 4. Loading state
    lbImg.classList.add('loading');
    spinner.style.display = '';

    // 5. Show thumbnail first (fast, already cached)
    try {
      const thumb = await API.getThumbnail(S.profileId, img.name, img._folder, 800);
      if (S.lbIdx !== idx) return; // user navigated away
      if (thumb && thumb.dataUrl) {
        lbImg.src = thumb.dataUrl;
      }
    } catch (e) {
      console.warn('[Lb] thumbnail load failed:', e);
    }

    // 6. Load full image
    try {
      const full = await API.getFullImage(S.profileId, img.name, img._folder);
      if (S.lbIdx !== idx) return; // user navigated away while loading
      lbImg.src = full.dataUrl;
      await lbImg.decode();
    } catch (e) {
      console.warn('[Lb] full image load failed, keeping thumbnail:', e);
    }

    // 7. Done loading (only if still on the same image)
    if (S.lbIdx === idx) {
      lbImg.classList.remove('loading');
      spinner.style.display = 'none';
    }
  },

  _resetZoom() {
    S.lbZoom = 1;
    S.lbPanX = 0;
    S.lbPanY = 0;
    this._applyZoom();
  },

  _applyZoom() {
    const img = document.getElementById('lightbox-img');
    if (!img) return;
    img.style.transform = `translate(${S.lbPanX}px, ${S.lbPanY}px) scale(${S.lbZoom})`;
    document.getElementById('lightbox-zoom-level').textContent = Math.round(S.lbZoom * 100) + '%';
  },

  zoomIn() {
    S.lbZoom = Math.min(S.lbZoom + 0.25, 5);
    this._applyZoom();
  },

  zoomOut() {
    S.lbZoom = Math.max(S.lbZoom - 0.25, 0.1);
    this._applyZoom();
  },

  zoomFit() {
    this._resetZoom();
  },

  prev() {
    if (S.lbIdx > 0) this.open(S.lbIdx - 1);
  },

  next() {
    if (S.lbIdx < S.filteredImages.length - 1) this.open(S.lbIdx + 1);
  },
};

// Keyboard handlers
document.addEventListener('keydown', (e) => {
  if (S.lbIdx < 0) return;
  switch (e.key) {
    case 'Escape': Lb.close(); break;
    case 'ArrowLeft': Lb.prev(); break;
    case 'ArrowRight': Lb.next(); break;
    case '+': case '=': Lb.zoomIn(); break;
    case '-': Lb.zoomOut(); break;
    case '0': Lb.zoomFit(); break;
  }
});

// Mouse wheel zoom
document.getElementById('lightbox')?.addEventListener('wheel', (e) => {
  if (S.lbIdx < 0) return;
  e.preventDefault();
  if (e.deltaY < 0) Lb.zoomIn();
  else Lb.zoomOut();
}, { passive: false });

// Drag to pan when zoomed
const lbImg = document.getElementById('lightbox-img');
(function() {
  let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0, isDragging = false;

  lbImg?.addEventListener('mousedown', (e) => {
    if (S.lbIdx < 0 || S.lbZoom <= 1) return;
    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = S.lbPanX;
    panStartY = S.lbPanY;
    lbImg.style.cursor = 'grabbing';
    lbImg.style.transition = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    S.lbPanX = panStartX + (e.clientX - dragStartX);
    S.lbPanY = panStartY + (e.clientY - dragStartY);
    Lb._applyZoom();
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    lbImg.style.cursor = 'grab';
    lbImg.style.transition = 'transform 0.1s';
  });
})();

// Double click zoom toggle
lbImg?.addEventListener('dblclick', () => {
  if (S.lbZoom === 1) S.lbZoom = 2;
  else Lb._resetZoom();
  Lb._applyZoom();
});

// Click bg or close button
document.getElementById('lightbox-bg')?.addEventListener('click', () => Lb.close());
document.getElementById('lightbox-close')?.addEventListener('click', () => Lb.close());
document.getElementById('lightbox-prev')?.addEventListener('click', () => Lb.prev());
document.getElementById('lightbox-next')?.addEventListener('click', () => Lb.next());
document.getElementById('lightbox-zoom-in')?.addEventListener('click', () => Lb.zoomIn());
document.getElementById('lightbox-zoom-out')?.addEventListener('click', () => Lb.zoomOut());
document.getElementById('lightbox-fit')?.addEventListener('click', () => Lb.zoomFit());
