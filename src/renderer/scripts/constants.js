// ============================================================
// Photo Album — Constants
// ============================================================

/** Supported image extensions */
const IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);

/** Files/paths excluded from scanning */
const EXCLUDE = new Set([
  'album.json', 'albums.json', 'albums.json.tmp',
  '.album-trash', '_trash', '_config', '_data',
  'backgrounds', 'photo-album.html',
]);

/** Trash directory name */
const TRASH_DIR = '.album-trash';

/** Backgrounds directory */
const BG_DIR = 'backgrounds';

/** Debounce delay (ms) */
const DEBOUNCE = 300;

/** Max Object URLs cached before auto-prune */
const MAX_URLS = 80;

// ============================================================
// THEMES — Windows 11 native style
// ============================================================
const THEMES = {
  dark: {
    bg: '#1c1c1c',
    surface: '#2d2d2d',
    surface2: '#333333',
    card: '#2a2a2a',
    cardHover: '#383838',
    border: '#404040',
    borderL: '#4a4a4a',
    text: '#f0f0f0',
    text2: '#b0b0b0',
    text3: '#707070',
    accent: '#60cdff',
    accent2: '#40b8e0',
    accentBg: 'rgba(96,205,255,0.12)',
  },
  light: {
    bg: '#f3f3f3',
    surface: '#fafafa',
    surface2: '#ffffff',
    card: '#fdfdfd',
    cardHover: '#f5f5f5',
    border: '#e0e0e0',
    borderL: '#f0f0f0',
    text: '#1b1b1b',
    text2: '#606060',
    text3: '#9a9a9a',
    accent: '#0066cc',
    accent2: '#0052a3',
    accentBg: 'rgba(0,102,204,0.08)',
  },
};
