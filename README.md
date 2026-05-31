# Photo Album — 本地相册管理工具

基于 Electron + SQLite 的本地图片管理应用。支持多文件夹管理、毛玻璃 UI、背景图自定义、Win11 风格界面。

![Platform](https://img.shields.io/badge/platform-Windows-blue) ![Electron](https://img.shields.io/badge/electron-33.x-9feaf9) ![License](https://img.shields.io/badge/license-MIT-green)

## ✨ 功能

- **多文件夹管理** — 同时管理多个图片文件夹，配置独立互不干扰
- **相册系统** — 子文件夹自动识别为相册，支持拖拽移动图片
- **图片浏览** — 网格/列表双模式，Lightbox 全屏预览、缩放、拖拽平移
- **发现页** — 瀑布流、随机抽卡（翻牌动画）、自动轮播
- **收藏 & 回收站** — 一键收藏，删除进回收站可恢复
- **主题系统** — 深色/浅色切换，强调色自定义，可从背景图自动提取
- **毛玻璃效果** — 侧边栏和卡片支持模糊/透明度独立调节
- **无边框窗口** — 隐藏 Electron 标题栏，自定义最小化/最大化/关闭按钮

## 🚀 安装与启动

### 环境要求
- [Node.js](https://nodejs.org) 18+
- Windows 10/11

### 快速启动

```bash
# 1. 克隆仓库
git clone https://github.com/GitHubemmm/PhotoAlbum-Electron.git
cd PhotoAlbum-Electron

# 2. 安装依赖
npm install

# 3. 构建前端
node build.js

# 4. 启动
npx electron .
```

### 或双击启动（推荐）

首次使用先运行 `npm install`，之后双击项目目录下的 **Photo Album.lnk**（快捷方式）即可一键打开。

## 🎨 使用说明

### 添加图片文件夹
启动后点击「选择图片文件夹」→ 浏览选择你的图片目录 → 自动加载所有图片

### 浏览图片
- 左侧导航切换「全部」「相册」「收藏」「发现」
- 点击图片进入 Lightbox 全屏预览
- 滚轮缩放，按住拖动平移，◀▶ 前后翻页，ESC 退出

### 相册管理
- 文件夹内的子文件夹自动识别为相册
- 右键图片 →「加入相册」→ 选择目标相册
- 右键相册 → 重命名 / 删除

### 设置
进入「设置」页面可调节：
- 主题：深色 / 浅色
- 强调色：Color Picker 或从背景图自动提取
- 背景图：导入、选择、模糊、透明度
- 侧边栏：宽度、字体大小、模糊、透明度
- 卡片：透明度、模糊
- 抽卡个数：1-10 张

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Electron 33 |
| 数据库 | SQLite (sql.js) |
| 前端 | Vanilla JS + CSS Custom Properties |
| 构建 | TypeScript + Node.js build script |
| 打包 | electron-builder（可选） |

## 📁 项目结构

```
src/
├── main/           # 主进程 (Electron)
│   ├── index.ts    # 窗口管理
│   ├── ipc/        # IPC 接口
│   ├── db/         # SQLite 数据库层
│   └── services/   # 扫描/缩略图/主题色
├── preload/        # 安全桥接
└── renderer/       # 渲染进程
    ├── index_cn.html  # HTML 模板
    ├── scripts/    # JS 模块
    │   ├── app.js       # 应用控制器
    │   ├── renderer.js  # 渲染器
    │   ├── settings.js  # 设置页
    │   ├── lightbox.js  # 图片查看器
    │   ├── state.js     # 状态管理
    │   └── ...
    └── styles/     # CSS 样式
```

## 🧪 测试

```bash
npm test
# 或
node test.js
```

自动测试覆盖：数据库迁移、设置持久化、Profile 隔离、扫描器。

## 📝 License

MIT © GitHubemmm
