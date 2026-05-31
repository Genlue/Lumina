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

    area.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;padding:24px;">
        ${selected.map((img, i) => `
          <div class="draw-card" style="width:180px;height:220px;perspective:800px;cursor:pointer;" data-idx="${i}">
            <div class="draw-card-inner" style="width:100%;height:100%;transition:transform 0.6s;transform-style:preserve-3d;position:relative;">
              <div style="position:absolute;inset:0;background:var(--c-accent-bg);border:2px solid var(--c-accent);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-size:3em;backface-visibility:hidden;">?</div>
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

    // Click to flip
    area.querySelectorAll('.draw-card').forEach((card, i) => {
      card.addEventListener('click', () => {
        const inner = card.querySelector('.draw-card-inner');
        const isFlipped = inner.style.transform.includes('180');
        if (isFlipped) {
          inner.style.transform = '';
        } else {
          inner.style.transform = 'rotateY(180deg)';
        }
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

    const area = document.getElementById('random-area');
    if (!area) return;

    area.innerHTML = `
      <div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <img id="random-img" style="max-width:90%;max-height:70vh;object-fit:contain;border-radius:8px;" src="">
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
      }
    }, 3000);

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
