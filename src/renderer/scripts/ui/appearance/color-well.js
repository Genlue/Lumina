// Golden Gate · appearance/color-well
import { h, clamp } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { spring } from '../../core/spring.js';
import { createDisposer } from '../_shared/disposer.js';
import { applyControlState } from '../_shared/control.js';
import { openLayer, positionLayer, focusableWithin } from '../_shared/overlay.js';
import { ACCENT_PRESETS } from './swatches.js';

/* ==========================================================================
   57. 颜色井 ColorWell

   原型：NSColorWell —— 一个方块色块，按下弹系统颜色面板。

   为什么不用 `Swatches`：那是一组「候选色」，选中即改值；ColorWell 是
   「当前值 + 打开取色器」，值可能是用户在面板里调出来的任意色。

   为什么颜色不能只存 hex：
   1) 色空间是有意义的 —— Display P3 的红和 sRGB 的红不是同一个颜色，
      把 P3 值塞进 `#rrggbb` 会当场掉色域；
   2) alpha 必须能和色值一起往返，`#rrggbb` 没有位置放它。
   所以内部统一存「三个 0–255 的通道 + 一个 space 标记 + alpha」，hex 只是
   给人类看的展示值：sRGB 下它是无损的，display-p3 下是经矩阵换算的近似值
   （超色域会被夹取），这一点在 value() 的注释里也写了。

   边界：
   - 屏幕取色（EyeDropper）是能力探测的，不支持就不渲染那颗按钮 —— 灰按钮
     比没有按钮更糟，用户会一直点它；
   - p3 的 CSS 输出在旧浏览器里会被 style 丢弃，此时只是「颜色退回默认」，
     不会报错，值本身仍然完整；
   - 面板是浮层，走 openLayer / positionLayer，不自己写 document 监听。
   ========================================================================== */

/* ---------------- 颜色数学 ---------------- */

// linear Display-P3 ↔ linear sRGB（D65）。矩阵取自 CSS Color 4 的参考实现。
const P3_TO_SRGB = [
  [1.2249401, -0.2249401, 0],
  [-0.0420569, 1.0420569, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];
const SRGB_TO_P3 = [
  [0.8224621, 0.177538, 0],
  [0.0331941, 0.9668058, 0],
  [0.0170827, 0.0723974, 0.9105199],
];

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** 在两个线性空间之间搬一次 8 位通道 */
function convert(rgb, matrix) {
  const lin = [rgb.r, rgb.g, rgb.b].map((v) => toLinear(clamp(v, 0, 255) / 255));
  const out = matrix.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
  return {
    r: toGamma(clamp(out[0], 0, 1)) * 255,
    g: toGamma(clamp(out[1], 0, 1)) * 255,
    b: toGamma(clamp(out[2], 0, 1)) * 255,
  };
}

function rgbToHsv(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max > 0 ? d / max : 0, v: max };
}

function hsvToRgb({ h: hue, s, v }) {
  // 360 与 0 是同一个红，取模后统一处理
  const hh = ((hue % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  };
}

function parseHex(text) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(String(text).trim());
  if (!m) return null;
  let d = m[1];
  if (d.length === 3 || d.length === 4) d = [...d].map((c) => c + c).join('');
  if (d.length !== 6 && d.length !== 8) return null;
  return {
    r: parseInt(d.slice(0, 2), 16),
    g: parseInt(d.slice(2, 4), 16),
    b: parseInt(d.slice(4, 6), 16),
    a: d.length === 8 ? parseInt(d.slice(6, 8), 16) / 255 : 1,
  };
}

