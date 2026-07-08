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

      // 同步背景模式
      const bgMode = App._settings.bg_transparent ? 'transparent' : 'image';
      this._highlightBgModeBtns(bgMode);

      // Sync reverse search UI state
      this.applyReverseSearch(App._settings?.reverse_search_enabled ?? false);

      // 加载主页标题设置
      this.renderHomeTitleSettings();

      // 加载强调色设置
      this._renderAccentUI();

      // === 透明模式控件覆盖 ===
      const bgCard2 = document.getElementById('bg-image-card');
      const bgGrid2 = document.getElementById('bg-thumb-grid');
      if (App._settings.bg_transparent) {
        if (bgCard2) bgCard2.style.display = 'none';
        if (bgGrid2) bgGrid2.style.display = 'none';
        // 隐藏模糊和透明度滑块
        const blurEl2 = document.getElementById('set-bg-blur');
        if (blurEl2) blurEl2.closest('.settings-card').style.display = 'none';
        document.getElementById('bg-blur-val').style.display = 'none';
        const opacityEl2 = document.getElementById('set-bg-opacity');
        if (opacityEl2) opacityEl2.closest('.settings-card').style.display = 'none';
        document.getElementById('bg-opacity-val').style.display = 'none';
        // 强制自定义强调色
        this._highlightAccentBtns('custom');
        document.getElementById('accent-custom-panel').style.display = '';
        document.getElementById('accent-extract-panel').style.display = 'none';
      } else {
        if (bgCard2) bgCard2.style.display = '';
        if (bgGrid2) bgGrid2.style.display = 'flex';
        const blurEl2 = document.getElementById('set-bg-blur');
        if (blurEl2) blurEl2.closest('.settings-card').style.display = '';
        document.getElementById('bg-blur-val').style.display = '';
        const opacityEl2 = document.getElementById('set-bg-opacity');
        if (opacityEl2) opacityEl2.closest('.settings-card').style.display = '';
        document.getElementById('bg-opacity-val').style.display = '';
      }

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

  /** Set accent mode (custom/extract) */
  setAccentMode(mode) {
    // 透明模式下禁止切换到提取模式
    if (App._settings.bg_transparent && mode === 'extract') {
      Toast.show('透明模式下不支持提取颜色', 'info');
      return;
    }
    this._closeColorPicker();
    App._settings.accent_mode = mode;
    API.saveSettings(S.profileId, { accent_mode: mode });
    this._highlightAccentBtns(mode);

    const panel = document.getElementById('accent-custom-panel');
    const extractPanel = document.getElementById('accent-extract-panel');
    if (mode === 'custom') {
      if (panel) panel.style.display = '';
      if (extractPanel) extractPanel.style.display = 'none';
      this.applyCurrentAccent();
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
    // 透明模式下跳过，由外部覆盖逻辑控制
    if (App._settings.bg_transparent) return;
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

  setBgMode(mode) {
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
      App._settings.accent_mode = 'custom';  // 仅UI层，不写DB

      // === 应用透明背景效果 ===
      this.applyBgTransparent(true);

      // 首次进入透明模式时保存初始颜色到DB，使后续切换独立
      API.saveSettings(S.profileId, {
        transparent_accent_color_dark: App._settings.accent_color_dark,
        transparent_accent_color_light: App._settings.accent_color_light
      });

      // === UI 控件管理 ===
      // 隐藏背景图卡片
      const bgCard = document.getElementById('bg-image-card');
      if (bgCard) bgCard.style.display = 'none';
      // 隐藏模糊和透明度滑块
      const blurSlider = document.getElementById('set-bg-blur');
      if (blurSlider) {
        const blurCard = blurSlider.closest('.settings-card');
        if (blurCard) blurCard.style.display = 'none';
      }
      document.getElementById('bg-blur-val').style.display = 'none';
      const opacitySlider = document.getElementById('set-bg-opacity');
      if (opacitySlider) {
        const opacityCard = opacitySlider.closest('.settings-card');
        if (opacityCard) opacityCard.style.display = 'none';
      }
      document.getElementById('bg-opacity-val').style.display = 'none';
      // 强制自定义强调色
      document.getElementById('accent-custom-panel').style.display = '';
      document.getElementById('accent-extract-panel').style.display = 'none';
      this._highlightAccentBtns('custom');
      // 应用当前强调色
      this.applyCurrentAccent();
      this._updateAccentSwatches();
    } else {
      // === 保存透明模式的强调色 ===
      App._settings.transparent_accent_color_dark = App._settings.accent_color_dark;
      App._settings.transparent_accent_color_light = App._settings.accent_color_light;
      API.saveSettings(S.profileId, {
        transparent_accent_color_dark: App._settings.accent_color_dark,
        transparent_accent_color_light: App._settings.accent_color_light
      });

      // === 恢复背景图模式的强调色 ===
      App._settings.accent_color_dark = App._settings.bg_image_accent_color_dark || '#4A9EFF';
      App._settings.accent_color_light = App._settings.bg_image_accent_color_light || '#003D7A';
      App._settings.accent_mode = App._settings.bg_image_accent_mode || 'custom';

      // === 关闭透明背景效果 ===
      this.applyBgTransparent(false);

      // 恢复背景图
      this.applyBgImage(App._settings.bg_image || null);
      this.applyBlur(App._settings.bg_blur ?? 0);
      this.applyOpacity(App._settings.bg_opacity ?? 1.0);

      App._settings.bg_transparent = false;  // 提前设置，确保 _renderAccentUI 能看到

      // === UI 控件恢复 ===
      const bgCard = document.getElementById('bg-image-card');
      if (bgCard) bgCard.style.display = '';
      const blurSlider = document.getElementById('set-bg-blur');
      if (blurSlider) {
        const blurCard = blurSlider.closest('.settings-card');
        if (blurCard) blurCard.style.display = '';
      }
      document.getElementById('bg-blur-val').style.display = '';
      const opacitySlider = document.getElementById('set-bg-opacity');
      if (opacitySlider) {
        const opacityCard = opacitySlider.closest('.settings-card');
        if (opacityCard) opacityCard.style.display = '';
      }
      document.getElementById('bg-opacity-val').style.display = '';
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
