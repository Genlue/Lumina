// ============================================================
// Lumina · 模态框
// 只有一种外壳（Dialog），内容按 kind 变。
// 设计系统要求「不要自己造第二套遮罩与关窗逻辑」，所以这里只有一处。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::api;
use crate::models::*;
use crate::state::App;
use crate::ui::{toast, toast_with};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModalKind {
    Rename,
    MoveTo,
    Confirm,
    NewAlbum,
    RenameAlbum,
    DeleteAlbum,
    /// 从封面页移除一个图库（只删记录，不动磁盘）
    RemoveProfile,
    SearchHelp,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Modal {
    pub kind: ModalKind,
    pub title: String,
    pub desc: String,
    pub value: String,
    pub image: Option<Image>,
    pub folder: Option<String>,
    /// 二次确认的动作标识（`Confirm` 用）
    pub action: String,
}

impl Modal {
    pub fn new(kind: ModalKind, title: &str) -> Self {
        Self {
            kind,
            title: title.to_string(),
            desc: String::new(),
            value: String::new(),
            image: None,
            folder: None,
            action: String::new(),
        }
    }
    pub fn desc(mut self, d: &str) -> Self {
        self.desc = d.to_string();
        self
    }
    pub fn value(mut self, v: &str) -> Self {
        self.value = v.to_string();
        self
    }
    pub fn image(mut self, i: Image) -> Self {
        self.image = Some(i);
        self
    }
    pub fn folder(mut self, f: &str) -> Self {
        self.folder = Some(f.to_string());
        self
    }
    pub fn action(mut self, a: &str) -> Self {
        self.action = a.to_string();
        self
    }
}

/* ---------------- 入口 ---------------- */

pub fn prompt_rename(app: App, img: Image) {
    let name = img.name.clone();
    app.modal
        .set(Some(Modal::new(ModalKind::Rename, "重命名").desc("扩展名会保留").value(&name).image(img)));
}

pub fn pick_album(app: App, img: Image) {
    app.modal.set(Some(
        Modal::new(ModalKind::MoveTo, "移动到相册").desc("选一个目标相册，或者移到根目录").image(img),
    ));
}

pub fn confirm(app: App, title: &str, desc: &str, action: &str) {
    app.modal
        .set(Some(Modal::new(ModalKind::Confirm, title).desc(desc).action(action)));
}

/* ---------------- 组件 ---------------- */

#[component]
pub fn ModalHost() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        {move || {
            let Some(m) = app.modal.get() else {
                return ().into_any();
            };
            let open = Signal::derive(move || app.modal.with(|m| m.is_some()));
            let close = Callback::new(move |_| app.modal.set(None));

            let body = match m.kind {
                ModalKind::Rename | ModalKind::NewAlbum | ModalKind::RenameAlbum => {
                    let cur = m.value.clone();
                    view! {
                        <Field
                            value=Signal::derive(move || {
                                app.modal.with(|m| m.as_ref().map(|x| x.value.clone()).unwrap_or_default())
                            })
                            placeholder=cur
                            label="名称"
                            on_input=Callback::new(move |v: String| {
                                app.modal.update(|m| {
                                    if let Some(x) = m {
                                        x.value = v;
                                    }
                                });
                            })
                            on_enter=Callback::new(move |_| submit(app))
                        />
                    }
                    .into_any()
                }
                ModalKind::MoveTo => {
                    let folders = app.folders.get();
                    view! {
                        <div class="l-stack l-stack--2" style="max-height:320px;overflow-y:auto">
                            <FolderRow
                                label="根目录"
                                on_pick=Callback::new(move |_| {
                                    let img = app.modal.with(|m| m.as_ref().and_then(|x| x.image.clone()));
                                    app.modal.set(None);
                                    if let Some(img) = img {
                                        move_to_root(app, img);
                                    }
                                })
                            />
                            {folders.into_iter().map(|f| {
                                let f2 = f.clone();
                                view! {
                                    <FolderRow
                                        label=f
                                        on_pick=Callback::new(move |_| {
                                            let img = app.modal.with(|m| m.as_ref().and_then(|x| x.image.clone()));
                                            app.modal.set(None);
                                            if let Some(img) = img {
                                                move_to(app, img, f2.clone());
                                            }
                                        })
                                    />
                                }
                            }).collect_view()}
                        </div>
                    }
                    .into_any()
                }
                // 这三种只有「标题 + 一句说明 + 两个按钮」，说明走 Dialog 的
                // description 槽；body 留空，否则同一句话会出现两遍。
                ModalKind::Confirm | ModalKind::DeleteAlbum | ModalKind::RemoveProfile => {
                    ().into_any()
                }
                ModalKind::SearchHelp => view! { <SearchHelp /> }.into_any(),
            };

            let actions = if m.kind == ModalKind::SearchHelp {
                view! { <Button label="知道了" variant=ButtonVariant::Primary on_click=close /> }
                    .into_any()
            } else if m.kind == ModalKind::MoveTo {
                view! { <Button label="取消" variant=ButtonVariant::Plain on_click=close /> }.into_any()
            } else {
                let danger = matches!(
                    m.kind,
                    ModalKind::DeleteAlbum | ModalKind::RemoveProfile
                ) || m.action.starts_with("danger:");
                view! {
                    <Button label="取消" variant=ButtonVariant::Plain on_click=close />
                    <Button
                        label="确定"
                        variant=if danger { ButtonVariant::Danger } else { ButtonVariant::Primary }
                        on_click=Callback::new(move |_| submit(app))
                    />
                }
                .into_any()
            };

            view! {
                <Dialog
                    open=open
                    title=m.title.clone()
                    description=if m.kind == ModalKind::Confirm { String::new() } else { m.desc.clone() }
                    width=440
                    on_close=close
                    actions=Box::new(move || actions)
                >
                    {body}
                </Dialog>
            }
            .into_any()
        }}
    }
}

