// ============================================================
// Lumina · API
// 与 Rust 后端唯一的接触面。命令名与参数严格照 src-tauri/src/commands.rs。
// 浏览器里（没有 __TAURI__）所有调用都安全降级成 reject，页面自己兜住。
// ============================================================

import { S } from './state.js';

const tauri = globalThis.__TAURI__;

export const isDesktop = Boolean(tauri?.core?.invoke);

/** 直接 invoke；非桌面环境直接抛错，调用方用 toast 兜底 */
export function invoke(cmd, args = {}) {
  if (!isDesktop) return Promise.reject(new Error('需要在 Lumina 桌面端运行'));
  return tauri.core.invoke(cmd, args);
}

/** 本地文件路径 → webview 可加载的 asset URL */
export function fileSrc(path) {
  if (!path) return '';
  try {
    return tauri.core.convertFileSrc(path);
  } catch {
    return path;
  }
}

/* ==========================================================================
   图库 profile
   ========================================================================== */

export const profiles = {
  list: () => invoke('profiles_list'),
  get: (id) => invoke('profiles_get_by_id', { id }),
  create: (folderPath, name) => invoke('profiles_create', { folderPath, name }),
  remove: (id) => invoke('profiles_remove', { id }),
  touch: (id) => invoke('profiles_touch', { id }),
  markGone: (id) => invoke('profiles_mark_gone', { id }),
  checkPath: (folderPath) => invoke('profiles_check_path', { folderPath }),
  relocate: (id) => invoke('profiles_relocate', { id }),
};

/* ==========================================================================
   扫描
   ========================================================================== */

export const scan = {
  all: (profileId) => invoke('scanner_scan_all', { profileId }),
  folder: (profileId, folderPath) => invoke('scanner_scan_folder', { profileId, folderPath }),
  listFolders: (profileId) => invoke('scanner_list_folders', { profileId }),
  listSubfolders: (profileId, parentPath = '') =>
    invoke('scanner_list_subfolders', { profileId, parentPath }),
};

/* ==========================================================================
   缩略图（内存缓存 + 批量请求）
   ========================================================================== */

/** `${folder}|${name}|${size}` → { dataUrl, width, height } */
const thumbCache = new Map();

const thumbKey = (folder, name, size) => `${folder || ''}|${name}|${size || 'full'}`;

/** 同步读缓存：网格窗口化重建时先命中它，避免闪一下空白 */
export function peekThumb(name, folder, size) {
  return thumbCache.get(thumbKey(folder, name, size)) || null;
}

function putThumb(folder, name, size, value) {
  if (!value) return;
  thumbCache.set(thumbKey(folder, name, size), value);
}

/**
 * 单张缩略图。size = 0/null 时返回原图路径（灯箱、壁纸用）。
 * @returns {Promise<{dataUrl:string,width:number,height:number}>}
 */
export async function getThumb(name, folder, size = 400) {
  const hit = peekThumb(name, folder, size);
  if (hit) return hit;

  const res = await invoke('files_get_thumbnail', {
    profileId: S.profileId,
    filename: name,
    folder: folder || null,
    size: size || null,
  });
  if (!res?.dataUrl) throw new Error('缩略图为空');
  const value = {
    dataUrl: fileSrc(res.dataUrl),
    width: res.width || 0,
    height: res.height || 0,
  };
  putThumb(folder, name, size, value);
  return value;
}

/**
 * 批量缩略图：一次 IPC 拿多张，未命中缓存的才发请求。
 * @param {Array<{name:string, folder:string|null}>} items
 * @returns {Promise<Array<{dataUrl:string,width:number,height:number}|null>>} 与入参同序
 */
export async function getThumbs(items, size = 400) {
  const out = new Array(items.length).fill(null);
  const missing = [];
  const missingIdx = [];

  items.forEach((it, i) => {
    const hit = peekThumb(it.name, it.folder, size);
    if (hit) out[i] = hit;
    else {
      missing.push({ filename: it.name, folder: it.folder || null });
      missingIdx.push(i);
    }
  });

  if (!missing.length) return out;

  const batch = await invoke('files_get_thumbnails_batch', {
    profileId: S.profileId,
    requests: missing,
    size,
  });

  batch.forEach((res, j) => {
    const idx = missingIdx[j];
    const src = missing[j];
    if (!res || !res.dataUrl) return;
    const value = { dataUrl: fileSrc(res.dataUrl), width: 0, height: 0 };
    putThumb(src.folder, src.filename, size, value);
    out[idx] = value;
  });

  return out;
}

/** 原图（灯箱 / 壁纸预览） */
export const getFullImage = (name, folder) => getThumb(name, folder, 0);

/** 清空内存缩略图缓存（切换图库、重命名、删除后调用） */
export function clearThumbCache() {
  thumbCache.clear();
}

/** 驱逐单个文件的所有尺寸变体 */
export function evictThumb(name, folder) {
  const prefix = `${folder || ''}|${name}|`;
  for (const k of [...thumbCache.keys()]) {
    if (k.startsWith(prefix)) thumbCache.delete(k);
  }
}

/** 驱逐整个文件夹的缓存 */
export function evictThumbFolder(folder) {
  const prefix = `${folder || ''}|`;
  for (const k of [...thumbCache.keys()]) {
    if (k.startsWith(prefix)) thumbCache.delete(k);
  }
}

