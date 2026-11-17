#!/usr/bin/env node
// 开发循环：改完前端 → 一条命令看到界面。
//
// Tauri 会把 frontendDist 整个目录**编进 exe**，所以只跑 build-ui.mjs
// 是看不到变化的：必须重编宿主二进制。
//
//   node scripts/dev-run.mjs            构建 + 重启 + 截图
//   node scripts/dev-run.mjs --no-shot  只构建 + 重启

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const exe = join(root, 'src-tauri', 'target', 'debug', 'lumina.exe');
const shot = !process.argv.includes('--no-shot');

function sh(cmd, args, cwd) {
  process.stdout.write(`$ ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 1. 先关掉，否则 cargo 写不进 exe（os error 5）
spawnSync('taskkill', ['/F', '/IM', 'lumina.exe'], { stdio: 'ignore', shell: true });

// 2. 前端
sh('node', [join(root, 'scripts', 'build-ui.mjs')], root);

// 3. 宿主（把 dist 编进去）
//
// 调试端口只在**这一份临时配置**里出现：`cargo build` 会把 tauri.conf.json
// 编进 exe，所以构建时临时打开、构建完立刻还原。发布配置里永远没有这个端口。
const confPath = join(root, 'src-tauri', 'tauri.conf.json');
const confOriginal = readFileSync(confPath, 'utf8');
try {
  const conf = JSON.parse(confOriginal);
  conf.app.windows[0].additionalBrowserArgs = '--remote-debugging-port=9222';
  writeFileSync(confPath, JSON.stringify(conf, null, 2));
  sh('cargo', ['build'], join(root, 'src-tauri'));
} finally {
  writeFileSync(confPath, confOriginal);
}

// 4. 起进程
if (!existsSync(exe)) {
  process.stderr.write(`找不到 ${exe}\n`);
  process.exit(1);
}
const child = spawn(exe, [], {
  cwd: dirname(exe),
  detached: true,
  stdio: 'ignore',
  shell: false,
});
child.unref();

// 5. 等 CDP 就绪
const t0 = Date.now();
let up = false;
while (Date.now() - t0 < 20000) {
  try {
    const r = await fetch('http://127.0.0.1:9222/json');
    if (r.ok) {
      up = true;
      break;
    }
  } catch {
    /* 还没起 */
  }
  await new Promise((r) => setTimeout(r, 400));
}
if (!up) {
  process.stderr.write('调试端口没起来，检查 tauri.conf.json 的 additionalBrowserArgs\n');
  process.exit(1);
}
// 首屏扫描要一点时间，等数据落定
await new Promise((r) => setTimeout(r, 3500));

if (shot) {
  sh('node', [join(root, 'scripts', 'devtools.mjs'), 'shot', '.shots/dev.png'], root);
}
process.stdout.write('就绪\n');
