// ============================================================
// Lumina · Platform
// 与宿主环境的唯一接触面：Tauri 窗口能力。浏览器预览时全部安全降级。
// ============================================================

const tauri = globalThis.__TAURI__;

export const isDesktop = Boolean(tauri?.core?.invoke);

const invoke = (cmd, args) =>
  isDesktop ? tauri.core.invoke(cmd, args) : Promise.reject(new Error('not desktop'));

/* ---------------- 窗口材质 ---------------- */

/**
 * 侧栏背景材质。
 * - 'system'：交给 Windows 的 Acrylic API（DWM 真实模糊），窗口改为贴边、隐藏自绘壁纸
 * - 'css'：自绘背景 + backdrop-filter 玻璃（跨平台一致）
 * @returns {Promise<boolean>} 是否真正生效；浏览器里返回 false
 */
export async function setSidebarBackdrop(kind) {
  const root = document.documentElement;
  if (kind === 'system') {
    if (!isDesktop) {
      root.setAttribute('data-backdrop', 'css');
      return false;
    }
    try {
      await invoke('window_set_effect', { enabled: true, effectType: 'acrylic' });
      root.setAttribute('data-backdrop', 'system');
      return true;
    } catch (e) {
      console.warn('[platform] acrylic unavailable', e);
      root.setAttribute('data-backdrop', 'css');
      return false;
    }
  }

  if (isDesktop) {
    try {
      await invoke('window_set_effect', { enabled: false, effectType: null });
    } catch {}
  }
  root.setAttribute('data-backdrop', 'css');
  return true;
}

export const currentBackdrop = () =>
  document.documentElement.getAttribute('data-backdrop') || 'css';

/* ---------------- 窗口控制 ---------------- */

export const windowControls = {
  minimize: () => invoke('plugin:window|minimize').catch(() => {}),
  toggleMaximize: () => invoke('plugin:window|toggle_maximize').catch(() => {}),
  close: () => invoke('plugin:window|close').catch(() => {}),
  async isMaximized() {
    try {
      return await invoke('plugin:window|is_maximized');
    } catch {
      return false;
    }
  },
};

/** 标题栏模式：'macos' 去掉系统装饰用自绘红绿灯；'native' 交还系统 */
export async function setTitlebarMode(mode) {
  const root = document.documentElement;
  root.setAttribute('data-titlebar', mode === 'macos' ? 'macos' : 'native');
  if (!isDesktop) return;
  try {
    await invoke('window_set_titlebar', { mode });
  } catch (e) {
    console.warn('[platform] titlebar mode failed', e);
  }
}

/* ---------------- 打开文件位置 ---------------- */

export async function openInExplorer(path) {
  if (!isDesktop) return;
  try {
    await invoke('open_in_explorer', { path });
  } catch (e) {
    console.warn('[platform] open path failed', e);
  }
}
