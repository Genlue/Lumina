// ============================================================
// Photo Album — Renderer (clean)
// ============================================================

const R = {
  _imgObserver: null,

  /** Render sidebar album list */
  renderAlbumList() {
    const list = document.getElementById('album-list');
    if (!list) return;
    const wrap = document.getElementById('album-list-wrap');
    if (wrap) wrap.style.display = S.currentPage === 'album' ? 'block' : 'none';

    if (S.albumFolders.length === 0) {
      list.innerHTML = '<div style="padding:12px;color:var(--c-text3);font-size:0.82em;">暂无相册</div>';
      return;
    }

    list.innerHTML = S.albumFolders.map(f => {
      const count = (S.albumImages[f] ?? []).length;
      return `<div class="nav-item album-item" data-album="${U.esc(f)}"><span>📁</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${U.esc(f)}</span><span class="count">${count}</span></div>`;
    }).join('');

    list.querySelectorAll('.album-item').forEach(item => {
      item.addEventListener('click', () => {
        S.currentView = item.dataset.album; S.currentPage = 'album';
        App.navToAlbum(item.dataset.album);
      });
      item.addEventListener('contextmenu', e => App.albumCtx(e, item.dataset.album));
    });
  },

  /** Render image grid */
  async renderGrid() {
    const grid = document.getElementById('image-grid');
    const empty = document.getElementById('empty-state');
    if (!grid || !empty) return;

    const viewMode = App._settings?.view_mode ?? 'grid';
    let imgs = S.buildAllImgs();

    // Filter
    if (S.currentView === 'trash') {
      const trashList = await API.listTrash(S.profileId);
      imgs = trashList.map(t => ({
        name: t.trash_name, _key: t.trash_name, _folder: null,
        size: 0, lastModified: new Date(t.deleted_at).getTime(),
        _isTrash: true, _trashEntry: t, _displayName: t.original_name,
      }));
    } else if (S.currentView === 'favorites') {
      await API.listFav(S.profileId);
      imgs = imgs.filter(i => S.favoritesSet.has(i._key));
    } else if (S.currentView !== 'all' && S.currentView !== 'albums') {
      imgs = imgs.filter(i => i._folder === S.currentView);
    }

    // Search
    const search = document.getElementById('search-input')?.value?.toLowerCase() ?? '';
    if (search) imgs = imgs.filter(i => i.name.toLowerCase().includes(search));

    // Sort
    const sortBy = App._settings?.sort_by ?? 'name-asc';
    const sorters = {
      'name-asc': (a, b) => a.name.localeCompare(b.name),
      'name-desc': (a, b) => b.name.localeCompare(a.name),
      'date-desc': (a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0),
      'date-asc': (a, b) => (a.lastModified ?? 0) - (b.lastModified ?? 0),
    };
    imgs.sort(sorters[sortBy] || sorters['name-asc']);
    S.filteredImages = imgs;

    document.getElementById('image-count').textContent = `${imgs.length} 张图片`;

    if (imgs.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      empty.querySelector('.empty-text').textContent = search ? `未找到"${search}"` : '暂无图片';
      return;
    }
    empty.classList.add('hidden');

    grid.className = viewMode === 'list' ? 'list-view' : '';
    grid.innerHTML = '';

    for (const img of imgs) {
      const card = this._makeImageCard(img, viewMode);
      grid.appendChild(card);
    }

    // Click handlers
    grid.querySelectorAll('.image-card').forEach((card, idx) => {
      card.addEventListener('click', e => {
        if (S.multiselect) { App.toggle(card.dataset.key); return; }
        Lb.open(idx);
      });
      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        App.showCtx(e, S.filteredImages[idx]);
      });
    });

    this._lazyLoad();
  },

  _makeImageCard(img, viewMode) {
    const card = document.createElement('div');
    card.className = 'image-card' + (viewMode === 'list' ? ' list-card' : '');
    if (S.selected.has(img._key)) card.classList.add('selected');
    card.dataset.key = img._key;

    if (viewMode === 'list') {
      card.innerHTML = `<div style="width:42px;height:42px;background:var(--c-card);border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;"><img src="" data-src="${img._key}" style="width:100%;height:100%;object-fit:cover;opacity:0;" onload="this.style.opacity='1'"></div><div style="flex:1;min-width:0;"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${U.esc(img._displayName || img.name)}</div><div class="card-meta"><span>${img.size ? U.fmtSize(img.size) : '--'}</span><span>${img.lastModified ? U.fmtDate(img.lastModified) : '--'}</span>${img._folder ? '<span>📁 '+U.esc(img._folder)+'</span>' : ''}</div></div>`;
    } else {
      card.innerHTML = `<img src="" data-src="${img._key}" style="width:100%;height:100%;object-fit:cover;opacity:0;" onload="this.style.opacity='1'"><div class="card-name">${U.esc(img._displayName || img.name)}</div>`;
    }
    return card;
  },

  /** Render album grid */
  async renderAlbumGrid() {
    const wrap = document.getElementById('album-grid');
    const empty = document.getElementById('albums-empty');
    if (!wrap || !empty) return;

    if (S.albumFolders.length === 0) {
      wrap.innerHTML = ''; empty.classList.remove('hidden'); return;
    }
    empty.classList.add('hidden');

    wrap.innerHTML = S.albumFolders.map(f => {
      const count = (S.albumImages[f] ?? []).length;
      return `<div class="album-card" data-album="${U.esc(f)}"><div class="album-cover" data-folder="${U.esc(f)}">📁</div><div class="album-info"><div class="album-name">${U.esc(f)}</div><div class="album-count">${count} 张</div></div></div>`;
    }).join('');

    // Load cover thumbnails
    for (const f of S.albumFolders) {
      const imgs = S.albumImages[f] ?? [];
      if (imgs.length === 0) continue;
      try {
        const thumb = await API.getThumbnail(S.profileId, imgs[0].name, f);
        const coverEl = wrap.querySelector(`.album-cover[data-folder="${U.esc(f)}"]`);
        if (coverEl && thumb && thumb.dataUrl) {
          coverEl.innerHTML = `<img src="${thumb.dataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
        }
      } catch (e) { /* ignore */ }
    }

    wrap.querySelectorAll('.album-card').forEach(card => {
      card.addEventListener('contextmenu', e => App.albumCtx(e, card.dataset.album));
      card.style.cursor = 'pointer';
    });
  },

  /** Update breadcrumb */
  updateBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    const labels = { all: '全部图片', albums: '相册列表', trash: '回收站', favorites: '⭐ 收藏' };
    bc.textContent = labels[S.currentView] || `📁 ${S.currentView}`;
  },

  /** Lazy load visible images (reuse observer) */
  _lazyLoad() {
    if (this._imgObserver) this._imgObserver.disconnect();
    const images = document.querySelectorAll('#image-grid img[data-src]');
    this._imgObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        const key = img.dataset.src;
        if (!key) continue;
        const imageData = S.filteredImages.find(i => (i._key || i.name) === key);
        if (!imageData) continue;

        API.getThumbnail(S.profileId, imageData.name, imageData._folder)
          .then(thumb => { img.src = thumb.dataUrl; img.removeAttribute('data-src'); })
          .catch(() => { img.src = ''; img.removeAttribute('data-src'); });
        this._imgObserver.unobserve(img);
      }
    }, { rootMargin: '200px' });
    images.forEach(img => this._imgObserver.observe(img));
  },

  /** Update trash button count */
  async updateTrashBtn() {
    const count = await API.trashCount(S.profileId);
    const btn = document.getElementById('btn-trash');
    if (btn) {
      const badge = btn.querySelector('.count-badge');
      if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }
    }
  },

  updateFavCount() {
    const el = document.getElementById('nav-fav-count');
    if (el) el.textContent = S.favoritesSet.size || '';
  },

  updateCount() {
    const all = S.rootImages.length + Object.values(S.albumImages).reduce((s, a) => s + a.length, 0);
    const elAll = document.getElementById('nav-all-count'); if (elAll) elAll.textContent = all || '';
    const elAlb = document.getElementById('nav-album-count'); if (elAlb) elAlb.textContent = S.albumFolders.length || '';
    this.updateFavCount();
    this.updateTrashBtn();
  },

  /** Multi-select UI */
  uiSel() {
    const count = S.selected.size;
    const btn = document.getElementById('btn-deselect-all');
    if (btn) btn.style.display = count > 0 ? '' : 'none';
    document.querySelectorAll('.image-card').forEach(card => {
      card.classList.toggle('selected', S.selected.has(card.dataset.key));
    });
  },
};
