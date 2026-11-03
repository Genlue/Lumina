// ============================================================
// Lumina · Glass Schema
// 无 DOM 的光学契约：raw 默认值、各面覆盖项、存储范围与 UI 推荐范围。
// band / amount / strokeHalf / strokeFeather 使用形状本地 px；light 使用角度。
// effective coating 由 theme 另乘全局通透度，不写回这里的 raw 参数。
// ============================================================

export const GLASS_OPTICS_DEFAULTS = Object.freeze({
  band: 24,
  amount: 10,
  depth: 0.6,
  dispersion: 0,
  vibrancy: 1.15,
  coating: 0.2,
  coatingColor: 'glass',
  strokeHalf: 1,
  strokeFeather: 0.25,
  strokeAlpha: 0.6,
  falloff: 1,
  light: 0,
  blurK: 1,
});

/** 各面只列覆盖项；glassSurfaceDefaults(id) 返回一套完整 raw 参数。 */
export const GLASS_SURFACE_DEFAULTS = Object.freeze({
  chrome: Object.freeze({ band: 26, amount: 9, coating: 0.46, vibrancy: 1.8, strokeAlpha: 0.22, strokeHalf: 0.5, blurK: 0.7 }),
  panel: Object.freeze({ band: 30, amount: 11, coating: 0.58, vibrancy: 1.8, strokeAlpha: 0.2, strokeHalf: 0.5, blurK: 0.85 }),
  capsule: Object.freeze({ band: 20, amount: 7, coating: 0.3, vibrancy: 1.8, strokeAlpha: 0.34, strokeHalf: 0.8, blurK: 0.5 }),
  menu: Object.freeze({ band: 24, amount: 9, coating: 0.62, vibrancy: 1.8, strokeAlpha: 0.2, strokeHalf: 0.5, blurK: 0.7 }),
  toast: Object.freeze({ band: 18, amount: 6, coating: 0.36, vibrancy: 1.8, strokeAlpha: 0.24, strokeHalf: 0.6, blurK: 0.55 }),
  sheet: Object.freeze({ band: 32, amount: 12, coating: 0.86, vibrancy: 1.8, strokeAlpha: 0.24, strokeHalf: 0.6, blurK: 0.9 }),
  // 悬浮导航：长条、竖直/水平都可能，折射带按短边给，别按长边 —— 否则两端会糊掉
  dock: Object.freeze({ band: 22, amount: 8, coating: 0.52, vibrancy: 1.8, strokeAlpha: 0.3, strokeHalf: 0.7, blurK: 0.6 }),
  thumb: Object.freeze({ band: 7.2, amount: 2.2, coating: 0.34, vibrancy: 1, strokeAlpha: 0, strokeHalf: 0.8, strokeFeather: 0.35, blurK: 1 }),
});

export function glassSurfaceDefaults(id) {
  return { ...GLASS_OPTICS_DEFAULTS, ...(GLASS_SURFACE_DEFAULTS[id] ?? {}) };
}

/**
 * UI 直接消费的 12 项数值参数。min/max 是控件推荐范围；
 * storageMin/storageMax 是 raw 存储合法范围，二者可以不同。
 */
export const GLASS_PARAM_DEFS = Object.freeze([
  Object.freeze({ k: 'band', label: '折射带深度', hint: '从边缘往里多深开始弯折（本地 px）', min: 0, max: 60, step: 0.5, unit: 'px', digits: 1, storageMin: 0, storageMax: 240 }),
  Object.freeze({ k: 'amount', label: '峰值位移', hint: '贴边处最多把背景推多远（本地 px）', min: 0, max: 24, step: 0.1, unit: 'px', digits: 1, storageMin: 0, storageMax: 120 }),
  Object.freeze({ k: 'depth', label: '深度效应', hint: '叠多少径向分量；0 = 只有边缘法线，读成一层壳', min: 0, max: 1, step: 0.01, unit: '', digits: 2, storageMin: 0, storageMax: 1 }),
  Object.freeze({ k: 'dispersion', label: '色散', hint: '沿位移方向的红/蓝分离，对角象限反向', min: 0, max: 1, step: 0.01, unit: '', digits: 2, storageMin: 0, storageMax: 1 }),
  Object.freeze({ k: 'vibrancy', label: '饱和度', hint: '透过玻璃后色彩的浓度，1 = 原样', min: 0, max: 2.5, step: 0.01, unit: '×', digits: 2, storageMin: 0, storageMax: 4 }),
  Object.freeze({ k: 'coating', label: '涂层', hint: '表面色压上去的强度；0 = 纯折射，1 = 完全不透明', min: 0, max: 1, step: 0.01, unit: '', digits: 2, storageMin: 0, storageMax: 1 }),
  Object.freeze({ k: 'strokeAlpha', label: '描边高光', hint: '法线朝向光源那一侧的发丝光强度', min: 0, max: 1, step: 0.01, unit: '', digits: 2, storageMin: 0, storageMax: 1 }),
  Object.freeze({ k: 'strokeHalf', label: '高光半宽', hint: '发丝线的半宽（本地 px）', min: 0, max: 4, step: 0.05, unit: 'px', digits: 2, storageMin: 0, storageMax: 20 }),
  Object.freeze({ k: 'strokeFeather', label: '高光羽化', hint: '高光边缘的过渡宽度（本地 px）', min: 0, max: 2, step: 0.05, unit: 'px', digits: 2, storageMin: 0, storageMax: 20 }),
  Object.freeze({ k: 'falloff', label: '高光衰减', hint: '越大越收在法线上；1 = 宽泛光', min: 0.2, max: 4, step: 0.05, unit: '', digits: 2, storageMin: 0.05, storageMax: 20 }),
  Object.freeze({ k: 'light', label: '光照角度', hint: '0° = 光从上方来，90° = 从右侧来', min: 0, max: 360, step: 5, unit: '°', digits: 0, storageMin: 0, storageMax: 360 }),
  Object.freeze({ k: 'blurK', label: '背景模糊', hint: '背景模糊倍数；CSS 兜底与原生 lens 都读取', min: 0, max: 2, step: 0.05, unit: '×', digits: 2, storageMin: 0, storageMax: 3 }),
]);

const GLASS_PARAM_BY_KEY = Object.fromEntries(GLASS_PARAM_DEFS.map((d) => [d.k, d]));
const glassSchemaClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function glassSchemaNumber(patch, key, base) {
  const fallback = Number.isFinite(Number(base?.[key]))
    ? Number(base[key])
    : GLASS_OPTICS_DEFAULTS[key];
  const value = Number(patch?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

/** 归一化一套 raw 参数；缺项取 base，不产生 NaN，不应用全局 glass 倍率。 */
export function normalizeGlassOptics(patch = {}, base = GLASS_OPTICS_DEFAULTS) {
  const source = patch && typeof patch === 'object' ? patch : {};
  const result = {};
  for (const key of Object.keys(GLASS_OPTICS_DEFAULTS)) {
    if (key === 'coatingColor') {
      const value = typeof source.coatingColor === 'string' ? source.coatingColor.trim() : '';
      const fallback = typeof base?.coatingColor === 'string' ? base.coatingColor.trim() : '';
      result.coatingColor = value || fallback || GLASS_OPTICS_DEFAULTS.coatingColor;
      continue;
    }
    const def = GLASS_PARAM_BY_KEY[key];
    const value = glassSchemaNumber(source, key, base);
    result[key] = key === 'light'
      ? ((value % 360) + 360) % 360
      : glassSchemaClamp(value, def.storageMin, def.storageMax);
  }
  return result;
}
