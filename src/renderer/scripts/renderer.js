// ============================================================
// Lumina — Renderer (clean)
// ============================================================

const R = {
  _imgObserver: null,

  /** Render sidebar album list content only (visibility managed by App._showAlbumList/_hideAlbumList).
   *  Shows only direct children of the current view level, with a back button when nested. */
  renderAlbumList() {
    const list = document.getElementById('album-list');
    if (!list) return;

    const isNested = S.currentView && S.currentView !== 'all' && S.currentView !== 'albums'
      && S.currentView !== 'trash' && S.currentView !== 'favorites';
    const parentPath = isNested ? S.currentView : '';
    const folders = S.getChildAlbums(parentPath);

    if (folders.length === 0 && !isNested) {
      list.innerHTML = '<div style="padding:12px;color:var(--c-text3);font-size:0.82em;">暂无相册</div>';
      return;
    }

    let html = '';

    // Back button when in a nested folder
    if (isNested) {
      html += `<div class="nav-item album-item album-back" data-action="back">
        <span>${Icons.icon('arrow-up', 14)}</span><span style="flex:1;">.. 返回上级</span>
      </div>`;
    }

    if (folders.length > 0) {
      html += folders.map(f => {
        // getChildAlbums returns full paths like "2/艾莉" - use directly
        const displayName = S.getDisplayName(f);
        const directImgs = S.albumImages[f] ?? [];
        const count = directImgs.length;
        return `<div class="nav-item album-item" data-album="${U.esc(f)}">
          <span>${Icons.icon('folder', 14)}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${U.esc(displayName)}</span>
          <span class="count">${count}</span>
        </div>`;
      }).join('');
    }

    list.innerHTML = html;

    // Back button
    const backEl = list.querySelector('.album-back');
    if (backEl) {
      backEl.addEventListener('click', () => {
        App.navToParent();
      });
    }

    // Album item events
    list.querySelectorAll('.album-item[data-album]').forEach(item => {
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
        name: t.trash_name, _key: t.trash_name, _folder: TRASH_DIR,
        size: 0, lastModified: new Date(t.deleted_at).getTime(),
        _isTrash: true, _trashEntry: t, _displayName: t.original_name,
      }));
    } else if (S.currentView === 'favorites') {
      await API.listFav(S.profileId);
      // Build directly from favoritesList — avoids key mismatch with buildAllImgs
      imgs = S.favoritesList.map(f => ({
        name: f.filename || '',
        _key: f.folder_name ? f.folder_name + '/' + f.filename : f.filename,
        _folder: f.folder_name || null,
        size: f.file_size || 0,
        lastModified: f.file_date || 0,
        width: f.width || 0,
        height: f.height || 0,
      }));
    } else if (S.currentView !== 'all' && S.currentView !== 'albums') {
      imgs = imgs.filter(i => i._folder === S.currentView);
    }

    // Search
    const search = (document.getElementById('search-input')?.value?.toLowerCase() ?? '').trim();
    const exclude = (document.getElementById('search-neg')?.value?.toLowerCase() ?? '').trim();

    if (search || exclude) {
        const isInAlbum = S.currentView !== 'all' && S.currentView !== 'albums'
            && S.currentView !== 'trash' && S.currentView !== 'favorites';
        const matchType = S._searchAlbumMatchType?.[S.currentView];
        const isAlbumNameMatch = isInAlbum && matchType === 'name';

        // 正搜索过滤（非相册名匹配模式下）
        if (search && !isAlbumNameMatch) {
            imgs = imgs.filter(i => i.name.toLowerCase().includes(search));
        }

        // 逆搜索过滤：始终执行，包括相册名匹配模式
        if (exclude) {
            imgs = imgs.filter(i => !i.name.toLowerCase().includes(exclude));
        }
    }

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
        if (S.multiselect && S.selected.size > 0) {
          App.showMultiCtx(e);
        } else {
          App.showCtx(e, S.filteredImages[idx]);
        }
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
      card.innerHTML = `<div style="width:42px;height:42px;background:var(--c-card);border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;"><img src="" data-src="${img._key}" loading="lazy" style="width:100%;height:100%;object-fit:cover;opacity:0;" onload="this.style.opacity='1'"></div><div style="flex:1;min-width:0;"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${U.esc(img._displayName || img.name)}</div><div class="card-meta"><span>${img.size ? U.fmtSize(img.size) : '--'}</span><span>${img.lastModified ? U.fmtDate(img.lastModified) : '--'}</span>${img._folder ? '<span>' + Icons.icon('folder', 12) + ' ' + U.esc(img._folder) + '</span>' : ''}</div></div>`;
    } else {
      card.innerHTML = `<img src="" data-src="${img._key}" loading="lazy" style="width:100%;height:100%;object-fit:cover;opacity:0;" onload="this.style.opacity='1'"><div class="card-name">${U.esc(img._displayName || img.name)}</div>`;
    }
    return card;
  },

  /** Render album grid — show only direct children at the current level. */
  async renderAlbumGrid() {
    const wrap = document.getElementById('album-grid');
    const empty = document.getElementById('albums-empty');
    if (!wrap || !empty) return;

    const currentPath = (S.currentView === 'all' || S.currentView === 'albums') ? '' : S.currentView;
    let childFolders = S.getChildAlbums(currentPath);

    // Search filtering for albums
    const search = (document.getElementById('search-input')?.value?.toLowerCase() ?? '').trim();
    const exclude = (document.getElementById('search-neg')?.value?.toLowerCase() ?? '').trim();

    if (search || exclude) {
        const matchType = {};
        const filtered = childFolders.filter(f => {
            const displayName = S.getDisplayName(f).toLowerCase();
            const images = S.albumImages[f] ?? [];

            // 正搜索
            const nameMatch = !search || displayName.includes(search);
            const imgMatch = !search || images.some(img => img.name.toLowerCase().includes(search));
            const passesPositive = nameMatch || imgMatch;

            // 逆搜索：排除包含排除词的文件夹或图片
            if (exclude) {
                const nameExcluded = displayName.includes(exclude);
                const imgExcluded = images.some(img => img.name.toLowerCase().includes(exclude));
                if (nameExcluded || imgExcluded) return false;
            }

            if (passesPositive) {
                matchType[f] = (search && nameMatch) ? 'name' : (search && imgMatch) ? 'image-only' : 'name';
                return true;
            }
            return false;
        });
        childFolders = filtered;
        // Merge而非替换，保留当前相册的匹配状态
        S._searchAlbumMatchType = { ...(S._searchAlbumMatchType || {}), ...matchType };
    }

    if (childFolders.length === 0) {
      wrap.innerHTML = ''; empty.classList.remove('hidden');
      empty.querySelector('.empty-text').textContent = search ? `未找到"${search}"` : '尚无相册';
      return;
    }
    empty.classList.add('hidden');

    // Build cover image map: folder_name → cover_image
    let coverMap = {};
    try {
      const albums = await API.listAlbums(S.profileId);
      albums.forEach(a => { coverMap[a.folder_name] = a.cover_image; });
    } catch(e) { /* ignore */ }

    wrap.innerHTML = childFolders.map(f => {
      // getChildAlbums returns full paths like "2/艾莉" - use directly
      const count = (S.albumImages[f] ?? []).length;
      const hasChildren = S.hasChildAlbums(f);
      return `<div class="album-card" data-album="${U.esc(f)}">
        <div class="album-cover" data-folder="${U.esc(f)}">${Icons.icon('folder', 48)}</div>
        <div class="album-info">
          <div class="album-name">${U.esc(S.getDisplayName(f))}</div>
          <div class="album-count">${count} 张${hasChildren ? ' · ' + Icons.icon('folder-tree', 12) + ' 含子相册' : ''}</div>
        </div>
      </div>`;
    }).join('');

    // Load cover thumbnails
    for (const f of childFolders) {
      const imgs = S.albumImages[f] ?? [];
      if (imgs.length === 0) continue;
      try {
        const ts = Math.round((App._settings.thumbnail_size ?? 400) * 0.75);
        const coverName = coverMap[f];
        let targetImg = null;
        if (coverName) {
          targetImg = imgs.find(img => img.name === coverName);
        }
        if (!targetImg) targetImg = imgs[0];
        const thumb = await API.getThumbnail(S.profileId, targetImg.name, f, ts);
        const coverEl = wrap.querySelector(`.album-cover[data-folder="${U.esc(f)}"]`);
        if (coverEl && thumb && thumb.dataUrl) {
          coverEl.innerHTML = `<img src="${thumb.dataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
        }
      } catch (e) { /* ignore */ }
    }

    wrap.querySelectorAll('.album-card').forEach(card => {
      card.addEventListener('click', () => App.navToAlbum(card.dataset.album));
      card.addEventListener('contextmenu', e => App.albumCtx(e, card.dataset.album));
      card.style.cursor = 'pointer';
    });
  },

  /** Update breadcrumb with clickable segments for nested folders */
  updateBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    const labels = { all: '图片', albums: '相册', trash: '回收站', favorites: '收藏' };
    if (labels[S.currentView]) {
      bc.innerHTML = labels[S.currentView];
      bc.style.cursor = 'default';
      bc.onclick = null;
    } else {
      const items = S.getBreadcrumbItems();
      bc.innerHTML = items.map((item, i) => {
        const sep = i > 0 ? '<span style="margin:0 4px;color:var(--c-text3);">' + Icons.icon('chevron-right', 10) + '</span>' : '';
        const name = U.esc(item.name);
        if (i === items.length - 1) {
          return `${sep}<span style="color:var(--c-text);font-weight:600;">${name}</span>`;
        }
        return `${sep}<span class="bc-link" data-path="${U.esc(item.path)}" style="color:var(--c-accent);cursor:pointer;">${name}</span>`;
      }).join('');
      bc.style.cursor = 'default';

      // Click handler for breadcrumb links
      bc.querySelectorAll('.bc-link').forEach(link => {
        link.addEventListener('click', (e) => {
          e.stopPropagation();
          const path = link.dataset.path;
          if (path === 'all') {
            S.currentView = 'all';
            App.navPage('album');
          } else {
            App.navToAlbum(path);
          }
        });
      });
    }
  },

  /** Lazy load visible images (reuse observer, individual IPC with memory cache) */
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

        const ts = App._settings.thumbnail_size ?? 400;
        API.getThumbnail(S.profileId, imageData.name, imageData._folder, ts)
          .then(thumb => {
            if (!thumb || !thumb.dataUrl) {
                img.removeAttribute('data-src');
                if (!img.src) {
                    const card = img.closest('.image-card');
                    if (card && !card.querySelector('.img-placeholder')) {
                        const ph = document.createElement('div');
                        ph.className = 'img-placeholder';
                        ph.innerHTML = '<span data-icon="file-image" data-size="24"></span>';
                        card.appendChild(ph);
                    }
                }
                return;
            }
            img.src = thumb.dataUrl;
            if (thumb.width) img.width = thumb.width;
            if (thumb.height) img.height = thumb.height;
            img.removeAttribute('data-src');
            const card = img.closest('.image-card');
            if (card) {
                const ph = card.querySelector('.img-placeholder');
                if (ph) ph.remove();
            }
          })
          .catch(() => { img.removeAttribute('data-src'); });
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
    const elHome = document.getElementById('nav-home-count'); if (elHome) elHome.textContent = all || '';
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
