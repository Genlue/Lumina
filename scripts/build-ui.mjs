#!/usr/bin/env node
// 构建前端：cargo build (wasm32) → wasm-bindgen → dist/
//
// 为什么要一个 node 脚本而不是 beforeDevCommand 里的裸命令：
// Windows 上 tauri 用 cmd 起子进程，引号与路径分隔符在两个 shell 里行为不同。
//
// 产物目录是 `dist/`，不是 `ui/`：Tauri 会把 frontendDist 整个目录打进包，
// 如果指向 `ui/`，`ui/target`（几百 MB）会被一起塞进安装包。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, cpSync, statSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const ui = join(root, 'ui');
const dist = join(root, 'dist');
const pkg = join(dist, 'pkg');
const wasmName = 'lumina_ui.wasm';

const profile = process.argv.includes('--debug') ? 'debug' : 'release';
const profileArgs = profile === 'release' ? ['--release'] : [];

function run(cmd, args, cwd) {
  process.stdout.write(`\n$ ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    process.stderr.write(`\n[build-ui] 失败：${cmd} ${args.join(' ')}\n`);
    process.exit(r.status ?? 1);
  }
}

// 1. wasm
run('cargo', ['build', '--target', 'wasm32-unknown-unknown', ...profileArgs], ui);

// 2. wasm-bindgen。两个 --remove-* 不能省，否则 wasm 多 24 MB 符号名。
const wasmPath = join(ui, 'target', 'wasm32-unknown-unknown', profile, wasmName);
if (!existsSync(wasmPath)) {
  process.stderr.write(`[build-ui] 找不到 ${wasmPath}\n`);
  process.exit(1);
}
rmSync(pkg, { recursive: true, force: true });
mkdirSync(pkg, { recursive: true });
run('wasm-bindgen', [
  '--target', 'web',
  '--no-typescript',
  '--remove-name-section',
  '--remove-producers-section',
  '--out-dir', pkg,
  wasmPath,
], ui);

// 3. 页面外壳与样式
for (const f of ['index.html', 'app.css']) {
  const src = join(ui, f);
  if (existsSync(src)) copyFileSync(src, join(dist, f));
}

// 4. 图标（favicon）
const icons = join(root, 'src', 'renderer', 'assets');
if (existsSync(icons)) cpSync(icons, join(dist, 'assets'), { recursive: true });

const kb = (p) => (existsSync(p) ? `${(statSync(p).size / 1024).toFixed(1)} KB` : '—');
process.stdout.write(
  `\n[build-ui] 完成（${profile}）\n` +
  `  dist/pkg/lumina_ui_bg.wasm   ${kb(join(pkg, 'lumina_ui_bg.wasm'))}\n` +
  `  dist/pkg/lumina_ui.js        ${kb(join(pkg, 'lumina_ui.js'))}\n`,
);
