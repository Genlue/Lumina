// ============================================================
// Lumina — Utility functions (U)
// ============================================================

const U = {
  /** Generate UUID */
  uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  /** Debounce function */
  debounce(fn, ms = DEBOUNCE) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  },

  /** Format timestamp → YYYY-MM-DD HH:mm */
  fmtDate(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  /** Format bytes → human-readable */
  fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },

  /** File extension (lowercase, no dot) */
  ext(name) {
    return (name.split('.').pop() || '').toLowerCase();
  },

  /** File base name (no extension) */
  base(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.substring(0, i) : name;
  },

  /** HTML escape */
  esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  /** Check if filename is a supported image */
  isImg(name) {
    return IMG_EXTS.has(U.ext(name));
  },

  /** Check if filename should be excluded */
  isEx(name) {
    return EXCLUDE.has(name) || name.startsWith('.') || name.endsWith('.html') || name.endsWith('.json');
  },

  /** Generate trash filename with timestamp */
  genTrash(original) {
    const ext = U.ext(original);
    const base = U.base(original);
    return `${base}_${Date.now()}.${ext}`;
  },

  /** Avoid filename collision: add (2), (3), ... */
  avoidC(name, existingSet) {
    if (!existingSet.has(name)) return name;
    const ext = U.ext(name);
    const base = U.base(name);
    let i = 2;
    let candidate;
    do {
      candidate = ext ? `${base} (${i}).${ext}` : `${base} (${i})`;
      i++;
    } while (existingSet.has(candidate));
    return candidate;
  },

  /** Fisher-Yates shuffle (mutates) */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },
};
