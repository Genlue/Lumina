// ============================================================
// Photo Album — API layer (Tauri invoke wrappers)
// ============================================================

const API = {
  /** Invoke a Tauri command via window.__TAURI__ */
  async _invoke(cmd, args = {}) {
    return window.__TAURI__.core.invoke(cmd, args);
  },

  // === Profiles ===
  async createProfile(folderPath, name) {
    return this._invoke('profiles_create', { folderPath, name });
  },
  async listProfiles() {
    return this._invoke('profiles_list');
  },
  async getProfile(id) {
    return this._invoke('profiles_get_by_id', { id });
  },
  async removeProfile(id) {
    return this._invoke('profiles_remove', { id });
  },
  async touchProfile(id) {
    return this._invoke('profiles_touch', { id });
  },
  async relocateProfile(id) {
    return this._invoke('profiles_relocate', { id });
  },
  async markGoneProfile(id) {
    return this._invoke('profiles_mark_gone', { id });
  },
  async checkProfilePath(folderPath) {
    return this._invoke('profiles_check_path', { folderPath });
  },

  // === Scanner ===
  async scanAll(profileId) {
    const result = await this._invoke('scanner_scan_all', { profileId });
    console.log('[scanAll] result:', JSON.stringify(result, null, 2));
    console.log('[scanAll] albumFolders count:', result.albumFolders?.length);
    console.log('[scanAll] albumFolders:', JSON.stringify(result.albumFolders));
    console.log('[scanAll] albumImages keys:', Object.keys(result.albumImages || {}));
    if (profileId === S.profileId) {
      // 将 .album/backgrounds 从 albumImages 分离到独立的 bgImages，
      // 避免背景图出现在图片网格中（buildAllImgs 遍历所有 albumImages 条目）
      const albumImages = { ...result.albumImages };
      S.bgImages = albumImages['.album/backgrounds'] ?? [];
      delete albumImages['.album/backgrounds'];
      S.albumImages = albumImages;
      S.albumFolders = result.albumFolders;
      S.rootImages = result.rootImages;
    }
    return result;
  },

  // === Files ===
  /** In-memory thumbnail URL cache — avoids backend IPC + DB + disk on page re-switch */
  _thumbCache: new Map(),
  /** Get a thumbnail (or full image). size: null/0 = full original, number = max px dimension. */
  async getThumbnail(profileId, filename, folder, size = null) {
    const cacheKey = `${profileId}|${folder||''}|${filename}|${size||'full'}`;
    const cached = this._thumbCache.get(cacheKey);
    if (cached) return cached;
    const result = await this._invoke('files_get_thumbnail', { profileId, filename, folder, size });
    if (result && result.dataUrl) {
      try {
        result.dataUrl = window.__TAURI__.core.convertFileSrc(result.dataUrl);
      } catch (e) {
        // Keep original path if convertFileSrc fails
      }
      this._thumbCache.set(cacheKey, result);
    }
    return result;
  },
  /** Batch-load thumbnails — single IPC call for multiple images */
  async getThumbnailsBatch(profileId, items, size = 400) {
    // Pre-fill results in input order (null = uncached)
    const results = new Array(items.length).fill(null);
    const uncached = [];
    const uncachedIdx = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = `${profileId}|${item.folder||''}|${item.filename}|${size||'full'}`;
      const cached = this._thumbCache.get(key);
      if (cached) { results[i] = cached; }
      else { uncached.push(item); uncachedIdx.push(i); }
    }
    if (uncached.length > 0) {
      const batch = await this._invoke('files_get_thumbnails_batch', { profileId, requests: uncached, size });
      for (let j = 0; j < batch.length; j++) {
        const r = batch[j];
        const key = `${profileId}|${r.folder||''}|${r.filename}|${size||'full'}`;
        if (r.dataUrl) {
          try { r.dataUrl = window.__TAURI__.core.convertFileSrc(r.dataUrl); } catch(e) {}
          this._thumbCache.set(key, r);
        }
        // Place at correct position matching input order
        results[uncachedIdx[j]] = r;
      }
    }
    return results;
  },
  /** Clear thumbnail cache (useful when profile/settings change) */
  clearThumbCache() { this._thumbCache.clear(); },
  /** Load full-resolution image (lightbox, background). */
  async getFullImage(profileId, filename, folder) {
    return this.getThumbnail(profileId, filename, folder, null);
  },
  async renameFile(profileId, oldName, newName, folder) {
    return this._invoke('files_rename', { profileId, oldName, newName, folder });
  },
  async moveToTrash(profileId, filename, folder) {
    return this._invoke('files_move_to_trash', { profileId, filename, folder });
  },
  async permanentDelete(profileId, filename, folder = null) {
    return this._invoke('files_permanent_delete', { profileId, filename, folder });
  },
  async moveToFolder(profileId, filename, targetFolder) {
    return this._invoke('files_move_to_folder', { profileId, filename, targetFolder });
  },
  async moveBetween(profileId, filename, fromFolder, toFolder) {
    return this._invoke('files_move_between_folders', { profileId, filename, fromFolder, toFolder });
  },
  async moveToRoot(profileId, filename, fromFolder) {
    return this._invoke('files_move_to_root', { profileId, filename, fromFolder });
  },

  // === Folders ===
  async listSubfolders(profileId, parentPath = '') {
    return this._invoke('scanner_list_subfolders', { profileId, parentPath });
  },
  async createFolder(profileId, name, parent = '') {
    return this._invoke('folders_create', { profileId, name, parent: parent || null });
  },
  async deleteFolder(profileId, path, moveUp) {
    return this._invoke('folders_delete', { profileId, folderPath: path, moveUp });
  },
  async renameFolder(profileId, path, newName) {
    return this._invoke('folders_rename', { profileId, folderPath: path, newName });
  },

  // === Albums ===
  async setCover(profileId, folderName, imageName) {
    return this._invoke('albums_set_cover', { profileId, folderName, imageName });
  },
  async setOrder(profileId, folderName, order) {
    return this._invoke('albums_set_order', { profileId, folderName, order });
  },
  async listAlbums(profileId) {
    return this._invoke('albums_list', { profileId });
  },

  // === Favorites ===
  async toggleFav(profileId, filename, folder) {
    return this._invoke('favorites_toggle', { profileId, filename, folder });
  },
  async isFav(profileId, filename, folder) {
    return this._invoke('favorites_is_favorite', { profileId, filename, folder });
  },
  async listFav(profileId) {
    const list = await this._invoke('favorites_list', { profileId });
    S.favoritesList = list;
    S.favoritesSet = new Set(list.map(f => {
      return f.folder_name ? f.folder_name + '/' + f.filename : f.filename;
    }));
    return list;
  },
  async favCount(profileId) {
    return this._invoke('favorites_count', { profileId });
  },

  // === Trash ===
  async listTrash(profileId) {
    return this._invoke('trash_list', { profileId });
  },
  async restore(profileId, trashName, originalName, originalFolder) {
    return this._invoke('trash_restore', { profileId, trashName, originalName, originalFolder });
  },
  async trashCount(profileId) {
    return this._invoke('trash_count', { profileId });
  },
  async emptyTrash(profileId) {
    return this._invoke('trash_empty', { profileId });
  },

  // === Settings ===
  async getSettings(profileId) {
    return this._invoke('settings_get', { profileId });
  },
  async saveSettings(profileId, updates) {
    return this._invoke('settings_save', { profileId, updates });
  },

  // === Theme ===
  async extractColors(profileId, filename) {
    return this._invoke('theme_extract_colors', { profileId, filename });
  },

  // === Dialog ===
  async openFolder(title) {
    return this._invoke('dialog_open_folder', { title });
  },
  async openInExplorer(path) {
    return this._invoke('open_in_explorer', { path });
  },

  // === Cache ===
  async getCacheInfo(profileId) {
    return this._invoke('cache_get_info', { profileId });
  },
  async clearCache(profileId) {
    return this._invoke('cache_clear', { profileId });
  },

  // === Events — not exposing file watcher for now, same scan-on-demand approach ===
  onFileChange(callback) {
    // Tauri can emit events; for now, watcher is not enabled (same behavior as without chokidar)
    return () => {};
  },
  onWatchError(callback) {
    return () => {};
  },
};
