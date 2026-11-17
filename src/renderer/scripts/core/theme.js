// ============================================================
// Lumina · Theme
// 主题 / 强调色 / 液态玻璃参数的唯一入口。
// 「跟随系统」是真跟随：监听 prefers-color-scheme，系统切换即刻生效。
//
// 光学参数**以 DeskCanvas 的 LiquidGlassParams 为准**，一个面一套：
//   band / amount / depth / dispersion / vibrancy / coating(+color)
//   strokeHalf / strokeFeather / strokeAlpha / falloff / light
// 渲染层（glass-lens）直接读这里；CSS 兜底路径读同一组值派生出来的变量，
// 两条路的数值只有一个来源。
// ============================================================

import {
  GLASS_OPTICS_DEFAULTS,
  GLASS_PARAM_DEFS,
  glassSurfaceDefaults,
  normalizeGlassOptics,
} from './glass-schema.js';

const root = document.documentElement;
const mq = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * 桌面端由宿主告知的系统明暗（'light' / 'dark'），null = 不知道，退回 mq。
 *
 * 为什么不能只信 prefers-color-scheme：Windows 上它跟着**窗口主题**走，
 * 而窗口主题在手动切过浅色以后会被宿主钉死。宿主先把窗口主题交还系统、
 * 再回读，拿到的才是 OS 的真实偏好。
 */
let systemOverride = null;
// 版本号进 key：改了默认值就换一档，避免旧存档把新默认值盖掉
const KEY = 'lumina.appearance.v8';
const THEME_JSON_VERSION = 1;

/** 七类玻璃面。cls 用于写 CSS 兜底变量，id 用于取参数 */
export const GLASS_SURFACES = [
  { id: 'chrome', label: '顶栏', short: '顶栏', cls: '.c-glass-chrome', note: 'L1 · 最轻的一档，浮在内容之上' },
  // 导航栏不是液态玻璃，是 acrylic：只有浓度 / 模糊 / 饱和度三个旋钮，
  // 不参与折射与色散。放在这张表里是为了「参数页仍然原位」，不是因为它同材质。
  { id: 'panel', label: '导航栏', short: '导航栏', cls: '.c-acrylic', material: 'acrylic', note: 'Acrylic · 模糊 + 提饱和 + 染色，没有折射' },
  { id: 'capsule', label: '胶囊', short: '胶囊', cls: '.c-capsule', note: '工具栏里的一组控件共用一层玻璃' },
  { id: 'dock', label: '悬浮导航', short: '悬浮', cls: '.c-dock__pill', note: '浮在内容上的长条玻璃；导航栏的另一种形态' },
  { id: 'menu', label: '菜单', short: '菜单', cls: '.c-menu', note: 'L2 材质 + 弹层外影；可读性优先' },
  { id: 'toast', label: '提示条', short: '提示', cls: '.c-toast', note: '更薄的一层，多一道顶部镜面' },
  { id: 'sheet', label: '模态', short: '模态', cls: '.c-glass-sheet', note: 'L4 · 最厚，压在其它层之上' },
  { id: 'thumb', label: '滑块拇指', short: '拇指', cls: '.c-slider__thumb', note: '24×16 的小件，参数按短边等比缩' },
];

/** 兼容现有调用方；唯一默认值与归一化实现见 glass-schema.js。 */
export const GLASS_DEFAULTS = GLASS_OPTICS_DEFAULTS;

const state = {
  mode: 'system', // light | dark | system
  accent: '#0a84ff',
  glass: 1,
  /** 全局阴影浓度：0 = 完全平，1 = 默认，1.6 = 很重 */
  shadow: 1,
  /** 全局图标线宽（物理像素，不随图标尺寸缩放） */
  stroke: 1.4,
  /** 每个玻璃面一套完整光学参数 */
  optics: Object.fromEntries(GLASS_SURFACES.map((s) => [s.id, glassSurfaceDefaults(s.id)])),
  /** Acrylic（导航栏）：浓度 / 模糊 / 饱和度。和液态玻璃是两套参数，不共用。 */
  acrylic: { tint: 0.8, blur: 30, sat: 1.8 },
};

const listeners = new Set();

/* ---------------- 颜色工具 ---------------- */

