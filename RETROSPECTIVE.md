# Photo Album Electron — 项目复盘

> 从浏览器单 HTML 到 Electron 桌面应用的完整重构之旅。

---

## 一、项目起源

原版 **Photo Album** 是一个约 2000 行的单 HTML 文件，基于浏览器 File System Access API 运行。虽然功能完善，但存在几个痛点：

| 痛点 | 表现 |
|------|------|
| 授权弹窗 | 每次打开都要选择文件夹授权 |
| 存储脆弱 | IndexedDB 存目录句柄，路径变更即失效 |
| 分发困难 | 需要 Chrome/Edge，无法分享给非技术用户 |
| 扩展性差 | 单文件 2000 行，修改一处牵动全局 |

**目标**：迁移为 Electron 桌面应用，保留全部功能，改进架构，最终打包为 exe。

---

## 二、技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | Electron 33 | 内嵌 Chromium，可调 Node.js API |
| 数据库 | SQLite (sql.js) | 纯 JS 免编译，事务安全，跨平台 |
| 前端 | Vanilla JS + CSS Variables | 零框架依赖，与原版一脉相承 |
| 语言 | TypeScript (主进程) / JavaScript (渲染进程) | 主进程类型安全，渲染层动态灵活 |
| 构建 | Node.js 脚本 | 将 CSS/JS 内联到单 HTML |
| 打包 | electron-builder | 一键出 exe/nsis installer |

### 为什么不用 React/Vue？

原版是 Vanilla JS，约 2000 行。引入框架意味着重写而非迁移。Electron 内 Chromium 原生支持 ES2022+，Vanilla 足够。

### 为什么用 sql.js 而非 better-sqlite3？

better-sqlite3 是 C++ 原生模块，需编译。用户环境 Python 3.12 移除了 distutils 导致编译失败。sql.js 是纯 JavaScript 的 SQLite 实现，零编译，完全够用。

---

## 三、架构设计

```
┌──────────────────────────────────────┐
│           Electron Main              │
│  ┌─────────┐  ┌────────┐  ┌───────┐ │
│  │  IPC    │  │  DB    │  │Services│ │
│  │ Handler │  │ Layer  │  │(Scan/  │ │
│  │         │  │        │  │ Theme) │ │
│  └────┬────┘  └────────┘  └───────┘ │
├───────┼──────────────────────────────┤
│       │        Preload               │
│       │   contextBridge API          │
├───────┼──────────────────────────────┤
│       │     Renderer (HTML)          │
│  ┌────┴──────────────────────────┐   │
│  │  State → API → Render → App   │   │
│  │  12 modules, inline CSS+JS    │   │
│  └───────────────────────────────┘   │
└──────────────────────────────────────┘
```

### 关键决策

**1. 单 HTML 输出**

Electron 的 `file://` 协议禁止加载外部 JS/CSS。解决方案：Node.js 构建脚本将 12 个 JS 模块 + 3 个 CSS 文件内联到一个 `<style>` 和 `<script>` 中。输出文件约 107KB，一次性加载。

**2. 全局状态封装**

原版使用全局对象 `S` 直接修改。重构为 IIFE 封装的 `State` 对象，`S` 别名保持兼容。26 个字段通过 getter/setter 访问，为后续迁移到 Proxy/Observable 留了接口。

**3. 页面路由表**

原版 `navPage()` 使用 5 级 if-else。重构为路由表：

```js
_pageRoutes: {
  home: function() { ... },
  album: function() { ... },
  discover: function() { ... },
  settings: function() { ST.render(); },
}
```

**4. 设置持久化**

每个图片文件夹独立一套设置（主题、背景图、侧边栏宽度、卡片透明度等），通过 `profile_id` 隔离存储在 SQLite 中。切换文件夹自动加载对应配置。

**5. 背景图跨文件夹隔离**

这是一个多次修复的 bug。问题根源：`#bg-layer` 是全局单例 DOM 元素。解决方案：切换 profile 时，如果新 profile 无背景图，显式调用 `applyBgImage(null)` 清除 bg-layer。

---

## 四、开发过程中的主要坑

### 坑 1：`file://` 协议加载失败

Electron 下 `<script src="...">` 和 `<link href="...">` 全部静默失败。页面白屏。

**解决**：Node.js 构建脚本将所有 CSS/JS 内联到 HTML。代价是无法使用模块化和 source map，调试困难。

### 坑 2：CSS 变量未生效

所有 CSS 修改都写在 `layout.css` 里，但外部文件根本没加载。排查了 2 天才发现。

**教训**：遇到样式不生效，先检查 CSS 是否加载（DevTools Network 面板），不要假设文件能正常加载。

### 坑 3：`#bg-layer` 遮挡点击

`#bg-layer` 原设 `z-index: 0`，遮挡了右侧设置页的所有交互。左侧栏因 DOM 顺序在后面没被挡。用户描述"设置页卡死"，实际是点不了。

