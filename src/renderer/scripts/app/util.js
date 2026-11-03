// ============================================================
// Lumina · App 工具
// 纯函数：格式化、路径键、文件名处理。没有任何 DOM 依赖。
// ============================================================

/** 支持扫描的图片扩展名（与后端 scanner 保持一致） */
export const IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);

/** 回收站在 profile 里的相对目录 */
export const TRASH_DIR = '.album/trash';

/** 字节 → 可读 */
export function fmtSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

const pad = (n) => String(n).padStart(2, '0');

/** 时间戳 → YYYY-MM-DD HH:mm */
export function fmtDate(ts) {
  if (!ts) return '--';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '--';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 时间戳 → MM-DD */
export function fmtDay(ts) {
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '--';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 时间戳 → 相对时间（用于回收站/收藏列表） */
export function fmtAgo(ts) {
  const t = Number(ts) || 0;
  if (!t) return '--';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return fmtDate(t);
}

/** 文件名扩展名（小写，不含点） */
export const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();

/** 去掉扩展名 */
export function baseOf(name) {
  const i = String(name).lastIndexOf('.');
  return i > 0 ? String(name).slice(0, i) : String(name);
}

export const isImage = (name) => IMG_EXTS.has(extOf(name));

/** 路径最后一段 */
export function lastSegment(path) {
  const parts = String(path || '').split('/');
  return parts[parts.length - 1] || '';
}

/**
 * 图片的唯一键：`folder/filename`，根目录图片就是 `filename`。
 * 全应用（选择集、收藏集、网格、灯箱）共用这一套键。
 */
export const keyOf = (folder, name) => (folder ? `${folder}/${name}` : name);

/** 键 → { folder, name }；根目录的 folder 为 null */
export function parseKey(key) {
  const i = String(key).lastIndexOf('/');
  return i >= 0
    ? { name: key.slice(i + 1), folder: key.slice(0, i) }
    : { name: key, folder: null };
}

/** 数字钳制；非法值回退 */
export function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 把 Windows 路径统一成正斜杠、去掉尾部斜杠 */
export const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * 把「对话框选中的绝对路径」换算成 profile 内的相对相册路径。
 * 选中的就是图库根目录时返回 ''。
 */
export function toRelativeFolder(selected, root) {
  const s = normPath(selected);
  const r = normPath(root);
  if (s === r) return '';
  if (s.startsWith(`${r}/`)) return s.slice(r.length + 1);
  return s;
}

/** 洗牌（原地） */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 生成本地文件名不冲突的候选（重命名用不上，仅供复制场景） */
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const ext = extOf(name);
  const base = baseOf(name);
  let i = 2;
  let candidate;
  do {
    candidate = ext ? `${base} (${i}).${ext}` : `${base} (${i})`;
    i += 1;
  } while (taken.has(candidate));
  return candidate;
}

/* ==========================================================================
   拖拽：跨页面（网格 → 侧栏相册树 / 相册卡）传递图片键
   ========================================================================== */

export function setDragKeys(e, keys) {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', JSON.stringify(keys));
}

export function readDragKeys(e) {
  try {
    const raw = e.dataTransfer?.getData('text/plain') || '';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}
