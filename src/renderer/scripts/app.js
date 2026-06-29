// ============================================================
// Photo Album — App Controller (clean)
// ============================================================

const App = {
  _settings: {},
  _eventsBound: false,

  // ====== LIFECYCLE ======

  async init() {
    // Startup: use last saved theme, fallback to system preference
    try {
      var savedTheme = localStorage.getItem('pa_theme_mode');
      if (!savedTheme) savedTheme = window.matchMedia('(prefers-color-scheme:light)').matches ? 'light' : 'dark';
      ST.applyTheme(savedTheme);
      var savedAccent = localStorage.getItem('pa_accent_color') || '#60CDFF';
      ST.applyAccent(savedAccent);
      _syncJsCheck();
    } catch (e) { /* ignore */ }

    const statusEl = document.getElementById('startup-status');
    const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
    const setProgress = (pct) => {
      const fill = document.getElementById('loading-fill');
      if (fill) fill.style.width = pct + '%';
    };

    try {
      if (!window.__TAURI__) {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#1c1c1c;color:#aaa;font-family:sans-serif;"><div style="text-align:center;"><h2 style="color:#f44;">需要 Tauri 环境</h2><p>请在 Tauri 中运行此应用</p></div></div>';
        return;
      }

      setStatus('加载配置中...');
      setProgress(10);
      let profiles = await API.listProfiles();

      // Validate folder existence
      setProgress(30);
      for (const p of profiles) {
        const exists = await API.checkProfilePath(p.folder_path);
        if (!exists && !p.unavailable) {
          await API.markGoneProfile(p.id);
          p.unavailable = 1;
        }
      }
      profiles = await API.listProfiles();

      const startupCfg = document.getElementById('startup-config');
      const startupProfs = document.getElementById('startup-profiles');

      if (profiles.length === 0) {
        startupCfg.classList.remove('hidden');
      } else {
        this._renderProfileList(startupProfs, profiles);
        startupProfs.classList.remove('hidden');
      }

      document.getElementById('btn-select-folder')?.addEventListener('click', () => this._selectAndLoad());
      document.getElementById('btn-start-new')?.addEventListener('click', () => this._selectAndLoad());

      document.addEventListener('dragover', e => e.preventDefault());
      document.addEventListener('drop', async e => {
        e.preventDefault();
        const items = e.dataTransfer.items;
        if (items && items.length > 0) {
          const file = items[0].getAsFile();
          if (file && file.path) {
            const dir = file.path.substring(0, file.path.lastIndexOf('\\'));
            await this._loadProfile(dir);
          }
        }
      });

      // Album grid click delegation (bind once, survives innerHTML changes)
      document.getElementById('album-grid-wrap').onclick = (e) => {
        const card = e.target.closest('.album-card');
        if (!card) return;
        App.navToAlbum(card.dataset.album);
      };

      this._bindNav();
      this._bindToolbar();
      this._bindSettings();
      this._bindTitleBar();

      setProgress(100);
      setStatus('就绪');
      // Hide loading bar after fade
      setTimeout(() => {
        const lb = document.getElementById('loading-bar');
        if (lb) lb.style.display = 'none';
      }, 500);
    } catch (e) {
      console.error('Init error:', e);
      setStatus('启动失败: ' + (e.message || e));
    }
  },

  // ====== PROFILE MANAGEMENT ======

  _renderProfileList(container, profiles) {
    profiles = [...profiles].sort((a, b) => (b.last_access || 0) - (a.last_access || 0));
    const SHOW = 2;
    const visible = profiles.slice(0, SHOW);
    const hidden = profiles.slice(SHOW);

    let html = '';
    visible.forEach(p => { html += this._profileCard(p); });
    if (hidden.length > 0) {
      html += `<div id="more-profiles" class="hidden">${hidden.map(p => this._profileCard(p)).join('')}</div>`;
      html += `<button id="btn-show-more" class="btn-primary" style="margin-top:8px;width:100%;">显示更多 (${hidden.length})</button>`;
    }
    container.innerHTML = html;

    const btnMore = container.querySelector('#btn-show-more');
    if (btnMore) {
      btnMore.addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('more-profiles').classList.remove('hidden');
        btnMore.style.display = 'none';
      });
    }

    this._bindProfileCardEvents(container, profiles);
  },

  _profileCard(p) {
    const u = p.unavailable;
    return `<div class="home-card" data-id="${p.id}" style="margin-bottom:8px;${u ? 'opacity:0.6;border:1px solid var(--c-warning)' : ''}">
      <h3>${U.esc(p.name)}</h3>
      <p style="font-size:0.78em;color:var(--c-text3);word-break:break-all;">${U.esc(p.folder_path)}</p>
      ${u ? `<div style="margin-top:6px;display:flex;gap:6px;"><button class="btn-relocate" data-id="${p.id}" style="padding:4px 10px;background:var(--c-accent-bg);color:var(--c-accent);border-radius:4px;font-size:0.78em;cursor:pointer;">重新定位</button><button class="btn-del-profile" data-id="${p.id}" style="padding:4px 10px;background:var(--c-danger-bg);color:var(--c-danger);border-radius:4px;font-size:0.78em;cursor:pointer;">删除记录</button></div>` : ''}
      ${p.last_access ? `<p style="font-size:0.72em;color:var(--c-text3);margin-top:4px;">上次: ${U.fmtDate(p.last_access)}</p>` : ''}
      ${u ? '<span style="color:var(--c-warning);font-size:0.75em;">⚠ 文件夹不存在或已被移动</span>' : ''}
    </div>`;
  },

  _bindProfileCardEvents(container, profiles) {
    container.querySelectorAll('.home-card').forEach(card => {
      card.addEventListener('click', async e => {
        if (e.target.tagName === 'BUTTON') return;
        const p = profiles.find(x => x.id === card.dataset.id);
        if (p && !p.unavailable) await this._doLoad(p.id, p.folder_path);
      });

      // 右键删除 profile
      card.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const p = profiles.find(x => x.id === card.dataset.id);
        if (!p) return;
        CM.show(e.clientX, e.clientY);
        const menu = document.getElementById('ctx-m');
        menu.innerHTML = '<div data-action="delete" class="danger">🗑 删除此记录</div>';
        menu.querySelector('[data-action="delete"]').onclick = async () => {
          CM.hide();
          const r = await Modal.show('删除记录',
            `将清除「${U.esc(p.name)}」的所有配置数据，图片文件不受影响。`,
            [{ label: '取消' }, { label: '确认删除', danger: true }]);
          if (r.idx !== 1) return;
          await API.removeProfile(p.id);
          const updated = await API.listProfiles();
          this._renderProfileList(container, updated);
          Toast.show('已删除', 'info');
        };
      });
    });
    container.querySelectorAll('.btn-relocate').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const result = await API.relocateProfile(btn.dataset.id);
        if (result) await this._doLoad(result.id, result.folder_path);
      });
    });
    container.querySelectorAll('.btn-del-profile').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const r = await Modal.show('删除记录', '将删除所有配置数据，图片文件不受影响。', [{ label: '取消' }, { label: '确认删除', danger: true }]);
        if (r.idx !== 1) return;
        await API.removeProfile(btn.dataset.id);
        this._renderProfileList(container, await API.listProfiles());
        Toast.show('已删除', 'info');
      });
    });
  },

  async _selectAndLoad() {
    const folder = await API.openFolder('选择图片文件夹');
    if (folder) await this._loadProfile(folder);
  },

  async _loadProfile(folderPath) {
    const profiles = await API.listProfiles();
    const existing = profiles.find(p => p.folder_path === folderPath);
    if (existing) {
      await this._doLoad(existing.id, existing.folder_path);
      return;
    }
    const p = await API.createProfile(folderPath);
    await this._doLoad(p.id, folderPath);
  },

  async _doLoad(profileId, folderPath) {
    S.profileId = profileId;
    S.profileFolder = folderPath;
    S.profileName = folderPath.split(/[/\\]/).pop() || '未命名';

    await API.touchProfile(profileId);
    App._settings = await API.getSettings(profileId);
    await API.scanAll(profileId);
    await API.listFav(profileId);
    console.log('[App] After scanAll - albumFolders:', S.albumFolders);
    console.log('[App] After scanAll - albumImages keys:', Object.keys(S.albumImages));

    // Show scan summary toast
    const rootCount = S.rootImages.length;
    const albumCount = S.albumFolders.length;
    const imgCount = S.buildAllImgs().length;
    Toast.show(`扫描完成: ${albumCount} 个相册, ${imgCount} 张图片 (根${rootCount})`, 'info', 5000);

    // Background
    if (App._settings.bg_image) {
      ST.applyBgImage(App._settings.bg_image);
    } else {
      ST.applyBgImage(null);
    }

    // Theme (from profile DB settings)
    ST.applyTheme(App._settings.theme_mode ?? 'dark');
    ST.applyAccent(App._settings.accent_color ?? '#60CDFF');

    document.getElementById('startup').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.querySelector('#folder-info span').textContent = folderPath;

    // Apply layout settings in rAF — ensures browser has performed layout after un-hiding
    requestAnimationFrame(() => {
      ST.applySidebarWidth(App._settings.sidebar_width ?? 270);
      ST.applySidebarOpacity(App._settings.sidebar_opacity ?? 0.85);
      ST.applySidebarFont(App._settings.sidebar_font ?? 14);
      ST.applySidebarBlur(App._settings.sidebar_blur ?? 16);
      ST.applyCardOpacity(App._settings.card_opacity ?? 1);
      ST.applyCardBlur(App._settings.card_blur ?? 0);
      ST.applyToolbarHeight(App._settings.toolbar_height ?? 48);
      ST.applyToolbarBlur(App._settings.toolbar_blur ?? 16);
      ST.applyToolbarOpacity(App._settings.toolbar_opacity ?? 0.85);
    });

    // Restore bg settings AFTER DOM is visible
    ST.applyBlur(App._settings.bg_blur ?? 20);
    ST.applyOpacity(App._settings.bg_opacity ?? 0);

    this.navPage('home');
    this._showAlbumList();
    R.renderAlbumList();
    R.updateCount();

    API.onFileChange(async payload => {
      if (payload.profileId === profileId) {
        await API.scanAll(profileId);
        if (S.currentPage === 'album') R.renderGrid();
        R.renderAlbumList();
        R.updateCount();
        Toast.show('检测到文件变更，已刷新', 'info', 1500);
      }
    });

    Toast.show('已加载: ' + S.profileName, 'success');
  },

  // ====== SIDEBAR ALBUM LIST ======

  _showAlbumList() {
    const w = document.getElementById('album-list-wrap');
    if (w) w.style.display = 'block';
  },
  _hideAlbumList() {
    const w = document.getElementById('album-list-wrap');
    if (w) w.style.display = 'none';
  },

  // ====== PAGE ROUTER ======

  _pageRoutes: {
    home: function () { /* nothing */ },
    album: function () { App._renderAlbumPageContent(); },
    discover: function () { App.switchDiscoverTab(S.discoverTab); },
    settings: function () { ST.render(); },
  },

  navPage(page) {
    S.currentPage = page;
    document.querySelectorAll('.page-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-' + page)?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    if (page === 'album') { this._hideAlbumList(); }
    else { this._showAlbumList(); }
    R.renderAlbumList();

    const route = this._pageRoutes[page];
    if (route) route.call(this);
  },

  /**
   * Unified handler for rendering album page content based on S.currentView.
   * - 'albums' → album grid only (root-level album list)
   * - nested path WITH child albums → sub-album cards + direct image grid
   * - nested path WITHOUT child albums → image grid only
   * - 'all' / 'trash' / 'favorites' → image grid
   */
  _renderAlbumPageContent() {
    const at = document.getElementById('album-toolbar');
    const ag = document.getElementById('album-grid-wrap');
    const ic = document.getElementById('image-container');

    const isRootAlbums = S.currentView === 'albums';
    // A nested folder might have sub-albums → show both grid and images
    const hasSubAlbums = !isRootAlbums && S.currentView !== 'all'
      && S.currentView !== 'trash' && S.currentView !== 'favorites'
      && S.hasChildAlbums(S.currentView);

    if (isRootAlbums) {
      // Root album grid view
      if (at) at.style.display = '';
      if (ag) { ag.style.display = ''; ag.style.paddingBottom = '0'; }
      if (ic) ic.style.display = 'none';
      R.renderAlbumGrid();
      R.updateBreadcrumb();
      this._hideAlbumList();
    } else {
      if (at) at.style.display = 'none';
      // Show album grid with sub-album cards IF the folder has children
      if (ag) {
        ag.style.display = hasSubAlbums ? '' : 'none';
        if (hasSubAlbums) {
          R.renderAlbumGrid();
        }
      }
      if (ic) ic.style.display = '';
      R.updateBreadcrumb();
      R.renderGrid();
      this._showAlbumList();
    }
    R.renderAlbumList();
  },

  _switchToAlbumPage() {
    S.currentPage = 'album';
    document.querySelectorAll('.page-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-album').classList.remove('hidden');
    this._renderAlbumPageContent();
  },

  navToAlbum(folder) {
    S.currentView = folder;
    S.currentPage = 'album';
    document.querySelectorAll('.page-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-album')?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    this._renderAlbumPageContent();
  },

  /** Navigate up one level in the folder hierarchy */
  navToParent() {
    const segs = S.getBreadcrumbSegments();
    if (segs.length <= 1) {
      S.currentView = 'albums';
      this.navPage('album');
      return;
    }
    const parentPath = segs.slice(0, -1).join('/');
    this.navToAlbum(parentPath);
  },

  navToTrash() {
    S.currentView = 'trash'; S.currentPage = 'album';
    document.querySelectorAll('.page-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-album')?.classList.remove('hidden');
    this._renderAlbumPageContent();
  },

  navToFavorites() {
    S.currentView = 'favorites'; S.currentPage = 'album';
    document.querySelectorAll('.page-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-album')?.classList.remove('hidden');
    this._renderAlbumPageContent();
  },

  switchDiscoverTab(tab) {
    S.discoverTab = tab;
    document.querySelectorAll('.discover-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.discover-tab[data-tab="${tab}"]`)?.classList.add('active');
    document.querySelectorAll('.discover-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('discover-' + tab)?.classList.remove('hidden');
    D.stopRandom();
    if (tab === 'waterfall') D.renderWaterfall();
    else if (tab === 'draw') D.renderDraw();
    else if (tab === 'random') D.startRandom();
  },

  // ====== EVENT BINDING ======

  _bindNav() {
    if (this._eventsBound) return;
    this._eventsBound = true;

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        if (page === 'home') { S.currentView = 'all'; this.navPage('home'); }
        else if (page === 'all') { S.currentView = 'all'; this._switchToAlbumPage(); }
        else if (page === 'album') { S.currentView = 'albums'; this._switchToAlbumPage(); }
        else if (page === 'favorites') this.navToFavorites();
        else if (page === 'discover') this.navPage('discover');
        else if (page === 'settings') this.navPage('settings');
      });
    });

    document.getElementById('btn-trash')?.addEventListener('click', () => this.navToTrash());
    document.getElementById('btn-switch-folder')?.addEventListener('click', () => window._switchFolder?.());
    document.getElementById('btn-new-album')?.addEventListener('click', async () => {
      const name = await Modal.prompt('新建相册', '输入相册名称');
      if (!name) return;
      try {
        await API.createFolder(S.profileId, name);
        await API.scanAll(S.profileId);
        R.renderAlbumList();
        Toast.show(`相册已创建: ${name}`, 'success');
      } catch (e) { Toast.show('创建失败: ' + e.message, 'error'); }
    });
  },

  _bindToolbar() {
    const gv = document.getElementById('btn-view-grid');
    const lv = document.getElementById('btn-view-list');
    gv?.addEventListener('click', () => {
      gv.classList.add('active'); lv?.classList.remove('active');
      App._settings.view_mode = 'grid';
      API.saveSettings(S.profileId, { view_mode: 'grid' });
      R.renderGrid();
    });
    lv?.addEventListener('click', () => {
      lv.classList.add('active'); gv?.classList.remove('active');
      App._settings.view_mode = 'list';
      API.saveSettings(S.profileId, { view_mode: 'list' });
      R.renderGrid();
    });

    document.getElementById('btn-multi-select')?.addEventListener('click', () => {
      S.multiselect = !S.multiselect;
      const btn = document.getElementById('btn-multi-select');
      if (S.multiselect) { btn.classList.add('active'); btn.textContent = '☑ 多选'; }
      else { btn.classList.remove('active'); btn.textContent = '☐ 多选'; S.selected.clear(); R.uiSel(); }
    });

    document.getElementById('search-input')?.addEventListener('input', U.debounce(() => R.renderGrid(), DEBOUNCE));
    document.getElementById('sort-select')?.addEventListener('change', e => {
      App._settings.sort_by = e.target.value;
      API.saveSettings(S.profileId, { sort_by: e.target.value });
      R.renderGrid();
    });
  },

  _bindSettings() { /* All settings use inline HTML handlers */ },

  _bindTitleBar() {
    const win = window.__TAURI__?.window?.getCurrentWindow();
    document.getElementById('btn-min')?.addEventListener('click', () => win?.minimize());
    document.getElementById('btn-max')?.addEventListener('click', () => win?.toggleMaximize());
    document.getElementById('btn-close')?.addEventListener('click', () => win?.close());
  },

  // ====== IMAGE OPERATIONS ======

  toggle(key) {
    if (S.selected.has(key)) S.selected.delete(key);
    else S.selected.add(key);
    R.uiSel();
  },

  showCtx(e, img) {
    if (!img) return;
    e.preventDefault();
    CM.show(e.clientX, e.clientY);
    const menu = document.getElementById('ctx-m');

    if (img._isTrash) {
      // Trash-specific context menu
      const te = img._trashEntry;
      menu.innerHTML = `
        <div data-action="restore">↩ 还原到原位置</div>
        <div class="ctx-sep"></div>
        <div data-action="delete" class="danger">🗑 永久删除</div>
      `;
      menu.querySelector('[data-action="restore"]').onclick = () => {
        CM.hide();
        App.restore(te.trash_name, te.original_name, te.original_folder);
      };
      menu.querySelector('[data-action="delete"]').onclick = async () => {
        CM.hide();
        const r = await Modal.show('永久删除', '文件将彻底删除，无法恢复', [{ label: '取消' }, { label: '删除', danger: true }]);
        if (r.idx !== 1) return;
        try {
          await API.permanentDelete(S.profileId, te.trash_name, TRASH_DIR);
          await API.scanAll(S.profileId); R.renderGrid(); R.updateCount();
          Toast.show('已永久删除', 'info');
        } catch (e) { Toast.show('删除失败', 'error'); }
      };
      return;
    }

    const isFav = S.favoritesSet.has(img._key);
    const isRootImg = !img._folder;
    menu.innerHTML = `
      <div data-action="locate">${isRootImg ? '📁 位于根目录' : '📁 打开相册位置'}</div>
      <div class="ctx-sep"></div>
      <div data-action="fav">${isFav ? '★ 取消收藏' : '☆ 收藏'}</div>
      <div data-action="rename">重命名</div>
      <div data-action="cover">设为封面</div>
      <div data-action="delete" class="danger">删除</div>
    `;

    menu.querySelector('[data-action="locate"]').onclick = () => {
      CM.hide();
      if (img._folder) {
        App.navToAlbum(img._folder);
      }
    };
    menu.querySelector('[data-action="fav"]').onclick = async () => {
      CM.hide();
      const added = await API.toggleFav(S.profileId, img.name, img._folder || undefined);
      if (added) S.favoritesSet.add(img._key);
      else S.favoritesSet.delete(img._key);
      R.updateFavCount();
      if (S.currentView === 'favorites') {
        await API.listFav(S.profileId);
        R.renderGrid();
      }
      Toast.show(added ? '已收藏' : '已取消收藏', 'success');
    };
    menu.querySelector('[data-action="rename"]').onclick = async () => {
      CM.hide();
      const newName = await Modal.prompt('重命名', '新文件名', img.name);
      if (!newName || newName === img.name) return;
      try {
        await API.renameFile(S.profileId, img.name, newName, img._folder);
        await API.scanAll(S.profileId); R.renderGrid(); R.renderAlbumList();
        Toast.show('已重命名', 'success');
      } catch (e) { Toast.show('重命名失败', 'error'); }
    };
    menu.querySelector('[data-action="delete"]').onclick = async () => {
      CM.hide();
      const r = await Modal.show('删除', `移入回收站？`, [{ label: '取消' }, { label: '删除', danger: true }]);
      if (r.idx !== 1) return;
      try {
        await API.moveToTrash(S.profileId, img.name, img._folder);
        await API.scanAll(S.profileId); R.renderGrid(); R.renderAlbumList(); R.updateCount();
        Toast.show('已移入回收站', 'info');
      } catch (e) { Toast.show('删除失败', 'error'); }
    };
    menu.querySelector('[data-action="cover"]').onclick = async () => {
      CM.hide();
      if (img._folder) {
        await API.setCover(S.profileId, img._folder, img.name);
        Toast.show('已设为封面', 'success');
      }
    };
  },

  albumCtx(e, folder) {
    e.preventDefault();
    CM.show(e.clientX, e.clientY);
    const menu = document.getElementById('ctx-m');
    menu.innerHTML = '<div data-action="ra">重命名相册</div><div data-action="da" class="danger">删除相册</div>';
    menu.querySelector('[data-action="ra"]').onclick = async () => {
      CM.hide();
      const nn = await Modal.prompt('重命名', '新名称', folder);
      if (!nn || nn === folder) return;
      try {
        await API.renameFolder(S.profileId, folder, nn);
        await API.scanAll(S.profileId); R.renderAlbumList(); R.renderAlbumGrid();
        Toast.show('已重命名', 'success');
      } catch (e) { Toast.show('重命名失败', 'error'); }
    };
    menu.querySelector('[data-action="da"]').onclick = async () => {
      CM.hide();
      const r = await Modal.show('删除相册', '图片移回根目录？', [{ label: '移回根目录' }, { label: '一并删除', danger: true }, { label: '取消' }]);
      if (r.idx < 0 || r.idx > 1) return;
      try {
        await API.deleteFolder(S.profileId, folder, r.idx === 0);
        await API.scanAll(S.profileId); R.renderAlbumList(); R.renderAlbumGrid();
        Toast.show('已删除', 'info');
      } catch (e) { Toast.show('删除失败', 'error'); }
    };
  },

  showMultiCtx(e) {
    if (!S.multiselect || S.selected.size === 0) return;
    e.preventDefault();
    const menu = document.getElementById('ctx-m');
    menu.innerHTML = `
      <div data-action="fav-all">☆ 批量收藏</div>
      <div data-action="unfav-all">★ 批量取消收藏</div>
      <div class="ctx-sep"></div>
      <div data-action="move">📁 移动到文件夹</div>
      <div class="ctx-sep"></div>
      <div data-action="delete" class="danger">🗑 批量删除</div>
    `;
    CM.show(e.clientX, e.clientY);

    const favAllBtn = menu.querySelector('[data-action="fav-all"]');
    const unfavAllBtn = menu.querySelector('[data-action="unfav-all"]');

    // Check if there's anything to do for each action
    const hasUnfav = [...S.selected].some(key => !S.favoritesSet.has(key));
    const hasFav = [...S.selected].some(key => S.favoritesSet.has(key));
    if (!hasUnfav) favAllBtn.style.opacity = '0.4';
    if (!hasFav) unfavAllBtn.style.opacity = '0.4';

    favAllBtn.onclick = async () => {
        CM.hide();
        let count = 0;
        for (const key of S.selected) {
            if (S.favoritesSet.has(key)) continue;
            const img = S.filteredImages.find(i => i._key === key);
            if (img) {
                try {
                    await API.toggleFav(S.profileId, img.name, img._folder || undefined);
                    S.favoritesSet.add(key);
                    count++;
                } catch(e) {}
            }
        }
        await API.listFav(S.profileId);
        if (S.currentView === 'favorites') R.renderGrid();
        R.updateFavCount();
        App._exitMultiSelect();
        Toast.show(`已收藏 ${count} 张图片`, 'success');
    };

    unfavAllBtn.onclick = async () => {
        CM.hide();
        let count = 0;
        for (const key of S.selected) {
            if (!S.favoritesSet.has(key)) continue;
            const img = S.filteredImages.find(i => i._key === key);
            if (img) {
                try {
                    await API.toggleFav(S.profileId, img.name, img._folder || undefined);
                    S.favoritesSet.delete(key);
                    count++;
                } catch(e) {}
            }
        }
        await API.listFav(S.profileId);
        if (S.currentView === 'favorites') R.renderGrid();
        R.updateFavCount();
        App._exitMultiSelect();
        Toast.show(`已取消收藏 ${count} 张图片`, 'success');
    };

    menu.querySelector('[data-action="move"]').onclick = async () => {
        CM.hide();
        const folderName = await Modal.prompt('移动到文件夹', '输入目标文件夹名称');
        if (!folderName) return;
        let count = 0;
        for (const key of S.selected) {
            const img = S.filteredImages.find(i => i._key === key);
            if (img && img._folder !== folderName) {
                try {
                    if (img._folder) {
                        await API.moveBetween(S.profileId, img.name, img._folder, folderName);
                    } else {
                        await API.moveToFolder(S.profileId, img.name, folderName);
                    }
                    count++;
                } catch(e) {}
            }
        }
        if (count > 0) {
            await API.scanAll(S.profileId);
            R.renderGrid();
            R.renderAlbumList();
        }
        App._exitMultiSelect();
        Toast.show(`已移动 ${count} 张图片`, 'success');
    };

    menu.querySelector('[data-action="delete"]').onclick = async () => {
        CM.hide();
        const r = await Modal.show('批量删除', `将 ${S.selected.size} 张图片移入回收站？`, [{ label: '取消' }, { label: '删除', danger: true }]);
        if (r.idx !== 1) return;
        let count = 0;
        for (const key of S.selected) {
            const img = S.filteredImages.find(i => i._key === key);
            if (img) {
                try {
                    await API.moveToTrash(S.profileId, img.name, img._folder);
                    count++;
                } catch(e) {}
            }
        }
        if (count > 0) {
            await API.scanAll(S.profileId);
            R.renderGrid();
            R.renderAlbumList();
            R.updateCount();
        }
        App._exitMultiSelect();
        Toast.show(`已删除 ${count} 张图片`, 'success');
    };
  },

  _exitMultiSelect() {
    S.multiselect = false;
    S.selected.clear();
    const btn = document.getElementById('btn-multi-select');
    if (btn) { btn.classList.remove('active'); btn.textContent = '☐ 多选'; }
    R.uiSel();
  },

  async deleteFromLb() {
    if (S.lbIdx < 0) return;
    const img = S.filteredImages[S.lbIdx];
    if (!img) return;
    const r = await Modal.show('删除', '移入回收站？', [{ label: '取消' }, { label: '删除', danger: true }]);
    if (r.idx !== 1) return;
    try {
      await API.moveToTrash(S.profileId, img.name, img._folder);
      Lb.close(); await API.scanAll(S.profileId);
      R.renderGrid(); R.renderAlbumList(); R.updateCount();
      Toast.show('已移入回收站', 'info');
    } catch (e) { Toast.show('删除失败', 'error'); }
  },

  async restore(trashName, originalName, originalFolder) {
    try {
      await API.restore(S.profileId, trashName, originalName, originalFolder);
      await API.scanAll(S.profileId); R.renderGrid(); R.renderAlbumList(); R.updateCount();
      Toast.show('已恢复', 'success');
    } catch (e) { Toast.show('恢复失败: ' + e.message, 'error'); }
  },
};