/* ==========================================================================
   文件
   ========================================================================== */

export const files = {
  rename: (profileId, oldName, newName, folder) =>
    invoke('files_rename', { profileId, oldName, newName, folder: folder || null }),
  toTrash: (profileId, filename, folder) =>
    invoke('files_move_to_trash', { profileId, filename, folder: folder || null }),
  permanentDelete: (profileId, filename, folder) =>
    invoke('files_permanent_delete', { profileId, filename, folder: folder || null }),
  toFolder: (profileId, filename, targetFolder) =>
    invoke('files_move_to_folder', { profileId, filename, targetFolder }),
  betweenFolders: (profileId, filename, fromFolder, toFolder) =>
    invoke('files_move_between_folders', { profileId, filename, fromFolder, toFolder }),
  toRoot: (profileId, filename, fromFolder) =>
    invoke('files_move_to_root', { profileId, filename, fromFolder }),
};

/* ==========================================================================
   目录 / 相册
   ========================================================================== */

export const folders = {
  create: (profileId, name, parent) => invoke('folders_create', { profileId, name, parent: parent || null }),
  remove: (profileId, folderPath, moveUp) => invoke('folders_delete', { profileId, folderPath, moveUp }),
  rename: (profileId, folderPath, newName) => invoke('folders_rename', { profileId, folderPath, newName }),
};

export const albums = {
  list: (profileId) => invoke('albums_list', { profileId }),
  setCover: (profileId, folderName, imageName) =>
    invoke('albums_set_cover', { profileId, folderName, imageName }),
  setOrder: (profileId, folderName, order) =>
    invoke('albums_set_order', { profileId, folderName, order }),
};

/* ==========================================================================
   收藏 / 回收站
   ========================================================================== */

export const favorites = {
  list: (profileId) => invoke('favorites_list', { profileId }),
  toggle: (profileId, filename, folder) =>
    invoke('favorites_toggle', { profileId, filename, folder: folder || null }),
  isFav: (profileId, filename, folder) =>
    invoke('favorites_is_favorite', { profileId, filename, folder: folder || null }),
  count: (profileId) => invoke('favorites_count', { profileId }),
  export: (profileId) => invoke('favorites_export', { profileId }),
  import: (profileId, data, mode) => invoke('favorites_import', { profileId, data, mode }),
};

export const trash = {
  list: (profileId) => invoke('trash_list', { profileId }),
  restore: (profileId, trashName, originalName, originalFolder) =>
    invoke('trash_restore', { profileId, trashName, originalName, originalFolder: originalFolder || null }),
  count: (profileId) => invoke('trash_count', { profileId }),
  empty: (profileId) => invoke('trash_empty', { profileId }),
};

/* ==========================================================================
   设置 / 主题 / 壁纸
   ========================================================================== */

export const settings = {
  get: (profileId) => invoke('settings_get', { profileId }),
  save: (profileId, updates) => invoke('settings_save', { profileId, updates }),
};

/* ==========================================================================
   缓存
   ========================================================================== */

export const cache = {
  info: (profileId) => invoke('cache_get_info', { profileId }),
  clear: (profileId) => invoke('cache_clear', { profileId }),
  generate: (profileId, sizes) => invoke('cache_generate', { profileId, sizes }),
  cancel: () => invoke('cache_generate_cancel'),
  status: () => invoke('cache_generate_status'),
  reconcile: (profileId) => invoke('cache_reconcile', { profileId }),
};

/* ==========================================================================
   窗口 / 系统 / 对话框
   ========================================================================== */

export const system = {
  openInExplorer: (path) => invoke('open_in_explorer', { path }),
  pickFolder: (title) => invoke('dialog_open_folder', { title }),
  readText: (path) => invoke('read_text_file', { path }),
  writeText: (path, content) => invoke('write_text_file', { path, content }),
  setEffect: (enabled, effectType) => invoke('window_set_effect', { enabled, effectType }),
  setTitlebar: (mode) => invoke('window_set_titlebar', { mode }),
};

/** 原生保存 / 打开对话框（Tauri dialog 插件，withGlobalTauri 已开） */
export const dialog = {
  async saveJson(defaultName = 'favorites.json') {
    if (!tauri?.dialog?.save) return null;
    return tauri.dialog.save({
      defaultPath: defaultName,
      filters: [{ name: '收藏文件', extensions: ['json'] }],
    });
  },
  async openJson() {
    if (!tauri?.dialog?.open) return null;
    return tauri.dialog.open({
      multiple: false,
      filters: [{ name: '收藏文件', extensions: ['json'] }],
    });
  },
};

/* ==========================================================================
   事件
   ========================================================================== */

/**
 * 订阅后端事件；浏览器里返回空解绑函数。
 * @param {string} name
 * @param {(payload:any)=>void} cb
 * @returns {Promise<() => void>}
 */
export async function listen(name, cb) {
  if (!tauri?.event?.listen) return () => {};
  try {
    const un = await tauri.event.listen(name, (e) => cb(e.payload));
    return typeof un === 'function' ? un : () => {};
  } catch {
    return () => {};
  }
}