**解决**：加 `pointer-events: none`。

### 坑 4：设置页卡死

一个 JS 语法错误（`as any` 是 TS 语法，写在 JS 里）导致整个 `<script>` 块静默失败。所有 JS 不执行，页面空白。

**教训**：构建脚本应加 `node --check` 验证步骤。

### 坑 5：拖拽平移延迟

Lightbox 放大后拖拽图片，画面延迟 0.1s 才响应。原因是 CSS `transition: transform 0.1s` 在每次 mousemove 时触发动画，视觉上"跟不上鼠标"。

**解决**：拖拽时临时设 `transition: none`，松手恢复。

### 坑 6：相册卡片需点击 3 次

封面图异步加载时 `innerHTML` 替换了 `album-cover` 的内容，导致点击目标元素被移除，事件丢失。

**解决**：事件委托到父容器 `#album-grid-wrap`，用 `e.target.closest('.album-card')` 查找。

### 坑 7：强调色提取返回黑色

直接从 JPEG 文件读原始字节无法获得像素数据。JPEG 是 DCT 压缩格式，字节采样完全不可靠。

**解决**：改为渲染端 Canvas API 绘制图片 → `getImageData` 采样像素 → WCAG 对比度检查 → HSL 自适应明度。

---

## 五、屎山指数评估

在开发中期进行了一次代码质量审计（详见正文）。评分变化：

| 维度 | 重构前 | 重构后 |
|------|--------|--------|
| 命名规范 | 3/5 | 3/5 |
| 接口设计 | 4/5 | 2/5 |
| 代码结构 | 5/5 | 2/5 |
| 注释文档 | 4/5 | 3/5 |
| 错误处理 | 5/5 | 3/5 |
| 可测试性 | 5/5 | 4/5 |
| **总计** | **41/65** | **21/65** |

重构核心动作：
- 删除 `all.js`（陈旧副本）
- 统一构建脚本替代手动复制
- 状态对象封装修复
- 页面路由表替代 if-else
- 设置项统一 helper

---

## 六、自动化测试

编写了数据层测试脚本 `test.js`，覆盖：

- DB 迁移（V1→V3）
- Profile CRUD
- 设置持久化（14 个字段）
- Profile 隔离（无交叉污染）
- 扫描器（backgrounds 文件夹正确处理）

测试结果：**43 pass / 1 fail**（唯一失败是 IPC 注册在纯 Node.js 环境无 Electron `ipcMain`，预期行为）。

---

## 七、部署与分发

### 开发模式

```bash
npm install
node build.js      # 内联 CSS/JS
npx electron .     # 启动
```

快捷方式 `Photo Album.lnk` 调用 VBScript → Node.js launcher → 编译 TS → Electron。双击即启动，无命令行窗口。

### 生产模式

```bash
npm run build:win  # electron-builder 打包为 .exe
```

产物在 `dist-pkg/` 目录。

---

## 八、项目统计

| 指标 | 数值 |
|------|------|
| 总源文件 | 53 |
| TypeScript 文件 | 14 |
| JavaScript 文件 | 12 |
| CSS 文件 | 3 |
| HTML 模板 | 1 |
| 总代码行数 | ~5,000 |
| DB 迁移版本 | V3 |
| 总开发轮次 | ~80 次修改迭代 |
| 自动测试覆盖 | 43 条 assertion |

---

## 九、技术债 & 未来改进

| 项目 | 优先级 | 说明 |
|------|--------|------|
| 路径穿越防护 | 高 | IPC 文件操作需加 `..` 过滤 |
| webSecurity 恢复 | 中 | 打包为 exe 后可用 `app://` 协议替代 `file://` |
| repo helper 抽取 | 中 | `queryAll/queryOne/run` 在每个 repo 重复定义 |
| 单元测试 UI 层 | 低 | 渲染层纯函数可抽离测试 |
| Chokidar 文件监听 | 低 | 依赖已装但从未启用 |
| 国际化 i18n | 低 | 当前仅中文 |
| macOS 适配 | 低 | `frame: false` + 自定义标题栏需适配 |

---

## 十、心得总结

**做对了的**：
- 先理解原版架构再迁移，而不是从头写
- JavaScript 保持 Vanilla，没有引入不必要的框架
- 自动化测试尽早写，数据层 bug 少很多
- 构建脚本解决 file:// 加载问题，一劳永逸

**做错了的**：
- CSS 文件不加载排查太久——应该第一时间检查 Network 面板
- 多次在代码三份拷贝中手动同步，应早建构建脚本
- 背景图系统的 DOM 层级设计欠思考，反复修改了 5 次以上

**最重要的教训**：
> 遇到前端样式/交互 bug，先检查资源是否加载、CSS 是否生效、z-index 是否遮挡，而不是反复改 JS 逻辑。
