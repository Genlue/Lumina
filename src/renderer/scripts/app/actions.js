// ============================================================
// Lumina · 文件与图库操作
// 所有会改动磁盘 / 数据库的动作都集中在这里：页面只负责触发和展示。
// 每个动作完成后发一条总线事件，页面按需局部刷新。
// ============================================================

import { toast } from '../ui/kit.js';
import * as api from './api.js';
import { S, setFavorites, setScanResult, invalidateAll, totalCount } from './state.js';
import { confirm, choose, prompt } from './dialog.js';
import { emit } from './bus.js';
import * as shell from './shell.js';
import { fmtSize, toRelativeFolder, lastSegment, parseKey } from './util.js';

/* ==========================================================================
   索引
   ========================================================================== */

/** 重新读取相册记录（封面 / 排序） */
export async function loadAlbums() {
  try {
    S.albums = await api.albums.list(S.profileId);
  } catch {
    S.albums = [];
  }
  return S.albums;
}

/** 重新读取收藏 */
export async function loadFavorites() {
  try {
    setFavorites(await api.favorites.list(S.profileId));
  } catch {
    setFavorites([]);
  }
  emit('favorites');
  return S.favoriteList;
}

/** 重新读取回收站 */
export async function loadTrash() {
  try {
    S.trash = await api.trash.list(S.profileId);
    S.trashCount = S.trash.length;
    if (S.trashCount > 0) S.trashEverHad = true;
  } catch {
    S.trash = [];
    S.trashCount = 0;
  }
  emit('trash');
  return S.trash;
}

/**
 * 全量重扫：扫描磁盘 → 同步数据库 → 刷新索引与侧栏。
 * 这是所有「磁盘变了」的动作的统一收尾。
 */
