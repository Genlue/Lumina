// Golden Gate · _shared/initials


/** 中文取首字，西文取首字母缩写 */
export function initials(name = '') {
  const s = String(name).trim();
  if (!s) return '';
  if (/[\u3400-\u9fff]/.test(s)) return s.slice(0, 1);
  return s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}