/// 「移动到文件夹」列表里的一行。
///
/// 用原生 `<button>` 而不是库的 `NavItem`：后者输出 `role="option"`，
/// 这里没有 listbox 父级，语义反而是错的；按钮自带 Enter/Space 激活。
/// 复用 `.c-nav__item` 只为外观与导航栏一致，不参与导航栏的键盘模型。
#[component]
fn FolderRow(#[prop(into)] label: String, on_pick: Callback<()>) -> impl IntoView {
    view! {
        <button class="c-nav__item" on:click=move |_| on_pick.run(())>
            <span class="c-nav__label">{label}</span>
        </button>
    }
}

#[component]
fn SearchHelp() -> impl IntoView {
    let line = |k: &'static str, v: &'static str| {
        view! {
            <div class="l-row l-row--4" style="align-items:flex-start">
                <span style="flex:none;width:150px"><Badge label=k /></span>
                <span class="c-subtitle">{v}</span>
            </div>
        }
    };
    view! {
        <div class="l-stack l-stack--3">
            {line("猫 狗", "空格 = AND，同时包含「猫」和「狗」")}
            {line("猫 | 狗", "| = OR，包含任意一个")}
            {line("猫 -狗", "- = 排除，含「猫」但不含「狗」")}
            {line("\"猫 | 狗\"", "双引号 = 精确短语，里面的符号不再当操作符")}
            <Divider />
            {line("单击照片", "用灯箱打开")}
            {line("Ctrl / ⌘ + 单击", "多选")}
            {line("Esc", "退出选择模式 / 关闭灯箱")}
            {line("Ctrl / ⌘ + A", "全选")}
            {line("Delete", "把选中的照片移到回收站")}
            <Divider />
            {line("← / →", "灯箱翻页")}
            {line("R / Shift+R", "灯箱顺时针 / 逆时针旋转 90°")}
            {line("空格", "灯箱里收藏当前照片")}
        </div>
    }
}

/* ---------------- 提交 ---------------- */

fn submit(app: App) {
    let Some(m) = app.modal.get_untracked() else {
        return;
    };
    let profile = app.profile_id.get_untracked();
    app.modal.set(None);

    match m.kind {
        ModalKind::Rename => {
            if let Some(img) = m.image {
                let new_name = m.value.trim().to_string();
                if new_name.is_empty() || new_name == img.name {
                    return;
                }
                spawn_local(async move {
                    match api::file_rename(&profile, &img.name, &new_name, img.folder.as_deref()).await {
                        Ok(()) => {
                            app.reload_index();
                            app.reload_favorites();
                            toast("已重命名");
                        }
                        Err(e) => toast_with(format!("重命名失败：{e}"), Tone::Danger, None),
                    }
                });
            }
        }
        ModalKind::NewAlbum => {
            let name = m.value.trim().to_string();
            if name.is_empty() {
                return;
            }
            spawn_local(async move {
                match api::folder_create(&profile, &name, None).await {
                    Ok(()) => {
                        app.reload_index();
                        toast(format!("已创建相册「{name}」"));
                    }
                    Err(e) => toast_with(format!("创建失败：{e}"), Tone::Danger, None),
                }
            });
        }
        ModalKind::RenameAlbum => {
            if let Some(folder) = m.folder {
                let name = m.value.trim().to_string();
                if name.is_empty() {
                    return;
                }
                spawn_local(async move {
                    match api::folder_rename(&profile, &folder, &name).await {
                        Ok(()) => {
                            app.reload_index();
                            toast("已重命名相册");
                        }
                        Err(e) => toast_with(format!("重命名失败：{e}"), Tone::Danger, None),
                    }
                });
            }
        }
        ModalKind::DeleteAlbum => {
            if let Some(folder) = m.folder {
                let move_up = m.action == "album:delete:keep";
                spawn_local(async move {
                    match api::folder_delete(&profile, &folder, move_up).await {
                        Ok(()) => {
                            app.reload_index();
                            app.go(crate::state::Route::album("albums"));
                            toast("已删除相册");
                        }
                        Err(e) => toast_with(format!("删除失败：{e}"), Tone::Danger, None),
                    }
                });
            }
        }
        ModalKind::RemoveProfile => {
            if let Some(id) = m.folder {
                app.remove_profile(id);
            }
        }
        ModalKind::Confirm => match m.action.as_str() {
            "trash:empty" => crate::pages::trash::do_empty(app),
            "cache:clear" => crate::pages::settings::do_clear_cache(app),
            _ => {}
        },
        ModalKind::MoveTo | ModalKind::SearchHelp => {}
    }
}

fn move_to(app: App, img: Image, target: String) {
    let profile = app.profile_id.get_untracked();
    spawn_local(async move {
        let res = match &img.folder {
            Some(f) if !f.is_empty() => {
                api::file_between_folders(&profile, &img.name, Some(f), &target).await
            }
            _ => api::file_to_folder(&profile, &img.name, &target).await,
        };
        match res {
            Ok(()) => {
                app.reload_index();
                app.reload_favorites();
                toast(format!("已移动到「{target}」"));
            }
            Err(e) => toast_with(format!("移动失败：{e}"), Tone::Danger, None),
        }
    });
}

fn move_to_root(app: App, img: Image) {
    let profile = app.profile_id.get_untracked();
    spawn_local(async move {
        match api::file_to_root(&profile, &img.name, img.folder.as_deref()).await {
            Ok(()) => {
                app.reload_index();
                app.reload_favorites();
                toast("已移到根目录");
            }
            Err(e) => toast_with(format!("移动失败：{e}"), Tone::Danger, None),
        }
    });
}
