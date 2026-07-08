// ============================================================
// Photo Album — App Controller (clean)
// ============================================================

// 存储各视图的滚动位置
const _scrollPos = {};

const App = {
  _settings: {},
  _eventsBound: false,

  // ====== LIFECYCLE ======

  async init() {
    // Startup: use last saved theme, fallback to system preference
    try {
      var savedTheme = localStorage.getItem('pa_theme_mode');
      if (!savedTheme) savedTheme = 'system';
      ST.applyTheme(savedTheme);
      var savedAccentDark = localStorage.getItem('pa_accent_color_dark') || '#4A9EFF';
      var savedAccentLight = localStorage.getItem('pa_accent_color_light') || '#003D7A';
      ST.applyAccent(savedAccentDark, 'dark');
      ST.applyAccent(savedAccentLight, 'light');
      ST.applyCurrentAccent();
      _syncJsCheck();
      Icons.init();
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

      // Global handlers: browser contextmenu prevention
      document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });

      // Click outside context menu closes it
      document.addEventListener('click', (e) => {
        const ctxMenu = document.getElementById('ctx-m');
        if (ctxMenu && !ctxMenu.classList.contains('hidden') && !ctxMenu.contains(e.target)) {
          CM.hide();
        }
      });

      // Blank area in album grid → new folder
      document.getElementById('album-grid-wrap')?.addEventListener('contextmenu', async (e) => {
        if (e.target.closest('.album-card')) return;
        e.preventDefault();
        e.stopPropagation();
        const name = await Modal.prompt('新建文件夹', '输入文件夹名称');
        if (!name) return;
        try {
          await API.createFolder(S.profileId, name, S.currentView === 'albums' ? undefined : S.currentView);
          await API.scanAll(S.profileId);
          R.renderAlbumList();
          const agWrap1 = document.getElementById('album-grid-wrap');
          if (agWrap1) agWrap1.style.display = '';
          R.renderAlbumGrid();
          Toast.show('文件夹已创建', 'success');
        } catch (e) {
          Toast.show('创建失败: ' + e.message, 'error');
        }
      });

      // Blank area on page-scroll → new folder
      document.querySelector('#page-album .page-scroll')?.addEventListener('contextmenu', async (e) => {
        if (e.target.closest('.album-card') || e.target.closest('.image-card') || e.target.closest('#album-grid') || e.target.closest('#image-grid')) return;
        e.preventDefault();
        e.stopPropagation();
        const name = await Modal.prompt('新建文件夹', '输入文件夹名称');
        if (!name) return;
        try {
          await API.createFolder(S.profileId, name, S.currentView === 'albums' ? undefined : S.currentView);
          await API.scanAll(S.profileId);
          R.renderAlbumList();
          const agWrap2 = document.getElementById('album-grid-wrap');
          if (agWrap2) agWrap2.style.display = '';
          R.renderAlbumGrid();
          R.updateCount();
          Toast.show('文件夹已创建', 'success');
        } catch (e) {
          Toast.show('创建失败: ' + e.message, 'error');
        }
      });

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
        if (!p) return;
        if (p.unavailable) {
          const r = await Modal.show('文件夹不可用',
            `「${U.esc(p.name)}」的文件夹路径 ${U.esc(p.folder_path)} 不存在或已被移动。`,
            [
              { label: '重新定位', primary: true },
              { label: '删除记录', danger: true },
              { label: '取消' }
            ]
          );
          if (r.idx === 0) {
            const result = await API.relocateProfile(p.id);
            if (result) await this._doLoad(result.id, result.folder_path);
          } else if (r.idx === 1) {
            await API.removeProfile(p.id);
            const updated = await API.listProfiles();
            this._renderProfileList(container, updated);
            Toast.show('已删除记录', 'info');
          }
          return;
        }
        await this._doLoad(p.id, p.folder_path);
      });

      // 右键删除 profile
      card.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const p = profiles.find(x => x.id === card.dataset.id);
        if (!p) return;
        CM.show(e.clientX, e.clientY);
        const menu = document.getElementById('ctx-m');
        menu.innerHTML = '<div data-action="delete" class="danger">' + Icons.icon('trash', 14) + ' 删除此记录</div>';
        menu.querySelector('[data-action="delete"]').onclick = async () => {
          CM.hide();
          const r = await Modal.show('删除记录',
            `仅删除项目注册记录，「${U.esc(p.name)}」的 .album 配置和图片文件不受影响。`,
            [{ label: '取消' }, { label: '确认删除', danger: true }]);
          if (r.idx !== 1) return;
          await API.removeProfile(p.id);
          const updated = await API.listProfiles();
          this._renderProfileList(container, updated);
          Toast.show('已删除记录', 'info');
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
        const r = await Modal.show('删除记录', '仅删除项目注册记录，.album 配置和图片文件不受影响。', [{ label: '取消' }, { label: '确认删除', danger: true }]);
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
    try {
      S.profileId = profileId;
      S.profileFolder = folderPath;
      S.profileName = folderPath.split(/[/\\]/).pop() || '未命名';

      document.getElementById('search-input').value = '';
      document.getElementById('search-neg').value = '';

      await API.touchProfile(profileId);
      App._settings = await API.getSettings(profileId);
      // v2.8.2: 同步强调色隔离字段默认值
      const s = App._settings;
      s.bg_image_accent_mode = s.bg_image_accent_mode || 'custom';
      s.bg_image_accent_color_dark = s.bg_image_accent_color_dark || '#4A9EFF';
      s.bg_image_accent_color_light = s.bg_image_accent_color_light || '#003D7A';
      s.transparent_accent_color_dark = s.transparent_accent_color_dark || '#4A9EFF';
      s.transparent_accent_color_light = s.transparent_accent_color_light || '#003D7A';
      s.extract_color_dark = s.extract_color_dark || '#4A9EFF';
      s.extract_color_light = s.extract_color_light || '#003D7A';
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
      ST.applyTheme(App._settings.theme_mode ?? 'system');
      // Apply accent - store both modes, then apply current visual
      ST.applyAccent(App._settings.accent_color_dark ?? '#4A9EFF', 'dark');
      ST.applyAccent(App._settings.accent_color_light ?? '#003D7A', 'light');
      ST.applyCurrentAccent();

      document.getElementById('startup').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      document.querySelector('#folder-info span').textContent = folderPath;
      document.getElementById('folder-info').onclick = () => {
        API.openInExplorer(folderPath);
      };
      document.getElementById('folder-info').style.cursor = 'pointer';

      // Apply layout settings in rAF — ensures browser has performed layout after un-hiding
      requestAnimationFrame(() => {
        ST.applySidebarWidth(App._settings.sidebar_width ?? 150);
        ST.applySidebarOpacity(App._settings.sidebar_opacity ?? 0.7);
        ST.applySidebarFont(App._settings.sidebar_font ?? 20);
        ST.applySidebarBlur(App._settings.sidebar_blur ?? 16);
        ST.applyCardOpacity(App._settings.card_opacity ?? 0.7);
        ST.applyCardBlur(App._settings.card_blur ?? 16);
        ST.applyToolbarHeight(App._settings.toolbar_height ?? 56);
        ST.applyToolbarBlur(App._settings.toolbar_blur ?? 16);
        ST.applyToolbarOpacity(App._settings.toolbar_opacity ?? 0.7);
        document.documentElement.style.setProperty('--overlay-opacity', String(App._settings.select_overlay_opacity ?? 0.2));
        ST.applyReverseSearch(App._settings.reverse_search_enabled ?? false);
        ST.applyListColumns(App._settings.list_columns ?? 3);

        // Sync view mode toolbar buttons
        const currViewMode = App._settings.view_mode ?? 'grid';
        const gvBtn = document.getElementById('btn-view-grid');
        const lvBtn = document.getElementById('btn-view-list');
        if (gvBtn && lvBtn) {
          if (currViewMode === 'list') {
            lvBtn.classList.add('active');
            gvBtn.classList.remove('active');
          } else {
            gvBtn.classList.add('active');
            lvBtn.classList.remove('active');
          }
        }

        // Sync sort select
        const sortSelectEl = document.getElementById('sort-select');
        if (sortSelectEl) {
          sortSelectEl.value = App._settings.sort_by ?? 'name-asc';
        }

        // Apply home_title
        const homeTitleEl = document.getElementById('home-title');
        if (homeTitleEl) {
          homeTitleEl.textContent = App._settings.home_title || '我的相册';
        }
      });

      // 透明背景同步
      if (App._settings.bg_transparent) {
        App._settings.accent_mode = 'custom';  // 透明模式下强制自定义
        ST.applyBgTransparent(true);
        // 同步效果类型
        const efType = App._settings.bg_effect_type || 'acrylic';
        // 重新应用窗口效果
        API._invoke('window_set_effect', { enabled: true, effect_type: efType }).catch(() => {});
        // 应用覆盖层
        ST._updateOverlayOpacity(App._settings.bg_opacity ?? 1.0);
        ST._updateOverlayBlur(App._settings.bg_blur ?? 0);
      } else {
        document.documentElement.classList.remove('bg-transparent-mode');
      }

      // Restore bg settings AFTER DOM is visible
      ST.applyBlur(App._settings.bg_blur ?? 0);
      ST.applyOpacity(App._settings.bg_opacity ?? 1.0);

      // Initialize system theme listener
      ST.initSystemThemeListener();

      // Auto-extract accent if in extract mode
      if (App._settings?.accent_mode === 'extract' && App._settings?.bg_image) {
        ST.extractAccent();
      }

      this.navPage('home');
      this._showAlbumList();
      R.renderAlbumList();
      R.updateCount();
      this._updateDashboard();

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
    } catch (e) {
      console.error('_doLoad error:', e);
      Toast.show('加载失败: ' + (e.message || e), 'error', 5000);
    }
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
    // 离开相册页面时清空滚动缓存
    if (page !== 'album') {
        for (const key in _scrollPos) delete _scrollPos[key];
    }
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
    const ag = document.getElementById('album-grid-wrap');
    const ic = document.getElementById('image-container');

    const isRootAlbums = S.currentView === 'albums';
    // A nested folder might have sub-albums → show both grid and images
    const hasSubAlbums = !isRootAlbums && S.currentView !== 'all'
      && S.currentView !== 'trash' && S.currentView !== 'favorites'
      && S.hasChildAlbums(S.currentView);

    if (isRootAlbums) {
      // Root album grid view
      if (ag) { ag.style.display = ''; ag.style.paddingBottom = '0'; }
      if (ic) ic.style.display = 'none';
      R.renderAlbumGrid();
      R.updateBreadcrumb();
      this._hideAlbumList();
    } else {
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
    // Back button visibility
    const btnBack = document.getElementById('btn-back');
    if (btnBack) {
        const isRoot = S.currentView === 'all' || S.currentView === 'albums' || S.currentView === 'trash' || S.currentView === 'favorites';
        btnBack.style.display = isRoot ? 'none' : '';
    }

    // Nav highlight: update sidebar active tab
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    let pageKey = 'album';
    if (S.currentView === 'all') pageKey = 'all';
    else if (S.currentView === 'favorites') pageKey = 'favorites';
    else if (S.currentView === 'trash') pageKey = 'trash';
    const navItem = document.querySelector(`.nav-item[data-page="${pageKey}"]`);
    if (navItem) navItem.classList.add('active');

    R.renderAlbumList();
  },

  _switchToAlbumPage() {
    S.currentPage = 'album';
    document.querySelectorAll('.page-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-album').classList.remove('hidden');
    this._renderAlbumPageContent();
  },

  navToAlbum(folder) {
    // 保存当前视图的滚动位置
    const scrollEl = document.querySelector('#page-album .page-scroll');
    if (scrollEl) _scrollPos[S.currentView] = scrollEl.scrollTop;

    S.currentView = folder;
    S.currentPage = 'album';
    document.querySelectorAll('.page-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-album')?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    this._renderAlbumPageContent();

    // 恢复目标视图的滚动位置（retry机制等待DOM就绪）
    const tryRestore = (f, retries) => {
        const el = document.querySelector('#page-album .page-scroll');
        if (el && _scrollPos[f] !== undefined && el.scrollHeight > 0) {
            el.scrollTop = _scrollPos[f];
        } else if (retries > 0) {
            setTimeout(() => tryRestore(f, retries - 1), 80);
        }
    };
    setTimeout(() => tryRestore(folder, 10), 50);
  },

  /** Navigate up one level in the folder hierarchy */
  navToParent() {
    const segs = S.getBreadcrumbSegments();
    if (segs.length <= 1) {
      const scrollEl = document.querySelector('#page-album .page-scroll');
      if (scrollEl) _scrollPos[S.currentView] = scrollEl.scrollTop;
      S.currentView = 'albums';
      this.navPage('album');
      const tryRestore = (f, retries) => {
        const el = document.querySelector('#page-album .page-scroll');
        if (el && _scrollPos[f] !== undefined && el.scrollHeight > 0) {
          el.scrollTop = _scrollPos[f];
        } else if (retries > 0) {
          setTimeout(() => tryRestore(f, retries - 1), 80);
        }
      };
      setTimeout(() => tryRestore('albums', 10), 50);
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
        R.renderAlbumGrid();
        R.updateCount();
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
      const appEl = document.getElementById('app');
      if (S.multiselect) {
          btn.classList.add('active'); btn.innerHTML = Icons.icon('square-check', 14) + ' 多选';
          if (appEl) appEl.classList.add('multiselect-mode');
      } else {
          btn.classList.remove('active'); btn.innerHTML = Icons.icon('square-check', 14) + ' 多选';
          S.selected.clear(); R.uiSel();
          if (appEl) appEl.classList.remove('multiselect-mode');
      }
    });

    document.getElementById('search-input')?.addEventListener('input', U.debounce(async () => {
      S._searchAlbumMatchType = {};
      await R.renderGrid();
      if (S.currentView === 'albums' || S.currentView === 'all'
          || (S.currentView !== 'trash' && S.currentView !== 'favorites'
              && S.hasChildAlbums(S.currentView))) {
          await R.renderAlbumGrid();
      }
    }, DEBOUNCE));
    document.getElementById('search-neg')?.addEventListener('input', U.debounce(async () => {
        S._searchAlbumMatchType = {};
        await R.renderGrid();
        if (S.currentView === 'albums' || S.currentView === 'all'
            || (S.currentView !== 'trash' && S.currentView !== 'favorites'
                && S.hasChildAlbums(S.currentView))) {
            await R.renderAlbumGrid();
        }
    }, DEBOUNCE));
    document.getElementById('sort-select')?.addEventListener('change', e => {
      App._settings.sort_by = e.target.value;
      API.saveSettings(S.profileId, { sort_by: e.target.value });
      R.renderGrid();
    });

    // Back button
    document.getElementById('btn-back')?.addEventListener('click', () => App.navToParent());

    // Search right-click clear
    document.getElementById('search-input')?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.target.value = '';
        e.target.dispatchEvent(new Event('input'));
    });
    document.getElementById('search-neg')?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.target.value = '';
        e.target.dispatchEvent(new Event('input'));
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
        <div data-action="restore">${Icons.icon('undo', 14)} 还原到原位置</div>
      `;
      menu.querySelector('[data-action="restore"]').onclick = () => {
        CM.hide();
        App.restore(te.trash_name, te.original_name, te.original_folder);
      };
      return;
    }

    const isFav = S.favoritesSet.has(img._key);
    const isRootImg = !img._folder;
    menu.innerHTML = `
      <div data-action="locate">${Icons.icon('folder-open', 14)} ${isRootImg ? '位于根目录' : '打开相册位置'}</div>
      <div class="ctx-sep"></div>
      <div data-action="fav">${isFav ? Icons.icon('star', 14) + ' 取消收藏' : Icons.icon('star', 14) + ' 收藏'}</div>
      <div data-action="rename">重命名</div>
      <div data-action="cover">设为封面</div>
      <div class="ctx-sep"></div>
      <div data-action="move">${Icons.icon('folder', 14)} 移动到文件夹</div>
      <div class="ctx-sep"></div>
      <div data-action="explorer">${Icons.icon('external-link', 14)} 在资源管理器中打开</div>
      <div class="ctx-sep"></div>
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
    menu.querySelector('[data-action="move"]').onclick = async () => {
      CM.hide();
      App._moveToFolder(img);
    };
    menu.querySelector('[data-action="explorer"]').onclick = () => {
      CM.hide();
      const dirPath = img._folder
        ? S.profileFolder + '/' + img._folder
        : S.profileFolder;
      API.openInExplorer(dirPath);
    };
  },

  albumCtx(e, folder) {
    e.preventDefault();
    CM.show(e.clientX, e.clientY);
    const menu = document.getElementById('ctx-m');
    menu.innerHTML = `
      <div data-action="explorer">${Icons.icon('external-link', 14)} 在资源管理器中打开</div>
      <div class="ctx-sep"></div>
      <div data-action="ra">重命名相册</div>
      <div data-action="da" class="danger">删除相册</div>
    `;
    menu.querySelector('[data-action="explorer"]').onclick = () => {
      CM.hide();
      const folderPath = S.profileFolder + '/' + folder;
      API.openInExplorer(folderPath);
    };
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
        await API.scanAll(S.profileId); R.renderAlbumList(); R.renderAlbumGrid(); R.updateCount();
        Toast.show('已删除', 'info');
      } catch (e) { Toast.show('删除失败', 'error'); }
    };
  },

  showMultiCtx(e) {
    if (!S.multiselect || S.selected.size === 0) return;
    e.preventDefault();
    const allImgs = S.buildAllImgs();
    const menu = document.getElementById('ctx-m');

    if (S.currentView === 'trash') {
        e.preventDefault();
        menu.innerHTML = `
          <div data-action="restore-all">${Icons.icon('undo', 14)} 批量还原</div>
        `;
        CM.show(e.clientX, e.clientY);
        menu.querySelector('[data-action="restore-all"]').onclick = async () => {
            CM.hide();
            let count = 0, failCount = 0;
            for (const key of S.selected) {
                const { filename, folder } = parseKey(key);
                const allImgsLocal = S.buildAllImgs();
                const img = allImgsLocal.find(i => i._key === key);
                if (img && img._isTrash && img._trashEntry) {
                    const te = img._trashEntry;
                    try {
                        await API.restore(S.profileId, te.trash_name, te.original_name, te.original_folder);
                        count++;
                    } catch(e) { console.error('操作失败:', e); failCount++; }
                }
            }
            if (count > 0) {
                await API.scanAll(S.profileId);
                R.renderGrid();
                R.renderAlbumList();
                R.updateCount();
            }
            if (failCount > 0) Toast.show(`${failCount} 个操作失败`, 'error');
            App._exitMultiSelect();
            Toast.show(`已还原 ${count} 张图片`, 'success');
        };
        return;
    }

    menu.innerHTML = `
      <div data-action="fav-all">${Icons.icon('star', 14)} 批量收藏</div>
      <div data-action="unfav-all">${Icons.icon('star', 14)} 批量取消收藏</div>
      <div class="ctx-sep"></div>
      <div data-action="move">${Icons.icon('folder-open', 14)} 移动到文件夹</div>
      <div class="ctx-sep"></div>
      <div data-action="delete" class="danger">${Icons.icon('trash', 14)} 批量删除</div>
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
        let count = 0, failCount = 0;
        for (const key of [...S.selected]) {
            if (S.favoritesSet.has(key)) continue;
            const { filename, folder } = parseKey(key);
            try {
                await API.toggleFav(S.profileId, filename, folder || undefined);
                S.favoritesSet.add(key);
                count++;
            } catch(e) { console.error('操作失败:', e); failCount++; }
        }
        await API.listFav(S.profileId);
        if (S.currentView === 'favorites') R.renderGrid();
        R.updateFavCount();
        if (failCount > 0) Toast.show(`${failCount} 个操作失败`, 'error');
        App._exitMultiSelect();
        Toast.show(`已收藏 ${count} 张图片`, 'success');
    };

    unfavAllBtn.onclick = async () => {
        CM.hide();
        let count = 0, failCount = 0;
        for (const key of [...S.selected]) {
            if (!S.favoritesSet.has(key)) continue;
            const { filename, folder } = parseKey(key);
            try {
                await API.toggleFav(S.profileId, filename, folder || undefined);
                S.favoritesSet.delete(key);
                count++;
            } catch(e) { console.error('操作失败:', e); failCount++; }
        }
        await API.listFav(S.profileId);
        if (S.currentView === 'favorites') R.renderGrid();
        R.updateFavCount();
        if (failCount > 0) Toast.show(`${failCount} 个操作失败`, 'error');
        App._exitMultiSelect();
        Toast.show(`已取消收藏 ${count} 张图片`, 'success');
    };

    menu.querySelector('[data-action="move"]').onclick = async () => {
        CM.hide();
        const selectedKeys = Array.from(S.selected);
        const selectedPath = await API.openFolder('选择目标文件夹');
        if (!selectedPath) return;
        const normProfile = S.profileFolder.replace(/\\/g, '/').replace(/\/$/, '');
        const normSelected = selectedPath.replace(/\\/g, '/').replace(/\/$/, '');
        const prefix = normProfile + '/';
        let targetFolder = normSelected.startsWith(prefix) ? normSelected.slice(prefix.length) : normSelected;
        if (normSelected === normProfile) targetFolder = '';
        if (targetFolder.includes('\\')) targetFolder = targetFolder.replace(/\\/g, '/');
        let count = 0, failCount = 0;
        for (const key of selectedKeys) {
            const { filename, folder } = parseKey(key);
            if (folder !== null && folder !== targetFolder) {
                try {
                    if (targetFolder === '' && folder !== null) {
                        await API.moveToRoot(S.profileId, filename, folder);
                    } else if (folder !== null) {
                        await API.moveBetween(S.profileId, filename, folder, targetFolder);
                    } else {
                        await API.moveToFolder(S.profileId, filename, targetFolder);
                    }
                    count++;
                } catch(e) { console.error('操作失败:', e); failCount++; }
            } else if (folder === null && targetFolder !== '') {
                try {
                    await API.moveToFolder(S.profileId, filename, targetFolder);
                    count++;
                } catch(e) { console.error('操作失败:', e); failCount++; }
            }
        }
        if (count > 0) {
            await API.scanAll(S.profileId);
            R.renderGrid();
            R.renderAlbumList();
            R.updateCount();
        }
        if (failCount > 0) Toast.show(`${failCount} 个操作失败`, 'error');
        App._exitMultiSelect();
        Toast.show(`已移动 ${count} 张图片`, 'success');
    };

    menu.querySelector('[data-action="delete"]').onclick = async () => {
        CM.hide();
        const r = await Modal.show('批量删除', `将 ${S.selected.size} 张图片移入回收站？`, [{ label: '取消' }, { label: '删除', danger: true }]);
        if (r.idx !== 1) return;
        let count = 0, failCount = 0;
        for (const key of S.selected) {
            const { filename, folder } = parseKey(key);
            try {
                await API.moveToTrash(S.profileId, filename, folder || undefined);
                count++;
            } catch(e) { console.error('操作失败:', e); failCount++; }
        }
        if (count > 0) {
            await API.scanAll(S.profileId);
            R.renderGrid();
            R.renderAlbumList();
            R.updateCount();
        }
        if (failCount > 0) Toast.show(`${failCount} 个操作失败`, 'error');
        App._exitMultiSelect();
        Toast.show(`已删除 ${count} 张图片`, 'success');
    };
  },

  async _moveToFolder(img) {
    const selectedPath = await API.openFolder('选择目标文件夹');
    if (!selectedPath) return;
    const normProfile = S.profileFolder.replace(/\\/g, '/').replace(/\/$/, '');
    const normSelected = selectedPath.replace(/\\/g, '/').replace(/\/$/, '');
    const prefix = normProfile + '/';
    let targetFolder = normSelected.startsWith(prefix) ? normSelected.slice(prefix.length) : normSelected;
    if (normSelected === normProfile) targetFolder = '';
    if (targetFolder.includes('\\')) targetFolder = targetFolder.replace(/\\/g, '/');
    try {
        if (img._folder) {
            await API.moveBetween(S.profileId, img.name, img._folder, targetFolder);
        } else {
            await API.moveToFolder(S.profileId, img.name, targetFolder);
        }
        await API.scanAll(S.profileId);
        R.renderGrid();
        R.updateCount();
        Toast.show('已移动', 'success');
    } catch (e) {
        console.error('操作失败:', e);
        Toast.show('移动失败: ' + e.message, 'error');
    }
  },

  _exitMultiSelect() {
    S.multiselect = false;
    S.selected.clear();
    const btn = document.getElementById('btn-multi-select');
    if (btn) { btn.classList.remove('active'); btn.innerHTML = Icons.icon('square-check', 14) + ' 多选'; }
    const appEl = document.getElementById('app');
    if (appEl) appEl.classList.remove('multiselect-mode');
    R.uiSel();
  },

  _updateDashboard() {
    const totalImgs = S.rootImages.length + Object.values(S.albumImages).reduce((s, a) => s + a.length, 0);
    const totalSize = S.rootImages.reduce((s, img) => s + (img.size || 0), 0)
        + Object.values(S.albumImages).reduce((s, arr) => s + arr.reduce((s2, img) => s2 + (img.size || 0), 0), 0);
    const elImgs = document.getElementById('stat-total-imgs');
    const elSize = document.getElementById('stat-total-size');
    const elAlbums = document.getElementById('stat-albums');
    const elFavs = document.getElementById('stat-favs');
    if (elImgs) elImgs.textContent = totalImgs;
    if (elSize) elSize.textContent = U.fmtSize(totalSize);
    if (elAlbums) elAlbums.textContent = S.albumFolders.length;
    if (elFavs) elFavs.textContent = S.favoritesSet.size;
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

/** Parse _key (folder/filename) into folder and filename */
function parseKey(key) {
    const i = key.lastIndexOf('/');
    return i >= 0
        ? { filename: key.substring(i + 1), folder: key.substring(0, i) }
        : { filename: key, folder: null };
}

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

window._exportFavorites = async () => {
  const savePath = await window.__TAURI__.dialog.save({
    filters: [{ name: '收藏文件', extensions: ['json'] }]
  });
  if (!savePath) return;
  try {
    const json = await API.exportFavorites(S.profileId);
    await API._invoke('write_text_file', { path: savePath, content: json });
    Toast.show('收藏已导出', 'success');
  } catch (e) {
    Toast.show('导出失败: ' + (e.message || e), 'error');
  }
};

window._importFavorites = async () => {
  const openPath = await window.__TAURI__.dialog.open({
    filters: [{ name: '收藏文件', extensions: ['json'] }],
    multiple: false,
  });
  if (!openPath) return;
  const r = await Modal.show('导入收藏', '请选择导入模式', [
    { label: '合并', primary: true },
    { label: '覆盖', danger: true },
    { label: '取消' }
  ]);
  if (r.idx === 2 || r.idx < 0) return;
  const mode = r.idx === 0 ? 'merge' : 'overwrite';
  try {
    const data = await API._invoke('read_text_file', { path: openPath });
    const count = await API.importFavorites(S.profileId, data, mode);
    await API.listFav(S.profileId);
    R.updateFavCount();
    if (S.currentView === 'favorites') R.renderGrid();
    Toast.show(`已导入 ${count} 条收藏`, 'success');
  } catch (e) {
    Toast.show('导入失败: ' + (e.message || e), 'error');
  }
};

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
  // Star animation
  const starBtn = document.getElementById('lightbox-star');
  starBtn.classList.remove('lb-star-animate');
  void starBtn.offsetWidth;
  starBtn.classList.add('lb-star-animate');
  setTimeout(() => starBtn.classList.remove('lb-star-animate'), 300);

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
      App._updateDashboard();
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
    return;
  }
  // 空格聚焦搜索栏（仅在 album 页面、不在搜索框内、不在其他输入框内、灯箱关闭时）
  if (e.key === ' ' && S.lbIdx < 0 && S.currentPage === 'album'
      && document.activeElement !== document.getElementById('search-input')
      && document.activeElement?.tagName !== 'INPUT'
      && document.activeElement?.tagName !== 'TEXTAREA') {
    e.preventDefault();
    const si = document.getElementById('search-input');
    if (si) { si.focus(); si.select(); }
    return;
  }
});

document.addEventListener('DOMContentLoaded', () => App.init());
