# Photo Album 📸

一个基于 **Tauri v2** 的本地相册管理软件，轻量、快速、隐私安全。

![screenshot](screenshot.png)

---

## 特性

- 🖼️ **浏览模式** — 网格/列表视图，缩略图懒加载，流畅浏览大量图片
- 📁 **相册管理** — 自动扫描文件夹层级作为相册，支持嵌套目录
- ⭐ **收藏** — 标记喜欢的图片，快速筛选
- 🗑️ **回收站** — 删除的图片移入回收站，支持还原到原位置
- 🎨 **主题** — 深色/浅色模式，自定义强调色，背景图模糊/透明度
- 🔍 **搜索排序** — 按文件名搜索，按名称/日期排序
- 💡 **发现页** — 瀑布流、随机抽卡、幻灯片播放
- 🏗️ **统一 .album** — 所有缓存、回收站、背景图统一归入 `{图片目录}/.album/`

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Tauri v2](https://v2.tauri.app/) |
| 后端语言 | Rust |
| 前端 | 原生 JavaScript + CSS |
| 数据库 | SQLite (rusqlite) |
| 图片处理 | [image](https://crates.io/crates/image) crate |
| 构建工具 | Cargo |

## 快速开始

### 直接运行

下载 `photo-album.exe`，双击运行即可。

> 需要 [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) 运行时（Windows 11 自带，Windows 10 可能需要安装）

### 从源码构建

```bash
# 1. 安装 Rust
https://rustup.rs/

# 2. 克隆仓库
git clone https://github.com/Genlue/PhotoAlbum.git
cd PhotoAlbum

# 3. 构建
cd src-tauri
cargo build --release

# 4. 运行
./target/release/photo-album.exe
```

## 使用说明

1. **首次使用** — 点击"选择图片文件夹"或拖入文件夹
2. **主页** — 显示最近使用的相册和快捷入口
3. **全部图片** — 浏览文件夹中所有图片
4. **相册列表** — 按文件夹分组的相册视图
5. **收藏** — 右键图片收藏，集中查看
6. **回收站** — 右键图片删除后在此查看，支持还原
7. **发现** — 瀑布流/抽卡/幻灯片三种浏览方式
8. **设置** — 自定义主题、背景、布局等

## 开发

```bash
# 热重载开发
cd src-tauri
cargo tauri dev

# 运行测试
cargo test
```

## 许可证

MIT
