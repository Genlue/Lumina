// ============================================================
// Lumina · 图库会话
// 「打开一个图库」的完整流程：设置 → 主题 → 扫描 → 收藏 / 回收站 / 相册。
// 也负责多图库的添加、切换、重定位、移除。
// ============================================================

import { toast } from '../ui/overlays/toast.js';
import * as api from './api.js';
import { S, defaultSettings, setScanResult, invalidateAll } from './state.js';
import * as actions from './actions.js';
import * as materials from './materials.js';
import * as shell from './shell.js';
import * as router from './router.js';
import { emit } from './bus.js';
import { confirm } from './dialog.js';

/** 把后端 Settings 补齐成一份类型正确的对象（只保留前端会读的字段） */
export function normalizeSettings(raw) {
  const s = { ...defaultSettings(), ...(raw || {}) };
  s.reverse_search_enabled = Number(s.reverse_search_enabled) ? 1 : 0;
  s.theme_mode = ['light', 'dark', 'system'].includes(s.theme_mode) ? s.theme_mode : 'system';
  s.view_mode = s.view_mode === 'list' ? 'list' : 'grid';
  for (const k of ['list_columns', 'draw_count', 'random_interval', 'thumbnail_size', 'thumb_gen_concurrency']) {
    s[k] = Number(s[k]);
  }
  return s;
}

/** 读取图库列表，并顺手标记「文件夹已经不在」的记录 */
export async function loadProfiles() {
  try {
    S.profiles = await api.profiles.list();
  } catch (e) {
    S.profiles = [];
    throw e;
  }

  for (const p of S.profiles) {
    if (p.unavailable) continue;
    const ok = await api.profiles.checkPath(p.folder_path).catch(() => true);
    if (!ok) {
      await api.profiles.markGone(p.id).catch(() => {});
      p.unavailable = 1;
    }
  }
  return S.profiles;
}

export const lastUsedProfile = () =>
  [...S.profiles]
    .filter((p) => !p.unavailable)
    .sort((a, b) => (b.last_access || 0) - (a.last_access || 0))[0] || null;

/** 清空会话（没有图库 / 移除最后一个图库时） */
export function clearSession() {
  S.profileId = '';
  S.profileFolder = '';
  S.profileName = '';
  S.settings = defaultSettings();
  setScanResult({ rootImages: [], albumFolders: [], albumImages: {} });
  invalidateAll();
  S.favoriteList = [];
  S.favoriteSet = new Set();
  S.trash = [];
  S.trashCount = 0;
  S.albums = [];
  S.selection.clear();
  api.clearThumbCache();
  emit('images');
  emit('favorites');
  emit('trash');
}

/**
 * 打开一个图库。
 * @param {string} id
 * @param {{goHome?: boolean}} opts
 */
export async function loadProfile(id, { goHome = true } = {}) {
  const profile =
    S.profiles.find((p) => p.id === id) || (await api.profiles.get(id).catch(() => null));

  if (!profile) {
    toast('图库不存在或已被移除', { icon: 'x-circle', tone: 'danger' });
    return false;
  }

  if (profile.unavailable) {
    const relocate = await confirm({
      title: '文件夹不可用',
      body: `「${profile.name}」的路径 ${profile.folder_path} 不存在或已被移动。要重新定位吗？`,
      okLabel: '重新定位',
    });
    if (relocate) await relocateProfile(profile.id);
    return false;
  }

  S.profileId = profile.id;
  S.profileFolder = profile.folder_path;
  S.profileName = profile.name || profile.folder_path.split(/[/\\]/).pop() || '未命名';
  S.selection.clear();
  S.query = { q: '', ex: '' };
  S.trashEverHad = false;

  api.clearThumbCache();
  await api.profiles.touch(profile.id).catch(() => {});

  try {
    S.settings = normalizeSettings(await api.settings.get(profile.id));
  } catch (e) {
    S.settings = defaultSettings();
    toast(`读取设置失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
  }

  await materials.applySettings(S.settings);
  shell.refreshProfile();

  shell.setStatus('正在扫描图库…');
  try {
    const res = await api.scan.all(profile.id);
    setScanResult(res);
    invalidateAll();
  } catch (e) {
    shell.setStatus('扫描失败');
    toast(`扫描失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger', duration: 3200 });
  }

  await actions.loadAlbums();
  await actions.loadFavorites();
  await actions.loadTrash();
  await actions.refreshCacheInfo();

  shell.refreshStatus();
  shell.syncNav();
  shell.setStatus('就绪');

  emit('images');
  if (goHome) router.go({ page: 'home' }, { replace: true });
  return true;
}

/** 选一个文件夹加入图库并打开 */
export async function addProfile() {
  let folder = null;
  try {
    folder = await api.system.pickFolder('选择图片文件夹');
  } catch (e) {
    toast(`无法打开选择框：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
  if (!folder) return false;

  const existing = S.profiles.find((p) => p.folder_path === folder);
  if (existing) {
    await loadProfile(existing.id);
    return true;
  }

  try {
    const created = await api.profiles.create(folder);
    await loadProfiles();
    await loadProfile(created.id);
    toast(`已添加图库：${created.name}`, { icon: 'folder-plus' });
    return true;
  } catch (e) {
    toast(`添加失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
}

/** 重新定位（后端会弹目录选择框） */
export async function relocateProfile(id) {
  try {
    const res = await api.profiles.relocate(id);
    if (!res) return false;
    await loadProfiles();
    await loadProfile(res.id);
    toast('图库已重新定位', { icon: 'check' });
    return true;
  } catch (e) {
    toast(`重新定位失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
}

/** 移除图库记录（不动磁盘文件） */
export async function removeProfile(id) {
  const target = S.profiles.find((p) => p.id === id);
  const ok = await confirm({
    title: '移除图库',
    body: `只删除 Lumina 里的登记记录。「${target?.name || ''}」里的图片与 .album 目录都不会被动到。`,
    okLabel: '移除',
    danger: true,
  });
  if (!ok) return false;

  try {
    await api.profiles.remove(id);
  } catch (e) {
    toast(`移除失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }

  await loadProfiles();

  if (id === S.profileId) {
    const next = lastUsedProfile();
    if (next) {
      await loadProfile(next.id);
    } else {
      clearSession();
      shell.refreshStatus();
      shell.syncNav();
      router.go({ page: 'welcome' }, { replace: true });
    }
  } else {
    shell.syncNav();
  }

  toast('已移除图库记录', { icon: 'trash' });
  return true;
}
