// ============================================================
// Photo Album — API layer (IPC wrappers)
// Replaces: IndexedDB + File System Access API
// ============================================================

const API = {
  /** @type {typeof window.electronAPI} */
  get _e() { return window.electronAPI; },

  // === Profiles ===
  async createProfile(folderPath, name) {
    return this._e.profiles.create(folderPath, name);
  },
  async listProfiles() {
    return this._e.profiles.list();
  },
  async getProfile(id) {
    return this._e.profiles.getById(id);
  },
  async removeProfile(id) {
    return this._e.profiles.remove(id);
  },
  async touchProfile(id) {
    return this._e.profiles.touch(id);
  },
  async relocateProfile(id) {
    return this._e.profiles.relocate(id);
  },
  async markGoneProfile(id) {
    return this._e.profiles.markGone(id);
  },
  async checkProfilePath(folderPath) {
    return this._e.profiles.checkPath(folderPath);
  },

  // === Scanner ===
  async scanAll(profileId) {
    const result = await this._e.scanner.scanAll(profileId);
    // Update state
    if (profileId === S.profileId) {
      S.rootImages = result.rootImages;
      S.albumFolders = result.albumFolders;
      S.albumImages = result.albumImages;
    }
    return result;
  },

  // === Files ===
  async getThumbnail(profileId, filename, folder) {
    return this._e.files.getThumbnail(profileId, filename, folder);
  },
  async readFile(profileId, filename, folder) {
    const buf = await this._e.files.read(profileId, filename, folder);
    return new Blob([buf]);
  },
  async renameFile(profileId, oldName, newName, folder) {
    return this._e.files.rename(profileId, oldName, newName, folder);
  },
  async moveToTrash(profileId, filename, folder) {
    return this._e.files.moveToTrash(profileId, filename, folder);
  },
  async permanentDelete(profileId, filename) {
    return this._e.files.permanentDelete(profileId, filename);
  },
  async moveToFolder(profileId, filename, targetFolder) {
    return this._e.files.moveToFolder(profileId, filename, targetFolder);
  },
  async moveBetween(profileId, filename, fromFolder, toFolder) {
    return this._e.files.moveBetweenFolders(profileId, filename, fromFolder, toFolder);
  },
  async moveToRoot(profileId, filename, fromFolder) {
    return this._e.files.moveToRoot(profileId, filename, fromFolder);
  },

  // === Folders ===
  async createFolder(profileId, name) {
    return this._e.folders.create(profileId, name);
  },
  async deleteFolder(profileId, path, moveUp) {
    return this._e.folders.delete(profileId, path, moveUp);
  },
  async renameFolder(profileId, path, newName) {
    return this._e.folders.rename(profileId, path, newName);
  },

  // === Albums ===
  async setCover(profileId, folderName, imageName) {
    return this._e.albums.setCover(profileId, folderName, imageName);
  },
  async setOrder(profileId, folderName, order) {
    return this._e.albums.setOrder(profileId, folderName, order);
  },

  // === Favorites ===
  async toggleFav(profileId, filename, folder) {
    return this._e.favorites.toggle(profileId, filename, folder);
  },
  async isFav(profileId, filename, folder) {
    return this._e.favorites.isFavorite(profileId, filename, folder);
  },
  async listFav(profileId) {
    const list = await this._e.favorites.list(profileId);
    S.favoritesList = list;
    // Build key set using filename + folder for matching
    S.favoritesSet = new Set(list.map(f => {
      return f.folder_name ? f.folder_name + '/' + f.filename : f.filename;
    }));
    return list;
  },
  async favCount(profileId) {
    return this._e.favorites.count(profileId);
  },

  // === Trash ===
  async listTrash(profileId) {
    return this._e.trash.list(profileId);
  },
  async restore(profileId, trashName, originalName, originalFolder) {
    return this._e.trash.restore(profileId, trashName, originalName, originalFolder);
  },
  async trashCount(profileId) {
    return this._e.trash.count(profileId);
  },
  async emptyTrash(profileId) {
    return this._e.trash.empty(profileId);
  },

  // === Settings ===
  async getSettings(profileId) {
    return this._e.settings.get(profileId);
  },
  async saveSettings(profileId, updates) {
    return this._e.settings.save(profileId, updates);
  },

  // === Theme ===
  async extractColors(profileId, filename) {
    return this._e.theme.extractColors(profileId, filename);
  },

  // === Dialog ===
  async openFolder(title) {
    return this._e.dialog.openFolder(title);
  },

  // === Events ===
  onFileChange(callback) {
    return this._e.onFileChange(callback);
  },
  onWatchError(callback) {
    return this._e.onWatchError(callback);
  },
};