/** `rgb(0 0 0 / 50%)` / `color(display-p3 1 0 0 / .5)` 的通道解析 */
function readComponents(body, scale) {
  const [main, alphaPart] = body.split('/');
  const parts = main.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p) => {
    const n = parseFloat(p);
    if (!Number.isFinite(n)) return NaN;
    return p.includes('%') ? n / 100 : n / scale;
  };
  const [r, g, b] = parts.slice(0, 3).map(num);
  if ([r, g, b].some((v) => !Number.isFinite(v))) return null;
  let a = 1;
  const raw = alphaPart ?? parts[3];
  if (raw != null && String(raw).trim()) {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) a = String(raw).includes('%') ? n / 100 : n;
  }
  return { r: clamp(r, 0, 1), g: clamp(g, 0, 1), b: clamp(b, 0, 1), a: clamp(a, 0, 1) };
}

/** 接受 hex / rgb() / color(display-p3 …) / { r,g,b,a,space }；解析不了返回 null */
function parseColor(input, fallbackSpace = 'srgb') {
  if (input && typeof input === 'object') {
    const r = Number(input.r);
    const g = Number(input.g);
    const b = Number(input.b);
    if (![r, g, b].every(Number.isFinite)) return null;
    const a = Number(input.a);
    return {
      r: clamp(r, 0, 255),
      g: clamp(g, 0, 255),
      b: clamp(b, 0, 255),
      a: Number.isFinite(a) ? clamp(a, 0, 1) : 1,
      space: input.space === 'display-p3' ? 'display-p3' : 'srgb',
    };
  }

  const text = String(input ?? '').trim().toLowerCase();
  if (!text) return null;

  const hex = parseHex(text);
  if (hex) return { ...hex, space: fallbackSpace };

  const p3 = /^color\(\s*display-p3\s+([^)]*)\)$/.exec(text);
  if (p3) {
    const c = readComponents(p3[1], 1);
    if (!c) return null;
    return { r: c.r * 255, g: c.g * 255, b: c.b * 255, a: c.a, space: 'display-p3' };
  }

  const rgbFn = /^rgba?\(([^)]*)\)$/.exec(text);
  if (rgbFn) {
    const c = readComponents(rgbFn[1], 255);
    if (!c) return null;
    return { r: c.r * 255, g: c.g * 255, b: c.b * 255, a: c.a, space: 'srgb' };
  }

  return null;
}

