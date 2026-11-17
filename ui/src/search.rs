// ============================================================
// Lumina · 搜索语法
// 空格 = AND、| = OR、- = 排除、"" = 精确短语（其中的 - 和 | 不再是操作符）
// 与旧渲染层的 scripts/app/search.js 逐条对齐。
// ============================================================

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Query {
    pub q: String,
    pub ex: String,
}

impl Query {
    pub fn is_empty(&self) -> bool {
        self.q.trim().is_empty() && self.ex.trim().is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tok {
    Word,
    Or,
    Not,
}

#[derive(Debug, Clone, Default)]
struct Parsed {
    /// 每个 OR 分组内的正条件词
    groups: Vec<Vec<(bool, String)>>,
    pos_terms: Vec<String>,
    neg_terms: Vec<String>,
}

/// 把查询串切成 token。
fn tokenize(src: &str) -> Vec<(Tok, String)> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0usize;
    let mut at_start = true;

    while i < chars.len() {
        let ch = chars[i];

        if ch == '"' {
            let mut j = i + 1;
            while j < chars.len() && chars[j] != '"' {
                j += 1;
            }
            let v: String = chars[i + 1..j.min(chars.len())].iter().collect();
            let v = v.trim().to_lowercase();
            if !v.is_empty() {
                out.push((Tok::Word, v));
            }
            i = j + 1;
            at_start = false;
            continue;
        }

        if ch == '|' {
            out.push((Tok::Or, String::new()));
            i += 1;
            at_start = true;
            continue;
        }

        if ch.is_whitespace() {
            i += 1;
            at_start = true;
            continue;
        }

        // 只在词首的 - 才是排除标记；2024-05 里的连字符属于词本身
        if ch == '-' && at_start {
            out.push((Tok::Not, String::new()));
            i += 1;
            at_start = false;
            continue;
        }

        let mut w = String::new();
        while i < chars.len() {
            let c = chars[i];
            if c.is_whitespace() || c == '|' || c == '"' {
                break;
            }
            w.push(c);
            i += 1;
        }
        if !w.is_empty() {
            out.push((Tok::Word, w.to_lowercase()));
        }
        at_start = false;
    }
    out
}

fn parse(query: &str) -> Option<Parsed> {
    let raw = query.trim();
    if raw.is_empty() {
        return None;
    }
    let tokens = tokenize(raw);
    if tokens.is_empty() {
        return None;
    }

    let mut groups: Vec<Vec<(bool, String)>> = Vec::new();
    let mut current: Vec<(bool, String)> = Vec::new();
    let mut pending_not = false;

    for (kind, v) in tokens {
        match kind {
            Tok::Or => {
                if !current.is_empty() {
                    groups.push(std::mem::take(&mut current));
                }
                pending_not = false;
            }
            Tok::Not => pending_not = true,
            Tok::Word => {
                current.push((pending_not, v));
                pending_not = false;
            }
        }
    }
    if !current.is_empty() {
        groups.push(current);
    }
    if groups.is_empty() {
        return None;
    }

    let mut pos_terms: Vec<String> = Vec::new();
    let mut neg_terms: Vec<String> = Vec::new();
    for g in &groups {
        for (neg, term) in g {
            let bucket = if *neg { &mut neg_terms } else { &mut pos_terms };
            if !bucket.contains(term) {
                bucket.push(term.clone());
            }
        }
    }

    Some(Parsed {
        groups,
        pos_terms,
        neg_terms,
    })
}

impl Parsed {
    fn matches(&self, text: &str) -> bool {
        let lower = text.to_lowercase();
        self.groups.iter().any(|group| {
            let pos: Vec<&String> = group.iter().filter(|(n, _)| !n).map(|(_, t)| t).collect();
            if pos.is_empty() {
                return true; // 只有排除条件时，视为全部通过
            }
            pos.iter().all(|t| lower.contains(t.as_str()))
        })
    }

    fn excludes(&self, text: &str) -> bool {
        if self.neg_terms.is_empty() {
            return false;
        }
        let lower = text.to_lowercase();
        self.neg_terms.iter().any(|t| lower.contains(t.as_str()))
    }

