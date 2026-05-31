import * as fs from 'fs';
import * as path from 'path';
import { FileInfo, syncImages, listImages } from '../db/images-repo';
import { ensureAlbumsForProfile, listAlbums } from '../db/albums-repo';

/** Supported image extensions */
const IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);

/** Names/paths to exclude from scanning */
const EXCLUDE = new Set(['album.json', 'albums.json', '.album-trash', '_trash', '_config', '_data', 'backgrounds']);

export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return IMG_EXTS.has(ext);
}

export function shouldExclude(name: string): boolean {
  return EXCLUDE.has(name) || name.startsWith('.') || name.endsWith('.html') || name.endsWith('.json');
}

export interface ScanResult {
  rootImages: FileInfo[];
  albumFolders: string[];
  albumImages: Record<string, FileInfo[]>;
}

/**
 * Full scan: root images + all subfolder images
 */
export function scanProfileFolder(profileId: string, folderPath: string): ScanResult {
  const rootImages: FileInfo[] = [];
  const albumFolders: string[] = [];
  const albumImages: Record<string, FileInfo[]> = {};

  if (!fs.existsSync(folderPath)) {
    return { rootImages, albumFolders, albumImages };
  }

  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    console.error('[Scanner] Cannot read directory:', folderPath);
    return { rootImages, albumFolders, albumImages };
  }

  // Only process max 2000 entries to avoid hanging
  const MAX_ENTRIES = 2000;
  let entryCount = 0;

  for (const entry of entries) {
    if (entryCount++ > MAX_ENTRIES) break;

    const fullPath = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      // Skip system directories and common non-image dirs
      const skipDirs = new Set([
        ...EXCLUDE, '.git', 'node_modules', '.reasonix', '.vscode', '.idea',
        '__pycache__', '.cache', 'AppData', '.android', '.npm', '.nuget',
        '.ssh', '.templateengine', '.local', '.matplotlib', '.modelscope',
        '.MUMUVMM', '.idlerc', '.gradle', '.claude', '.codex', '.codex-session-delete',
        '.copilot', '.dotnet', '.wx-cli', '.cc-switch', '.vscode-shared',
      ]);
      if (skipDirs.has(entry.name) || entry.name.startsWith('.') || entry.name.startsWith('「')) {
        continue;
      }
      albumFolders.push(entry.name);
      try {
        const imgs = scanFileList(fullPath);
        if (imgs.length > 0) {
          albumImages[entry.name] = imgs;
        }
      } catch {
        // Skip unreadable directories
      }
    } else if (entry.isFile()) {
      if (shouldExclude(entry.name)) continue;
      if (isImageFile(entry.name)) {
        try {
          const stat = fs.statSync(fullPath);
          rootImages.push({
            name: entry.name,
            handle: undefined as never,
            size: stat.size,
            lastModified: stat.mtimeMs,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  // Also scan backgrounds folder (not shown as album)
  const bgPath = path.join(folderPath, 'backgrounds');
  if (fs.existsSync(bgPath)) {
    try {
      const bgImgs = scanFileList(bgPath);
      if (bgImgs.length > 0) {
        albumImages['backgrounds'] = bgImgs;
      }
    } catch { /* skip */ }
  }

  // Sync to DB
  syncImages(profileId, null, rootImages);

  // Ensure album records exist
  ensureAlbumsForProfile(profileId, albumFolders);

  // Sync album images
  const albums = listAlbums(profileId);
  for (const album of albums) {
    const imgs = albumImages[album.folder_name] ?? [];
    syncImages(profileId, album.id, imgs);
  }

  return { rootImages, albumFolders, albumImages };
}

function scanFileList(dirPath: string): FileInfo[] {
  const results: FileInfo[] = [];
  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (shouldExclude(entry.name)) continue;
    if (!isImageFile(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    const stat = fs.statSync(fullPath);
    results.push({
      name: entry.name,
      handle: undefined as never,
      size: stat.size,
      lastModified: stat.mtimeMs,
    });
  }
  return results;
}

/**
 * List all subfolders (non-excluded) recursively
 */
export function listAllSubfolders(folderPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(folderPath)) return results;

  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (shouldExclude(entry.name)) continue;

    results.push(entry.name);
    // Recursive for nested folders
    const subPath = path.join(folderPath, entry.name);
    try {
      const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (!sub.isDirectory()) continue;
        if (shouldExclude(sub.name)) continue;
        results.push(`${entry.name}/${sub.name}`);
      }
    } catch {
      // Permission issue — skip
    }
  }
  return results;
}
