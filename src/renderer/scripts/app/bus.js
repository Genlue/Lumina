// ============================================================
// Lumina · 应用内事件总线
// 页面订阅自己关心的数据变化，避免「一改收藏就整页重挂」。
// ============================================================

const map = new Map();

/**
 * 订阅。
 * @returns {() => void} 解绑
 */
export function on(evt, fn) {
  if (!map.has(evt)) map.set(evt, new Set());
  map.get(evt).add(fn);
  return () => map.get(evt)?.delete(fn);
}

export function emit(evt, payload) {
  for (const fn of map.get(evt) || []) {
    try {
      fn(payload);
    } catch (e) {
      console.error(`[bus] ${evt} handler failed`, e);
    }
  }
}

/** 页面 mount 时批量订阅，destroy 时一次解绑 */
export function subscribe(pairs) {
  const offs = Object.entries(pairs).map(([evt, fn]) => on(evt, fn));
  return () => offs.forEach((off) => off());
}