export async function rescan({ quiet = false, refreshPage = true } = {}) {
  if (!S.profileId) return null;
  shell.setStatus('正在扫描图库…');
  try {
    const res = await api.scan.all(S.profileId);
    setScanResult(res);
    invalidateAll();
    await loadAlbums();
    await loadFavorites();
    await loadTrash();
    shell.refreshStatus();
    shell.syncNav();
    shell.setStatus('就绪');
    emit('images');
    if (refreshPage) emit('reload');
    if (!quiet) {
      toast(`已刷新：${totalCount().toLocaleString('zh-CN')} 张照片`, { icon: 'refresh-cw' });
    }
    return res;
  } catch (e) {
    shell.setStatus('扫描失败');
    toast(`扫描失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger', duration: 3200 });
    return null;
  }
}

/* ==========================================================================
   收藏
   ========================================================================== */

/** 切换收藏；返回切换后的状态 */
export async function toggleFavorite(img) {
  if (!img?.name) return false;
  try {
    const added = await api.favorites.toggle(S.profileId, img.name, img.folder);
    if (added) S.favoriteSet.add(img.key);
    else S.favoriteSet.delete(img.key);
    await loadFavorites();
    shell.refreshStatus();
    shell.syncNav();
    toast(added ? '已加入收藏' : '已取消收藏', { icon: added ? 'heart' : 'star-off' });
    return added;
  } catch (e) {
    toast(`操作失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
}

/** 批量收藏 / 取消收藏 */
export async function setFavoriteMany(images, want) {
  let ok = 0;
  for (const img of images) {
    const has = S.favoriteSet.has(img.key);
    if (has === want) continue;
    try {
      await api.favorites.toggle(S.profileId, img.name, img.folder);
      ok += 1;
    } catch {
      // 单张失败不打断整批
    }
  }
  await loadFavorites();
  shell.refreshStatus();
  shell.syncNav();
  toast(want ? `已收藏 ${ok} 张` : `已取消收藏 ${ok} 张`, { icon: 'star' });
  return ok;
}

/* ==========================================================================
   删除 / 还原
   ========================================================================== */

/** 移入回收站（单张或多张） */
export async function moveToTrash(images) {
  const list = Array.isArray(images) ? images : [images];
  if (!list.length) return 0;

  const ok = await confirm({
    title: list.length > 1 ? `删除 ${list.length} 张照片` : '删除照片',
    body: '照片会移入回收站，可以随时还原。',
    okLabel: '移到回收站',
    danger: true,
  });
  if (!ok) return 0;

  let count = 0;
  for (const img of list) {
    try {
      await api.files.toTrash(S.profileId, img.name, img.folder);
      api.evictThumb(img.name, img.folder);
      count += 1;
    } catch {
      // 跳过失败项
    }
  }

  S.selection.clear();
  await rescan({ quiet: true });
  toast(`已移入回收站：${count} 张`, { icon: 'trash' });
  return count;
}

/** 回收站：还原单条 */
export async function restoreTrash(rec) {
  try {
    await api.trash.restore(S.profileId, rec.name, rec.displayName, rec.originalFolder);
    await rescan({ quiet: true });
    toast('已还原到原位置', { icon: 'undo' });
    return true;
  } catch (e) {
    toast(`还原失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
}

/** 回收站：全部还原 */
export async function restoreAllTrash() {
  const list = [...S.trash];
  if (!list.length) return 0;
  let count = 0;
  for (const rec of list) {
    try {
      await api.trash.restore(S.profileId, rec.name, rec.displayName, rec.originalFolder);
      count += 1;
    } catch {
      // 单条失败继续
    }
  }
  await rescan({ quiet: true });
  toast(`已还原 ${count} 张`, { icon: 'undo' });
  return count;
}

/** 回收站：清空（二次确认） */
export async function emptyTrash() {
  if (!S.trashCount) return 0;
  const ok = await confirm({
    title: '清空回收站',
    body: `将永久删除 ${S.trashCount} 个文件，此操作不可撤销。`,
    okLabel: '永久删除',
    danger: true,
  });
  if (!ok) return 0;
  try {
    const n = await api.trash.empty(S.profileId);
    S.trash = [];
    S.trashCount = 0;
    S.trashEverHad = true;
    api.clearThumbCache();
    shell.refreshStatus();
    shell.syncNav();
    emit('trash');
    toast(`已清空回收站（${n} 个文件）`, { icon: 'trash', duration: 2400 });
    return n;
  } catch (e) {
    toast(`清空失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return 0;
  }
}

/* ==========================================================================
   重命名 / 移动
   ========================================================================== */

export async function renameImage(img) {
  const next = await prompt({
    title: '重命名',
    body: `当前名称：${img.name}`,
    value: img.name,
    okLabel: '重命名',
  });
  if (!next || next === img.name) return false;
  try {
    await api.files.rename(S.profileId, img.name, next, img.folder);
    api.evictThumb(img.name, img.folder);
    await rescan({ quiet: true });
    toast('已重命名', { icon: 'square-pen' });
    return true;
  } catch (e) {
    toast(`重命名失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
}

/** 选择目标相册（对话框）→ 返回相对路径；取消返回 null */
async function pickTargetFolder(title = '选择目标相册') {
  const picked = await api.system.pickFolder(title);
  if (!picked) return null;
  return toRelativeFolder(picked, S.profileFolder);
}

/**
 * 移动一批图片到指定相册。
 * @param {Array} images
 * @param {string} [target] 不给就弹目录选择框
 */
export async function moveImages(images, target) {
  const list = Array.isArray(images) ? images : [images];
  if (!list.length) return 0;

  const dest = target === undefined ? await pickTargetFolder() : target;
  if (dest === null) return 0;

  let count = 0;
  for (const img of list) {
    const from = img.folder;
    if ((from || '') === (dest || '')) continue;
    try {
      if (!from) await api.files.toFolder(S.profileId, img.name, dest);
      else if (!dest) await api.files.toRoot(S.profileId, img.name, from);
      else await api.files.betweenFolders(S.profileId, img.name, from, dest);
      api.evictThumb(img.name, from);
      count += 1;
    } catch {
      // 跳过失败项
    }
  }

  if (!count) {
    toast('没有需要移动的照片', { icon: 'info' });
    return 0;
  }
  S.selection.clear();
  await rescan({ quiet: true });
  toast(`已移动 ${count} 张到「${dest ? lastSegment(dest) : '根目录'}」`, { icon: 'move' });
  return count;
}

/** 拖拽移动：直接把一批图片丢到某个相册 */
export function dropIntoAlbum(keys, folder) {
  const imgs = [...keys].map((key) => {
    const { name, folder: from } = parseKey(key);
    return { name, folder: from, key };
  });
  return moveImages(imgs, folder || '');
}

export async function setAlbumCover(img) {
  if (!img?.folder) {
    toast('根目录的照片不能设为相册封面', { icon: 'info' });
    return;
  }
  try {
    await api.albums.setCover(S.profileId, img.folder, img.name);
    await loadAlbums();
    emit('albums');
    toast('已设为封面', { icon: 'image' });
  } catch (e) {
    toast(`设置封面失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
  }
}

export function openInExplorer(path) {
  if (!path) return;
  api.system.openInExplorer(path).catch(() => {
    toast('无法打开资源管理器', { icon: 'x-circle', tone: 'danger' });
  });
}

/** 打开某张图片所在的目录 */
export function revealImage(img) {
  const base = S.profileFolder.replace(/\\/g, '/');
  openInExplorer(img.folder ? `${base}/${img.folder}` : base);
}

/* ==========================================================================
   相册（文件夹）
   ========================================================================== */

export async function createAlbum(parent = '') {
  const name = await prompt({
    title: '新建相册',
    body: parent ? `将创建在「${parent}」下` : '将创建在图库根目录',
    placeholder: '相册名称',
    okLabel: '创建',
  });
  if (!name) return false;
  try {
    await api.folders.create(S.profileId, name, parent || null);
    await rescan({ quiet: true });
    toast(`相册已创建：${name}`, { icon: 'folder-plus' });
    return true;
  } catch (e) {
    toast(`创建失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
}

export async function renameAlbum(folder) {
  const name = await prompt({
    title: '重命名相册',
    value: lastSegment(folder),
    okLabel: '重命名',
  });
  if (!name || name === lastSegment(folder)) return false;
  try {
    await api.folders.rename(S.profileId, folder, name);
    await rescan({ quiet: true });
    toast('相册已重命名', { icon: 'square-pen' });
    return true;
  } catch (e) {
    toast(`重命名失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
}

export async function deleteAlbum(folder) {
  const idx = await choose({
    title: '删除相册',
    body: `「${lastSegment(folder)}」里的照片要一起处理吗？`,
    options: [
      { label: '照片移回根目录', variant: 'primary' },
      { label: '一并删除', variant: 'danger' },
      { label: '取消', variant: 'plain' },
    ],
  });
  if (idx < 0 || idx === 2) return false;
  try {
    await api.folders.remove(S.profileId, folder, idx === 0);
    api.evictThumbFolder(folder);
    await rescan({ quiet: true });
    toast('相册已删除', { icon: 'trash' });
    return true;
  } catch (e) {
    toast(`删除失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
}

/* ==========================================================================
   收藏导入 / 导出 / 复制到壁纸
   ========================================================================== */

export async function exportFavorites() {
  try {
    const path = await api.dialog.saveJson(`lumina-favorites-${Date.now()}.json`);
    if (!path) return;
    const json = await api.favorites.export(S.profileId);
    await api.system.writeText(path, json);
    toast('收藏已导出', { icon: 'download' });
  } catch (e) {
    toast(`导出失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
  }
}

export async function importFavorites() {
  try {
    const path = await api.dialog.openJson();
    if (!path) return;
    const idx = await choose({
      title: '导入收藏',
      body: '合并会保留现有收藏；覆盖会先清空再导入。',
      options: [
        { label: '合并', variant: 'primary' },
        { label: '覆盖', variant: 'danger' },
        { label: '取消', variant: 'plain' },
      ],
    });
    if (idx < 0 || idx === 2) return;

    const data = await api.system.readText(path);
    const count = await api.favorites.import(S.profileId, data, idx === 0 ? 'merge' : 'overwrite');
    await loadFavorites();
    shell.refreshStatus();
    shell.syncNav();
    toast(`已导入 ${count} 条收藏`, { icon: 'upload' });
  } catch (e) {
    toast(`导入失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
  }
}

/* ==========================================================================
   缓存
   ========================================================================== */

export async function refreshCacheInfo() {
  try {
    S.cacheInfo = await api.cache.info(S.profileId);
  } catch {
    S.cacheInfo = { size: 0, file_count: 0 };
  }
  emit('cache');
  return S.cacheInfo;
}

export async function clearCache() {
  const ok = await confirm({
    title: '清除缩略图缓存',
    body: '下次浏览时会重新生成。原图不受影响。',
    okLabel: '清除',
    danger: true,
  });
  if (!ok) return;
  try {
    if (S.gen.running) {
      await api.cache.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
    }
    const n = await api.cache.clear(S.profileId);
    api.clearThumbCache();
    await refreshCacheInfo();
    emit('reload');
    toast(`已清除 ${n} 个缓存文件`, { icon: 'trash' });
  } catch (e) {
    toast(`清除失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
  }
}

export async function reconcileCache() {
  const ok = await confirm({
    title: '检查缓存',
    body: '对比图库（含回收站）与缓存文件，清理源图已不存在的孤儿缩略图。',
    okLabel: '开始检查',
  });
  if (!ok) return;
  try {
    const res = await api.cache.reconcile(S.profileId);
    const removed = res.removedCount ?? res.removed_count ?? 0;
    const bytes = res.removedBytes ?? res.removed_bytes ?? 0;
    await refreshCacheInfo();
    toast(
      removed > 0 ? `已清理 ${removed} 个孤儿缓存（${fmtSize(bytes)}）` : '未发现多余缓存',
      { icon: removed > 0 ? 'check' : 'info' }
    );
  } catch (e) {
    toast(`检查失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
  }
}

/* ==========================================================================
   图库（profile）
   ========================================================================== */

export async function removeProfile(id) {
  const ok = await confirm({
    title: '移除图库',
    body: '只删除 Lumina 里的登记记录，图片文件与 .album 目录都不会被动到。',
    okLabel: '移除',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.profiles.remove(id);
    toast('已移除图库', { icon: 'trash' });
    emit('profiles');
    return true;
  } catch (e) {
    toast(`移除失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    return false;
  }
}
