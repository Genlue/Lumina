import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

import {
  createProfile, listProfiles, getProfileById, touchProfile,
  markProfileGone, removeProfile, updateFolderPath,
} from '../db/profiles-repo';
import {
  listAlbums, setAlbumCover, setAlbumOrder, renameAlbum, deleteAlbum, getAlbumByFolder,
} from '../db/albums-repo';
import { listImages, getImageById, getImageByName, updateImageMeta } from '../db/images-repo';
import { toggleFavorite, listFavorites, isFavorite, countFavorites } from '../db/favorites-repo';
import {
  listTrash, addTrashEntry, removeTrashEntry, countTrash, emptyTrash, getTrashEntry,
} from '../db/trash-repo';
import { getSettings, saveSettings } from '../db/settings-repo';
import { scanProfileFolder, listAllSubfolders } from '../services/scanner';
import { getThumbnailPath, saveThumbnail, getImageDimensionsFromBuffer } from '../services/thumbnails';
import { extractThemeColors } from '../services/theme';
import { v4 as uuid } from 'uuid';

function getProfileFolder(id: string): string {
  const p = getProfileById(id);
  if (!p) throw new Error(`Profile ${id} not found`);
  return p.folder_path;
}

export function registerIpcHandlers(): void {
  // ============================================================
  // Profiles
  // ============================================================
  ipcMain.handle('profiles:create', async (_e, folderPath: string, customName?: string) => {
    const profile = createProfile(folderPath, customName);
    // Initial scan
    scanProfileFolder(profile.id, folderPath);
    return profile;
  });

  ipcMain.handle('profiles:list', async () => listProfiles());

  ipcMain.handle('profiles:checkPath', async (_e, folderPath: string) => {
    return fs.existsSync(folderPath);
  });

  ipcMain.handle('profiles:getById', async (_e, id: string) => getProfileById(id));

  ipcMain.handle('profiles:remove', async (_e, id: string) => {
    removeProfile(id);
  });

  ipcMain.handle('profiles:touch', async (_e, id: string) => {
    touchProfile(id);
  });

  ipcMain.handle('profiles:markGone', async (_e, id: string) => {
    markProfileGone(id);
  });

  ipcMain.handle('profiles:relocate', async (_e, id: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      title: '重新定位文件夹',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const newPath = result.filePaths[0];
    updateFolderPath(id, newPath);
    scanProfileFolder(id, newPath);
    return getProfileById(id);
  });

  // ============================================================
  // Scanner
  // ============================================================
  ipcMain.handle('scanner:scanAll', async (_e, profileId: string) => {
    const folder = getProfileFolder(profileId);
    return scanProfileFolder(profileId, folder);
  });

  ipcMain.handle('scanner:scanFolder', async (_e, profileId: string, folderPath: string) => {
    const root = getProfileFolder(profileId);
    const fullPath = path.join(root, folderPath);
    return scanProfileFolder(profileId, fullPath);
  });

  ipcMain.handle('scanner:listFolders', async (_e, profileId: string) => {
    const folder = getProfileFolder(profileId);
    return listAllSubfolders(folder);
  });

  // ============================================================
  // Files
  // ============================================================
  ipcMain.handle('files:read', async (_e, profileId: string, filename: string, subfolder?: string) => {
    const root = getProfileFolder(profileId);
    const filePath = subfolder ? path.join(root, subfolder, filename) : path.join(root, filename);
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filename}`);
    return fs.readFileSync(filePath);
  });

  ipcMain.handle('files:getThumbnail', async (_e, profileId: string, filename: string, subfolder?: string) => {
    const root = getProfileFolder(profileId);
    const filePath = subfolder ? path.join(root, subfolder, filename) : path.join(root, filename);
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filename}`);

    // Read file and convert to base64 data URL
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
    };
    const mime = mimeTypes[ext] || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

    // Get dimensions from header
    const dims = getImageDimensionsFromBuffer(buf);

    // Update DB with dimensions
    const img = getImageByName(profileId, filename, null);
    if (img && dims) {
      updateImageMeta(img.id, { width: dims.width, height: dims.height });
    }

    return { dataUrl, width: dims?.width ?? 0, height: dims?.height ?? 0 };
  });

  ipcMain.handle('files:rename', async (_e, profileId: string, oldName: string, newName: string, subfolder?: string) => {
    const root = getProfileFolder(profileId);
    const oldPath = subfolder ? path.join(root, subfolder, oldName) : path.join(root, oldName);
    const newPath = subfolder ? path.join(root, subfolder, newName) : path.join(root, newName);

    if (!fs.existsSync(oldPath)) throw new Error(`File not found: ${oldName}`);
    if (fs.existsSync(newPath)) throw new Error(`Target already exists: ${newName}`);

    fs.renameSync(oldPath, newPath);
    return newName;
  });

  ipcMain.handle('files:moveToTrash', async (_e, profileId: string, filename: string, subfolder?: string) => {
    const root = getProfileFolder(profileId);
    const trashDir = path.join(root, '.album-trash');
    if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir);

    const oldPath = subfolder ? path.join(root, subfolder, filename) : path.join(root, filename);
    if (!fs.existsSync(oldPath)) throw new Error(`File not found: ${filename}`);

    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    const ts = Date.now();
    const trashName = `${base}_${ts}${ext}`;
    const newPath = path.join(trashDir, trashName);

    fs.renameSync(oldPath, newPath);

    // Record in DB
    addTrashEntry(profileId, filename, trashName, subfolder ?? null);

    return trashName;
  });

  ipcMain.handle('files:permanentDelete', async (_e, profileId: string, filename: string) => {
    const root = getProfileFolder(profileId);
    const filePath = path.join(root, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    removeTrashEntry(profileId, filename);
  });

  ipcMain.handle('files:moveToFolder', async (_e, profileId: string, filename: string, targetFolder: string) => {
    const root = getProfileFolder(profileId);
    const oldPath = path.join(root, filename);
    const targetDir = path.join(root, targetFolder);
    const newPath = path.join(targetDir, filename);

    if (!fs.existsSync(oldPath)) throw new Error(`File not found: ${filename}`);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    fs.renameSync(oldPath, newPath);
    return targetFolder;
  });

  ipcMain.handle('files:moveBetweenFolders', async (_e, profileId: string, filename: string, fromFolder: string, toFolder: string) => {
    const root = getProfileFolder(profileId);
    const oldPath = path.join(root, fromFolder, filename);
    const newPath = path.join(root, toFolder, filename);

    if (!fs.existsSync(oldPath)) throw new Error(`File not found: ${filename}`);
    const targetDir = path.join(root, toFolder);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    fs.renameSync(oldPath, newPath);
    return toFolder;
  });

  ipcMain.handle('files:moveToRoot', async (_e, profileId: string, filename: string, fromFolder: string) => {
    const root = getProfileFolder(profileId);
    const oldPath = path.join(root, fromFolder, filename);
    const newPath = path.join(root, filename);

    if (!fs.existsSync(oldPath)) throw new Error(`File not found: ${filename}`);
    if (fs.existsSync(newPath)) throw new Error(`Target already exists: ${filename}`);

    fs.renameSync(oldPath, newPath);
  });

  // ============================================================
  // Folders (Album CRUD)
  // ============================================================
  ipcMain.handle('folders:create', async (_e, profileId: string, name: string) => {
    const root = getProfileFolder(profileId);
    const dir = path.join(root, name);
    if (fs.existsSync(dir)) throw new Error(`Folder already exists: ${name}`);
    fs.mkdirSync(dir);
    return name;
  });

  ipcMain.handle('folders:delete', async (_e, profileId: string, folderPath: string, moveUp: boolean) => {
    const root = getProfileFolder(profileId);
    const fullPath = path.join(root, folderPath);

    if (!fs.existsSync(fullPath)) throw new Error(`Folder not found: ${folderPath}`);

    if (moveUp) {
      // Move files to root before deleting
      const entries = fs.readdirSync(fullPath);
      for (const f of entries) {
        fs.renameSync(path.join(fullPath, f), path.join(root, f));
      }
    }

    fs.rmSync(fullPath, { recursive: true, force: true });
    deleteAlbum(profileId, folderPath);
  });

  ipcMain.handle('folders:rename', async (_e, profileId: string, folderPath: string, newName: string) => {
    const root = getProfileFolder(profileId);
    const oldFull = path.join(root, folderPath);
    const newFull = path.join(root, newName);

    if (!fs.existsSync(oldFull)) throw new Error(`Folder not found: ${folderPath}`);
    if (fs.existsSync(newFull)) throw new Error(`Target already exists: ${newName}`);

    fs.renameSync(oldFull, newFull);
    renameAlbum(profileId, folderPath, newName);
    return newName;
  });

  // ============================================================
  // Albums
  // ============================================================
  ipcMain.handle('albums:setCover', async (_e, profileId: string, folderName: string, imageName: string) => {
    setAlbumCover(profileId, folderName, imageName);
  });

  ipcMain.handle('albums:setOrder', async (_e, profileId: string, folderName: string, order: string[]) => {
    setAlbumOrder(profileId, folderName, order);
  });

  // ============================================================
  // Favorites
  // ============================================================
  ipcMain.handle('favorites:toggle', async (_e, profileId: string, filename: string, folder?: string) => {
    const album = folder ? getAlbumByFolder(profileId, folder) : null;
    const img = getImageByName(profileId, filename, album ? album.id : null);
    if (!img) throw new Error(`Image not found: ${filename}`);
    return toggleFavorite(profileId, img.id);
  });

  ipcMain.handle('favorites:list', async (_e, profileId: string) => {
    return listFavorites(profileId);
  });

  ipcMain.handle('favorites:isFavorite', async (_e, profileId: string, filename: string, folder?: string) => {
    const album = folder ? getAlbumByFolder(profileId, folder) : null;
    const img = getImageByName(profileId, filename, album ? album.id : null);
    if (!img) return false;
    return isFavorite(profileId, img.id);
  });

  ipcMain.handle('favorites:count', async (_e, profileId: string) => {
    return countFavorites(profileId);
  });

  // ============================================================
  // Trash
  // ============================================================
  ipcMain.handle('trash:list', async (_e, profileId: string) => {
    return listTrash(profileId);
  });

  ipcMain.handle('trash:restore', async (_e, profileId: string, trashName: string, originalName: string, originalFolder?: string) => {
    const root = getProfileFolder(profileId);
    const trashDir = path.join(root, '.album-trash');
    const trashPath = path.join(trashDir, trashName);
    const restorePath = originalFolder
      ? path.join(root, originalFolder, originalName)
      : path.join(root, originalName);

    if (!fs.existsSync(trashPath)) throw new Error(`Trash file not found: ${trashName}`);

    const restoreDir = path.dirname(restorePath);
    if (!fs.existsSync(restoreDir)) {
      fs.mkdirSync(restoreDir, { recursive: true });
    }

    // Avoid name collision
    let finalPath = restorePath;
    let counter = 2;
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    while (fs.existsSync(finalPath)) {
      finalPath = originalFolder
        ? path.join(root, originalFolder, `${base} (${counter})${ext}`)
        : path.join(root, `${base} (${counter})${ext}`);
      counter++;
    }

    fs.renameSync(trashPath, finalPath);
    removeTrashEntry(profileId, trashName);

    return path.basename(finalPath);
  });

  ipcMain.handle('trash:count', async (_e, profileId: string) => {
    return countTrash(profileId);
  });

  ipcMain.handle('trash:empty', async (_e, profileId: string) => {
    const root = getProfileFolder(profileId);
    const trashDir = path.join(root, '.album-trash');
    if (fs.existsSync(trashDir)) {
      for (const f of fs.readdirSync(trashDir)) {
        fs.unlinkSync(path.join(trashDir, f));
      }
    }
    return emptyTrash(profileId);
  });

  // ============================================================
  // Settings
  // ============================================================
  ipcMain.handle('settings:get', async (_e, profileId: string) => {
    return getSettings(profileId);
  });

  ipcMain.handle('settings:save', async (_e, profileId: string, updates: Record<string, unknown>) => {
    saveSettings(profileId, updates);
    return getSettings(profileId);
  });

  // ============================================================
  // Theme
  // ============================================================
  ipcMain.handle('theme:extractColors', async (_e, profileId: string, filename: string) => {
    const root = getProfileFolder(profileId);
    const filePath = path.join(root, 'backgrounds', filename);
    if (!fs.existsSync(filePath)) throw new Error(`Background file not found: ${filename}`);
    return extractThemeColors(filePath);
  });

  // ============================================================
  // Background import
  // ============================================================
  ipcMain.handle('bg:import', async (_e, profileId: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: '选择背景图片',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const srcPath = result.filePaths[0];
    const root = getProfileFolder(profileId);
    const bgDir = path.join(root, 'backgrounds');
    if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });
    const ext = path.extname(srcPath);
    const filename = path.basename(srcPath);
    const destPath = path.join(bgDir, filename);
    // Avoid overwriting
    let finalPath = destPath;
    let finalName = filename;
    let counter = 2;
    while (fs.existsSync(finalPath)) {
      const base = path.basename(filename, ext);
      finalName = `${base} (${counter})${ext}`;
      finalPath = path.join(bgDir, finalName);
      counter++;
    }
    fs.copyFileSync(srcPath, finalPath);
    return finalName;
  });

  // ============================================================
  // Window controls
  // ============================================================
  ipcMain.handle('window:minimize', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.minimize();
  });
  ipcMain.handle('window:maximize', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  });
  ipcMain.handle('window:close', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.close();
  });

  // ============================================================
  // Dialog
  // ============================================================
  ipcMain.handle('dialog:openFolder', async (_e, title?: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      title: title ?? '选择图片文件夹',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('bg:openFolder', async (_e, profileId: string) => {
    const root = getProfileFolder(profileId);
    const bgPath = path.join(root, 'backgrounds');
    if (!fs.existsSync(bgPath)) fs.mkdirSync(bgPath, { recursive: true });
    shell.openPath(bgPath);
  });

  ipcMain.handle('bg:delete', async (_e, profileId: string, filename: string) => {
    const root = getProfileFolder(profileId);
    const filePath = path.join(root, 'backgrounds', filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
}