// ====== GLOBAL HELPERS ======

window._openBgFolder = async () => {
  await API._invoke('bg_open_folder', { profileId: S.profileId });
};

window._importBg = async () => {
  const imported = await API._invoke('bg_import', { profileId: S.profileId });
  if (imported) {
    await API.scanAll(S.profileId);
    ST._loadBgList();
    ST.applyBgImage(imported);
    Toast.show('背景图已导入', 'success');
  }
};

/** Sync js-check badge colors to match current theme */
function _syncJsCheck() {
  var el = document.getElementById('js-check');
  if (!el) return;
  var isLight = false;
  try {
    // Read computed background of startup container (not CSS var, which may vary)
    var startupEl = document.getElementById('startup');
    if (startupEl) {
      var rgb = getComputedStyle(startupEl).backgroundColor;
      // Light bg is rgb(243, 243, 243), dark bg is rgb(28, 28, 28)
      // Check if the red channel > 128 (light) or < 128 (dark)
      var nums = rgb.replace(/[^\d,]/g, '').split(',').map(Number);
      if (nums.length >= 3 && nums[0] > 128) isLight = true;
    } else {
      // Fallback: check document body
      var rgb = getComputedStyle(document.body).backgroundColor;
      var nums = rgb.replace(/[^\d,]/g, '').split(',').map(Number);
      if (nums.length >= 3 && nums[0] > 128) isLight = true;
    }
  } catch(e){}
  el.style.background = isLight ? '#d4edda' : '#1a472a';
  el.style.color = isLight ? '#155724' : '#b0e0b0';
  el.style.borderColor = isLight ? '#c3e6cb' : '#2d6a4f';
}

