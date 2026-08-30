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

  /**
   * 给定背景色（#rrggbb），返回在其上对比度更高的前景色（自动黑/白）。
   * 依据 WCAG 相对亮度：与黑色对比度 (L+0.05)/0.05 ≥ 与白色对比度 1.05/(L+0.05)
   * 时选黑（阈值 L≥0.179），否则选白。
   */
  onColor(hex) {
    if (!hex || hex[0] !== '#' || hex.length < 7) return '#fff';
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L >= 0.179 ? '#111111' : '#ffffff';
  },
};
