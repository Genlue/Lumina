# Lumina 📸

一个基于 **Tauri v2 + Rust + Leptos** 的本地相册管理软件，轻量、快速、隐私安全。

![screenshot](screenshot.png)

---

## 特性

- 🚪 **封面页** — 启动先进封面页：进入 / 添加 / 移除 / 重定位图库，进入时有加载动画
- 🗂️ **多图库** — 一个图库对应一个本地文件夹，可添加、切换、重定位、移除
- 🖼️ **浏览模式** — 网格 / 列表两种视图；缩略图分块渲染 + 批量请求，大图库也不卡
- 📁 **相册管理** — 自动扫描文件夹层级生成相册，支持嵌套目录、封面、拖拽移动
- ⭐ **收藏** — 标记喜欢的图片，支持 JSON 导出 / 导入
- 🗑️ **回收站** — 删除的图片移入回收站，可还原到原位置、永久删除、一键清空
- 🔍 **搜索排序** — 正搜索 + 排除搜索；空格 = AND、`|` = OR、`-` = 排除
- 💡 **发现页** — 瀑布流、随机抽卡、幻灯片三种浏览方式
- 🌗 **灯箱** — 全屏查看、滚轮缩放（光标锚点，1×–8×）、左键自由拖拽平移（双击归位）、左右翻页、90° 旋转、当前图模糊暗化背景；点图片外任意区域退出
- 📊 **主页工作台** — 图库身份 + 指标条、最近相册、格式堆叠条、缓存与维护
- 🎨 **外观** — 深色 / 浅色 / 跟随系统、强调色色板、侧栏宽度、每行图片数、图片间距
- 🧊 **玻璃效果三档** — 完整效果（SVG 折射 + 模糊）/ 仅模糊 / 性能优先（不透明底，低配机器更跟手）
- 🪟 **窗口外壳** — 无边框窗口 + 红绿灯、导航栏开合；不拦截系统截图与任务栏预览
- 🗂️ **缓存管理** — 缩略图生成全局限速；全库预生成（带进度可取消）；检查并清理孤儿缓存
- 🏗️ **统一 `.album`** — 缓存、回收站统一收在 `{图片目录}/.album/`

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Tauri v2](https://v2.tauri.app/) |
| 后端 | Rust + SQLite（rusqlite） |
| 前端 | **Rust + Leptos 0.8（CSR）编译到 wasm** |
| 设计系统 | [GlassDesign](https://github.com/Genlue/GlassDesign) v0.10.0（git tag 依赖；构建期预计算液态玻璃，效果可分三档） |
| 图片处理 | [image](https://crates.io/crates/image) crate |
| 构建 | cargo + wasm-bindgen + Node 脚本 |

> 前端不再是 JS/CSS，也没有打包器：界面用 `view!` 拼，`cargo build` 出 wasm，
> `wasm-bindgen` 出胶水，产物落在 `dist/`，由 Tauri 编进 exe。

## 目录

```text
Lumina/
├── ui/                       前端 crate（lumina-ui，Leptos CSR）
│   ├── src/
│   │   ├── lib.rs            入口：bootstrap + 主题 + 灯箱 + 模态框
│   │   ├── api.rs            后端命令的完整镜像（唯一接触面）
│   │   ├── models.rs         与 src-tauri/src/models.rs 一一对应的数据模型
│   │   ├── state.rs          App 状态（全是 RwSignal）+ 缩略图批量通道
│   │   ├── search.rs         搜索语法解析 + 排序
│   │   ├── shell.rs          外壳（常驻）：顶栏 / 导航栏 / 封面页 / 加载页 / 页面分发
│   │   ├── grid.rs           照片浏览引擎：工具行 / 网格 / 列表 / 右键菜单
│   │   ├── lightbox.rs       灯箱
│   │   ├── theme.rs          主题：首帧缓存 + Settings 单向同步（Memo 收窄依赖）
│   │   ├── scrollbar.rs      覆盖式滚动条驱动（补库里的半成品）
│   │   ├── prefs.rs          纯显示偏好（每行张数、间距、导航开合）
│   │   └── pages/            home / library / albums / favorites /
│   │                         discover / trash / settings / dialog / welcome
│   ├── index.html            页面外壳（引入 app.css 与 pkg/）
│   ├── app.css               只写位置与尺寸，颜色全走令牌
├── dist/                     构建产物（wasm + 胶水 + 页面），Tauri 的 frontendDist
├── src-tauri/                宿主：全部业务命令
├── scripts/
│   ├── build-ui.mjs          前端构建：cargo wasm → wasm-bindgen → dist/
│   ├── dev-run.mjs           开发循环：构建 + 重启 + 截图
│   └── devtools.mjs          CDP 调试：截图 / 抓控制台 / 求值
└── src/renderer/             ⚠️ 旧渲染层（v3.0 的 JS/CSS），仅作对照保留
```

## 构建

```bash
# 1. 前端 → dist/
node scripts/build-ui.mjs

# 2. 宿主（会把 dist 编进 exe）
cd src-tauri && cargo build --release

# 3. 运行
./target/release/lumina.exe
```

> **依赖认上游 tag**：`ui/Cargo.toml` 引 `glass-design` 的 `v0.10.0`，仓库里不留第二份源码
> （上游 tag 依赖，仓库里不留副本）。升级三步：改 tag → `cargo update -p glass-design` → 提交 `ui/Cargo.lock`。
> 0.10.0 带来玻璃效果三档；0.8.1 起覆盖式滚动条由库自己挂、`Row` 有 `wide`；
> 0.8.3 修滑块拇指与填充脱节。

首次构建要拉依赖并编译（约 2 分钟）。之后有缓存。

## 开发

```bash
node scripts/dev-run.mjs            # 构建 + 重启 + 截图到 .shots/dev.png
node scripts/dev-run.mjs --no-shot  # 只构建 + 重启
node scripts/devtools.mjs errors    # 抓控制台报错
node scripts/devtools.mjs shot x.png
node scripts/devtools.mjs eval "document.title"
```

两条容易踩的坑，`dev-run.mjs` 已经替你处理了：

1. **Tauri 把 `dist/` 编进 exe**，所以只跑 `build-ui.mjs` 是看不到变化的，必须重编宿主。
2. 调试端口只在构建期临时写进 `tauri.conf.json`，构建完立刻还原 —— 发布配置里没有它。

## 设计约定

- **控件从 `glass_design::prelude::*` 取**，不自建视觉。颜色、圆角、阴影、间距全部走令牌。
- **`app.css` 只写位置与尺寸**，不出现字面色值。
- **状态是 `RwSignal`，事件是 `Callback`**，页面里没有一句 DOM 操作。
- **`Card` 本身不带内边距**：行用 `Row`（自带内边距），其余内容套 `Pad`。
- **缩略图走批量通道**：`Thumbs::request` 登记需求，本帧末尾合并成一次 IPC。
- **网格分块渲染**（每块 300 张）+ 瓦片 `content-visibility`，1 万张不卡。

### 关于「玻璃折什么」

壁纸层 `#wallpaper` 用的是 `tokens.css` 里的合成渐变，**不截桌面**。

GlassDesign 的原方案是让宿主实时截「窗口背后的屏幕」喂给玻璃，代价是必须先给窗口挂
`WDA_EXCLUDEFROMCAPTURE`（否则截到的桌面里包含自己，会折出镜中镜）——而那个 API 会让
系统截图、录屏、任务栏预览一起拍不到 Lumina。对一个相册软件来说不划算，所以这里不截。

## 安装说明

- **系统要求**：Windows 10+，需安装 WebView2 Runtime（Windows 11 预装）
- **安装步骤**：双击安装器 → 选择安装目录 → 完成
- **数据隔离**：应用数据存储在图片文件夹下的 `.album/` 目录，卸载时不会删除用户数据

## 更新日志

完整历史见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

## 许可证

MIT
