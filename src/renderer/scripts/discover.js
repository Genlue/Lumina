// ============================================================
// Lumina — Discover Page (waterfall / draw / random)
// ============================================================

const D = {
  // Waterfall items keep their positions while thumbnails are loading.
  // CSS columns cannot do that because every image changes the column height.
  _wfGrid: null,
  _wfItems: [],
  _wfCards: new Map(),
  _wfObserver: null,
  _wfResizeObserver: null,
  _wfQueue: new Map(),
  _wfFlushScheduled: false,
  _wfLoadingGeneration: 0,
  _wfGeneration: 0,
  _wfDataSignature: '',
  _wfLayoutWidth: 0,

  /** Render a stable, lazily-loaded waterfall layout. */
  renderWaterfall() {
    const grid = document.getElementById('waterfall-grid');
    if (!grid) return;

    const all = this._sortWaterfallItems(S.buildAllImgs());
    if (all.length === 0) {
      this._wfGeneration += 1;
      this._clearWaterfall();
      grid.innerHTML = '<div class="empty-text" style="padding:40px;">暂无图片</div>';
      return;
    }

    const dataSignature = this._getWaterfallSignature(all);
    if (this._wfGrid === grid && this._wfDataSignature === dataSignature
        && grid.querySelector('.waterfall-item')) {
      // Returning to the tab should not rebuild an already laid-out gallery.
      this._observeWaterfallItems();
      this._layoutWaterfall();
      return;
    }

    this._clearWaterfall();
    this._wfGeneration += 1;
    const generation = this._wfGeneration;
    this._wfGrid = grid;
    this._wfItems = all;
    this._wfDataSignature = dataSignature;
    this._wfCards = new Map();
    grid.innerHTML = '';

    const fragment = document.createDocumentFragment();
    all.forEach((img, index) => {
      const key = img._key || img.name;
      const container = document.createElement('div');
      container.className = 'waterfall-item';
      container.dataset.key = key;
      container.dataset.wfState = 'idle';
      container.setAttribute('role', 'button');
      container.setAttribute('aria-label', img.name);

      const imgEl = document.createElement('img');
      imgEl.className = 'waterfall-image';
      imgEl.alt = img.name;
      imgEl.decoding = 'async';
      imgEl.draggable = false;
      imgEl.style.opacity = '0';
      container.appendChild(imgEl);
      fragment.appendChild(container);
      this._wfCards.set(key, { card: container, image: imgEl, item: img });

      container.addEventListener('click', () => {
        S.filteredImages = all;
        Lb.open(index);
      });
      container.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        S.filteredImages = all;
        App.showCtx(e, img);
      });
    });
    grid.appendChild(fragment);

    this._layoutWaterfall();
    this._setupWaterfallObservers(generation);
    this._observeWaterfallItems();
  },

  /** Keep the order independent from filesystem/HashMap enumeration order. */
  _sortWaterfallItems(items) {
    return items.slice().sort((a, b) => {
      const ak = String(a._key || a.name || '').toLocaleLowerCase();
      const bk = String(b._key || b.name || '').toLocaleLowerCase();
      if (ak < bk) return -1;
      if (ak > bk) return 1;
      return String(a._key || a.name || '').localeCompare(String(b._key || b.name || ''));
    });
  },

  _getWaterfallSignature(items) {
    const thumbSize = App._settings?.thumbnail_size ?? 400;
    return [S.profileId || '', thumbSize, items.map(img => [
      img._key || img.name,
      img.size || 0,
      img.lastModified || 0,
      img.width || 0,
      img.height || 0,
    ].join(':')).join('|')].join('|');
  },

  _getWaterfallColumns() {
    if (window.innerWidth <= 800) return 2;
    if (window.innerWidth <= 1100) return 3;
    return 4;
  },

  _getWaterfallRatio(item) {
    const width = Number(item.width);
    const height = Number(item.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      // Avoid pathological headers creating an unusably tall single card.
      return Math.max(0.4, Math.min(2.5, width / height));
    }
    // Large/unsupported files may not have dimensions from the scanner.
    // Keep a deterministic placeholder ratio so loading never moves cards.
    return 4 / 3;
  },

  _layoutWaterfall() {
    const grid = this._wfGrid;
    if (!grid || this._wfCards.size === 0) return;

    const width = grid.clientWidth;
    if (!width) {
      requestAnimationFrame(() => this._layoutWaterfall());
      return;
    }

    const columns = this._getWaterfallColumns();
    const gap = 8;
    const columnWidth = Math.max(1, (width - gap * (columns - 1)) / columns);
    const columnHeights = new Array(columns).fill(0);

    for (const item of this._wfItems) {
      const key = item._key || item.name;
      const entry = this._wfCards.get(key);
      if (!entry) continue;

      let column = 0;
      for (let i = 1; i < columnHeights.length; i++) {
        if (columnHeights[i] < columnHeights[column]) column = i;
      }

      const height = Math.max(120, Math.round(columnWidth / this._getWaterfallRatio(item)));
      const left = Math.round(column * (columnWidth + gap));
      const top = Math.round(columnHeights[column]);
      entry.card.style.width = `${columnWidth}px`;
      entry.card.style.height = `${height}px`;
      entry.card.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      columnHeights[column] += height + gap;
    }

    const totalHeight = Math.max(...columnHeights, 0) - (columnHeights.length ? gap : 0);
    grid.style.height = `${Math.max(0, Math.ceil(totalHeight))}px`;
    this._wfLayoutWidth = width;
  },

  _setupWaterfallObservers(generation) {
    const grid = this._wfGrid;
    if (!grid) return;

    const root = grid.closest('.page-scroll');
    this._wfObserver = new IntersectionObserver(entries => {
      if (generation !== this._wfGeneration) return;

      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      for (const entry of visible) {
        const card = entry.target;
        if (card.dataset.wfState !== 'idle') continue;
        const key = card.dataset.key;
        card.dataset.wfState = 'queued';
        this._wfQueue.set(key, card);
        this._wfObserver.unobserve(card);
      }
      if (visible.length > 0) this._scheduleWaterfallFlush();
    }, { root, rootMargin: '720px 0px', threshold: 0.01 });

    if (typeof ResizeObserver !== 'undefined' && root) {
      this._wfResizeObserver = new ResizeObserver(() => {
        if (generation !== this._wfGeneration) return;
        const width = grid.clientWidth;
        if (width && Math.abs(width - this._wfLayoutWidth) > 1) {
          requestAnimationFrame(() => {
            if (generation === this._wfGeneration) this._layoutWaterfall();
          });
        }
      });
      this._wfResizeObserver.observe(root);
    }
  },

  _observeWaterfallItems() {
    if (!this._wfObserver) return;
    for (const entry of this._wfCards.values()) {
      if (entry.card.dataset.wfState === 'idle') this._wfObserver.observe(entry.card);
    }
  },

  _scheduleWaterfallFlush() {
    if (this._wfFlushScheduled) return;
    this._wfFlushScheduled = true;
    requestAnimationFrame(() => {
      this._wfFlushScheduled = false;
      this._flushWaterfallQueue();
    });
  },

  _flushWaterfallQueue() {
    const generation = this._wfGeneration;
    if (this._wfLoadingGeneration === generation || this._wfQueue.size === 0) return;

    // Keep IPC and image decoding work bounded while scrolling quickly.
    const batchEntries = Array.from(this._wfQueue.entries()).slice(0, 8);
    batchEntries.forEach(([key]) => this._wfQueue.delete(key));
    batchEntries.forEach(([, card]) => { card.dataset.wfState = 'loading'; });

    const requests = batchEntries.map(([key]) => {
      const entry = this._wfCards.get(key);
      return { filename: entry.item.name, folder: entry.item._folder || null };
    });
    const thumbSize = Math.max(240, Math.round((App._settings?.thumbnail_size ?? 400) * 1.25));
    this._wfLoadingGeneration = generation;

    API.getThumbnailsBatch(S.profileId, requests, thumbSize)
      .then(results => {
        if (generation !== this._wfGeneration) return;
        results.forEach((thumb, index) => {
          const key = batchEntries[index]?.[0];
          const entry = key ? this._wfCards.get(key) : null;
          if (!entry) return;

          const markFailed = () => {
            entry.card.dataset.wfState = 'failed';
            entry.card.classList.add('waterfall-failed');
          };

          if (thumb?.dataUrl) {
            let fallbackTried = false;
            entry.image.onload = () => {
              if (generation !== this._wfGeneration) return;
              entry.image.style.opacity = '1';
              entry.card.dataset.wfState = 'loaded';
            };
            entry.image.onerror = () => {
              if (generation !== this._wfGeneration) return;
              if (fallbackTried) {
                markFailed();
                return;
              }

              // Retry through the single-image path, which can fall back to the
              // original file when a batch thumbnail cannot be generated.
              fallbackTried = true;
              const item = entry.item;
              API.getThumbnail(
                S.profileId,
                item.name,
                item._folder ?? null,
                thumbSize,
              )
                .then(fallback => {
                  if (generation !== this._wfGeneration) return;
                  if (fallback?.dataUrl) {
                    entry.image.src = fallback.dataUrl;
                  } else {
                    markFailed();
                  }
                })
                .catch(markFailed);
            };
            entry.image.src = thumb.dataUrl;
          } else {
            markFailed();
          }
        });
      })
      .catch(() => {
        if (generation !== this._wfGeneration) return;
        batchEntries.forEach(([key]) => {
          const entry = this._wfCards.get(key);
          if (entry) {
            entry.card.dataset.wfState = 'failed';
            entry.card.classList.add('waterfall-failed');
          }
        });
      })
      .finally(() => {
        if (this._wfLoadingGeneration === generation) {
          this._wfLoadingGeneration = 0;
          if (generation === this._wfGeneration && this._wfQueue.size > 0) {
            this._scheduleWaterfallFlush();
          }
        }
      });
  },

  _clearWaterfall() {
    if (this._wfObserver) this._wfObserver.disconnect();
    if (this._wfResizeObserver) this._wfResizeObserver.disconnect();
    this._wfObserver = null;
    this._wfResizeObserver = null;
    this._wfQueue.clear();
    this._wfGrid = null;
    this._wfItems = [];
    this._wfCards = new Map();
    this._wfDataSignature = '';
    this._wfLayoutWidth = 0;
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
      <div style="display:flex;justify-content:center;padding:20px;">
        <div class="draw-action-card" onclick="D.renderDraw()">
          ${Icons.icon('shuffle', 32)}
          <span>重新抽取</span>
        </div>
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
      <div class="random-view">
        <div class="random-controls">
          <div id="random-info" style="text-align:center;color:var(--c-text2);font-size:0.9em;font-weight:var(--font-weight-medium);margin-bottom:12px;"></div>
          <div style="display:flex;gap:12px;justify-content:center;">
            <button class="toolbar-btn" id="random-prev">${Icons.icon('chevron-left', 16)}</button>
            <button class="toolbar-btn" id="random-pause">${Icons.icon('pause', 16)}</button>
            <button class="toolbar-btn" id="random-next">${Icons.icon('chevron-right', 16)}</button>
          </div>
        </div>
        <div class="random-stage">
          <img id="random-img" src="" alt="">
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
