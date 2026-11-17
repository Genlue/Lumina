// Golden Gate · _shared/contrast


/** 给自定义底色配前景：只解析 #RGB / #RRGGBB，其它颜色交回 --text-on-accent */
export function contrastOn(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return 'var(--text-on-accent)';
  let hx = m[1];
  if (hx.length === 3) hx = hx.split('').map((c) => c + c).join('');
  const n = parseInt(hx, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.55 ? 'var(--text-primary)' : 'var(--text-on-accent)';
}
