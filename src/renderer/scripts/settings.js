// ============================================================
// Photo Album — Settings (clean)
// ============================================================

const ST = {
  /**
   * Render settings page — set current values on all controls.
   */
  render() {
    try {
      const s = App._settings;
      if (!s) return;
      this._setVal('set-theme', null); // Button-based, handled separately
      this._setVal('set-accent', s.accent_color ?? '#60CDFF');
      this._setVal('set-bg-blur', s.bg_blur ?? 20);
      this._setVal('set-bg-opacity', Math.round((s.bg_opacity ?? 0) * 100));
      this._setVal('set-thumb-size', s.thumbnail_size ?? 400);
      this._setVal('set-draw-count', s.draw_count ?? 3);
      this._setVal('set-random-interval', s.random_interval ?? 3);
      this._setVal('set-sidebar-w', s.sidebar_width ?? 270);
      this._setVal('set-sidebar-opacity', Math.round((s.sidebar_opacity ?? 0.85) * 100));
      this._setVal('set-sidebar-font', s.sidebar_font ?? 14);
      this._setVal('set-sidebar-blur', s.sidebar_blur ?? 16);
      this._setVal('set-card-opacity', Math.round((s.card_opacity ?? 1) * 100));
      this._setVal('set-card-blur', s.card_blur ?? 0);
      this._setVal('set-toolbar-h', s.toolbar_height ?? 48);
      this._setVal('set-toolbar-blur', s.toolbar_blur ?? 16);
      this._setVal('set-toolbar-opacity', Math.round((s.toolbar_opacity ?? 0.85) * 100));
      this._setVal('set-overlay-opacity', Math.round((s.select_overlay_opacity ?? 0.2) * 100));
      this._setVal('set-list-cols', s.list_columns ?? 1);

      this._setText('bg-blur-val', (s.bg_blur ?? 20) + 'px');
      this._setText('bg-opacity-val', Math.round((s.bg_opacity ?? 0) * 100) + '%');
      this._setText('sidebar-w-val', (s.sidebar_width ?? 270) + 'px');
      this._setText('sidebar-opacity-val', Math.round((s.sidebar_opacity ?? 0.85) * 100) + '%');
      this._setText('sidebar-font-val', (s.sidebar_font ?? 14) + 'px');
      this._setText('sidebar-blur-val', (s.sidebar_blur ?? 16) + 'px');
      this._setText('card-opacity-val', Math.round((s.card_opacity ?? 1) * 100) + '%');
      this._setText('card-blur-val', (s.card_blur ?? 0) + 'px');
      this._setText('toolbar-h-val', (s.toolbar_height ?? 48) + 'px');
      this._setText('toolbar-blur-val', (s.toolbar_blur ?? 16) + 'px');
      this._setText('toolbar-opacity-val', Math.round((s.toolbar_opacity ?? 0.85) * 100) + '%');
      this._setText('overlay-opacity-val', Math.round((s.select_overlay_opacity ?? 0.2) * 100) + '%');
      this._setText('thumb-size-val', (s.thumbnail_size ?? 400) + 'px');
      this._setText('draw-count-val', s.draw_count ?? 3);
      this._setText('random-interval-val', (s.random_interval ?? 3) + 's');
      this._setText('list-cols-val', s.list_columns ?? 1);

      this._highlightThemeBtns(s.theme_mode ?? 'dark');
      this._loadBgList();

      // Sync reverse search UI state
      this.applyReverseSearch(App._settings?.reverse_search_enabled ?? false);

      // 加载主页标题设置
      this.renderHomeTitleSettings();

      // Cache info
      API.getCacheInfo(S.profileId).then(info => {
        const label = document.getElementById('cache-size-label');
        if (label) {
          const sizeStr = info.size > 0 ? U.fmtSize(info.size) : '0 B';
          label.textContent = `缓存 ${info.file_count} 个文件 (${sizeStr})`;
        }
      }).catch(() => {});
    } catch (e) { console.error('ST.render error:', e); }
  },

  // === Theme ===

  applyTheme(mode) {
    const theme = THEMES[mode] ?? THEMES.dark;
    const root = document.documentElement;
    const set = (k, v) => root.style.setProperty(k, v);
    set('--c-bg', theme.bg);
    set('--c-surface', theme.surface);
    set('--c-surface2', theme.surface2);
    set('--c-card', theme.card);
    set('--c-card-hover', theme.cardHover);
    set('--c-border', theme.border);
    set('--c-border-light', theme.borderL);
    set('--c-text', theme.text);
    set('--c-text2', theme.text2);
    set('--c-text3', theme.text3);
    document.body.style.background = theme.bg;
    document.body.style.color = theme.text;

    const h2r = (hex) => { const n = parseInt(hex.slice(1), 16); return `${(n>>16)&255},${(n>>8)&255},${n&255}`; };
    const srgb = h2r(theme.surface).split(',');
    set('--c-surface-r', srgb[0]); set('--c-surface-g', srgb[1]); set('--c-surface-b', srgb[2]);
    const crgb = h2r(theme.card || '#2a2a2a').split(',');
    set('--c-card-r', crgb[0]); set('--c-card-g', crgb[1]); set('--c-card-b', crgb[2]);

    API.saveSettings(S.profileId, { theme_mode: mode });
    App._settings.theme_mode = mode;
    try { localStorage.setItem('pa_theme_mode', mode); } catch (e) { /* ignore */ }
    // Sync js-check badge colors
    if (typeof _syncJsCheck === 'function') _syncJsCheck();
    this._highlightThemeBtns(mode);
  },

  _highlightThemeBtns(mode) {
    const d = document.getElementById('btn-theme-dark');
    const l = document.getElementById('btn-theme-light');
    if (d) d.style.borderColor = mode === 'dark' ? 'var(--c-accent)' : 'transparent';
    if (l) l.style.borderColor = mode === 'light' ? 'var(--c-accent)' : 'transparent';
  },

  _highlightReverseBtns(enabled) {
    const onBtn = document.getElementById('btn-reverse-on');
    const offBtn = document.getElementById('btn-reverse-off');
    if (onBtn) onBtn.style.borderColor = enabled ? 'var(--c-accent)' : 'transparent';
    if (offBtn) offBtn.style.borderColor = enabled ? 'transparent' : 'var(--c-accent)';
  },

  applyReverseSearch(enabled) {
    const wrap = document.getElementById('search-wrap');
    const negInput = document.getElementById('search-neg');
    const negIcon = document.querySelector('.search-neg-icon');
    if (!wrap || !negInput || !negIcon) return;
    if (enabled) {
        wrap.classList.add('dual');
        negInput.style.display = '';
        negIcon.style.display = '';
    } else {
        wrap.classList.remove('dual');
        negInput.style.display = 'none';
        negIcon.style.display = 'none';
        negInput.value = '';
    }
    this._highlightReverseBtns(enabled);
  },

  // === Accent ===

  applyAccent(color) {
    const root = document.documentElement;
    root.style.setProperty('--c-accent', color);
    const darken = (h, a) => { const n = parseInt(h.slice(1), 16); const r = Math.max(0, ((n>>16)&255) - a); const g = Math.max(0, ((n>>8)&255) - a); const b = Math.max(0, (n&255) - a); return `rgb(${r},${g},${b})`; };
    root.style.setProperty('--c-accent2', darken(color, 30));
    root.style.setProperty('--c-accent-bg', `rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},0.12)`);
    API.saveSettings(S.profileId, { accent_color: color });
    App._settings.accent_color = color;
    try { localStorage.setItem('pa_accent_color', color); } catch (e) { /* ignore */ }
  },

  extractAccent() {
    const bgFile = App._settings.bg_image;
    if (!bgFile) { Toast.show('请先选择背景图片', 'info'); return; }

    API.extractColors(S.profileId, bgFile).then(result => {
      if (!result || !result.palette || result.palette.length === 0 || result.palette[0] === '#000000') {
        Toast.show('未能提取有效颜色', 'info');
        return;
      }

      // WCAG contrast check against current theme background (same logic as theme-extractor.js)
      const palette = result.palette;
      const isDark = (App._settings?.theme_mode ?? 'dark') === 'dark';
      const bgHex = isDark ? '#1c1c1c' : '#f3f3f3';
      const bgRgb = hexToRgb(bgHex);
      const MIN_CONTRAST = 5.0;

      let bestColor = null;
      for (const hex of palette) {
        const rgb = hexToRgb(hex);
        if (contrastRatio(rgb.r, rgb.g, rgb.b, bgRgb.r, bgRgb.g, bgRgb.b) >= MIN_CONTRAST) {
          bestColor = hex;
          break;
        }
      }

      // If none pass, HSL-adapt the top candidate
      if (!bestColor) {
        const top = hexToRgb(palette[0]);
        const hsl = rgbToHsl(top.r, top.g, top.b);
        hsl.s = Math.min(1, hsl.s + 0.15);
        if (isDark) {
          hsl.l = Math.max(0.55, hsl.l);
        } else {
          hsl.l = Math.min(0.40, hsl.l);
        }
        const adapted = hslToRgb(hsl.h, hsl.s, hsl.l);
        bestColor = rgbToHex(adapted.r, adapted.g, adapted.b);
      }

      this.applyAccent(bestColor);
      this._setVal('set-accent', bestColor);
      Toast.show('强调色已提取: ' + bestColor, 'success');
    }).catch(e => {
      Toast.show('提取失败: ' + (e.message || e), 'error');
    });
  },

  // === Background ===

  async applyBgImage(filename) {
    const bgLayer = document.getElementById('bg-layer');
    if (!filename) {
      if (bgLayer) { bgLayer.style.backgroundImage = ''; bgLayer.style.opacity = '0'; }
      await API.saveSettings(S.profileId, { bg_image: null });
      App._settings.bg_image = null;
      this._loadBgList();
      return;
    }
    if (!bgLayer || !S.profileId) return;

    // Update state synchronously to avoid race: user may click "extract accent"
    // before the async thumbnail load completes.
    App._settings.bg_image = filename;
    this._loadBgList();

    try {
      const thumb = await API.getThumbnail(S.profileId, filename, BG_DIR);
      if (thumb && thumb.dataUrl) {
        bgLayer.style.backgroundImage = `url(${thumb.dataUrl})`;
        bgLayer.style.backgroundSize = 'cover';
        bgLayer.style.backgroundPosition = 'center';
        // Use saved opacity, NEVER read from DOM (DOM may have stale profile's value)
        const savedOp = (App._settings.bg_opacity != null && App._settings.bg_opacity > 0) ? App._settings.bg_opacity : 0.5;
        bgLayer.style.opacity = String(savedOp);
        await API.saveSettings(S.profileId, { bg_image: filename, bg_opacity: savedOp });
        App._settings.bg_opacity = savedOp;
      }
    } catch (e) {
      Toast.show('背景图加载失败', 'error');
      if (bgLayer) bgLayer.style.backgroundImage = '';
      App._settings.bg_image = null;
      this._loadBgList();
    }
  },

  applyBlur(val) {
    const bgLayer = document.getElementById('bg-layer');
    if (bgLayer) bgLayer.style.filter = val > 0 ? `blur(${val}px)` : '';
    this._setText('bg-blur-val', val + 'px');
    API.saveSettings(S.profileId, { bg_blur: val });
    App._settings.bg_blur = val;
  },

  applyOpacity(val) {
    const bgLayer = document.getElementById('bg-layer');
    if (bgLayer) bgLayer.style.opacity = String(val);
    this._setText('bg-opacity-val', Math.round(val * 100) + '%');
    API.saveSettings(S.profileId, { bg_opacity: val });
    App._settings.bg_opacity = val;
  },

  // === Background Thumbnail Grid ===

  _loadBgList() {
    const grid = document.getElementById('bg-thumb-grid');
    if (!grid) return;
    const currentBg = App._settings.bg_image || '';
    const bgImgs = S.bgImages ?? [];
    grid.innerHTML = '';

    // "None" option
    const noneEl = this._makeBgThumb(null, currentBg === '', '无');
    noneEl.onclick = () => this.applyBgImage(null);
    grid.appendChild(noneEl);

    for (const img of bgImgs) {
      const isActive = img.name === currentBg;
      const thumb = this._makeBgThumb(img.name, isActive, '');
      thumb.onclick = () => this.applyBgImage(img.name);
      // Delete button
      const delBtn = document.createElement('button');
      delBtn.textContent = '×';
      Object.assign(delBtn.style, {
        position: 'absolute', top: '2px', right: '2px', width: '18px', height: '18px',
        borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff',
        border: 'none', fontSize: '11px', cursor: 'pointer', lineHeight: '1',
      });
      delBtn.onclick = (e) => { e.stopPropagation(); this._deleteBg(img.name); };
      thumb.appendChild(delBtn);
      grid.appendChild(thumb);
      // Load preview
      API.getThumbnail(S.profileId, img.name, BG_DIR, THUMB_SIZES.bgPreview).then(t => {
        const imgEl = thumb.querySelector('img');
        if (imgEl && t && t.dataUrl) imgEl.src = t.dataUrl;
      }).catch(() => {});
    }
  },

  _makeBgThumb(filename, active, label) {
    const div = document.createElement('div');
    Object.assign(div.style, {
      width: '80px', height: '60px', borderRadius: '6px', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75em', overflow: 'hidden', position: 'relative',
      border: `2px solid ${active ? 'var(--c-accent)' : 'var(--c-border)'}`,
      background: 'var(--c-card)',
    });
    if (label) {
      div.textContent = label;
    } else {
      const imgEl = document.createElement('img');
      imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      div.appendChild(imgEl);
    }
    return div;
  },

  _deleteBg(filename) {
    Modal.show('删除背景图', `确定删除 ${filename}？`, [{ label: '取消' }, { label: '删除', danger: true }]).then(r => {
      if (r.idx !== 1) return;
      API._invoke('bg_delete', { profileId: S.profileId, filename }).then(() => {
        API.scanAll(S.profileId).then(() => {
          this._loadBgList();
          if (App._settings.bg_image === filename) this.applyBgImage(null);
          Toast.show('已删除', 'success');
        });
      }).catch(() => Toast.show('删除失败', 'error'));
    });
  },

  _refreshBgList() {
    API.scanAll(S.profileId).then(() => {
      this._loadBgList();
      Toast.show('已刷新', 'info');
    });
  },

  // === Card ===

  applyCardOpacity(val) {
    document.documentElement.style.setProperty('--card-opacity', String(val));
    this._setText('card-opacity-val', Math.round(val * 100) + '%');
    API.saveSettings(S.profileId, { card_opacity: val });
    App._settings.card_opacity = val;
  },

  applyCardBlur(val) {
    document.documentElement.style.setProperty('--card-blur', val + 'px');
    this._setText('card-blur-val', val + 'px');
    API.saveSettings(S.profileId, { card_blur: val });
    App._settings.card_blur = val;
  },

  applyToolbarHeight(val) {
    document.documentElement.style.setProperty('--toolbar-h', val + 'px');
    this._setText('toolbar-h-val', val + 'px');
    API.saveSettings(S.profileId, { toolbar_height: val });
    App._settings.toolbar_height = val;
  },

  applyListColumns(val) {
    document.documentElement.style.setProperty('--list-columns', val);
    App._settings.list_columns = val;
    this._setText('list-cols-val', val);
    API.saveSettings(S.profileId, { list_columns: val });
  },

  applyToolbarBlur(val) {
    document.documentElement.style.setProperty('--toolbar-blur', val + 'px');
    this._setText('toolbar-blur-val', val + 'px');
    API.saveSettings(S.profileId, { toolbar_blur: val });
    App._settings.toolbar_blur = val;
  },

  applyToolbarOpacity(val) {
    document.documentElement.style.setProperty('--toolbar-opacity', String(val));
    this._setText('toolbar-opacity-val', Math.round(val * 100) + '%');
    API.saveSettings(S.profileId, { toolbar_opacity: val });
    App._settings.toolbar_opacity = val;
  },

  applyOverlayOpacity(val) {
    document.documentElement.style.setProperty('--overlay-opacity', String(val));
    this._setText('overlay-opacity-val', Math.round(val * 100) + '%');
    API.saveSettings(S.profileId, { select_overlay_opacity: val });
    App._settings.select_overlay_opacity = val;
  },

  clearCache() {
    Modal.show('清除缓存', '确定清除缩略图缓存？重新加载图片时需要重新生成。', [{ label: '取消' }, { label: '清除', danger: true }]).then(r => {
      if (r.idx !== 1) return;
      const btn = document.getElementById('btn-clear-cache');
      if (btn) { btn.disabled = true; btn.textContent = '清除中...'; }
      API.clearCache(S.profileId).then(count => {
        Toast.show(`已清除 ${count} 个缓存文件`, 'success');
        const label = document.getElementById('cache-size-label');
        if (label) label.textContent = '缓存 0 个文件 (0 B)';
      }).catch(e => {
        Toast.show('清除缓存失败: ' + (e.message || e), 'error');
      }).finally(() => {
        if (btn) { btn.disabled = false; btn.textContent = '清除缓存'; }
      });
    });
  },

  applySidebarWidth(val) {
    document.documentElement.style.setProperty('--sidebar-w', val + 'px');
    const sb = document.getElementById('sidebar');
    if (sb) { sb.style.width = val + 'px'; sb.style.minWidth = val + 'px'; }
    this._setText('sidebar-w-val', val + 'px');
    API.saveSettings(S.profileId, { sidebar_width: val });
    App._settings.sidebar_width = val;
  },

  applySidebarFont(val) {
    document.documentElement.style.setProperty('--sidebar-font', val + 'px');
    this._setText('sidebar-font-val', val + 'px');
    API.saveSettings(S.profileId, { sidebar_font: val });
    App._settings.sidebar_font = val;
  },

  applySidebarBlur(val) {
    document.documentElement.style.setProperty('--sidebar-blur', val + 'px');
    this._setText('sidebar-blur-val', val + 'px');
    API.saveSettings(S.profileId, { sidebar_blur: val });
    App._settings.sidebar_blur = val;
  },

  applySidebarOpacity(val) {
    document.documentElement.style.setProperty('--sidebar-opacity', String(val));
    this._setText('sidebar-opacity-val', Math.round(val * 100) + '%');
    API.saveSettings(S.profileId, { sidebar_opacity: val });
    App._settings.sidebar_opacity = val;
  },

  applyThumbnailSize(val) {
    this._setText('thumb-size-val', val + 'px');
    API.saveSettings(S.profileId, { thumbnail_size: val });
    App._settings.thumbnail_size = val;
  },

  applyDrawCount(val) {
    this._setText('draw-count-val', val);
    API.saveSettings(S.profileId, { draw_count: val });
    App._settings.draw_count = val;
  },

  applyRandomInterval(val) {
    this._setText('random-interval-val', val + 's');
    API.saveSettings(S.profileId, { random_interval: val });
    App._settings.random_interval = val;
  },

  // === Home Title ===
  renderHomeTitleSettings() {
    const title = App._settings?.home_title;
    const elTitle = document.getElementById('set-home-title');
    if (elTitle && title) elTitle.value = title;
  },
  saveHomeTitle() {
    const title = document.getElementById('set-home-title')?.value?.trim() || '我的相册';
    App._settings.home_title = title;
    API.saveSettings(S.profileId, { home_title: title });
    const el = document.getElementById('home-title');
    if (el) el.textContent = title;
    Toast.show('主页标题已更新', 'success');
  },

  // === Reverse Search ===

  toggleReverseSearch(enabled) {
    App._settings.reverse_search_enabled = enabled;
    API.saveSettings(S.profileId, { reverse_search_enabled: enabled });
    this.applyReverseSearch(enabled);
    // 触发重新搜索
    document.getElementById('search-input')?.dispatchEvent(new Event('input'));
  },

  // === Helpers ===

  _getVal(id, fallback) {
    const el = document.getElementById(id);
    return el ? el.value : fallback;
  },

  _setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val !== null) el.value = val;
  },

  _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  },
};
