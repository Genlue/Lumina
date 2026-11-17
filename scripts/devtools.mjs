#!/usr/bin/env node
// 用 WebView2 的远程调试端口看界面：截图 + 抓控制台报错 + 求值。
//
// 用法：
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 ./lumina.exe
//   node scripts/devtools.mjs shot .shots/ui.png
//   node scripts/devtools.mjs errors
//   node scripts/devtools.mjs eval "document.title"
//
// 为什么不直接截屏：窗口被遮挡时 PrintWindow 对 WebView2 会返回全白，
// CDP 的 Page.captureScreenshot 抓的是合成结果，与窗口前后台无关。

const PORT = process.env.CDP_PORT || 9222;

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return res.json();
}

async function pickPage() {
  const list = await targets();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有 page 目标，应用启动了吗？');
  return page;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error(`WebSocket 连接失败：${e.message || e.type}`));
  });
}

function rpc(ws) {
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  return {
    events,
    send(method, params = {}) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [cmd, ...rest] = process.argv.slice(2);

const page = await pickPage();
const ws = await connect(page.webSocketDebuggerUrl);
const c = rpc(ws);

await c.send('Runtime.enable');
await c.send('Log.enable');
await c.send('Page.enable');
await sleep(1200);

if (cmd === 'shot') {
  const out = rest[0] || '.shots/ui.png';
  const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(`saved ${out}`);
} else if (cmd === 'errors') {
  const bad = c.events.filter(
    (e) =>
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
      (e.method === 'Runtime.exceptionThrown') ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'),
  );
  if (!bad.length) {
    console.log('控制台零 error');
  } else {
    for (const e of bad) {
      const p = e.params;
      const text =
        p.entry?.text ||
        p.exceptionDetails?.exception?.description ||
        p.args?.map((a) => a.value ?? a.description).join(' ');
      console.log(`[${e.method}] ${text}`);
    }
  }
} else if (cmd === 'eval') {
  const expr = rest.join(' ');
  const r = await c.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    console.log('EXCEPTION:', r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  } else {
    console.log(JSON.stringify(r.result.value, null, 2));
  }
} else {
  console.log('用法：shot <path> | errors | eval <expr>');
}

ws.close();