    fn hits(&self, text: &str) -> bool {
        self.matches(text) && !self.excludes(text)
    }
}

/// 一条查询的编译结果：正条件 + 排除条件 + 用于高亮的词。
#[derive(Debug, Clone, Default)]
pub struct Filter {
    parsed: Option<Parsed>,
}

impl Filter {
    pub fn new(q: &str, ex: &str) -> Self {
        // 正搜索与排除搜索是两个输入框，各自解析后合并：
        // 排除框里的词一律视为排除条件（前缀 - 可有可无）。
        let mut parsed = parse(q);
        let ex_parsed = parse(ex);
        if let Some(e) = ex_parsed {
            match &mut parsed {
                Some(p) => {
                    for t in e.pos_terms {
                        if !p.neg_terms.contains(&t) {
                            p.neg_terms.push(t);
                        }
                    }
                    for t in e.neg_terms {
                        if !p.neg_terms.contains(&t) {
                            p.neg_terms.push(t);
                        }
                    }
                }
                None => {
                    let mut p = Parsed {
                        groups: vec![Vec::new()],
                        pos_terms: Vec::new(),
                        neg_terms: Vec::new(),
                    };
                    p.neg_terms.extend(e.pos_terms);
                    p.neg_terms.extend(e.neg_terms);
                    parsed = Some(p);
                }
            }
        }
        Self { parsed }
    }

    pub fn from_query(q: &Query) -> Self {
        Self::new(&q.q, &q.ex)
    }

    pub fn is_empty(&self) -> bool {
        self.parsed.is_none()
    }

    pub fn hits(&self, text: &str) -> bool {
        match &self.parsed {
            None => true,
            Some(p) => p.hits(text),
        }
    }

    /// 用于高亮的正条件词。
    pub fn terms(&self) -> Vec<String> {
        self.parsed
            .as_ref()
            .map(|p| p.pos_terms.clone())
            .unwrap_or_default()
    }
}

/* ---------------- 排序 ---------------- */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SortBy {
    #[default]
    NameAsc,
    NameDesc,
    DateDesc,
    DateAsc,
}

impl SortBy {
    pub fn parse(s: &str) -> Self {
        match s {
            "name-desc" => Self::NameDesc,
            "date-desc" => Self::DateDesc,
            "date-asc" => Self::DateAsc,
            _ => Self::NameAsc,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::NameAsc => "name-asc",
            Self::NameDesc => "name-desc",
            Self::DateDesc => "date-desc",
            Self::DateAsc => "date-asc",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::NameAsc => "名称 A→Z",
            Self::NameDesc => "名称 Z→A",
            Self::DateDesc => "最新优先",
            Self::DateAsc => "最旧优先",
        }
    }
}

/// 名称排序用不区分大小写的自然序（`zh` 排序由浏览器 localeCompare 近似）。
pub fn compare_name(a: &str, b: &str) -> std::cmp::Ordering {
    a.to_lowercase().cmp(&b.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn and_or_not() {
        let f = Filter::new("猫 狗", "");
        assert!(f.hits("猫和狗.jpg"));
        assert!(!f.hits("只有猫.jpg"));

        let f = Filter::new("猫 | 狗", "");
        assert!(f.hits("只有狗.jpg"));

        let f = Filter::new("猫 -狗", "");
        assert!(f.hits("猫.jpg"));
        assert!(!f.hits("猫狗.jpg"));
    }

    #[test]
    fn phrase_and_hyphen() {
        let f = Filter::new("\"猫 | 狗\"", "");
        assert!(f.hits("猫 | 狗.jpg"));
        assert!(!f.hits("猫.jpg"));

        let f = Filter::new("2024-05", "");
        assert!(f.hits("IMG_2024-05.jpg"));
    }

    #[test]
    fn exclude_field() {
        let f = Filter::new("", "截图");
        assert!(f.hits("风景.jpg"));
        assert!(!f.hits("截图 2024.png"));
    }
}