window._switchFolder = async () => {
  const r = await Modal.show('更换文件夹', '选择已有或添加新文件夹？', [
    { label: '选择已有' }, { label: '添加新文件夹', primary: true }, { label: '取消' },
  ]);
  if (r.idx === 0) {
    const profiles = await API.listProfiles();
    const sp = document.getElementById('startup');
    const spl = document.getElementById('startup-profiles');
    App._renderProfileList(spl, profiles);
    spl.classList.remove('hidden');
    sp.classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    _syncJsCheck();
    if (D.stopRandom) D.stopRandom();
  } else if (r.idx === 1) {
    App._selectAndLoad();
  }
};

// ====== LIGHTBOX ACTIONS ======

document.getElementById('lightbox-star')?.addEventListener('click', () => {
  if (S.lbIdx < 0) return;
  const img = S.filteredImages[S.lbIdx];
  if (!img) return;
  API.toggleFav(S.profileId, img.name, img._folder || undefined).then(added => {
    if (added) S.favoritesSet.add(img._key);
    else S.favoritesSet.delete(img._key);
    Lb._update(); R.updateFavCount();
  });
});
document.getElementById('lightbox-delete')?.addEventListener('click', () => App.deleteFromLb());

// ====== HOME CARD NAVIGATION ======

// Rescan card
document.querySelectorAll('.home-card[data-action="rescan"]').forEach(card => {
  card.addEventListener('click', async () => {
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';
    try {
      await API.scanAll(S.profileId);
      R.renderAlbumList();
      R.updateCount();
      if (S.currentPage === 'album') R.renderGrid();
      Toast.show('已刷新', 'success');
    } catch (e) {
      Toast.show('刷新失败: ' + e.message, 'error');
    }
    card.style.opacity = '';
    card.style.pointerEvents = '';
  });
});

document.querySelectorAll('.home-card[data-nav]').forEach(card => {
  card.addEventListener('click', () => {
    const nav = card.dataset.nav;
    if (nav === 'album') { S.currentView = 'albums'; App._switchToAlbumPage(); }
    else if (nav.startsWith('discover-')) { S.discoverTab = nav.split('-')[1]; App.navPage('discover'); }
  });
});

document.querySelectorAll('.discover-tab').forEach(tab => {
  tab.addEventListener('click', () => App.switchDiscoverTab(tab.dataset.tab));
});

document.addEventListener('keydown', e => {
  // ESC: go back one level in folder hierarchy (if lightbox not open)
  if (e.key === 'Escape' && S.lbIdx < 0 && S.currentPage === 'album' && S.currentView !== 'all' && S.currentView !== 'albums' && S.currentView !== 'trash' && S.currentView !== 'favorites') {
    App.navToParent();
    return;
  }
  if (e.ctrlKey && e.key === 'f' && S.currentPage === 'album') {
    e.preventDefault();
    document.getElementById('search-input')?.focus();
  }
});

document.addEventListener('DOMContentLoaded', () => App.init());
