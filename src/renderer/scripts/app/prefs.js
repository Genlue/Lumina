// ============================================================
// Lumina · 界面偏好
// 纯展示参数（网格列数、间距）存在 localStorage：
// 它们只影响这台机器上的观感，不属于图库数据，也不进 SQLite。
// ============================================================

const KEY = 'lumina.ui.v1';

const state = {
  /** 每行图片数；0 = 按缩略图尺寸自动铺 */
  gridColumns: 0,
  /** 网格缝，px */
  gridGap: 4,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Number.isFinite(saved.gridColumns)) state.gridColumns = saved.gridColumns;
    if (Number.isFinite(saved.gridGap)) state.gridGap = saved.gridGap;
  } catch {
    // 存档损坏就用默认值
  }
}

export function getPrefs() {
  return { ...state };
}

export function setPrefs(patch) {
  Object.assign(state, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
  return { ...state };
}

load();
