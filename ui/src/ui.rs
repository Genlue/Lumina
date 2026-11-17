// ============================================================
// Lumina · 小工具
// 只做一件事：把设计系统里返回 id 的提示函数包成 `()`，
// 这样 `match` 的两个分支类型一致，不会因为「一边是 u32 一边是 ()」编译不过。
// ============================================================

use glass_design::prelude::*;

pub fn toast(msg: impl Into<String>) {
    let _ = glass_design::prelude::toast(msg);
}

pub fn toast_with(msg: impl Into<String>, tone: Tone, icon: Option<IconName>) {
    let _ = glass_design::prelude::toast_with(msg, tone, icon);
}

pub fn toast_err(msg: impl Into<String>) {
    let _ = glass_design::prelude::toast_with(msg, Tone::Danger, None);
}
