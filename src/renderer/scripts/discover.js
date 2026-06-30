// ============================================================
// Photo Album — Discover Page (waterfall / draw / random)
// ============================================================

const D = {
  /** Render waterfall layout with lazy loading */
  renderWaterfall() {
    const grid = document.getElementById('waterfall-grid');
    if (!grid) return;

    const all = S.buildAllImgs();
    if (all.length === 0) {
      grid.innerHTML = '<div class="empty-text" style="padding:40px;">暂无图片</div>';
      return;
    }

    // Disconnect previous observer
    if (this._wfObserver) this._wfObserver.disconnect();

    grid.innerHTML = '';
    for (const img of all) {
      const container = document.createElement('div');
      const imgEl = document.createElement('img');
      imgEl.alt = img.name;
      imgEl.dataset.src = img._key;
      imgEl.dataset.folder = img._folder || '';
      imgEl.style.opacity = '0';
      container.appendChild(imgEl);
      grid.appendChild(container);

      imgEl.addEventListener('click', () => {
        S.filteredImages = all;
        Lb.open(all.indexOf(img));
      });
      imgEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        S.filteredImages = all;
        App.showCtx(e, img);
      });
    }

    // Lazy-load waterfall images via IntersectionObserver
    this._wfObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        const key = img.dataset.src;
        const folder = img.dataset.folder || null;
        if (!key) continue;
        const imageData = all.find(i => (i._key || i.name) === key);
        if (!imageData) continue;

        const ts = Math.round((App._settings.thumbnail_size ?? 400) * 1.25);
        API.getThumbnail(S.profileId, imageData.name, folder || imageData._folder, ts)
          .then(thumb => { img.src = thumb.dataUrl; img.style.opacity = '1'; })
          .catch(() => {});
        this._wfObserver.unobserve(img);
      }
    }, { rootMargin: '400px' });

    grid.querySelectorAll('img[data-src]').forEach(img => this._wfObserver.observe(img));
  },

  /** Render draw (random card flip) */
  renderDraw() {
    const area = document.getElementById('draw-area');
    if (!area) return;

    const all = S.buildAllImgs();
    if (all.length === 0) {
      area.innerHTML = '<div class="empty-text" style="padding:40px;">暂无图片</div>';
      return;
    }

    const count = App._settings?.draw_count ?? 3;
    const selected = U.shuffle([...all]).slice(0, count);
    D._drawCards = selected;

    // Adaptive columns: max 5 per row, never more cols than cards
    const cols = Math.min(count, 5);

    area.innerHTML = `
      <div class="draw-grid" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px;max-width:${cols * 170 + (cols-1)*14}px;margin:0 auto;padding:24px 16px;">
        ${selected.map((img, i) => `
          <div class="draw-card" data-idx="${i}" style="aspect-ratio:3/4;perspective:800px;cursor:pointer;min-width:0;">
            <div class="draw-card-inner" style="width:100%;height:100%;transition:transform 0.65s cubic-bezier(0.4,0,0.2,1);transform-style:preserve-3d;position:relative;">
              <div class="draw-card-front" style="position:absolute;inset:0;background:var(--c-accent-bg);border:2px solid var(--c-accent);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-size:clamp(1.5em,5vw,3em);backface-visibility:hidden;">?</div>
              <img src="" class="draw-img-${i}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:var(--radius-md);backface-visibility:hidden;transform:rotateY(180deg);" alt="${U.esc(img.name)}">
            </div>
          </div>
        `).join('')}
      </div>
      <div style="text-align:center;padding:16px;">
        <button class="btn-primary" onclick="D.renderDraw()">重新抽取</button>
      </div>
    `;

    // Load images
    selected.forEach((img, i) => {
      const ts = App._settings.thumbnail_size ?? 400;
      API.getThumbnail(S.profileId, img.name, img._folder, ts)
        .then(thumb => {
          const el = area.querySelector(`.draw-img-${i}`);
          if (el) el.src = thumb.dataUrl;
        })
        .catch(() => {});
    });

    // Auto-flip with staggered delay — wrap in rAF to ensure DOM is painted
    requestAnimationFrame(() => {
      area.querySelectorAll('.draw-card').forEach((card, i) => {
        setTimeout(() => {
          const inner = card.querySelector('.draw-card-inner');
          if (inner) inner.style.transform = 'rotateY(180deg)';
        }, 100 + i * 150);
      });
    });

    // Click flipped card to open lightbox scoped to drawn cards
    area.querySelectorAll('.draw-card').forEach((card, i) => {
      card.addEventListener('click', () => {
        S.filteredImages = D._drawCards;
        Lb.open(i);
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        S.filteredImages = D._drawCards;
        App.showCtx(e, D._drawCards[i]);
      });
    });
  },

  /** Start random slideshow */
  startRandom() {
    if (S.randomTimer) this.stopRandom();

    const all = S.buildAllImgs();
    if (all.length === 0) return;

    S._randomImgs = U.shuffle([...all]);
    S._randomIdx = 0;
    S.randomPaused = false;
    S._lbFromRandom = false;

    const interval = (App._settings?.random_interval ?? 3) * 1000;

    const area = document.getElementById('random-area');
    if (!area) return;

    area.innerHTML = `
      <div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <img id="random-img" style="max-width:90%;max-height:70vh;object-fit:contain;border-radius:8px;cursor:pointer;" src="">
        <div id="random-info" style="margin-top:12px;color:var(--c-text2);font-size:0.85em;"></div>
        <div style="display:flex;gap:10px;margin-top:12px;">
          <button class="toolbar-btn" id="random-prev">${Icons.icon('chevron-left', 14)}</button>
          <button class="toolbar-btn" id="random-pause">${Icons.icon('pause', 14)}</button>
          <button class="toolbar-btn" id="random-next">${Icons.icon('chevron-right', 14)}</button>
        </div>
      </div>
    `;

    this._showRandom();

    S.randomTimer = setInterval(() => {
      if (!S.randomPaused) {
        S._randomIdx = (S._randomIdx + 1) % S._randomImgs.length;
        this._showRandom();
        // If lightbox is open from random mode, keep it in sync
        if (S._lbFromRandom && S.lbIdx >= 0) {
          S.lbIdx = S._randomIdx;
          Lb._update();
        }
      }
    }, interval);

    document.getElementById('random-prev')?.addEventListener('click', () => {
      S._randomIdx = (S._randomIdx - 1 + S._randomImgs.length) % S._randomImgs.length;
      this._showRandom();
    });
    document.getElementById('random-next')?.addEventListener('click', () => {
      S._randomIdx = (S._randomIdx + 1) % S._randomImgs.length;
      this._showRandom();
    });
    document.getElementById('random-pause')?.addEventListener('click', () => {
      S.randomPaused = !S.randomPaused;
      document.getElementById('random-pause').innerHTML = S.randomPaused ? Icons.icon('chevron-right', 14) : Icons.icon('pause', 14);
    });

    // Click image to open lightbox synced with slideshow
    document.getElementById('random-img')?.addEventListener('click', () => {
      S._lbFromRandom = true;
      S.filteredImages = S._randomImgs;
      Lb.open(S._randomIdx);
    });
    document.getElementById('random-img')?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      S.filteredImages = S._randomImgs;
      App.showCtx(e, S._randomImgs[S._randomIdx]);
    });
  },

  _showRandom() {
    if (!S._randomImgs) return;
    const img = S._randomImgs[S._randomIdx];
    if (!img) return;
    const ts = Math.round((App._settings.thumbnail_size ?? 400) * 1.5);
    API.getThumbnail(S.profileId, img.name, img._folder, ts)
      .then(thumb => {
        const el = document.getElementById('random-img');
        if (el) {
          el.src = thumb.dataUrl;
          el.style.opacity = '1';
        }
      })
      .catch(() => {});
    const info = document.getElementById('random-info');
    if (info) {
      info.textContent = `${img.name}${img._folder ? ` (${img._folder})` : ''}`;
    }
    // Preload next image
    this._preloadNext();
  },

  _preloadNext() {
    if (!S._randomImgs || S._randomImgs.length <= 1) return;
    const nextIdx = (S._randomIdx + 1) % S._randomImgs.length;
    const nextImg = S._randomImgs[nextIdx];
    if (!nextImg) return;
    const ts = Math.round((App._settings.thumbnail_size ?? 400) * 1.5);
    // Fire-and-forget preload
    API.getThumbnail(S.profileId, nextImg.name, nextImg._folder, ts)
      .then(thumb => { S._preloadedSrc = thumb?.dataUrl || null; })
      .catch(() => { S._preloadedSrc = null; });
  },

  stopRandom() {
    if (S.randomTimer) {
      clearInterval(S.randomTimer);
      S.randomTimer = null;
    }
  },
};
