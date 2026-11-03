// ============================================================
// Lumina · 状态
// 一个朴素的单例对象：页面直接读，改完自己重绘。
// 没有订阅机制 —— 相册/收藏/回收站这些数据量大的地方，
// 隐式重渲染比显式调用更难控，也更容易掉帧。
// ============================================================

import { keyOf } from './util.js';
import { DEFAULT_ACCENT } from './palette.js';

/**
 * Settings 的兜底值。
 * 只列前端真正会读的字段 —— 其余字段（壁纸、面板浓度、圆角、字体、顶栏模式…）
 * 已经在精简时移除，后端仍保留在 DB 里，但界面不再消费。
 */
export function defaultSettings() {
  return {
    view_mode: 'grid',
    sort_by: 'name-asc',
    theme_mode: 'system',
    accent_color: DEFAULT_ACCENT,
    reverse_search_enabled: 1,
    thumbnail_size: 400,
    list_columns: 3,
    draw_count: 10,
    random_interval: 3,
    thumb_gen_concurrency: 10,
  };
}

export const S = {
  /* ---- 图库 ---- */
  profiles: [],
  profileId: '',
  profileFolder: '',
  profileName: '',
  settings: defaultSettings(),

  /* ---- 图片索引 ---- */
  rootImages: [],
  albumFolders: [],
  albumImages: {},
  albums: [],

  /* ---- 收藏 / 回收站 ---- */
  favoriteList: [],
  favoriteSet: new Set(),
  trash: [],
  trashCount: 0,
  /** 本次会话里回收站曾经有过内容 —— 用来区分「没删过」和「已清空」 */
  trashEverHad: false,

  /* ---- 交互 ---- */
  query: { q: '', ex: '' },
  selection: new Set(),
  /** 长按进入的选择模式：开启后单击=选中，关闭后单击=打开 */
  selectionMode: false,
  route: { page: 'home', view: 'all', tab: 'waterfall' },

  /* ---- 运行时 ---- */
  scanning: false,
  scanStatus: '',
  cacheInfo: { size: 0, file_count: 0 },
  gen: { running: false, done: 0, total: 0 },
  systemAccent: '',
};

/* ==========================================================================
   归一化：后端记录 → 应用内部结构
   统一用 { name, folder, key, size, date, width, height }，
   页面里不再区分 FileInfo / FavoritesRecord / TrashRecord。
   ========================================================================== */

export function normalizeImage(fi, folder) {
  return {
    name: fi.name,
    folder: folder || null,
    key: keyOf(folder, fi.name),
    size: fi.size || 0,
    date: fi.lastModified || 0,
    width: fi.width || 0,
    height: fi.height || 0,
  };
}

export function normalizeFavorite(f) {
  const name = f.filename || '';
  const folder = f.folder_name || null;
  return {
    name,
    folder,
    key: keyOf(folder, name),
    size: f.file_size || 0,
    date: f.file_date || 0,
    addedAt: f.added_at || '',
    width: f.width || 0,
    height: f.height || 0,
    fav: true,
  };
}

export function normalizeTrash(t) {
  return {
    id: t.id,
    name: t.trash_name,
    displayName: t.original_name,
    folder: '.album/trash',
    originalFolder: t.original_folder || null,
    deletedAt: t.deleted_at || '',
    key: keyOf('.album/trash', t.trash_name),
    size: 0,
    date: new Date(t.deleted_at || 0).getTime() || 0,
    record: t,
  };
}

/* ==========================================================================
   扫描结果 → 索引
   ========================================================================== */

let allCache = null;

export function setScanResult(result) {
  S.rootImages = (result?.rootImages || []).map((fi) => normalizeImage(fi, null));

  const albumImages = { ...(result?.albumImages || {}) };
  // .album/backgrounds 不是一个相册，不能出现在图片网格里
  delete albumImages['.album/backgrounds'];

  S.albumFolders = [...(result?.albumFolders || [])].sort((a, b) => a.localeCompare(b, 'zh'));

  S.albumImages = {};
  for (const [folder, list] of Object.entries(albumImages)) {
    S.albumImages[folder] = (list || []).map((fi) => normalizeImage(fi, folder));
  }

  allCache = null;
}

export function setFavorites(list) {
  S.favoriteList = (list || []).map(normalizeFavorite);
  S.favoriteSet = new Set(S.favoriteList.map((f) => f.key));
}

/** 所有图片（根 + 各相册），按需构建并缓存 */
export function allImages() {
  if (allCache) return allCache;
  const out = [];
  for (const img of S.rootImages) out.push(img);
  for (const list of Object.values(S.albumImages)) {
    for (const img of list) out.push(img);
  }
  allCache = out;
  return out;
}

/** 让下一次 allImages() 重新构建 */
export function invalidateAll() {
  allCache = null;
}

/* ==========================================================================
   目录树
   ========================================================================== */

/** parentPath 的直接子相册（parentPath 为空 = 根层级） */
export function childAlbums(parentPath) {
  const parent = parentPath || '';
  if (!parent) return S.albumFolders.filter((f) => !f.includes('/'));
  const prefix = `${parent}/`;
  return S.albumFolders.filter(
    (f) => f.startsWith(prefix) && f.indexOf('/', prefix.length) === -1
  );
}

export function hasChildren(folderPath) {
  return childAlbums(folderPath).length > 0;
}

/** 某个相册下的直接图片（不含子相册） */
export function imagesInFolder(folder) {
  return S.albumImages[folder] || [];
}

/** 视图 → 图片集合。'all' 是全部，其余按相册过滤 */
export function imagesInView(view) {
  if (!view || view === 'all' || view === 'albums') return allImages();
  return imagesInFolder(view);
}

export function isFav(key) {
  return S.favoriteSet.has(key);
}

export function totalCount() {
  return S.rootImages.length + Object.values(S.albumImages).reduce((n, l) => n + l.length, 0);
}

export function totalSize() {
  let n = 0;
  for (const img of S.rootImages) n += img.size;
  for (const list of Object.values(S.albumImages)) for (const img of list) n += img.size;
  return n;
}

export function albumCover(folder) {
  const rec = S.albums.find((a) => a.folder_name === folder);
  const list = imagesInFolder(folder);
  if (rec?.cover_image) {
    const hit = list.find((img) => img.name === rec.cover_image);
    if (hit) return hit;
  }
  return list[0] || null;
}

/** 相册记录（封面/排序用） */
export function albumRecord(folder) {
  return S.albums.find((a) => a.folder_name === folder) || null;
}