function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return { r: 10, g: 132, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const rgbCss = ({ r, g, b }, a = 1) =>
  a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`;

function mix(c1, c2, t) {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/** 相对亮度，用来决定强调色上的文字是黑还是白 */
function luminance({ r, g, b }) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const tClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/* ---------------- 参数归一化 ---------------- */

/** 兼容现有调用方；归一化 raw，不乘全局 glass。 */
export function normalizeOptics(patch = {}, base = GLASS_DEFAULTS) {
  return normalizeGlassOptics(patch, base);
}

const isThemeRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasThemeField = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isThemeNumber = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** 完整校验并构造独立 raw 快照；此函数绝不修改 state 或 localStorage。 */
function parseThemeJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`主题 JSON 解析失败：${error.message}`);
  }
  if (!isThemeRecord(data)) throw new Error('主题 JSON 必须是对象');

  for (const key of ['version', 'mode', 'accent', 'glass', 'shadow', 'stroke', 'optics']) {
    if (!hasThemeField(data, key)) throw new Error(`主题 JSON 缺少字段：${key}`);
  }
  if (data.version !== THEME_JSON_VERSION) {
    throw new Error(`不支持的主题 JSON 版本：${data.version}`);
  }
  if (!['light', 'dark', 'system'].includes(data.mode)) {
    throw new Error(`非法主题模式：${data.mode}`);
  }
  if (typeof data.accent !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(data.accent.trim())) {
    throw new Error('非法强调色：必须是 #RGB 或 #RRGGBB');
  }
  for (const [key, min, max] of [['glass', 0, 1], ['shadow', 0, 1.6], ['stroke', 0.6, 2.2]]) {
    if (!isThemeNumber(data[key], min, max)) {
      throw new Error(`非法 ${key}：必须是 ${min}…${max} 内的有限数字`);
    }
  }
  if (!isThemeRecord(data.optics)) throw new Error('主题 JSON 的 optics 必须是对象');

  const optics = {};
  for (const s of GLASS_SURFACES) {
    if (!hasThemeField(data.optics, s.id)) throw new Error(`主题 JSON 缺少玻璃面：${s.id}`);
    const raw = data.optics[s.id];
    if (!isThemeRecord(raw)) throw new Error(`玻璃面 ${s.id} 必须是对象`);
    for (const key of Object.keys(GLASS_DEFAULTS)) {
      if (!hasThemeField(raw, key)) throw new Error(`玻璃面 ${s.id} 缺少字段：${key}`);
    }
    for (const def of GLASS_PARAM_DEFS) {
      if (!isThemeNumber(raw[def.k], def.storageMin, def.storageMax)) {
        throw new Error(`玻璃面 ${s.id} 的 ${def.k} 超出存储范围或不是有限数字`);
      }
    }
    if (typeof raw.coatingColor !== 'string' || !raw.coatingColor.trim()) {
      throw new Error(`玻璃面 ${s.id} 的 coatingColor 必须是非空字符串`);
    }
    if (raw.coatingColor !== 'glass' && typeof CSS !== 'undefined' && !CSS.supports('color', raw.coatingColor)) {
      throw new Error(`玻璃面 ${s.id} 的 coatingColor 不是可识别的 CSS 颜色`);
    }
    // 这里只复制 raw；effective 的 coating 倍率只在读取和 CSS 导出时计算。
    optics[s.id] = normalizeOptics(raw, glassSurfaceDefaults(s.id));
  }

  return {
    mode: data.mode,
    accent: data.accent.trim(),
    glass: data.glass,
    shadow: data.shadow,
    stroke: data.stroke,
    optics,
  };
}

/**
 * 取某个面的**生效参数**（已经算上「通透度」这个全局倍率）。
 * 渲染层与 CSS 兜底都走这一个入口，不存在两套数。
 */
function effective(id) {
  const o = state.optics[id] ?? glassSurfaceDefaults(id);
  // 通透度是全局倍率：1 → 原值，0 → 45%。它压的是「涂层」，不是折射
  const k = 0.45 + 0.55 * state.glass;
  return { ...o, coating: o.coating * k };
}

/** CSS 里不能把 'glass' 当颜色；导出/写变量时解析成当前主题玻璃色。 */
const cssCoatingColor = (value) =>
  value === 'glass' ? 'rgb(var(--glass-rgb))' : value;

/* ---------------- 应用 ---------------- */

let acrylicSheet = null;

/** Acrylic 只有三个值，直接写在 :root 上，不进玻璃的逐面变量表 */
function applyAcrylic() {
  if (typeof document === 'undefined') return;
  if (!acrylicSheet?.isConnected) {
    acrylicSheet = document.createElement('style');
    acrylicSheet.id = 'gg-acrylic';
    document.head.append(acrylicSheet);
  }
  const a = state.acrylic;
  acrylicSheet.textContent =
    `:root{--m-acrylic-a:${a.tint.toFixed(4)};` +
    `--m-acrylic-blur:${a.blur.toFixed(2)}px;` +
    `--m-acrylic-sat:${Math.round(a.sat * 100)}%;}`;
}

let opticsSheet = null;

function ensureSheet() {
  if (opticsSheet?.isConnected) return opticsSheet;
  opticsSheet = document.createElement('style');
  opticsSheet.id = 'gg-optics';
  document.head.append(opticsSheet);
  return opticsSheet;
}

/**
 * 把每个面的参数写成 CSS 变量。CSS 兜底路径吃这些变量；
 * 渲染层不读 CSS（直接调 getOptics），但两边数值同源。
 */
function applyOptics() {
  if (typeof document === 'undefined') return;
  const lines = [];
  for (const s of GLASS_SURFACES) {
    // acrylic 面不吃液态玻璃参数，写上去只会让后代误读
    if (s.material === 'acrylic') continue;
    const o = effective(s.id);
    lines.push(
      `${s.cls} {` +
      `--lg-band:${o.band};` +
      `--lg-amount:${o.amount};` +
      `--lg-amount-k:${Math.min(1, o.amount / 10).toFixed(3)};` +
      `--lg-depth:${o.depth};` +
      `--lg-dispersion:${o.dispersion};` +
      `--lg-vibrancy:${o.vibrancy};` +
      `--lg-coating:${o.coating.toFixed(4)};` +
      `--lg-coating-color:${cssCoatingColor(o.coatingColor)};` +
      `--lg-stroke-half:${o.strokeHalf};` +
      `--lg-stroke-feather:${o.strokeFeather};` +
      `--lg-stroke-alpha:${o.strokeAlpha};` +
      `--lg-falloff:${o.falloff};` +
      `--lg-light:${o.light};` +
      `--glass-blur-k:${o.blurK};` +
      `}`
    );
  }
  ensureSheet().textContent = lines.join('\n');
}

function applyAccent(resolved) {
  const base = state.accent;
  const baseRgb = hexToRgb(base);

  // 浅色主题下略压暗，深色主题下略提亮，保证同一个色在两套主题里都成立
  const adjusted =
    resolved === 'dark' ? mix(base, '#ffffff', 0.06) : mix(base, '#000000', 0.1);
  const hover = resolved === 'dark' ? mix(base, '#ffffff', 0.16) : mix(base, '#000000', 0.22);

  root.style.setProperty('--accent', rgbCss(adjusted));
  root.style.setProperty('--accent-hover', rgbCss(hover));
  root.style.setProperty('--accent-soft', rgbCss(baseRgb, resolved === 'dark' ? 0.22 : 0.12));
  root.style.setProperty('--accent-ring', rgbCss(baseRgb, resolved === 'dark' ? 0.48 : 0.36));
  root.style.setProperty('--accent-rgb', `${baseRgb.r} ${baseRgb.g} ${baseRgb.b}`);
  root.style.setProperty('--text-on-accent', luminance(baseRgb) > 0.62 ? '#1d1d1f' : '#ffffff');
}

function notifyTheme() {
  const resolved = resolveTheme();
  listeners.forEach((fn) => fn({ ...state, resolved }));
}

function apply({ notify = true } = {}) {
  const resolved = resolveTheme();
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-mode', state.mode);
  root.style.setProperty('--lg', String(state.glass));
  root.style.setProperty('--shadow-k', String(state.shadow));
  root.style.setProperty('--ic-stroke', String(state.stroke));
  applyAccent(resolved);
  applyOptics();
  applyAcrylic();
  root.style.setProperty('color-scheme', resolved);
  if (notify) listeners.forEach((fn) => fn({ ...state, resolved }));
}

/** 所有变更走同一条路径：完整应用、按需保存、最后统一通知一次。 */
function commit({ persist = true } = {}) {
  apply({ notify: false });
  if (persist) save();
  notifyTheme();
}

/* ---------------- 持久化 ---------------- */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!isThemeRecord(saved)) return;
    if (['light', 'dark', 'system'].includes(saved.mode)) state.mode = saved.mode;
    if (typeof saved.accent === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(saved.accent.trim())) {
      state.accent = saved.accent.trim();
    }
    if (Number.isFinite(Number(saved.glass))) state.glass = tClamp(Number(saved.glass), 0, 1);
    if (Number.isFinite(Number(saved.shadow))) state.shadow = tClamp(Number(saved.shadow), 0, 1.6);
    if (Number.isFinite(Number(saved.stroke))) state.stroke = tClamp(Number(saved.stroke), 0.6, 2.2);
    if (saved.optics) {
      for (const s of GLASS_SURFACES) {
        if (saved.optics[s.id]) {
          state.optics[s.id] = normalizeOptics(saved.optics[s.id], glassSurfaceDefaults(s.id));
        }
      }
    }
    if (isThemeRecord(saved.acrylic)) {
      const a = saved.acrylic;
      if (Number.isFinite(Number(a.tint))) state.acrylic.tint = tClamp(Number(a.tint), 0, 1);
      if (Number.isFinite(Number(a.blur))) state.acrylic.blur = tClamp(Number(a.blur), 0, 80);
      if (Number.isFinite(Number(a.sat))) state.acrylic.sat = tClamp(Number(a.sat), 0, 3);
    }
  } catch {}
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

/* ---------------- 系统变化 ---------------- */

mq.addEventListener('change', () => {
  // 桌面端以窗口主题为准：mq 这时反映的可能是宿主自己钉住的值，不是系统
  if (state.mode === 'system' && !systemOverride) apply();
});

/**
 * 宿主回报系统明暗。传 null 表示读不到，退回 prefers-color-scheme。
 * 浏览器里没有宿主，保持 null 即可，行为和以前完全一样。
 * @returns {boolean} 是否真的变了（没变就不会重绘）
 */
export function setSystemTheme(value) {
  const next = value === 'dark' || value === 'light' ? value : null;
  if (next === systemOverride) return false;
  systemOverride = next;
  if (state.mode === 'system') commit({ persist: false });
  return true;
}

/* ---------------- 对外 API ---------------- */

export const resolveTheme = (mode = state.mode) =>
  mode === 'light' || mode === 'dark'
    ? mode
    : systemOverride || (mq.matches ? 'dark' : 'light');

export const theme = {
  init() {
    load();
    apply({ notify: false });
    return { ...state, resolved: resolveTheme() };
  },
  get mode() {
    return state.mode;
  },
  get accent() {
    return state.accent;
  },
  get glass() {
    return state.glass;
  },
  get resolved() {
    return resolveTheme();
  },
  setMode(mode, { persist = true } = {}) {
    state.mode = mode === 'light' || mode === 'dark' ? mode : 'system';
    commit({ persist });
  },
  setAccent(hex, { persist = true } = {}) {
    if (hex === 'multi') return;
    state.accent = hex;
    commit({ persist });
  },
  setGlass(v, { persist = true } = {}) {
    state.glass = tClamp(num(v, 1), 0, 1);
    commit({ persist });
  },
  get shadow() {
    return state.shadow;
  },
  get stroke() {
    return state.stroke;
  },
  setStroke(v, { persist = true } = {}) {
    state.stroke = tClamp(num(v, 1.4), 0.6, 2.2);
    commit({ persist });
  },
  setShadow(v, { persist = true } = {}) {
    state.shadow = tClamp(num(v, 1), 0, 1.6);
    commit({ persist });
  },
  resetShadow({ persist = true } = {}) {
    this.setShadow(1, { persist });
  },

  /** 某个面的**生效**参数（含通透度倍率），渲染层直接用 */
  getOptics(id) {
    return effective(id);
  },
  /** 某个面的原始参数（不含通透度倍率），调参面板显示用 */
  getOpticsRaw(id) {
    return { ...(state.optics[id] ?? glassSurfaceDefaults(id)) };
  },
  /** 全部面的原始参数 */
  get optics() {
    return Object.fromEntries(GLASS_SURFACES.map((s) => [s.id, { ...state.optics[s.id] }]));
  },
  /** 逐项调整某个面；未提供的项保持不变 */
  setOptics(id, patch, { persist = true } = {}) {
    if (!state.optics[id]) return;
    state.optics[id] = normalizeOptics({ ...state.optics[id], ...patch }, glassSurfaceDefaults(id));
    commit({ persist });
  },
  /** 完整复制某面的 raw 到七个面，含 band/amount/描边等本地 px；不乘 glass，也不套目标面默认值。 */
  applyOpticsToAll(id, { persist = true } = {}) {
    const src = state.optics[id];
    if (!src) return;
    for (const s of GLASS_SURFACES) state.optics[s.id] = { ...src };
    commit({ persist });
  },
  /** 只重置七面 raw；mode/accent/glass/shadow/stroke 等全局状态保持不变。 */
  resetOptics(id, { persist = true } = {}) {
    if (id) state.optics[id] = glassSurfaceDefaults(id);
    else for (const s of GLASS_SURFACES) state.optics[s.id] = glassSurfaceDefaults(s.id);
    commit({ persist });
  },
  /** Acrylic 三个旋钮（导航栏专用） */
  get acrylic() {
    return { ...state.acrylic };
  },
  setAcrylic(patch, { persist = true } = {}) {
    const next = { ...state.acrylic, ...patch };
    state.acrylic = {
      tint: tClamp(Number(next.tint), 0, 1),
      blur: tClamp(Number(next.blur), 0, 80),
      sat: tClamp(Number(next.sat), 0, 3),
    };
    commit({ persist });
  },
  resetAcrylic({ persist = true } = {}) {
    state.acrylic = { tint: 0.8, blur: 30, sat: 1.8 };
    commit({ persist });
  },
  /** 完整、可恢复的状态存档；optics 始终是未乘 glass 的七面 raw。 */
  exportJson() {
    return JSON.stringify({
      version: THEME_JSON_VERSION,
      mode: state.mode,
      accent: state.accent,
      glass: state.glass,
      shadow: state.shadow,
      stroke: state.stroke,
      optics: Object.fromEntries(GLASS_SURFACES.map((s) => [s.id, { ...state.optics[s.id] }])),
      acrylic: { ...state.acrylic },
    }, null, 2);
  },
  /** 先解析并校验全部字段，再一次性替换状态；失败时不应用、不保存、不清空旧存档。 */
  importJson(text, { persist = true } = {}) {
    const next = parseThemeJson(text);
    Object.assign(state, next);
    commit({ persist });
  },
  /** 有限的 CSS 附加导出：仅含当前 effective 变量，不是完整主题存档。 */
  exportCss() {
    const blocks = GLASS_SURFACES.filter((s) => s.material !== 'acrylic').map((s) => {
      const o = effective(s.id);
      return `${s.cls} {
  --lg-band: ${o.band};
  --lg-amount: ${o.amount};
  --lg-amount-k: ${Math.min(1, o.amount / 10).toFixed(3)};
  --lg-depth: ${o.depth};
  --lg-dispersion: ${o.dispersion};
  --lg-vibrancy: ${o.vibrancy};
  --lg-coating: ${o.coating.toFixed(3)};
  --lg-coating-color: ${cssCoatingColor(o.coatingColor)};
  --lg-stroke-half: ${o.strokeHalf};
  --lg-stroke-feather: ${o.strokeFeather};
  --lg-stroke-alpha: ${o.strokeAlpha};
  --lg-falloff: ${o.falloff};
  --lg-light: ${o.light};
  --glass-blur-k: ${o.blurK};
}`;
    });
    const globals = `:root {
  --lg: ${state.glass};
  --shadow-k: ${state.shadow};
  --ic-stroke: ${state.stroke};
}`;
    return [globals, ...blocks].join('\n\n');
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export const systemPrefersDark = () => mq.matches;
