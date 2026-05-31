import { contextBridge, ipcRenderer } from 'electron';

/**
 * 暴露给渲染进程的安全 API
 * 所有文件/文件夹操作必须通过此桥接，渲染进程无法直接访问 Node.js
 */
const electronAPI = {
  // === Profiles ===
  profiles: {
    create: (folderPath: string, name?: string) =>
      ipcRenderer.invoke('profiles:create', folderPath, name),
    list: () => ipcRenderer.invoke('profiles:list'),
    getById: (id: string) => ipcRenderer.invoke('profiles:getById', id),
    remove: (id: string) => ipcRenderer.invoke('profiles:remove', id),
    touch: (id: string) => ipcRenderer.invoke('profiles:touch', id),
    markGone: (id: string) => ipcRenderer.invoke('profiles:markGone', id),
    checkPath: (folderPath: string) => ipcRenderer.invoke('profiles:checkPath', folderPath),
    relocate: (id: string) => ipcRenderer.invoke('profiles:relocate', id),
  },

  // === Scanner ===
  scanner: {
    scanAll: (profileId: string) =>
      ipcRenderer.invoke('scanner:scanAll', profileId),
    scanFolder: (profileId: string, folderPath: string) =>
      ipcRenderer.invoke('scanner:scanFolder', profileId, folderPath),
    listFolders: (profileId: string) =>
      ipcRenderer.invoke('scanner:listFolders', profileId),
    watchFolder: (profileId: string) =>
      ipcRenderer.invoke('scanner:watch', profileId),
    unwatchFolder: (profileId: string) =>
      ipcRenderer.invoke('scanner:unwatch', profileId),
  },

  // === Files ===
  files: {
    read: (profileId: string, filename: string, folder?: string) =>
      ipcRenderer.invoke('files:read', profileId, filename, folder),
    write: (profileId: string, filename: string, data: ArrayBuffer) =>
      ipcRenderer.invoke('files:write', profileId, filename, data),
    rename: (profileId: string, old: string, new_: string, folder?: string) =>
      ipcRenderer.invoke('files:rename', profileId, old, new_, folder),
    moveToTrash: (profileId: string, filename: string, folder?: string) =>
      ipcRenderer.invoke('files:moveToTrash', profileId, filename, folder),
    permanentDelete: (profileId: string, filename: string) =>
      ipcRenderer.invoke('files:permanentDelete', profileId, filename),
    getThumbnail: (profileId: string, filename: string, folder?: string) =>
      ipcRenderer.invoke('files:getThumbnail', profileId, filename, folder),
    moveToFolder: (profileId: string, filename: string, targetFolder: string) =>
      ipcRenderer.invoke('files:moveToFolder', profileId, filename, targetFolder),
    moveBetweenFolders: (profileId: string, filename: string, fromFolder: string, toFolder: string) =>
      ipcRenderer.invoke('files:moveBetweenFolders', profileId, filename, fromFolder, toFolder),
    moveToRoot: (profileId: string, filename: string, fromFolder: string) =>
      ipcRenderer.invoke('files:moveToRoot', profileId, filename, fromFolder),
  },

  // === Folders ===
  folders: {
    create: (profileId: string, name: string) =>
      ipcRenderer.invoke('folders:create', profileId, name),
    delete: (profileId: string, folderPath: string, moveUp: boolean) =>
      ipcRenderer.invoke('folders:delete', profileId, folderPath, moveUp),
    rename: (profileId: string, folderPath: string, newName: string) =>
      ipcRenderer.invoke('folders:rename', profileId, folderPath, newName),
  },

  // === Albums ===
  albums: {
    setCover: (profileId: string, folderName: string, imageName: string) =>
      ipcRenderer.invoke('albums:setCover', profileId, folderName, imageName),
    setOrder: (profileId: string, folderName: string, order: string[]) =>
      ipcRenderer.invoke('albums:setOrder', profileId, folderName, order),
  },

  // === Favorites ===
  favorites: {
    toggle: (profileId: string, filename: string, folder?: string) =>
      ipcRenderer.invoke('favorites:toggle', profileId, filename, folder),
    list: (profileId: string) =>
      ipcRenderer.invoke('favorites:list', profileId),
    isFavorite: (profileId: string, filename: string, folder?: string) =>
      ipcRenderer.invoke('favorites:isFavorite', profileId, filename, folder),
    count: (profileId: string) =>
      ipcRenderer.invoke('favorites:count', profileId),
  },

  // === Trash ===
  trash: {
    list: (profileId: string) =>
      ipcRenderer.invoke('trash:list', profileId),
    restore: (profileId: string, trashName: string, originalName: string, originalFolder?: string) =>
      ipcRenderer.invoke('trash:restore', profileId, trashName, originalName, originalFolder),
    count: (profileId: string) =>
      ipcRenderer.invoke('trash:count', profileId),
    empty: (profileId: string) =>
      ipcRenderer.invoke('trash:empty', profileId),
  },

  // === Settings ===
  settings: {
    get: (profileId: string) =>
      ipcRenderer.invoke('settings:get', profileId),
    save: (profileId: string, settings: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:save', profileId, settings),
  },

  // === Theme ===
  theme: {
    extractColors: (profileId: string, filename: string) =>
      ipcRenderer.invoke('theme:extractColors', profileId, filename),
  },

  // === Background ===
  bg: {
    import: (profileId: string) => ipcRenderer.invoke('bg:import', profileId),
    openFolder: (profileId: string) => ipcRenderer.invoke('bg:openFolder', profileId),
    delete: (profileId: string, filename: string) => ipcRenderer.invoke('bg:delete', profileId, filename),
  },

  // === Dialog ===
  dialog: {
    openFolder: (title?: string) =>
      ipcRenderer.invoke('dialog:openFolder', title),
  },

  // === Window ===
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },

  // === Events from main → renderer ===
  onFileChange: (callback: (payload: { profileId: string; event: string; path: string }) => void) => {
    const sub = (_: unknown, payload: { profileId: string; event: string; path: string }) => callback(payload);
    ipcRenderer.on('watcher:change', sub);
    return () => ipcRenderer.removeListener('watcher:change', sub);
  },

  onWatchError: (callback: (payload: { profileId: string; error: string }) => void) => {
    const sub = (_: unknown, payload: { profileId: string; error: string }) => callback(payload);
    ipcRenderer.on('watcher:error', sub);
    return () => ipcRenderer.removeListener('watcher:error', sub);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
