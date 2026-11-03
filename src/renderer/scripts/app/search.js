// ============================================================
// Lumina · 搜索语法
// 空格 = AND、| = OR、- = 排除、"" = 精确短语（其中的 - 和 | 不再是操作符）
// 只做纯文本匹配，不依赖任何 DOM。
// ============================================================

/**
 * 把查询串切成 token。
 * @returns {Array<{t:'word'|'or'|'not', v?:string}>}
 */
function tokenize(query) {
  const out = [];
  const src = String(query || '');
  let i = 0;
  let atTokenStart = true;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      const stop = end === -1 ? src.length : end;
      const v = src.slice(i + 1, stop).trim();
      if (v) out.push({ t: 'word', v: v.toLowerCase() });
      i = stop + 1;
      atTokenStart = false;
      continue;
    }

    if (ch === '|') {
      out.push({ t: 'or' });
      i += 1;
      atTokenStart = true;
      continue;
    }

    if (/\s/.test(ch)) {
      i += 1;
      atTokenStart = true;
      continue;
    }

    // 只在词首的 - 才是排除标记；2024-05 里的连字符属于词本身
    if (ch === '-' && atTokenStart) {
      out.push({ t: 'not' });
      i += 1;
      atTokenStart = false;
      continue;
    }

    let w = '';
    while (i < src.length && !/\s/.test(src[i]) && src[i] !== '|' && src[i] !== '"') {
      w += src[i];
      i += 1;
    }
    if (w) out.push({ t: 'word', v: w.toLowerCase() });
    atTokenStart = false;
  }

  return out;
}

/**
 * 解析查询。
 * @returns {null | {match:(s:string)=>boolean, exclude:(s:string)=>boolean, terms:string[], describe:()=>string}}
 */
export function parseQuery(query) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  const tokens = tokenize(raw);
  if (!tokens.length) return null;

  // 按 | 分组；每组内是若干 { neg, term }
  const groups = [];
  let current = [];
  let pendingNot = false;

  const flushGroup = () => {
    if (current.length) groups.push(current);
    current = [];
  };

  for (const tk of tokens) {
    if (tk.t === 'or') {
      flushGroup();
      pendingNot = false;
    } else if (tk.t === 'not') {
      pendingNot = true;
    } else {
      current.push({ neg: pendingNot, term: tk.v });
      pendingNot = false;
    }
  }
  flushGroup();

  if (!groups.length) return null;

  const posTerms = [];
  const negTerms = [];
  for (const g of groups) {
    for (const it of g) {
      const bucket = it.neg ? negTerms : posTerms;
      if (!bucket.includes(it.term)) bucket.push(it.term);
    }
  }

  const match = (text) => {
    const lower = String(text || '').toLowerCase();
    return groups.some((group) => {
      const pos = group.filter((it) => !it.neg);
      if (!pos.length) return true; // 只有排除条件时，视为全部通过
      return pos.every((it) => lower.includes(it.term));
    });
  };

  const exclude = (text) => {
    if (!negTerms.length) return false;
    const lower = String(text || '').toLowerCase();
    return negTerms.some((t) => lower.includes(t));
  };

  const describe = () =>
    groups
      .map((group) => {
        const pos = group.filter((it) => !it.neg).map((it) => it.term);
        const neg = group.filter((it) => it.neg).map((it) => it.term);
        const head = pos.length ? pos.join(' + ') : '(全部)';
        return neg.length ? `${head} -${neg.join(' -')}` : head;
      })
      .join(' | ');

  return { match, exclude, terms: posTerms, describe };
}

/** 文本是否被查询命中（正条件通过且不在排除集里） */
export function hits(parsed, text) {
  if (!parsed) return true;
  return parsed.match(text) && !parsed.exclude(text);
}

/**
 * 高亮：返回 HTML 片段。
 * 先把文本转义，再逐词包 <mark class="app-mark">，避免大小写与特殊字符问题。
 */
export function highlight(text, terms) {
  const escaped = escapeHtml(String(text ?? ''));
  if (!terms || !terms.length) return escaped;
  let out = escaped;
  for (const term of terms) {
    if (!term) continue;
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(${safe})`, 'gi'), '<mark class="app-mark">$1</mark>');
  }
  return out;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
