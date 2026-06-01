// ============================================================
// Photo Album — Discover Page (waterfall / draw / random)
// ============================================================

const D = {
  /** Render waterfall layout */
  async renderWaterfall() {
    const grid = document.getElementById('waterfall-grid');
    if (!grid) return;

    const all = S.buildAllImgs();
    if (all.length === 0) {
      grid.innerHTML = '<div class="empty-text" style="padding:40px;">暂无图片</div>';
      return;
    }

    grid.innerHTML = '';
    for (const img of all) {
      const container = document.createElement('div');
      const imgEl = document.createElement('img');
      imgEl.alt = img.name;
      container.appendChild(imgEl);
      grid.appendChild(container);

      API.getThumbnail(S.profileId, img.name, img._folder)
        .then(thumb => { imgEl.src = thumb.dataUrl; })
        .catch(() => {});

      imgEl.addEventListener('click', () => {
        S.filteredImages = all;
        Lb.open(all.indexOf(img));
      });
    }
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
      API.getThumbnail(S.profileId, img.name, img._folder)
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
          <button class="toolbar-btn" id="random-prev">◀</button>
          <button class="toolbar-btn" id="random-pause">⏸</button>
          <button class="toolbar-btn" id="random-next">▶</button>
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
      document.getElementById('random-pause').textContent = S.randomPaused ? '▶' : '⏸';
    });

    // Click image to open lightbox synced with slideshow
    document.getElementById('random-img')?.addEventListener('click', () => {
      S._lbFromRandom = true;
      S.filteredImages = S._randomImgs;
      Lb.open(S._randomIdx);
    });
  },

  _showRandom() {
    if (!S._randomImgs) return;
    const img = S._randomImgs[S._randomIdx];
    if (!img) return;
    API.getThumbnail(S.profileId, img.name, img._folder)
      .then(thumb => {
        const el = document.getElementById('random-img');
        if (el) el.src = thumb.dataUrl;
      })
      .catch(() => {});
    const info = document.getElementById('random-info');
    if (info) {
      info.textContent = `${img.name}${img._folder ? ` (${img._folder})` : ''}`;
    }
  },

  stopRandom() {
    if (S.randomTimer) {
      clearInterval(S.randomTimer);
      S.randomTimer = null;
    }
  },
};