/** 展示用 hex：p3 下先换算到 sRGB 再取 8 位，超出色域会被夹取（有损） */
function displayHex(rgb, spaceName) {
  const c = spaceName === 'display-p3' ? convert(rgb, P3_TO_SRGB) : rgb;
  return (
    '#' +
    [c.r, c.g, c.b]
      .map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** 可直接塞进 style 的字符串；p3 用 color(display-p3 …)，通道是 0–1 */
function cssColor(rgb, a, spaceName) {
  const alpha = Math.round(a * 1000) / 1000;
  if (spaceName === 'display-p3') {
    const ch = (v) => (Math.round((clamp(v, 0, 255) / 255) * 10000) / 10000).toString();
    return `color(display-p3 ${ch(rgb.r)} ${ch(rgb.g)} ${ch(rgb.b)} / ${alpha})`;
  }
  return `rgb(${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)} / ${alpha})`;
}

/* ---------------- 控件 ---------------- */

export function ColorWell({
  value = '#0a84ff',
  space: spaceOpt = 'srgb',
  label = '颜色',
  disabled = false,
  invalid = false,
  showAlpha = true,
  presets,
  onChange,
  onInput,
  className = '',
} = {}) {
  const disposer = createDisposer();

  let space = spaceOpt === 'display-p3' ? 'display-p3' : 'srgb';
  let alpha = 1;
  let hsv = { h: 211, s: 1, v: 1 };
  let openFlag = false;
  let layer = null;
  let pos = null;
  let entry = null;
  let inputRaf = 0;
  let isDisabled = !!disabled;
  let isReadonly = false;

  const blocked = () => isDisabled || isReadonly;

  /* ---------------- DOM ---------------- */

  const fill = h('span', { class: 'c-colorwell__fill', 'aria-hidden': 'true' });
  // 根节点是 div 而不是 <button>：`value` 是 button 的原生属性（字符串），
  // 挂 el.value() 会被它吃成 "[object Function]"。复合控件统一用 role=button +
  // 自己的 Enter/Space 处理，状态由 applyControlState 落到 aria-disabled / tabindex。
  const well = h(
    'div',
    {
      class: `c-colorwell ${className}`.trim(),
      role: 'button',
      tabindex: '0',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-label': label,
      title: label,
    },
    fill
  );

  const svThumb = h('span', { class: 'c-colorpicker__thumb', 'aria-hidden': 'true' });
  const svPanel = h(
    'div',
    {
      class: 'c-colorpicker__sv',
      role: 'slider',
      tabindex: '0',
      'aria-label': '饱和度与亮度',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '100',
      'aria-valuetext': '饱和度 100%，亮度 100%',
    },
    // 白→透明 / 黑→透明 两层压在「当前色相」上。这里的三段 hsl 是颜色本身
    // （光谱），不是界面材质，所以不受令牌约束。
    h('span', { class: 'c-colorpicker__sv-white', 'aria-hidden': 'true' }),
    h('span', { class: 'c-colorpicker__sv-black', 'aria-hidden': 'true' }),
    svThumb
  );

  const hueThumb = h('span', { class: 'c-colorpicker__thumb', 'aria-hidden': 'true' });
  const hueBar = h(
    'div',
    {
      class: 'c-colorpicker__hue',
      role: 'slider',
      tabindex: '0',
      'aria-label': '色相',
      'aria-valuemin': '0',
      'aria-valuemax': '360',
      'aria-valuenow': '211',
      'aria-valuetext': '211 度',
    },
    hueThumb
  );

  const alphaFill = h('span', { class: 'c-colorpicker__alpha-fill', 'aria-hidden': 'true' });
  const alphaThumb = h('span', { class: 'c-colorpicker__thumb', 'aria-hidden': 'true' });
  const alphaBar = h(
    'div',
    {
      class: 'c-colorpicker__alpha',
      role: 'slider',
      tabindex: '0',
      'aria-label': '不透明度',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '100',
      'aria-valuetext': '100%',
    },
    alphaFill,
    alphaThumb
  );

  const hexInput = h('input', {
    class: 'c-colorpicker__hex',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': '十六进制颜色值',
    value: '#000000',
  });

  const RGB_LABELS = ['红', '绿', '蓝'];
  const rgbInputs = RGB_LABELS.map((name) =>
    h('input', {
      class: 'c-colorpicker__num',
      type: 'text',
      inputmode: 'numeric',
      maxlength: '3',
      autocomplete: 'off',
      'aria-label': `${name}色通道，0 到 255`,
      value: '0',
    })
  );

  const rgbRow = h(
    'div',
    { class: 'c-colorpicker__row c-colorpicker__rgbrow' },
    ...RGB_LABELS.map((name, i) =>
      h(
        'label',
        { class: 'c-colorpicker__field' },
        h('span', { class: 'c-colorpicker__fieldlabel' }, name),
        rgbInputs[i]
      )
    )
  );

  const presetList = (presets ?? ACCENT_PRESETS)
    .map((p) => (typeof p === 'string' ? { value: p, label: p.toUpperCase() } : p))
    .filter((p) => p && p.value);

  const presetRow = h(
    'div',
    { class: 'c-colorpicker__presets', role: 'group', 'aria-label': '预设颜色' },
    ...presetList.map((p) =>
      h('button', {
        class: 'c-colorpicker__preset',
        type: 'button',
        'aria-pressed': 'false',
        'aria-label': p.label || p.value,
        title: p.label || p.value,
        dataset: { hex: String(p.value).toLowerCase() },
        style: { '--sw': p.value },
      })
    )
  );

  const hexText = h('span', { class: 'c-colorpicker__hextext selectable' }, '#000000');
  const spaceTag = h('span', { class: 'c-colorpicker__space' }, 'sRGB');
  const foot = h(
    'div',
    { class: 'c-colorpicker__foot' },
    hexText,
    spaceTag
  );

  const hexRow = h('div', { class: 'c-colorpicker__row' }, hexInput);

  // 屏幕取色：探测不到就不长这颗按钮（灰按钮只会让人一直点）
  if (typeof window.EyeDropper === 'function') {
    hexRow.append(
      h('button', {
        class: 'c-colorpicker__eyedropper',
        type: 'button',
        'aria-label': '从屏幕取色',
        title: '从屏幕取色',
        html: icon('eye', 14),
        onclick: async () => {
          if (blocked()) return;
          try {
            const result = await new window.EyeDropper().open();
            const picked = parseHex(result?.sRGBHex || '');
            if (picked) applyColor({ ...picked, space: 'srgb' }, { notify: true });
          } catch {
            // 用户取消取色：静默恢复，不打断面板
          }
        },
      })
    );
  }

  const panel = h(
    'div',
    {
      class: 'c-colorpicker c-popover',
      role: 'dialog',
      'aria-label': `${label}取色器`,
      tabindex: '-1',
    },
    svPanel,
    hueBar
  );
  if (showAlpha) panel.append(alphaBar);
  panel.append(hexRow, rgbRow, presetRow, foot);

  /* ---------------- 状态落 DOM ---------------- */

  function paint() {
    const rgb = hsvToRgb(hsv);
    const hex = displayHex(rgb, space);
    const css = cssColor(rgb, alpha, space);
    const pct = Math.round(alpha * 100);
    const spaceName = space === 'display-p3' ? 'Display P3' : '';

    well.style.setProperty('--cw-color', css);

    const aria = `${label} ${hex.toUpperCase()}，不透明度 ${pct}%${spaceName ? `，${spaceName}` : ''}`;
    well.setAttribute('aria-label', aria);
    well.title = aria;

    panel.style.setProperty('--cw-color', css);
    svPanel.style.setProperty('--h', String(Math.round(hsv.h)));
    svThumb.style.left = `${(hsv.s * 100).toFixed(2)}%`;
    svThumb.style.top = `${((1 - hsv.v) * 100).toFixed(2)}%`;
    svPanel.setAttribute('aria-valuenow', String(Math.round(hsv.s * 100)));
    svPanel.setAttribute(
      'aria-valuetext',
      `饱和度 ${Math.round(hsv.s * 100)}%，亮度 ${Math.round(hsv.v * 100)}%`
    );

    hueThumb.style.left = `${((hsv.h / 360) * 100).toFixed(2)}%`;
    hueBar.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    hueBar.setAttribute('aria-valuetext', `${Math.round(hsv.h)} 度`);

    if (showAlpha) {
      alphaFill.style.background = `linear-gradient(to right, ${cssColor(rgb, 0, space)}, ${cssColor(rgb, 1, space)})`;
      alphaThumb.style.left = `${(alpha * 100).toFixed(2)}%`;
      alphaBar.setAttribute('aria-valuenow', String(pct));
      alphaBar.setAttribute('aria-valuetext', `${pct}%`);
    }

    // 正在编辑的框不要被覆盖，否则用户打到一半的字会被吃掉
    if (document.activeElement !== hexInput) hexInput.value = hex;
    const channels = [rgb.r, rgb.g, rgb.b];
    rgbInputs.forEach((inp, i) => {
      if (document.activeElement !== inp) inp.value = String(Math.round(channels[i]));
    });

    for (const btn of presetRow.children) {
      btn.setAttribute('aria-pressed', String(btn.dataset.hex === hex));
    }

    hexText.textContent = hex.toUpperCase();
    spaceTag.textContent = space === 'display-p3' ? 'Display P3' : 'sRGB';
  }

  /* ---------------- 值 ---------------- */

  function readValue() {
    const rgb = hsvToRgb(hsv);
    return {
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      a: alpha,
      space,
      // 注意：p3 下 hex 是有损的 sRGB 近似值，只用于展示 / 兼容老接口
      hex: displayHex(rgb, space),
      css: cssColor(rgb, alpha, space),
    };
  }

  function setHsv(next) {
    hsv = { ...hsv, ...next };
    paint();
  }

  function applyColor(color, { notify = false } = {}) {
    if (!color) return false;
    const prevHue = hsv.h;
    space = color.space;
    alpha = color.a;
    const next = rgbToHsv(color.r, color.g, color.b);
    // 灰阶没有色相，保留上一次的 —— 否则把亮度拖到 0 再拖回来会变成红色
    hsv = { h: next.s === 0 ? prevHue : next.h, s: next.s, v: next.v };
    paint();
    if (notify && !blocked()) {
      onInput?.(readValue());
      onChange?.(readValue());
    }
    return true;
  }

  function commitPatch(patch, { live = false } = {}) {
    if (blocked()) return;
    setHsv(patch);
    if (live) emitInput();
    else {
      onInput?.(readValue());
      onChange?.(readValue());
    }
  }

  function emitInput() {
    if (inputRaf) return;
    inputRaf = requestAnimationFrame(() => {
      inputRaf = 0;
      onInput?.(readValue());
    });
  }

  function emitChange() {
    if (blocked()) return;
    onChange?.(readValue());
  }

  function applyRgb(r, g, b) {
    if (blocked()) return;
    const next = rgbToHsv(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
    hsv = { h: next.s === 0 ? hsv.h : next.h, s: next.s, v: next.v };
    paint();
    onInput?.(readValue());
    onChange?.(readValue());
  }

  function setAlpha(next, { live = false } = {}) {
    if (blocked()) return;
    alpha = clamp(next, 0, 1);
    paint();
    if (live) emitInput();
    else {
      onInput?.(readValue());
      onChange?.(readValue());
    }
  }

  /* ---------------- 输入框提交 ---------------- */

  function flashInvalid(input) {
    input.dataset.invalid = '1';
    input.setAttribute('aria-invalid', 'true');
    disposer.timeout(() => {
      delete input.dataset.invalid;
      input.setAttribute('aria-invalid', 'false');
    }, 520);
  }

  function commitHex() {
    const current = readValue();
    if (blocked()) {
      hexInput.value = current.hex;
      return;
    }
    const text = hexInput.value.trim();
    const parsed = parseHex(text);
    if (!parsed) {
      hexInput.value = current.hex;
      flashInvalid(hexInput);
      return;
    }
    // 没有 alpha 位的写法沿用当前不透明度，不要因为「改了颜色」把透明度重置成 100%
    const hasAlpha = /^#[0-9a-f]{4}$/i.test(text) || /^#[0-9a-f]{8}$/i.test(text);
    const nextAlpha = hasAlpha ? parsed.a : alpha;
    // 失焦提交时值没变就别再发一轮事件：点进点出不该产生 onChange
    if (
      Math.round(parsed.r) === Math.round(current.r) &&
      Math.round(parsed.g) === Math.round(current.g) &&
      Math.round(parsed.b) === Math.round(current.b) &&
      Math.abs(nextAlpha - current.a) < 1e-6
    ) {
      hexInput.value = current.hex;
      return;
    }
    alpha = nextAlpha;
    applyRgb(parsed.r, parsed.g, parsed.b);
    hexInput.value = readValue().hex;
  }

  function commitRgb(index) {
    const input = rgbInputs[index];
    const now = hsvToRgb(hsv);
    if (blocked()) {
      input.value = String(Math.round([now.r, now.g, now.b][index]));
      return;
    }
    const raw = input.value.trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) {
      input.value = String(Math.round([now.r, now.g, now.b][index]));
      flashInvalid(input);
      return;
    }
    const ch = [now.r, now.g, now.b];
    ch[index] = Math.round(clamp(n, 0, 255));
    // 同上：光标进出这个框不该改值，也不该触发回调
    if (ch.every((v, i) => v === Math.round([now.r, now.g, now.b][i]))) {
      input.value = String(ch[index]);
      return;
    }
    applyRgb(ch[0], ch[1], ch[2]);
    input.value = String(Math.round(hsvToRgb(hsv)[['r', 'g', 'b'][index]]));
  }

  /* ---------------- 指针拖动 ---------------- */

  /**
   * 三个条共用一套按压逻辑：按下即取值、指针捕获后跟手、松手才 onChange。
   * 监听挂在元素自己身上（靠 setPointerCapture 收 move），不用 document。
   */
  function bindDrag(target, apply, { onEnd } = {}) {
    let active = false;

    disposer.on(target, 'pointerdown', (e) => {
      if (blocked()) return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      active = true;
      target.focus({ preventScroll: true });
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // 某些环境（合成事件）没有 pointerId，退化成普通拖动
      }
      apply(e);
    });

    disposer.on(target, 'pointermove', (e) => {
      if (active) apply(e);
    });

    const end = (e) => {
      if (!active) return;
      active = false;
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {}
      onEnd?.();
    };

    disposer.on(target, 'pointerup', end);
    disposer.on(target, 'pointercancel', end);
    disposer.on(target, 'lostpointercapture', () => {
      if (!active) return;
      active = false;
      onEnd?.();
    });
  }

  const ratio = (el, e, axis) => {
    const r = el.getBoundingClientRect();
    const span = axis === 'y' ? r.height : r.width;
    if (!span) return 0;
    return clamp((axis === 'y' ? e.clientY - r.top : e.clientX - r.left) / span, 0, 1);
  };

  bindDrag(
    svPanel,
    (e) => {
      const s = ratio(svPanel, e, 'x');
      const v = 1 - ratio(svPanel, e, 'y');
      commitPatch({ s, v }, { live: true });
    },
    { onEnd: emitChange }
  );

  bindDrag(
    hueBar,
    (e) => commitPatch({ h: Math.round(ratio(hueBar, e, 'x') * 360) }, { live: true }),
    { onEnd: emitChange }
  );

  if (showAlpha) {
    bindDrag(
      alphaBar,
      (e) => setAlpha(Math.round(ratio(alphaBar, e, 'x') * 100) / 100, { live: true }),
      { onEnd: emitChange }
    );
  }

  /* ---------------- 键盘 ---------------- */

  disposer.on(svPanel, 'keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    let patch = null;
    if (e.key === 'ArrowLeft') patch = { s: clamp(hsv.s - step, 0, 1) };
    else if (e.key === 'ArrowRight') patch = { s: clamp(hsv.s + step, 0, 1) };
    else if (e.key === 'ArrowUp') patch = { v: clamp(hsv.v + step, 0, 1) };
    else if (e.key === 'ArrowDown') patch = { v: clamp(hsv.v - step, 0, 1) };
    if (!patch) return;
    e.preventDefault();
    commitPatch(patch);
  });

  disposer.on(hueBar, 'keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    let next = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = hsv.h - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = hsv.h + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 360;
    if (next == null) return;
    e.preventDefault();
    commitPatch({ h: clamp(next, 0, 360) });
  });

  if (showAlpha) {
    disposer.on(alphaBar, 'keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      let next = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = alpha - step;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = alpha + step;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = 1;
      if (next == null) return;
      e.preventDefault();
      setAlpha(next);
    });
  }

  disposer.on(hexInput, 'keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitHex();
      hexInput.select?.();
    } else if (e.key === 'Escape') {
      // 不 stopPropagation：Esc 仍然要把整个面板收起
      hexInput.value = readValue().hex;
    }
  });
  disposer.on(hexInput, 'blur', commitHex);

  rgbInputs.forEach((input, i) => {
    disposer.on(input, 'keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRgb(i);
        input.select?.();
      } else if (e.key === 'Escape') {
        input.value = String(Math.round(hsvToRgb(hsv)[['r', 'g', 'b'][i]]));
      }
    });
    disposer.on(input, 'blur', () => commitRgb(i));
  });

  disposer.on(presetRow, 'click', (e) => {
    const btn = e.target.closest('.c-colorpicker__preset');
    if (!btn || blocked()) return;
    const parsed = parseColor(btn.dataset.hex, space);
    if (parsed) applyColor(parsed, { notify: true });
  });

  /* ---------------- 开合 ---------------- */

  function handleClose() {
    openFlag = false;
    layer = null;
    pos?.stop();
    pos = null;
    entry?.stop();
    entry = null;
    panel.remove();
    well.setAttribute('aria-expanded', 'false');
  }

  function open() {
    // 只读仍可打开看值，只是改不动；禁用则连面板都不给开
    if (isDisabled || openFlag || disposer.disposed) return;
    document.body.append(panel);
    openFlag = true;

    layer = openLayer({
      el: panel,
      container: panel,
      modal: false,
      dismissible: true,
      outside: true,
      // 点井本身不算「外面」，否则刚点开就被自己关掉
      ignore: [well],
      initialFocus: 'none',
      onClose: handleClose,
    });
    panel.style.zIndex = String(900 + layer.level * 20);

    pos = positionLayer(panel, {
      anchor: well,
      placement: 'bottom',
      align: 'start',
      gap: 6,
      onHidden: () => layer?.close('hidden'),
    });

    well.setAttribute('aria-expanded', 'true');

    panel.style.opacity = '0';
    panel.style.transform = 'scale(0.97)';
    entry = spring({
      from: 0,
      to: 1,
      damping: 1,
      response: 0.22,
      onUpdate: (t) => {
        panel.style.opacity = String(t);
        panel.style.transform = `scale(${0.97 + 0.03 * t})`;
      },
    });
  }

  function close() {
    if (!openFlag) return;
    if (layer) layer.close('api');
    else handleClose();
  }

  disposer.on(well, 'click', () => {
    if (isDisabled) return;
    if (openFlag) close();
    else open();
  });

  disposer.on(well, 'keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      // 自己消化，避免浏览器再补一次 click 把面板「开了又关」
      e.preventDefault();
      if (isDisabled) return;
      if (openFlag) close();
      else open();
      return;
    }
    // 面板开着时 Tab 直接进面板：它是 body 末尾的浮层，按 DOM 顺序够不到
    if (e.key === 'Tab' && openFlag && !e.shiftKey) {
      const first = focusableWithin(panel)[0];
      if (first) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
  });

  /* ---------------- 对外 API ---------------- */

  const initial = parseColor(value, space) ?? { r: 10, g: 132, b: 255, a: 1, space };
  space = initial.space;
  alpha = initial.a;
  hsv = (() => {
    const next = rgbToHsv(initial.r, initial.g, initial.b);
    return { h: next.h, s: next.s, v: next.v };
  })();

  well.set = (v) => {
    const parsed = parseColor(v, space);
    if (!parsed) return;
    applyColor(parsed, { notify: false });
  };
  well.value = readValue;
  well.setDisabled = (v) => {
    isDisabled = !!v;
    applyControlState(well, { disabled: isDisabled });
    if (isDisabled) close();
  };
  well.setInvalid = (v) => applyControlState(well, { invalid: v });
  well.setReadonly = (v) => {
    isReadonly = !!v;
    applyControlState(well, { readonly: isReadonly });
    panel.setAttribute('aria-readonly', String(isReadonly));
  };
  well.open = open;
  well.close = close;
  well.isOpen = () => openFlag;
  well.panel = panel;
  // 面板里的 hex 输入框是「真正的值入口」，对外暴露给需要接管焦点的场景
  well.input = hexInput;
  well.dispose = () => {
    if (disposer.disposed) return;
    close();
    disposer.dispose();
  };

  applyControlState(well, { disabled: isDisabled });
  applyControlState(well, { invalid: !!invalid });
  paint();

  disposer.add(() => {
    if (inputRaf) cancelAnimationFrame(inputRaf);
    inputRaf = 0;
    entry?.stop();
    panel.remove();
  });

  return well;
}
