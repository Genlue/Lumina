// ============================================================
// Lumina · 设置 → 外观
// 外观只剩两个旋钮：主题模式、强调色。
// 材质（七面光学参数 / 通透度 / 阴影浓度 / 线宽）由 Golden Gate 自己的
// theme 管，存在 localStorage —— 它属于设计系统，不属于图库数据。
// ============================================================

import { theme } from '../core/theme.js';
import { S } from './state.js';
import { system, isDesktop } from './api.js';
import { clampNum } from './util.js';

/** 防止 setAccent 的监听回调再次进入 */
let applyingAccent = false;

/**
 * 当前生效的强调色。
 * 深浅两档不再分开设置：theme.setAccent 会按主题自动压暗 / 提亮（docs/01 §7），
 * 同一个十六进制在两套主题下都成立 —— 于是「一个参数只有一个值」。
 */
export function resolveAccent(s) {
  return s.accent_color;
}

/** 只应用强调色（主题切换时也会被调用） */
export function applyAccent(s) {
  if (applyingAccent) return;
  const want = String(resolveAccent(s, theme.resolved) || '').toLowerCase();
  if (!want || theme.accent.toLowerCase() === want) return;
  applyingAccent = true;
  try {
    theme.setAccent(want);
  } finally {
    applyingAccent = false;
  }
}

/** 主题模式：light / dark / system */
export function applyThemeMode(s) {
  const mode = s.theme_mode === 'light' || s.theme_mode === 'dark' ? s.theme_mode : 'system';
  if (theme.mode !== mode) theme.setMode(mode, { persist: true });
  applyAccent(s);
}

/**
 * 界面尺寸参数：导航栏宽度。
 * 唯一入口是 --nav-w（tokens.css §11）—— 「侧栏」只是导航栏的一种形态，
 * --sidebar-* 已经是兼容别名，新代码不再写它。
 */
export function applyUiParams(s) {
  const root = document.documentElement;
  // 范围与 tokens.css 的 --nav-w-min(190) / --nav-w-max(340) 对齐，
  // 默认值与 --nav-w(224) 一致。
  root.style.setProperty(
    '--nav-w',
    `${Math.round(clampNum(s.sidebar_width, 190, 340, 224))}px`
  );
}

/**
 * 导航栏材质：Windows Acrylic —— 真实桌面模糊。
 * layout.css 里 [data-backdrop="system"] 会隐藏自绘壁纸、让导航栏完全透明，
 * 模糊与染色由 DWM 提供；拿不到效果时回落到 Golden Gate 的 CSS acrylic。
 */
export async function applyBackdrop() {
  const root = document.documentElement;
  if (!isDesktop) {
    root.setAttribute('data-backdrop', 'css');
    return;
  }
  try {
    await system.setEffect(true, 'acrylic');
    root.setAttribute('data-backdrop', 'system');
  } catch {
    root.setAttribute('data-backdrop', 'css');
  }
}

/**
 * 应用整份设置。
 * 材质固定为 Golden Gate 的默认档：设置页不再提供这些旋钮，
 * 所以每次启动都把可能残留在 localStorage 里的旧值拉回默认，避免界面漂移。
 */
export async function applySettings(s) {
  theme.setGlass(1);
  theme.setShadow(1);
  theme.setStroke(1.4);
  // 七个玻璃面的光学参数回到设计系统的定稿值（glass-schema.js）。
  // 想调材质请去 Golden Gate 的玻璃参数页导出，不要在这里写死。
  theme.resetOptics();
  applyThemeMode(s);
  applyUiParams(s);
  await applyBackdrop();
}

/**
 * theme.js 内部已经监听 prefers-color-scheme 并重算 data-theme，
 * 但强调色要按新的 resolved 重新选一次，所以这里再挂一层。
 */
export function startThemeWatch() {
  theme.subscribe(() => {
    applyAccent(S.settings);
  });
}
