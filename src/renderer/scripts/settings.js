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
      this._setVal('set-bg-blur', s.bg_blur ?? 0);
      this._setVal('set-bg-opacity', Math.round((s.bg_opacity ?? 1.0) * 100));
      this._setVal('set-thumb-size', s.thumbnail_size ?? 400);
      this._setVal('set-draw-count', s.draw_count ?? 10);
      this._setVal('set-random-interval', s.random_interval ?? 3);
      this._setVal('set-sidebar-w', s.sidebar_width ?? 150);
      this._setVal('set-sidebar-opacity', Math.round((s.sidebar_opacity ?? 0.7) * 100));
      this._setVal('set-sidebar-font', s.sidebar_font ?? 20);
      this._setVal('set-sidebar-blur', s.sidebar_blur ?? 16);
      this._setVal('set-card-opacity', Math.round((s.card_opacity ?? 0.7) * 100));
      this._setVal('set-card-blur', s.card_blur ?? 16);
      this._setVal('set-toolbar-h', s.toolbar_height ?? 56);
      this._setVal('set-toolbar-blur', s.toolbar_blur ?? 16);
      this._setVal('set-toolbar-opacity', Math.round((s.toolbar_opacity ?? 0.7) * 100));
      this._setVal('set-overlay-opacity', Math.round((s.select_overlay_opacity ?? 0.2) * 100));
      this._setVal('set-list-cols', s.list_columns ?? 3);

      this._setText('bg-blur-val', (s.bg_blur ?? 0) + 'px');
      this._setText('bg-opacity-val', Math.round((s.bg_opacity ?? 1.0) * 100) + '%');
      this._setText('sidebar-w-val', (s.sidebar_width ?? 150) + 'px');
      this._setText('sidebar-opacity-val', Math.round((s.sidebar_opacity ?? 0.7) * 100) + '%');
      this._setText('sidebar-font-val', (s.sidebar_font ?? 20) + 'px');
      this._setText('sidebar-blur-val', (s.sidebar_blur ?? 16) + 'px');
      this._setText('card-opacity-val', Math.round((s.card_opacity ?? 0.7) * 100) + '%');
      this._setText('card-blur-val', (s.card_blur ?? 16) + 'px');
      this._setText('toolbar-h-val', (s.toolbar_height ?? 56) + 'px');
      this._setText('toolbar-blur-val', (s.toolbar_blur ?? 16) + 'px');
      this._setText('toolbar-opacity-val', Math.round((s.toolbar_opacity ?? 0.7) * 100) + '%');
      this._setText('overlay-opacity-val', Math.round((s.select_overlay_opacity ?? 0.2) * 100) + '%');
      this._setText('thumb-size-val', (s.thumbnail_size ?? 400) + 'px');
      this._setText('draw-count-val', s.draw_count ?? 10);
      this._setText('random-interval-val', (s.random_interval ?? 3) + 's');
      this._setText('list-cols-val', s.list_columns ?? 3);

      this._highlightThemeBtns(s.theme_mode ?? 'dark');
      this._loadBgList();

      // Sync reverse search UI state
      this.applyReverseSearch(App._settings?.reverse_search_enabled ?? false);

      // 加载主页标题设置
      this.renderHomeTitleSettings();

      // 加载强调色设置
      this._renderAccentUI();

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
    // 如果颜色选择器打开则不执行主题切换(防止预览被打断)
    if (this._pickerOpen) return;
    // Resolve system to actual mode
    let effectiveMode = mode;
    if (mode === 'system') {
      effectiveMode = window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    }

    const theme = THEMES[effectiveMode] ?? THEMES.dark;
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

    // Apply correct accent based on resulting effective mode
    this.applyCurrentAccent();

    // If accent_mode is 'extract', auto-extract on theme switch
    if (App._settings?.accent_mode === 'extract') {
      this.extractAccent();
    }
  },

  _highlightThemeBtns(mode) {
    const d = document.getElementById('btn-theme-dark');
    const l = document.getElementById('btn-theme-light');
    const s = document.getElementById('btn-theme-system');
    if (d) d.style.borderColor = mode === 'dark' ? 'var(--c-accent)' : 'transparent';
    if (l) l.style.borderColor = mode === 'light' ? 'var(--c-accent)' : 'transparent';
    if (s) s.style.borderColor = mode === 'system' ? 'var(--c-accent)' : 'transparent';
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

  /** Apply accent color visually and optionally save to a specific mode */
  applyAccent(color, forMode) {
    if (forMode) {
      // Save to mode-specific storage
      if (forMode === 'dark') {
        App._settings.accent_color_dark = color;
        API.saveSettings(S.profileId, { accent_color_dark: color });
        try { localStorage.setItem('pa_accent_color_dark', color); } catch (e) { /* ignore */ }
      } else {
        App._settings.accent_color_light = color;
        API.saveSettings(S.profileId, { accent_color_light: color });
        try { localStorage.setItem('pa_accent_color_light', color); } catch (e) { /* ignore */ }
      }
      // Only apply visually if this mode matches current effective theme
      const effectiveTheme = this._getEffectiveTheme();
      if (forMode === effectiveTheme) {
        this._applyAccentVisual(color);
      }
    } else {
      // Direct visual apply
      this._applyAccentVisual(color);
    }

    // Update swatches
    this._updateAccentSwatches();
    // Keep presets display in sync
    this._renderPresets();
  },

  /** Apply the correct accent color for the current effective theme */
  applyCurrentAccent() {
    const effectiveTheme = this._getEffectiveTheme();
    const color = effectiveTheme === 'dark'
      ? (App._settings.accent_color_dark || '#4A9EFF')
      : (App._settings.accent_color_light || '#003D7A');
    this._applyAccentVisual(color);
  },

  /** Internal: apply accent CSS vars without saving */
  _applyAccentVisual(color) {
    const root = document.documentElement;
    root.style.setProperty('--c-accent', color);
    const darken = (h, a) => { const n = parseInt(h.slice(1), 16); const r = Math.max(0, ((n>>16)&255) - a); const g = Math.max(0, ((n>>8)&255) - a); const b = Math.max(0, (n&255) - a); return `rgb(${r},${g},${b})`; };
    root.style.setProperty('--c-accent2', darken(color, 30));
    const parseHex = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
    const [r, g, b] = parseHex(color);
    root.style.setProperty('--c-accent-bg', `rgba(${r},${g},${b},0.12)`);
  },

  /** Get effective dark/light mode, resolving 'system' */
  _getEffectiveTheme() {
    const mode = App._settings?.theme_mode || 'dark';
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    }
    return mode;
  },

  /** Open color picker for a specific mode (fixed positioning) */
  openColorPicker(forMode) {
    this._closeColorPicker();

    const swatch = document.getElementById('accent-swatch-' + forMode);
    if (!swatch) return;

    const originalColor = forMode === 'dark'
        ? (App._settings.accent_color_dark || '#4A9EFF')
        : (App._settings.accent_color_light || '#003D7A');

    // 创建面板 (opacity:0 初始态)
    const panel = document.createElement('div');
    panel.className = 'color-picker-panel';
    panel.innerHTML = `
        <div class="cpp-preview" style="background:${originalColor};"></div>
        <div class="cpp-value">${originalColor}</div>
        <div class="cpp-actions">
            <button class="cpp-confirm">确认</button>
            <button class="cpp-cancel">取消</button>
        </div>
    `;
    document.body.appendChild(panel);

    // 计算 fixed 定位
    const swatchRect = swatch.getBoundingClientRect();
    const panelWidth = 140; // min-width
    let left = swatchRect.left + swatchRect.width / 2 - panelWidth / 2;
    // 确保不超出左/右边界
    const maxLeft = window.innerWidth - panelWidth - 8;
    left = Math.max(8, Math.min(left, maxLeft));

    // 先设 left 让面板渲染，再读取高度
    panel.style.left = left + 'px';
    panel.style.top = '-1000px'; // 临时隐藏以获取尺寸

    return new Promise(resolve => {
        requestAnimationFrame(() => {
            const panelHeight = panel.offsetHeight || 130;
            let top = swatchRect.top - 8 - panelHeight;

            // 视口边界：超出上方则翻转到下方
            if (top < 8) {
                top = swatchRect.bottom + 8;
            }

            panel.style.top = top + 'px';

            // 开启动画
            void panel.offsetWidth;
            panel.classList.add('open');

            // 创建隐藏 color input
            const input = document.createElement('input');
            input.type = 'color';
            input.value = originalColor;
            input.style.cssText = 'position:fixed;opacity:0;width:1px;height:1px;pointer-events:none;';
            input.style.left = '-100px';
            input.style.top = '-100px';
            document.body.appendChild(input);

            // 事件绑定
            const onInput = () => {
                const c = input.value;
                panel.querySelector('.cpp-preview').style.background = c;
                panel.querySelector('.cpp-value').textContent = c;
                if (forMode === this._getEffectiveTheme()) {
                    this._applyAccentVisual(c);
                }
            };
            input.addEventListener('input', onInput);
            input.addEventListener('change', onInput);

            input.addEventListener('cancel', () => {
                if (forMode === this._getEffectiveTheme()) {
                    this._applyAccentVisual(originalColor);
                }
                this._closeColorPicker();
            });

            // 确认
            panel.querySelector('.cpp-confirm').onclick = () => {
                this.applyAccent(input.value, forMode);
                this._closeColorPicker();
            };

            // 取消
            panel.querySelector('.cpp-cancel').onclick = () => {
                const currentOriginal = forMode === 'dark'
                    ? (App._settings.accent_color_dark || '#4A9EFF')
                    : (App._settings.accent_color_light || '#003D7A');
                if (forMode === this._getEffectiveTheme()) {
                    this._applyAccentVisual(currentOriginal);
                }
                this._closeColorPicker();
            };

            // ESC 关闭
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    const co = forMode === 'dark'
                        ? (App._settings.accent_color_dark || '#4A9EFF')
                        : (App._settings.accent_color_light || '#003D7A');
                    if (forMode === this._getEffectiveTheme()) {
                        this._applyAccentVisual(co);
                    }
                    this._closeColorPicker();
                }
            };
            document.addEventListener('keydown', onKey);

            // 滚动/窗口变化关闭
            const onScrollResize = () => {
                this._closeColorPicker();
            };
            window.addEventListener('scroll', onScrollResize, { capture: true, once: true });
            window.addEventListener('resize', onScrollResize, { once: true });

            // 面板外点击关闭
            const onDocClick = (e) => {
                if (!panel.contains(e.target) && !input.contains(e.target)) {
                    this._closeColorPicker();
                    document.removeEventListener('mousedown', onDocClick);
                }
            };
            setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);

            // 保存引用
            this._pickerPanel = panel;
            this._pickerInput = input;
            this._pickerForMode = forMode;
            this._pickerKeyHandler = onKey;
            this._pickerScrollHandler = onScrollResize;
            this._pickerDocHandler = onDocClick;
            this._pickerOpen = true;

            // 触发原生拾色器
            input.click();

            resolve();
        });
    });
  },

  /** 关闭颜色选择器(清理DOM) */
  _closeColorPicker() {
    if (this._pickerPanel) {
        this._pickerPanel.classList.remove('open');
        // 等待动画结束后移除
        setTimeout(() => {
            if (this._pickerPanel) this._pickerPanel.remove();
            this._pickerPanel = null;
        }, 150);
    }
    if (this._pickerInput) { this._pickerInput.remove(); this._pickerInput = null; }
    if (this._pickerKeyHandler) { document.removeEventListener('keydown', this._pickerKeyHandler); this._pickerKeyHandler = null; }
    if (this._pickerDocHandler) { document.removeEventListener('mousedown', this._pickerDocHandler); this._pickerDocHandler = null; }
    this._pickerOpen = false;
    this._pickerForMode = null;
  },

  /** Set accent mode (custom/extract) */
  setAccentMode(mode) {
    this._closeColorPicker();
    App._settings.accent_mode = mode;
    API.saveSettings(S.profileId, { accent_mode: mode });
    this._highlightAccentBtns(mode);

    const panel = document.getElementById('accent-custom-panel');
    const extractPanel = document.getElementById('accent-extract-panel');
    if (mode === 'custom') {
      if (panel) panel.style.display = '';
      if (extractPanel) extractPanel.style.display = 'none';
      this._renderPresets();
    } else {
      if (panel) panel.style.display = 'none';
      if (extractPanel) extractPanel.style.display = '';
      this.extractAccent();
    }
  },

  _highlightAccentBtns(mode) {
    const customBtn = document.getElementById('btn-accent-custom');
    const extractBtn = document.getElementById('btn-accent-extract');
    if (customBtn) customBtn.classList.toggle('active', mode === 'custom');
    if (extractBtn) extractBtn.classList.toggle('active', mode === 'extract');
  },

  /** Update accent UI elements */
  _renderAccentUI() {
    // 切换模式时关闭可能残留的picker
    this._closeColorPicker();
    const s = App._settings;
    // Sync accent mode buttons
    this._highlightAccentBtns(s.accent_mode || 'custom');

    // Show/hide panels
    const panel = document.getElementById('accent-custom-panel');
    const extractPanel = document.getElementById('accent-extract-panel');
    if (s.accent_mode === 'extract') {
      if (panel) panel.style.display = 'none';
      if (extractPanel) extractPanel.style.display = '';
    } else {
      if (panel) panel.style.display = '';
      if (extractPanel) extractPanel.style.display = 'none';
    }

    // Update swatches
    this._updateAccentSwatches();
    // Render presets
    this._renderPresets();
  },

  _updateAccentSwatches() {
    const darkSwatch = document.getElementById('accent-swatch-dark');
    const lightSwatch = document.getElementById('accent-swatch-light');
    if (darkSwatch) darkSwatch.style.background = App._settings.accent_color_dark || '#4A9EFF';
    if (lightSwatch) lightSwatch.style.background = App._settings.accent_color_light || '#003D7A';
  },

  /** Extract accent colors from background image for both dark and light themes */
  extractAccent(forMode) {
    if (App._settings?.accent_mode !== 'extract') return;
    const bgFile = App._settings.bg_image;
    if (!bgFile) { Toast.show('请先选择背景图片', 'info'); return; }

    API.extractColors(S.profileId, bgFile).then(result => {
      if (App._settings?.accent_mode !== 'extract') return;
      if (!result || !result.palette || result.palette.length === 0 || result.palette[0] === '#000000') {
        Toast.show('未能提取有效颜色', 'info');
        return;
      }

      const palette = result.palette;

      // Extract for dark background (#1c1c1c)
      const darkColor = this._pickBestColor(palette, true);
      // Extract for light background (#f3f3f3)
      const lightColor = this._pickBestColor(palette, false);

      if (forMode === 'dark' || !forMode) {
        this.applyAccent(darkColor, 'dark');
      }
      if (forMode === 'light' || !forMode) {
        this.applyAccent(lightColor, 'light');
      }

      // Apply current visual
      if (!forMode) {
        this.applyCurrentAccent();
      }

      Toast.show('强调色已提取', 'success');
    }).catch(e => {
      Toast.show('提取失败: ' + (e.message || e), 'error');
    });
  },

  /** Pick the best color from a palette for a given background (dark/light) */
  _pickBestColor(palette, isDark) {
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

    return bestColor;
  },

  // === Accent Presets ===

  savePreset(name) {
    if (!name || !name.trim()) { Toast.show('请输入预设名称', 'info'); return; }
    const dark = App._settings.accent_color_dark || '#4A9EFF';
    const light = App._settings.accent_color_light || '#003D7A';
    const presets = this._getPresets();
    const existing = presets.findIndex(p => p.name === name.trim());
    if (existing >= 0) {
      Modal.show('预设已存在', `覆盖「${name.trim()}」？`, [{ label: '取消' }, { label: '覆盖', primary: true }]).then(r => {
        if (r.idx !== 1) return;
        presets[existing] = { id: presets[existing].id, name: name.trim(), dark, light };
        this._savePresets(presets);
        Toast.show('预设已更新', 'success');
      });
      return;
    }
    presets.push({ id: crypto.randomUUID(), name: name.trim(), dark, light });
    this._savePresets(presets);
    Toast.show('预设已保存', 'success');
  },

  applyPreset(id) {
    const presets = this._getPresets();
    const p = presets.find(p => p.id === id);
    if (!p) return;
    this.applyAccent(p.dark, 'dark');
    this.applyAccent(p.light, 'light');
    this.applyCurrentAccent();
    Toast.show('已应用预设: ' + p.name, 'success');
  },

  deletePreset(id) {
    Modal.show('删除预设', '确定删除此预设？', [{ label: '取消' }, { label: '删除', danger: true }]).then(r => {
      if (r.idx !== 1) return;
      const presets = this._getPresets().filter(p => p.id !== id);
      this._savePresets(presets);
      Toast.show('预设已删除', 'info');
    });
  },

  _getPresets() {
    try { return JSON.parse(App._settings.accent_presets || '[]'); } catch(e) { return []; }
  },

  _savePresets(presets) {
    const json = JSON.stringify(presets);
    App._settings.accent_presets = json;
    API.saveSettings(S.profileId, { accent_presets: json });
    this._renderPresets();
  },

  _renderPresets() {
    const container = document.getElementById('accent-presets');
    if (!container) return;
    const presets = this._getPresets();
    if (presets.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = '';
    for (const p of presets) {
      const el = document.createElement('div');
      el.className = 'accent-preset-item';
      el.innerHTML = '<div class="ap-colors"><span class="ap-dot" style="background:' + U.esc(p.dark) + '"></span><span class="ap-dot" style="background:' + U.esc(p.light) + '"></span></div><span class="ap-name">' + (U.escHtml ? U.escHtml(p.name) : p.name) + '</span>';
      el.title = p.name + ' (右键删除)';
      el.onclick = () => this.applyPreset(p.id);
      el.oncontextmenu = (e) => { e.preventDefault(); this.deletePreset(p.id); };
      container.appendChild(el);
    }
  },

  // === System theme listener ===

  initSystemThemeListener() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', (e) => {
      if (App._settings?.theme_mode === 'system') {
        const mode = e.matches ? 'dark' : 'light';
        const theme = THEMES[mode];
        if (!theme) return;

        // Apply theme visually
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

        if (typeof _syncJsCheck === 'function') _syncJsCheck();

        // Apply correct accent
        this.applyCurrentAccent();

        // If accent_mode is extract, auto-extract
        if (App._settings?.accent_mode === 'extract') {
          this.extractAccent();
        }
      }
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

    // Update state synchronously to avoid race
    App._settings.bg_image = filename;
    this._loadBgList();

    try {
      const thumb = await API.getThumbnail(S.profileId, filename, BG_DIR);
      if (thumb && thumb.dataUrl) {
        bgLayer.style.backgroundImage = `url(${thumb.dataUrl})`;
        bgLayer.style.backgroundSize = 'cover';
        bgLayer.style.backgroundPosition = 'center';
        const savedOp = (App._settings.bg_opacity != null && App._settings.bg_opacity > 0) ? App._settings.bg_opacity : 0.5;
        bgLayer.style.opacity = String(savedOp);
        await API.saveSettings(S.profileId, { bg_image: filename, bg_opacity: savedOp });
        App._settings.bg_opacity = savedOp;

        // If accent_mode is 'extract', auto-extract
        if (App._settings?.accent_mode === 'extract') {
          this.extractAccent();
        }
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
    if (elTitle) elTitle.value = title || '我的相册';
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
    // Trigger re-search
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
