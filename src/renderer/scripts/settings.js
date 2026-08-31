// ============================================================
// Lumina — Settings (clean)
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
      this._setVal('set-bg-blur-input', s.bg_blur ?? 0);
      this._setVal('set-bg-opacity', Math.round((s.bg_opacity ?? 1.0) * 100));
      this._setVal('set-bg-opacity-input', Math.round((s.bg_opacity ?? 1.0) * 100));
      this._setVal('set-thumb-size', s.thumbnail_size ?? 400);
      this._setVal('set-thumb-size-input', s.thumbnail_size ?? 400);
      this._setVal('set-draw-count', s.draw_count ?? 10);
      this._setVal('set-draw-count-input', s.draw_count ?? 10);
      this._setVal('set-random-interval', s.random_interval ?? 3);
      this._setVal('set-random-interval-input', s.random_interval ?? 3);
      this._setVal('set-sidebar-w', s.sidebar_width ?? 150);
      this._setVal('set-sidebar-w-input', s.sidebar_width ?? 150);
      this._setVal('set-sidebar-font', s.sidebar_font ?? 20);
      this._setVal('set-sidebar-font-input', s.sidebar_font ?? 20);
      this._setVal('set-panel-blur', s.sidebar_blur ?? 16);
      this._setVal('set-panel-blur-input', s.sidebar_blur ?? 16);
      this._setVal('set-panel-opacity', Math.round((s.sidebar_opacity ?? 0.7) * 100));
      this._setVal('set-panel-opacity-input', Math.round((s.sidebar_opacity ?? 0.7) * 100));
      this._setVal('set-toolbar-h', s.toolbar_height ?? 56);
      this._setVal('set-toolbar-h-input', s.toolbar_height ?? 56);
      this._setVal('set-overlay-opacity', Math.round((s.select_overlay_opacity ?? 0.2) * 100));
      this._setVal('set-overlay-opacity-input', Math.round((s.select_overlay_opacity ?? 0.2) * 100));
      this._setVal('set-list-cols', s.list_columns ?? 3);
      this._setVal('set-list-cols-input', s.list_columns ?? 3);

      this._setText('bg-blur-val', (s.bg_blur ?? 0) + 'px');
      this._setText('bg-opacity-val', Math.round((s.bg_opacity ?? 1.0) * 100) + '%');
      this._setText('sidebar-w-val', (s.sidebar_width ?? 150) + 'px');
      this._setText('sidebar-font-val', (s.sidebar_font ?? 20) + 'px');
      this._setText('panel-blur-val', (s.sidebar_blur ?? 16) + 'px');
      this._setText('panel-opacity-val', Math.round((s.sidebar_opacity ?? 0.7) * 100) + '%');
      this._setText('toolbar-h-val', (s.toolbar_height ?? 56) + 'px');
      this._setText('overlay-opacity-val', Math.round((s.select_overlay_opacity ?? 0.2) * 100) + '%');
      this._setText('thumb-size-val', (s.thumbnail_size ?? 400) + 'px');
      this._setText('draw-count-val', s.draw_count ?? 10);
      this._setText('random-interval-val', (s.random_interval ?? 3) + 's');
      this._setText('list-cols-val', s.list_columns ?? 3);

      // 生成并发数（0 = 无上限）
      this.syncGenConcurrency(s.thumb_gen_concurrency ?? 10);

      this._highlightThemeBtns(s.theme_mode ?? 'dark');
      this._highlightTitlebarBtns(s.titlebar_mode ?? 'native');
      // 界面字体：异步加载系统字体下拉 + 同步当前值
      this._loadFontList();
      this._syncFontSelect(s.font_family ?? '');
      this._loadBgList();

      // 同步背景模式
      const bgMode = App._settings.bg_transparent ? 'transparent' : 'image';
      this._highlightBgModeBtns(bgMode);

      // Sync reverse search UI state
      this.applyReverseSearch(App._settings?.reverse_search_enabled ?? false);

      // 加载主页标题设置
      this.renderHomeTitleSettings();

      // 加载强调色设置
      this._renderAccentUI();

      // === 背景区块可见性同步（与 _loadBgList 共用实现，任何入口行为一致）===
      this._syncBgSectionUi();

      // Cache info + 恢复可能仍在运行的预生成任务进度
      this._refreshCacheLabel();
      this._restoreGenStatus();
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
        // 透明模式下同时保存到独立存储
        if (App._settings.bg_transparent) {
          App._settings.transparent_accent_color_dark = color;
          API.saveSettings(S.profileId, { transparent_accent_color_dark: color });
        }
      } else {
        App._settings.accent_color_light = color;
        API.saveSettings(S.profileId, { accent_color_light: color });
        try { localStorage.setItem('pa_accent_color_light', color); } catch (e) { /* ignore */ }
        if (App._settings.bg_transparent) {
          App._settings.transparent_accent_color_light = color;
          API.saveSettings(S.profileId, { transparent_accent_color_light: color });
        }
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
  },

  /** Apply the correct accent color for the current effective theme */
  applyCurrentAccent() {
    const effectiveTheme = this._getEffectiveTheme();
    let color;
    if (App._settings.accent_mode === 'extract') {
      color = effectiveTheme === 'dark'
        ? (App._settings.extract_color_dark || '#4A9EFF')
        : (App._settings.extract_color_light || '#003D7A');
    } else if (App._settings.accent_mode === 'system') {
      // 使用缓存的系统色，不可用时降级
      color = this._systemAccentColor || this._getDefaultSystemFallback();
      // 对比度兜底
      color = this._ensureContrast(color, effectiveTheme);
    } else {
      color = effectiveTheme === 'dark'
        ? (App._settings.accent_color_dark || '#4A9EFF')
        : (App._settings.accent_color_light || '#003D7A');
    }
    this._applyAccentVisual(color);
  },

  /** Internal: apply accent CSS vars without saving */
  _applyAccentVisual(color) {
    const root = document.documentElement;
    root.style.setProperty('--c-accent', color);
    // 强调色底上的自动前景色（WCAG 对比度选黑/白），供 .btn-primary 等使用
    root.style.setProperty('--c-on-accent', U.onColor(color));
    const darken = (h, a) => { const n = parseInt(h.slice(1), 16); const r = Math.max(0, ((n>>16)&255) - a); const g = Math.max(0, ((n>>8)&255) - a); const b = Math.max(0, (n&255) - a); return `rgb(${r},${g},${b})`; };
    root.style.setProperty('--c-accent2', darken(color, 30));
    const parseHex = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
    const [r, g, b] = parseHex(color);
    root.style.setProperty('--c-accent-bg', `rgba(${r},${g},${b},0.12)`);
    // Redraw dashboard charts when accent changes
    if (typeof App !== 'undefined' && App._updateDashboard) {
      App._updateDashboard();
    }
  },

  /** Get effective dark/light mode, resolving 'system' */
  _getEffectiveTheme() {
    const mode = App._settings?.theme_mode || 'dark';
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    }
    return mode;
  },

  /** Open color picker for a specific mode (canvas-based, no native input) */
  openColorPicker(forMode) {
    this._closeColorPicker();

    const swatch = document.getElementById('accent-swatch-' + forMode);
    if (!swatch) return;

    const originalColor = forMode === 'dark'
        ? (App._settings.accent_color_dark || '#4A9EFF')
        : (App._settings.accent_color_light || '#003D7A');

    const parsed = this._parseHex(originalColor);
    const hsv = this._rgbToHsv(parsed.r, parsed.g, parsed.b);

    // Panel DOM
    const panel = document.createElement('div');
    panel.className = 'color-picker-panel';
    panel.innerHTML = `
      <div class="cpp-hue-bar"><div class="cpp-handle" style="left:${(hsv.h / 360 * 200)}px;top:8px;"></div></div>
      <div class="cpp-sb-area">
        <canvas class="cpp-sb-canvas" width="200" height="150"></canvas>
        <div class="cpp-handle cpp-handle-sb" style="left:${hsv.s * 200}px;top:${(1 - hsv.v) * 150}px;"></div>
      </div>
      <div class="cpp-preview-row">
        <div class="cpp-preview" style="background:${originalColor};"></div>
        <input class="cpp-hex-input" type="text" value="${originalColor}" maxlength="7">
      </div>
      <div class="cpp-actions">
        <button class="cpp-confirm">确认</button>
        <button class="cpp-cancel">取消</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Position above swatch
    const swatchRect = swatch.getBoundingClientRect();
    const panelWidth = 220;
    let left = swatchRect.left + swatchRect.width / 2 - panelWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
    panel.style.left = left + 'px';
    panel.style.top = '-1000px';

    requestAnimationFrame(() => {
      const panelHeight = panel.offsetHeight || 290;
      let top = swatchRect.top - 8 - panelHeight;
      if (top < 8) top = swatchRect.bottom + 8;
      panel.style.top = top + 'px';
      void panel.offsetWidth;
      panel.classList.add('open');
    });

    // State
    this._pickerPanel = panel;
    this._pickerForMode = forMode;
    this._pickerHsv = hsv;
    this._pickerOrig = originalColor;
    this._pickerOpen = true;

    this._renderPickerCanvas(panel);
    this._updatePickerUI(panel);
    this._bindPickerEvents(panel);
  },

  _renderPickerCanvas(panel) {
    const canvas = panel.querySelector('.cpp-sb-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = 200, h = 150;
    const hsv = this._pickerHsv;
    const rgb = this._hsvToRgb(hsv.h, 1, 1);
    const base = this._rgbToHex(rgb.r, rgb.g, rgb.b);

    // White → pure hue gradient (top)
    const g1 = ctx.createLinearGradient(0, 0, w, 0);
    g1.addColorStop(0, '#ffffff');
    g1.addColorStop(1, base);
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    // Transparent → black gradient (bottom-up)
    const g2 = ctx.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, '#000000');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  },

  _updatePickerUI(panel) {
    const hsv = this._pickerHsv;
    const rgb = this._hsvToRgb(hsv.h, hsv.s, hsv.v);
    const hex = this._rgbToHex(rgb.r, rgb.g, rgb.b);

    panel.querySelector('.cpp-preview').style.background = hex;
    panel.querySelector('.cpp-hex-input').value = hex;

    // Position handles
    const hueHandle = panel.querySelector('.cpp-hue-bar .cpp-handle');
    if (hueHandle) hueHandle.style.left = (hsv.h / 360 * 200) + 'px';

    const sbHandle = panel.querySelector('.cpp-handle-sb');
    if (sbHandle) {
      sbHandle.style.left = (hsv.s * 200) + 'px';
      sbHandle.style.top = ((1 - hsv.v) * 150) + 'px';
    }

    // Apply visual preview for current effective theme
    if (this._pickerForMode === this._getEffectiveTheme()) {
      this._applyAccentVisual(hex);
    }
  },

  _updateHue(clientX, rect, panel) {
    const x = Math.max(0, Math.min(200, clientX - rect.left));
    this._pickerHsv.h = (x / 200) * 360;
    this._renderPickerCanvas(panel);
    this._updatePickerUI(panel);
  },

  _updateSb(clientX, clientY, rect, panel) {
    const x = Math.max(0, Math.min(200, clientX - rect.left));
    const y = Math.max(0, Math.min(150, clientY - rect.top));
    this._pickerHsv.s = x / 200;
    this._pickerHsv.v = 1 - y / 150;
    this._updatePickerUI(panel);
  },

  _bindPickerEvents(panel) {
    const forMode = this._pickerForMode;

    // --- Hue bar drag ---
    const hueBar = panel.querySelector('.cpp-hue-bar');
    const startHueDrag = (startX, startY) => {
      const rect = hueBar.getBoundingClientRect();
      this._updateHue(startX, rect, panel);
      const onMove = (e) => { this._updateHue(e.clientX, rect, panel); };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMoveT); document.removeEventListener('touchend', onUp); };
      const onMoveT = (e) => { e.preventDefault(); const t = e.touches[0]; this._updateHue(t.clientX, rect, panel); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMoveT, { passive: false });
      document.addEventListener('touchend', onUp);
    };
    hueBar.addEventListener('mousedown', (e) => startHueDrag(e.clientX, e.clientY));
    hueBar.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; startHueDrag(t.clientX, t.clientY); }, { passive: false });

    // --- Saturation/Brightness area drag ---
    const sbArea = panel.querySelector('.cpp-sb-area');
    const startSbDrag = (startX, startY) => {
      const rect = sbArea.getBoundingClientRect();
      this._updateSb(startX, startY, rect, panel);
      const onMove = (e) => { this._updateSb(e.clientX, e.clientY, rect, panel); };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMoveT); document.removeEventListener('touchend', onUp); };
      const onMoveT = (e) => { e.preventDefault(); const t = e.touches[0]; this._updateSb(t.clientX, t.clientY, rect, panel); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMoveT, { passive: false });
      document.addEventListener('touchend', onUp);
    };
    sbArea.addEventListener('mousedown', (e) => startSbDrag(e.clientX, e.clientY));
    sbArea.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; startSbDrag(t.clientX, t.clientY); }, { passive: false });

    // --- Hex input ---
    const hexInput = panel.querySelector('.cpp-hex-input');
    hexInput.addEventListener('input', () => {
      let val = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        const p = this._parseHex(val);
        this._pickerHsv = this._rgbToHsv(p.r, p.g, p.b);
        this._renderPickerCanvas(panel);
        this._updatePickerUI(panel);
      }
    });

    // --- Keyboard arrows on canvas ---
    const canvas = panel.querySelector('.cpp-sb-canvas');
    canvas.setAttribute('tabindex', '0');
    canvas.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.05 : 0.02;
      const hsv = this._pickerHsv;
      switch (e.key) {
        case 'ArrowUp': hsv.v = Math.min(1, hsv.v + step); break;
        case 'ArrowDown': hsv.v = Math.max(0, hsv.v - step); break;
        case 'ArrowLeft': hsv.s = Math.max(0, hsv.s - step); break;
        case 'ArrowRight': hsv.s = Math.min(1, hsv.s + step); break;
        default: return;
      }
      e.preventDefault();
      this._updatePickerUI(panel);
      this._renderPickerCanvas(panel);
    });

    // --- Confirm ---
    panel.querySelector('.cpp-confirm').onclick = () => {
      const rgb = this._hsvToRgb(this._pickerHsv.h, this._pickerHsv.s, this._pickerHsv.v);
      const hex = this._rgbToHex(rgb.r, rgb.g, rgb.b);
      this.applyAccent(hex, forMode);
      this._closeColorPicker();
    };

    // --- Cancel ---
    panel.querySelector('.cpp-cancel').onclick = () => {
      if (forMode === this._getEffectiveTheme()) {
        this._applyAccentVisual(this._pickerOrig);
      }
      this._closeColorPicker();
    };

    // --- ESC ---
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (forMode === this._getEffectiveTheme()) {
          this._applyAccentVisual(this._pickerOrig);
        }
        this._closeColorPicker();
      }
    };
    document.addEventListener('keydown', onKey);
    this._pickerKeyHandler = onKey;

    // --- Scroll/window resize close ---
    const onScrollResize = () => { this._closeColorPicker(); };
    window.addEventListener('scroll', onScrollResize, { capture: true, once: true });
    window.addEventListener('resize', onScrollResize, { once: true });
    this._pickerScrollHandler = onScrollResize;

    // --- Outside click close ---
    const onDocClick = (e) => {
      if (!panel.contains(e.target)) {
        this._closeColorPicker();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    this._pickerDocHandler = onDocClick;
  },

  /** 关闭颜色选择器(清理DOM) */
  _closeColorPicker() {
    if (this._pickerPanel) {
      this._pickerPanel.classList.remove('open');
      setTimeout(() => {
        if (this._pickerPanel) { this._pickerPanel.remove(); this._pickerPanel = null; }
      }, 150);
    }
    if (this._pickerKeyHandler) { document.removeEventListener('keydown', this._pickerKeyHandler); this._pickerKeyHandler = null; }
    if (this._pickerDocHandler) { document.removeEventListener('mousedown', this._pickerDocHandler); this._pickerDocHandler = null; }
    if (this._pickerScrollHandler) { window.removeEventListener('scroll', this._pickerScrollHandler, { capture: true }); this._pickerScrollHandler = null; }
    this._pickerOpen = false;
    this._pickerForMode = null;
    this._pickerHsv = null;
    this._pickerOrig = null;
  },

  /** Set accent mode (custom/extract/system) */
  setAccentMode(mode) {
    // 透明模式下禁止切换到提取模式
    if (App._settings.bg_transparent && mode === 'extract') {
      Toast.show('透明模式下不支持提取颜色', 'info');
      return;
    }
    this._closeColorPicker();
    App._settings.accent_mode = mode;
    const saveData = { accent_mode: mode };
    // 透明模式下同步保存 transparent_accent_mode
    if (App._settings.bg_transparent) {
      App._settings.transparent_accent_mode = mode;
      saveData.transparent_accent_mode = mode;
    }
    API.saveSettings(S.profileId, saveData);
    this._highlightAccentBtns(mode);

    const panel = document.getElementById('accent-custom-panel');
    const extractPanel = document.getElementById('accent-extract-panel');
    const systemPanel = document.getElementById('accent-system-panel');

    if (mode === 'custom') {
      if (panel) panel.style.display = '';
      if (extractPanel) extractPanel.style.display = 'none';
      if (systemPanel) systemPanel.style.display = 'none';
      this.applyCurrentAccent();
    } else if (mode === 'extract') {
      if (panel) panel.style.display = 'none';
      if (extractPanel) extractPanel.style.display = '';
      if (systemPanel) systemPanel.style.display = 'none';
      this.extractAccent();
    } else if (mode === 'system') {
      if (panel) panel.style.display = 'none';
      if (extractPanel) extractPanel.style.display = 'none';
      if (systemPanel) systemPanel.style.display = '';
      this.applyCurrentAccent();
    }
  },

  _highlightAccentBtns(mode) {
    const customBtn = document.getElementById('btn-accent-custom');
    const extractBtn = document.getElementById('btn-accent-extract');
    const systemBtn = document.getElementById('btn-accent-system');
    if (customBtn) customBtn.classList.toggle('active', mode === 'custom');
    if (extractBtn) extractBtn.classList.toggle('active', mode === 'extract');
    if (systemBtn) systemBtn.classList.toggle('active', mode === 'system');
  },

  /** Update accent UI elements */
  _renderAccentUI() {
    this._closeColorPicker();
    const s = App._settings;

    // 透明模式下只禁用提取，但保留自定义和跟随系统
    if (s.bg_transparent) {
      this._highlightAccentBtns(s.accent_mode || 'custom');
      document.getElementById('accent-custom-panel').style.display = s.accent_mode === 'custom' ? '' : 'none';
      document.getElementById('accent-extract-panel').style.display = 'none';
      document.getElementById('accent-system-panel').style.display = s.accent_mode === 'system' ? '' : 'none';
      this._updateAccentSwatches();
      if (s.accent_mode === 'system') this._updateSystemAccentUI();
      return;
    }

    // 非透明模式正常三态
    this._highlightAccentBtns(s.accent_mode || 'custom');
    const panel = document.getElementById('accent-custom-panel');
    const extractPanel = document.getElementById('accent-extract-panel');
    const systemPanel = document.getElementById('accent-system-panel');
    if (s.accent_mode === 'extract') {
      if (panel) panel.style.display = 'none';
      if (extractPanel) extractPanel.style.display = '';
      if (systemPanel) systemPanel.style.display = 'none';
    } else if (s.accent_mode === 'system') {
      if (panel) panel.style.display = 'none';
      if (extractPanel) extractPanel.style.display = 'none';
      if (systemPanel) systemPanel.style.display = '';
      this._updateSystemAccentUI();
    } else {
      if (panel) panel.style.display = '';
      if (extractPanel) extractPanel.style.display = 'none';
      if (systemPanel) systemPanel.style.display = 'none';
    }
    this._updateAccentSwatches();
  },

  _updateAccentSwatches() {
    const darkSwatch = document.getElementById('accent-swatch-dark');
    const lightSwatch = document.getElementById('accent-swatch-light');
    if (darkSwatch) darkSwatch.style.background = App._settings.accent_color_dark || '#4A9EFF';
    if (lightSwatch) lightSwatch.style.background = App._settings.accent_color_light || '#003D7A';
  },

  /** 更新系统强调色UI预览 */
  _updateSystemAccentUI() {
    const swatch = document.getElementById('accent-swatch-system');
    const valueEl = document.getElementById('accent-system-color-value');
    if (this._systemAccentColor) {
      if (swatch) swatch.style.background = this._systemAccentColor;
      if (valueEl) valueEl.textContent = this._systemAccentColor;
    } else {
      if (swatch) swatch.style.background = '#4A9EFF';
      if (valueEl) valueEl.textContent = '获取中...';
    }
  },

  /** 从系统获取强调色，缓存并应用 */
  async _fetchSystemAccentColor() {
    try {
      const color = await API.getSystemAccentColor();
      if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
        this._systemAccentColor = color;
        // 如果是 system 模式则立即应用
        if (App._settings?.accent_mode === 'system') {
          this.applyCurrentAccent();
        }
        this._updateSystemAccentUI();
        return color;
      }
    } catch (e) {
      // 忽略错误，使用降级色
    }
    // 降级
    this._systemAccentColor = null;
    return null;
  },

  /** 系统色不可用时的默认降级 */
  _getDefaultSystemFallback() {
    const mode = this._getEffectiveTheme();
    return mode === 'dark' ? '#60cdff' : '#0066cc';
  },

  /** WCAG 对比度保证 >= 4.5:1 */
  _ensureContrast(hex, forTheme) {
    const bg = forTheme === 'dark' ? '#1c1c1c' : '#f3f3f3';
    const bgRgb = hexToRgb(bg);
    const fgRgb = hexToRgb(hex);
    const cr = contrastRatio(fgRgb.r, fgRgb.g, fgRgb.b, bgRgb.r, bgRgb.g, bgRgb.b);
    if (cr >= 4.5) return hex;
    // 对比度不足，调整亮度
    const hsl = rgbToHsl(fgRgb.r, fgRgb.g, fgRgb.b);
    if (forTheme === 'dark') {
      hsl.l = Math.max(0.55, hsl.l);
    } else {
      hsl.l = Math.min(0.40, hsl.l);
    }
    const adapted = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(adapted.r, adapted.g, adapted.b);
  },

  /** 初始化系统强调色监听器（30秒轮询） */
  _initSystemAccentListener() {
    // 立即获取一次
    this._fetchSystemAccentColor();
    // 每 30 秒轮询
    if (this._systemAccentTimer) clearInterval(this._systemAccentTimer);
    this._systemAccentTimer = setInterval(() => {
      this._fetchSystemAccentColor();
    }, 30000);
  },

  /** Extract accent colors from background image for both dark and light themes */
  extractAccent(forMode) {
    if (App._settings?.accent_mode !== 'extract') return;
    if (App._settings.bg_transparent) return;  // 透明模式下禁止提取
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
        App._settings.extract_color_dark = darkColor;
        API.saveSettings(S.profileId, { extract_color_dark: darkColor });
      }
      if (forMode === 'light' || !forMode) {
        App._settings.extract_color_light = lightColor;
        API.saveSettings(S.profileId, { extract_color_light: lightColor });
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

  // === Color utilities ===

  _hsvToRgb(h, s, v) {
    const c = v * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs(hp % 2 - 1));
    let r, g, b;
    if (hp < 1) { r = c; g = x; b = 0; }
    else if (hp < 2) { r = x; g = c; b = 0; }
    else if (hp < 3) { r = 0; g = c; b = x; }
    else if (hp < 4) { r = 0; g = x; b = c; }
    else if (hp < 5) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const m = v - c;
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  },
  _rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (mx === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }
    return { h, s: mx === 0 ? 0 : d / mx, v: mx };
  },
  _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
  },
  _parseHex(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
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

        // 如果是 system 模式，刷新系统色缓存
        if (App._settings?.accent_mode === 'system') {
          this._fetchSystemAccentColor();
        }

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
      await this._loadBgList();
      return;
    }
    if (!bgLayer || !S.profileId) return;
    // 透明模式下 #bg-layer 被 CSS 隐藏，跳过加载（保持透明背景）
    if (App._settings.bg_transparent) return;

    // Update state synchronously to avoid race
    App._settings.bg_image = filename;
    await this._loadBgList();

    try {
      const thumb = await API.getThumbnail(S.profileId, filename, BG_DIR);
      if (!thumb || !thumb.dataUrl) throw new Error('背景图数据为空');
      bgLayer.style.backgroundImage = `url(${thumb.dataUrl})`;
      bgLayer.style.backgroundSize = 'cover';
      bgLayer.style.backgroundPosition = 'center';
      // 只应用当前透明度设置，不修改/落库 bg_opacity（透明度由滑条独占控制）
      const op = (App._settings.bg_opacity == null) ? 1.0 : App._settings.bg_opacity;
      bgLayer.style.opacity = String(op);
      await API.saveSettings(S.profileId, { bg_image: filename });

      // If accent_mode is 'extract', auto-extract
      if (App._settings?.accent_mode === 'extract') {
        this.extractAccent();
      }
    } catch (e) {
      Toast.show('背景图加载失败', 'error');
      if (bgLayer) { bgLayer.style.backgroundImage = ''; bgLayer.style.opacity = '0'; }
      App._settings.bg_image = null;
      // 落库清理失效引用，避免下次启动重复加载失败
      await API.saveSettings(S.profileId, { bg_image: null }).catch(() => {});
      await this._loadBgList();
    }
  },

  async setBgMode(mode) {
    if (mode === 'transparent') {
      // === 快照：保存背景图模式的强调色配置 ===
      App._settings.bg_image_accent_mode = App._settings.accent_mode;
      App._settings.bg_image_accent_color_dark = App._settings.accent_color_dark;
      App._settings.bg_image_accent_color_light = App._settings.accent_color_light;
      API.saveSettings(S.profileId, {
        bg_image_accent_mode: App._settings.accent_mode,
        bg_image_accent_color_dark: App._settings.accent_color_dark,
        bg_image_accent_color_light: App._settings.accent_color_light
      });

      // === 加载透明模式的强调色 ===
      // 如果没有独立保存过透明模式的颜色，则继承当前（背景图模式）的颜色作为初始值
      App._settings.transparent_accent_color_dark = App._settings.transparent_accent_color_dark || App._settings.accent_color_dark || '#4A9EFF';
      App._settings.transparent_accent_color_light = App._settings.transparent_accent_color_light || App._settings.accent_color_light || '#003D7A';
      App._settings.accent_color_dark = App._settings.transparent_accent_color_dark;
      App._settings.accent_color_light = App._settings.transparent_accent_color_light;
      // 如果 transparent_accent_mode 未显式保存过，继承当前模式
      App._settings.transparent_accent_mode = App._settings.transparent_accent_mode || App._settings.accent_mode;
      // ★ 关键修改：不再强制 'custom'，而是使用 transparent_accent_mode
      App._settings.accent_mode = App._settings.transparent_accent_mode;

      // === 应用透明背景效果 ===
      this.applyBgTransparent(true);
      // 提前设置，确保 _syncBgSectionUi 与后续守卫能看到最新状态
      App._settings.bg_transparent = true;

      // 首次进入透明模式时保存初始颜色到DB，使后续切换独立
      API.saveSettings(S.profileId, {
        transparent_accent_color_dark: App._settings.accent_color_dark,
        transparent_accent_color_light: App._settings.accent_color_light,
        transparent_accent_mode: App._settings.accent_mode
      });

      // === UI 控件管理（背景行隐藏 + 强调色面板按模式显示）===
      this._syncBgSectionUi();
      document.getElementById('accent-custom-panel').style.display = App._settings.accent_mode === 'custom' ? '' : 'none';
      document.getElementById('accent-extract-panel').style.display = 'none';
      document.getElementById('accent-system-panel').style.display = App._settings.accent_mode === 'system' ? '' : 'none';
      this._highlightAccentBtns(App._settings.accent_mode || 'custom');
      // 应用当前强调色
      this.applyCurrentAccent();
      this._updateAccentSwatches();
      // 刷新背景图列表（轻量，不触发全量扫描）
      await this._loadBgList();
    } else {
      // === 保存透明模式的强调色 ===
      App._settings.transparent_accent_color_dark = App._settings.accent_color_dark;
      App._settings.transparent_accent_color_light = App._settings.accent_color_light;
      App._settings.transparent_accent_mode = App._settings.accent_mode;
      API.saveSettings(S.profileId, {
        transparent_accent_color_dark: App._settings.accent_color_dark,
        transparent_accent_color_light: App._settings.accent_color_light,
        transparent_accent_mode: App._settings.accent_mode
      });

      // === 恢复背景图模式的强调色 ===
      App._settings.accent_color_dark = App._settings.bg_image_accent_color_dark || '#4A9EFF';
      App._settings.accent_color_light = App._settings.bg_image_accent_color_light || '#003D7A';
      App._settings.accent_mode = App._settings.bg_image_accent_mode || 'custom';

      // === 关闭透明背景效果 ===
      this.applyBgTransparent(false);
      // 提前设置，确保 applyBgImage 的透明守卫与 _renderAccentUI 能看到最新状态
      App._settings.bg_transparent = false;

      // 刷新背景图列表（轻量，不触发全量扫描；含失效引用自愈）
      await this._loadBgList();

      // 恢复背景图
      this.applyBgImage(App._settings.bg_image || null);
      this.applyBlur(App._settings.bg_blur ?? 0);
      this.applyOpacity(App._settings.bg_opacity ?? 1.0);

      // === UI 控件恢复 ===
      this._syncBgSectionUi();
      // 恢复强调色UI
      this._renderAccentUI();
      this.applyCurrentAccent();
    }

    App._settings.bg_transparent = (mode === 'transparent');
    API.saveSettings(S.profileId, { bg_transparent: mode === 'transparent' });
    this._highlightBgModeBtns(mode);
  },

  async applyBgTransparent(enabled) {
    if (enabled) {
      document.documentElement.classList.add('bg-transparent-mode');
      try {
        await API._invoke('window_set_effect', { enabled: true, effect_type: 'acrylic' });
      } catch (e) {
        console.warn('[App] Window effect not available:', e);
      }
      const bgLayer = document.getElementById('bg-layer');
      if (bgLayer) { bgLayer.style.backgroundImage = ''; bgLayer.style.opacity = '0'; }
      // 覆盖层始终保持透明
      const overlay = document.getElementById('bg-overlay');
      if (overlay) { overlay.style.background = 'rgba(0,0,0,0)'; overlay.style.opacity = '0'; }
    } else {
      document.documentElement.classList.remove('bg-transparent-mode');
      try {
        await API._invoke('window_set_effect', { enabled: false, effect_type: null });
      } catch (e) { /* ignore */ }
      // 重置覆盖层
      const overlay = document.getElementById('bg-overlay');
      if (overlay) { overlay.style.background = ''; overlay.style.opacity = ''; overlay.style.backdropFilter = ''; }
    }
  },

  _highlightBgModeBtns(mode) {
    const imgBtn = document.getElementById('btn-bg-image');
    const transBtn = document.getElementById('btn-bg-transparent');
    if (imgBtn) imgBtn.style.borderColor = mode === 'image' ? 'var(--c-accent)' : 'transparent';
    if (transBtn) transBtn.style.borderColor = mode === 'transparent' ? 'var(--c-accent)' : 'transparent';
  },







  applyBlur(val) {
    val = this._clampNumber(val, 0, 50, App._settings.bg_blur ?? 0);
    const bgLayer = document.getElementById('bg-layer');
    if (bgLayer) bgLayer.style.filter = val > 0 ? `blur(${val}px)` : '';
    this._syncRangePair('set-bg-blur', 'set-bg-blur-input', 'bg-blur-val', val, v => v + 'px');
    API.saveSettings(S.profileId, { bg_blur: val });
    App._settings.bg_blur = val;
  },

  applyOpacity(val) {
    val = this._clampNumber(val, 0, 1, App._settings.bg_opacity ?? 1.0);
    const bgLayer = document.getElementById('bg-layer');
    if (bgLayer) bgLayer.style.opacity = String(val);
    const pct = Math.round(val * 100);
    this._syncRangePair('set-bg-opacity', 'set-bg-opacity-input', 'bg-opacity-val', pct, v => v + '%');
    API.saveSettings(S.profileId, { bg_opacity: val });
    App._settings.bg_opacity = val;
  },

  // === Background Thumbnail Grid ===

  /**
   * 背景区块控件可见性同步：透明模式隐藏「背景图片 / 背景模糊 / 背景透明度」行，
   * 图像模式恢复。render()、_loadBgList()、setBgMode() 全部复用本函数，
   * 保证导入/删除/刷新后的界面与“切换标签页重新渲染”完全一致。
   */
  _syncBgSectionUi() {
    const transparent = !!(App._settings && App._settings.bg_transparent);
    const ids = ['bg-image-card', 'bg-blur-row', 'bg-opacity-row'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = transparent ? 'none' : '';
    }
  },

  async _loadBgList() {
    const grid = document.getElementById('bg-thumb-grid');
    if (!grid) return;
    this._syncBgSectionUi();
    let bgImgs = [];
    try {
      // 轻量读取背景图列表（只扫描 .album/backgrounds），不依赖全量扫描结果
      bgImgs = await API.bgList(S.profileId);
    } catch (e) {
      Toast.show('背景图列表加载失败: ' + (e.message || e), 'error');
      return;
    }
    // 同步状态，避免与全量扫描结果不一致
    S.bgImages = bgImgs;

    const currentBg = App._settings.bg_image || '';

    // 自愈：保存的背景图已不存在时清理引用，避免每次启动都加载失败
    if (currentBg && !bgImgs.some(img => img.name === currentBg)) {
      await this.applyBgImage(null);
      return;
    }

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
    div.dataset.bgName = filename || '';
    Object.assign(div.style, {
      width: '80px', height: '60px', borderRadius: '6px', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75em', overflow: 'hidden', position: 'relative',
      border: `2px solid ${active ? 'var(--c-accent)' : 'var(--c-border)'}`,
      background: 'var(--c-surface)',
      color: 'var(--c-text)',
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
      API._invoke('bg_delete', { profileId: S.profileId, filename }).then(async () => {
        API.evictThumbCache(S.profileId, BG_DIR, filename); // 删除后驱逐旧预览，避免同名再导入显示脏缓存
        await this._loadBgList();
        if (App._settings.bg_image === filename) this.applyBgImage(null);
        Toast.show('已删除', 'success');
      }).catch(() => Toast.show('删除失败', 'error'));
    });
  },

  async _refreshBgList() {
    try {
      API.evictThumbCacheByFolder(S.profileId, BG_DIR); // 刷新 = 丢弃背景目录全部预览缓存，强制重取
      await this._loadBgList();
      Toast.show('已刷新', 'info');
    } catch (e) {
      Toast.show('刷新失败: ' + (e.message || e), 'error');
    }
  },

  // === Panel（侧边栏 / 顶栏 / 标题栏 / 卡片 共用模糊与透明度）===

  applyPanelBlur(val) {
    val = this._clampNumber(val, 0, 50, App._settings.sidebar_blur ?? 16);
    document.documentElement.style.setProperty('--sidebar-blur', val + 'px');
    document.documentElement.style.setProperty('--toolbar-blur', val + 'px');
    document.documentElement.style.setProperty('--card-blur', val + 'px');
    this._syncRangePair('set-panel-blur', 'set-panel-blur-input', 'panel-blur-val', val, v => v + 'px');
    API.saveSettings(S.profileId, { sidebar_blur: val, toolbar_blur: val, card_blur: val });
    App._settings.sidebar_blur = val;
    App._settings.toolbar_blur = val;
    App._settings.card_blur = val;
  },

  applyPanelOpacity(val) {
    val = this._clampNumber(val, 0, 1, App._settings.sidebar_opacity ?? 0.7);
    document.documentElement.style.setProperty('--sidebar-opacity', String(val));
    document.documentElement.style.setProperty('--toolbar-opacity', String(val));
    document.documentElement.style.setProperty('--card-opacity', String(val));
    const pct = Math.round(val * 100);
    this._syncRangePair('set-panel-opacity', 'set-panel-opacity-input', 'panel-opacity-val', pct, v => v + '%');
    API.saveSettings(S.profileId, { sidebar_opacity: val, toolbar_opacity: val, card_opacity: val });
    App._settings.sidebar_opacity = val;
    App._settings.toolbar_opacity = val;
    App._settings.card_opacity = val;
  },

  applyToolbarHeight(val) {
    val = this._clampNumber(val, 56, 80, App._settings.toolbar_height ?? 56);
    document.documentElement.style.setProperty('--toolbar-h', val + 'px');
    this._syncRangePair('set-toolbar-h', 'set-toolbar-h-input', 'toolbar-h-val', val, v => v + 'px');
    API.saveSettings(S.profileId, { toolbar_height: val });
    App._settings.toolbar_height = val;
  },

  applyListColumns(val) {
    val = this._clampNumber(val, 1, 5, App._settings.list_columns ?? 3);
    document.documentElement.style.setProperty('--list-columns', val);
    App._settings.list_columns = val;
    this._syncRangePair('set-list-cols', 'set-list-cols-input', 'list-cols-val', val, v => v);
    API.saveSettings(S.profileId, { list_columns: val });
  },

  // === Titlebar Mode ===

  /** 切换到指定顶栏模式: 'native'(Windows 原生) | 'macos'(macOS 红绿灯) */
  applyTitlebarMode(mode, skipSave = false) {
    mode = mode === 'macos' ? 'macos' : 'native';
    App._settings.titlebar_mode = mode;
    // 顶栏模式现在按 profile 持久化于 DB；启动页由 Rust 按“最后打开的文件夹”读取
    if (!skipSave) {
      API.saveSettings(S.profileId, { titlebar_mode: mode });
    }
    this._applyTitlebarModeDom(mode);
    this._highlightTitlebarBtns(mode);
  },

  /** 应用顶栏模式的 DOM 与窗口效果（不写 DB，供启动/加载 profile 时同步） */
  _applyTitlebarModeDom(mode) {
    document.body.classList.toggle('titlebar-macos', mode === 'macos');
    API._invoke('window_set_titlebar', { mode }).catch(e => console.warn('[Titlebar] set titlebar mode failed:', e));
  },

  _highlightTitlebarBtns(mode) {
    const nativeBtn = document.getElementById('btn-titlebar-native');
    const macosBtn = document.getElementById('btn-titlebar-macos');
    if (nativeBtn) nativeBtn.style.borderColor = mode === 'native' ? 'var(--c-accent)' : 'transparent';
    if (macosBtn) macosBtn.style.borderColor = mode === 'macos' ? 'var(--c-accent)' : 'transparent';
  },

  // === 界面字体 ===

  _fontListPromise: null,

  _cssFontName(name) {
    const s = String(name || '').trim().replace(/"/g, "'");
    return s ? '"' + s + '"' : '';
  },

  _syncFontSelect(family) {
    const sel = document.getElementById('set-font-family');
    if (sel) sel.value = family || '';
    const resetBtn = document.getElementById('btn-font-reset');
    if (resetBtn) resetBtn.style.borderColor = family ? 'var(--c-accent)' : 'transparent';
  },

  /** 异步加载系统字体列表并填充下拉框（不同粗细变体已在 Rust 端去重） */
  _loadFontList() {
    if (!this._fontListPromise) {
      this._fontListPromise = API.listSystemFonts().then(fonts => {
        const sel = document.getElementById('set-font-family');
        if (!sel) return;
        const current = App._settings?.font_family || '';
        sel.innerHTML = '<option value="">跟随系统（默认）</option>';
        for (const name of fonts) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          try { opt.style.fontFamily = this._cssFontName(name); } catch (e) { /* ignore */ }
          sel.appendChild(opt);
        }
        if (current) sel.value = current;
      }).catch(() => {});
    }
    return this._fontListPromise;
  },

  /** 应用界面字体（空字符串 = 跟随系统默认）；skipSave 用于 profile 加载同步，避免重复写库 */
  applyFontFamily(family, skipSave = false) {
    family = family || '';
    App._settings.font_family = family;
    if (!skipSave) {
      API.saveSettings(S.profileId, { font_family: family });
    }
    const root = document.documentElement;
    if (family) {
      root.style.setProperty('--font-family', `${this._cssFontName(family)}, "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`);
    } else {
      root.style.removeProperty('--font-family');
    }
    this._syncFontSelect(family);
  },

  applyOverlayOpacity(val) {
    val = this._clampNumber(val, 0, 0.6, App._settings.select_overlay_opacity ?? 0.2);
    document.documentElement.style.setProperty('--overlay-opacity', String(val));
    const pct = Math.round(val * 100);
    this._syncRangePair('set-overlay-opacity', 'set-overlay-opacity-input', 'overlay-opacity-val', pct, v => v + '%');
    API.saveSettings(S.profileId, { select_overlay_opacity: val });
    App._settings.select_overlay_opacity = val;
  },

  clearCache() {
    Modal.show('清除缓存', '确定清除缩略图缓存？重新加载图片时需要重新生成。', [{ label: '取消' }, { label: '清除', danger: true }]).then(r => {
      if (r.idx !== 1) return;
      const btn = document.getElementById('btn-clear-cache');
      if (btn) { btn.disabled = true; btn.textContent = '清除中...'; }
      // 若预生成任务在跑：先取消，稍等在途的那一张结束后再清，避免边清边生成
      const doClear = () => API.clearCache(S.profileId).then(count => {
        API.clearThumbCache();  // v1.1.2: 同时清空内存缓存
        Toast.show(`已清除 ${count} 个缓存文件`, 'success');
        this._refreshCacheLabel();
      }).catch(e => {
        Toast.show('清除缓存失败: ' + (e.message || e), 'error');
      });
      const finish = () => {
        if (btn) { btn.disabled = false; btn.textContent = '清除缓存'; }
      };
      if (this._genRunning) {
        API.cancelGenerateThumbs().catch(() => {});
        // 取消在下一张图前生效；稍等在途那一张结束后再清，避免边清边生成
        setTimeout(() => doClear().finally(finish), 800);
      } else {
        doClear().finally(finish);
      }
    });
  },

  // === 缓存管理：预生成 / 检查 ===

  _genRunning: false,
  _genUnlisten: null,

  _refreshCacheLabel() {
    API.getCacheInfo(S.profileId).then(info => {
      const label = document.getElementById('cache-size-label');
      if (label) {
        const sizeStr = info.size > 0 ? U.fmtSize(info.size) : '0 B';
        label.textContent = `缓存 ${info.file_count} 个文件 (${sizeStr})`;
      }
    }).catch(() => {});
  },

  /** 进入设置页时恢复仍在后台运行的生成任务进度 */
  _restoreGenStatus() {
    API.getCacheGenStatus().then(st => {
      if (st && st.running) {
        this._genRunning = true;
        this._ensureGenListener();
        this._cacheGenUI(true, st.done, st.total);
      } else if (!this._genRunning) {
        this._cacheGenUI(false);
      }
    }).catch(() => {});
  },

  _ensureGenListener() {
    if (this._genUnlisten) return;
    API.onCacheGenProgress(p => {
      if (p.phase === 'running') {
        this._genRunning = true;
        this._cacheGenUI(true, p.done, p.total);
        return;
      }
      // done / cancelled
      const wasRunning = this._genRunning;
      this._genRunning = false;
      this._cacheGenUI(false);
      API.clearThumbCache(); // 生成期间可能缓存过“无缩略图回退”结果，清掉强制重取
      this._refreshCacheLabel();
      const checkBtn = document.getElementById('btn-check-cache');
      if (checkBtn) checkBtn.disabled = false;
      if (!wasRunning) return; // 图库为空时后端会同步补发 done，避免重复提示
      if (p.phase === 'done') {
        Toast.show(`缩略图缓存生成完成（共 ${p.total} 张）`, 'success');
      } else {
        Toast.show(`已取消生成（完成 ${p.done}/${p.total}）`, 'info');
      }
    }).then(un => { this._genUnlisten = un; }).catch(() => {});
  },

  _cacheGenUI(running, done, total) {
    const btn = document.getElementById('btn-generate-cache');
    const wrap = document.getElementById('cache-gen-progress-wrap');
    const bar = document.getElementById('cache-gen-progress-bar');
    const text = document.getElementById('cache-gen-progress-text');
    if (btn) btn.textContent = running ? '取消生成' : '生成缩略图';
    if (wrap) wrap.style.display = running ? '' : 'none';
    if (running && bar && text) {
      const pct = total ? Math.min(100, Math.round(done * 100 / total)) : 0;
      bar.style.width = pct + '%';
      text.textContent = `正在预生成缩略图 ${done || 0} / ${total || 0}（${pct}%），速度已自动限速`;
    }
  },

  /** 预生成“图片”与“发现”两种浏览尺寸的缩略图（与视图实际取图尺寸一致） */
  generateThumbs() {
    if (this._genRunning) {
      API.cancelGenerateThumbs().catch(() => {}); // 再次点击 = 取消，进度事件收尾
      return;
    }
    const grid = App._settings?.thumbnail_size ?? 400;
    const waterfall = Math.max(240, Math.round(grid * 1.25));
    this._ensureGenListener();
    const btn = document.getElementById('btn-generate-cache');
    if (btn) { btn.disabled = true; btn.textContent = '启动中...'; }
    API.generateThumbs(S.profileId, [grid, waterfall]).then(total => {
      if (btn) btn.disabled = false;
      if (!total) { Toast.show('图库为空，没有需要生成的图片', 'info'); return; }
      this._genRunning = true;
      this._cacheGenUI(true, 0, total);
      const checkBtn = document.getElementById('btn-check-cache');
      if (checkBtn) checkBtn.disabled = true; // 生成期间不做孤儿检查，避免结果误导
    }).catch(e => {
      if (btn) { btn.disabled = false; btn.textContent = '生成缩略图'; }
      Toast.show('启动生成失败: ' + (e.message || e), 'error');
    });
  },

  /** 对比图库（含回收站、背景图）与缓存文件，清理多余的孤儿缩略图 */
  checkCache() {
    Modal.show('检查缓存', '对比当前图库（含回收站与背景图）与缓存文件，清理源图片已不存在的多余缩略图缓存。', [{ label: '取消' }, { label: '开始检查', danger: true }]).then(r => {
      if (r.idx !== 1) return;
      const btn = document.getElementById('btn-check-cache');
      if (btn) { btn.disabled = true; btn.textContent = '检查中...'; }
      API.reconcileCache(S.profileId).then(res => {
        const removed = res.removedCount ?? 0;
        if (removed > 0) {
          Toast.show(`检查完成：清理 ${removed} 个多余缓存 (${U.fmtSize(res.removedBytes || 0)})`, 'success');
        } else {
          Toast.show('检查完成：未发现多余缓存', 'info');
        }
        this._refreshCacheLabel();
      }).catch(e => {
        Toast.show('检查缓存失败: ' + (e.message || e), 'error');
      }).finally(() => {
        if (btn) { btn.disabled = false; btn.textContent = '检查缓存'; }
      });
    });
  },

  applySidebarWidth(val) {
    val = this._clampNumber(val, 150, 500, App._settings.sidebar_width ?? 150);
    document.documentElement.style.setProperty('--sidebar-w', val + 'px');
    const sb = document.getElementById('sidebar');
    if (sb) { sb.style.width = val + 'px'; sb.style.minWidth = val + 'px'; }
    this._syncRangePair('set-sidebar-w', 'set-sidebar-w-input', 'sidebar-w-val', val, v => v + 'px');
    API.saveSettings(S.profileId, { sidebar_width: val });
    App._settings.sidebar_width = val;
  },

  applySidebarFont(val) {
    val = this._clampNumber(val, 10, 30, App._settings.sidebar_font ?? 20);
    document.documentElement.style.setProperty('--sidebar-font', val + 'px');
    this._syncRangePair('set-sidebar-font', 'set-sidebar-font-input', 'sidebar-font-val', val, v => v + 'px');
    API.saveSettings(S.profileId, { sidebar_font: val });
    App._settings.sidebar_font = val;
  },

  applyThumbnailSize(val) {
    val = this._clampNumber(val, 100, 800, App._settings.thumbnail_size ?? 400);
    this._syncRangePair('set-thumb-size', 'set-thumb-size-input', 'thumb-size-val', val, v => v + 'px');
    API.saveSettings(S.profileId, { thumbnail_size: val });
    App._settings.thumbnail_size = val;
  },

  // === 生成并发数（缩略图预生成 / 按需解码的全局并发上限）===

  /** 仅同步 UI 与内存值（不写库），供 render / _doLoad / profile 切换恢复状态；0 = 无上限 */
  syncGenConcurrency(val) {
    App._settings.thumb_gen_concurrency = val;
    this._syncRangePair('set-gen-conc', 'set-gen-conc-input', 'gen-conc-val', val > 0 ? val : 10, v => v);
    this._highlightGenConcurrencyBtns(val);
  },

  /** 限速模式下滑块/数值输入（1~64），保存并立即生效 */
  applyGenConcurrency(val) {
    val = this._clampNumber(val, 1, 64, App._settings.thumb_gen_concurrency > 0 ? App._settings.thumb_gen_concurrency : 10);
    this.syncGenConcurrency(val);
    API.saveSettings(S.profileId, { thumb_gen_concurrency: val });
  },

  /** 限速（可调）/ 无上限 二选一；切回限速时若无历史值则恢复默认 10 */
  setGenConcurrencyMode(mode) {
    const cur = App._settings.thumb_gen_concurrency ?? 10;
    const val = mode === 'unlimited' ? 0 : (cur > 0 ? cur : 10);
    this.syncGenConcurrency(val);
    API.saveSettings(S.profileId, { thumb_gen_concurrency: val });
  },

  _highlightGenConcurrencyBtns(val) {
    const limitedBtn = document.getElementById('btn-gen-conc-limited');
    const unlimitedBtn = document.getElementById('btn-gen-conc-unlimited');
    if (limitedBtn) limitedBtn.style.borderColor = val !== 0 ? 'var(--c-accent)' : 'transparent';
    if (unlimitedBtn) unlimitedBtn.style.borderColor = val === 0 ? 'var(--c-accent)' : 'transparent';
    const row = document.getElementById('gen-conc-row');
    if (row) row.style.display = val === 0 ? 'none' : '';
  },

  applyDrawCount(val) {
    val = this._clampNumber(val, 1, 30, App._settings.draw_count ?? 10);
    this._syncRangePair('set-draw-count', 'set-draw-count-input', 'draw-count-val', val, v => v);
    API.saveSettings(S.profileId, { draw_count: val });
    App._settings.draw_count = val;
  },

  applyRandomInterval(val) {
    val = this._clampNumber(val, 1, 30, App._settings.random_interval ?? 3);
    this._syncRangePair('set-random-interval', 'set-random-interval-input', 'random-interval-val', val, v => v + 's');
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

  _clampNumber(val, min, max, fallback) {
    const num = Number(val);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  },

  _syncRangePair(rangeId, numberId, displayId, val, format) {
    const rangeEl = document.getElementById(rangeId);
    const numberEl = document.getElementById(numberId);
    if (rangeEl) rangeEl.value = String(val);
    if (numberEl) numberEl.value = String(val);
    if (displayId) this._setText(displayId, format ? format(val) : String(val));
  },

  // === 使用指南 ===

  showSearchGuide() {
    Modal.show('搜索语法与快捷键',
      '<div style="text-align:left;line-height:1.8;">' +
      '<h4 style="margin-bottom:8px;">搜索语法</h4>' +
      '<p><b>空格</b> = AND（同时匹配多个词）<br>' +
      '<code style="background:var(--c-surface);padding:2px 6px;border-radius:3px;">猫 狗</code> → 同时包含"猫"和"狗"</p>' +
      '<p><b>|</b> = OR（匹配任一条件）<br>' +
      '<code style="background:var(--c-surface);padding:2px 6px;border-radius:3px;">猫 | 狗</code> → 包含"猫"或"狗"</p>' +
      '<p><b>-</b> = 排除（不含该词）<br>' +
      '<code style="background:var(--c-surface);padding:2px 6px;border-radius:3px;">猫 -狗</code> → 包含"猫"但不含"狗"</p>' +
      '<p><b>""</b> = 精确短语（忽略其中的特殊字符）<br>' +
      '<code style="background:var(--c-surface);padding:2px 6px;border-radius:3px;">"猫 | 狗"</code> → 精确匹配"猫 | 狗"</p>' +
      '<hr style="border-color:var(--c-border);margin:12px 0;">' +
      '<h4 style="margin-bottom:8px;">快捷键</h4>' +
      '<p><b>Ctrl+F</b> 或 <b>空格</b> → 聚焦搜索栏<br>' +
      '<b>右键点击搜索栏</b> → 清空内容<br>' +
      '<b>Esc</b> → 返回上级相册</p>' +
      '</div>',
      [{ label: '知道了', primary: true }]
    );
  },

  /** 纯视觉重置所有主题/背景/透明状态到系统默认，不写 DB（用于回到 startup 页面） */
  resetToSystemDefaults() {
    document.documentElement.classList.remove('bg-transparent-mode');

    // 根据系统偏好确定当前有效主题
    let effectiveMode = window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
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

    // 清除背景图视觉
    const bgLayer = document.getElementById('bg-layer');
    if (bgLayer) { bgLayer.style.backgroundImage = ''; bgLayer.style.opacity = '0'; bgLayer.style.filter = ''; }
    // 重置覆盖层
    const overlay = document.getElementById('bg-overlay');
    if (overlay) { overlay.style.background = ''; overlay.style.opacity = ''; overlay.style.backdropFilter = ''; }
    // 关闭窗口效果
    API._invoke('window_set_effect', { enabled: false, effect_type: null }).catch(() => {});
  },
};
