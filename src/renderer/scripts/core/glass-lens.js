// ============================================================
// Lumina · Glass Lens
// 把一块玻璃挂到 DOM 上。**背板由合成器提供，不自己画。**
//
//   旧：glass-texture 用 canvas 把 DOM 背景重画一遍 → 假背板 → WebGL 逐像素算
//   新：backdrop-filter 直接拿合成器输出 → SVG 滤镜做光学
//
// 为什么必须换：玻璃背后到底是什么，只有合成器知道。文字、图片、伪元素、
// pointer-events:none 的装饰层、opacity、filter、混合模式 —— 重画一遍永远会漏。
// 最刺眼的一处是顶栏胶囊采不到 .c-topveil（它 pointer-events:none，
// 进不了 elementsFromPoint），于是胶囊是灰的、旁边那条渐进模糊是紫的。
//
// 一条玻璃 = 两样东西：
//   ① backdrop-filter: blur(B) url(#filter)  —— 背板 + 折射 + 色散 + 涂层 + 高光
//   ② 一个 <filter>，只依赖形状与参数（见 glass-optics.js）
// 没有 canvas、没有 rAF、没有滚动监听 —— 背板变了合成器自己会重算。
// ============================================================

import { resolveGlassShape } from './glass-shape.js';
import {
  normalizeGlassOptics,
  glassMapSize,
  glassDisplacementField,
  glassHighlightField,
  glassDisplacementScale,
} from './glass-optics.js';
import { theme, GLASS_SURFACES } from './theme.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 位移贴图最长边（px）。太小边缘会有台阶，太大拖慢生成 */
const MAP_MAX = 512;
/** 高光贴图最长边。它是一圈软边，不需要高分辨率 */
const HL_MAX = 320;

/**
 * 每块玻璃的静止模糊半径来自 CSS 的材质令牌，这里只是把它读出来 ——
 * 不另存一份色值/尺寸，改令牌时玻璃跟着变。
 * （custom property 是 calc()，不能直接读成数值，所以用一个零尺寸探针解一次。）
 */
const BLUR_EXPR = {
  chrome: 'calc(var(--m-chrome-blur) * var(--glass-blur-k, 1))',
  panel: 'calc(var(--m-panel-blur) * var(--glass-blur-k, 1))',
  capsule: 'calc(var(--m-popover-blur) * var(--glass-blur-k, 1))',
  menu: 'calc(var(--m-popover-blur) * var(--glass-blur-k, 1))',
  toast: 'calc(var(--m-popover-blur) * var(--glass-blur-k, 1))',
  sheet: 'calc(var(--m-sheet-blur) * var(--glass-blur-k, 1))',
  // 拇指的模糊由 CSS 自己管：--thumb-blur-px 里已经含 blur-k，
  // 而且按下时会收到 0（见 .c-slider[data-dragging]）—— 所以这里不再乘一次。
  thumb: 'var(--thumb-blur-px)',
};

const BLUR_TOKEN = {
  chrome: '--m-chrome-blur',
  panel: '--m-panel-blur',
  capsule: '--m-popover-blur',
  menu: '--m-popover-blur',
  toast: '--m-popover-blur',
  sheet: '--m-sheet-blur',
};

/* ---------------- 贴图编码 ---------------- */

const mapCache = new Map();
let svgHost = null;
let seq = 0;
let nativeOk = null;

const cacheSet = (key, url) => {
  if (mapCache.size > 64) mapCache.clear();
  mapCache.set(key, url);
  return url;
};

function encode(data, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

function displacementMap(shape, p) {
  const key = `d|${shape.w}|${shape.h}|${shape.radius}|${shape.verts ? shape.verts.join(',') : ''}|${p.band}|${p.depth}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const [mw, mh] = glassMapSize(shape, MAP_MAX);
  return cacheSet(key, encode(glassDisplacementField(shape, p, mw, mh), mw, mh));
}

function highlightMap(shape, p) {
  const key = `h|${shape.w}|${shape.h}|${shape.radius}|${shape.verts ? shape.verts.join(',') : ''}|${p.strokeHalf}|${p.strokeFeather}|${p.strokeAlpha}|${p.falloff}|${p.light}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const [mw, mh] = glassMapSize(shape, HL_MAX);
  return cacheSet(key, encode(glassHighlightField(shape, p, mw, mh), mw, mh));
}

/* ---------------- 滤镜 ---------------- */

function hostSvg() {
  if (svgHost && svgHost.isConnected) return svgHost;
  svgHost = document.createElementNS(SVG_NS, 'svg');
  svgHost.setAttribute('width', '0');
  svgHost.setAttribute('height', '0');
  svgHost.setAttribute('aria-hidden', 'true');
  svgHost.setAttribute('focusable', 'false');
  svgHost.id = 'gg-glass-filters';
  svgHost.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  document.body.append(svgHost);
  return svgHost;
}

/**
 * 建/更新一块玻璃的滤镜。
 *
 * 两个 feImage 用**用户坐标（px）**定位，不用百分比：
 * 百分比在 Chrome 里相对的是元素框而不是滤镜区域，写成 55.6% 会让贴图只盖住
 * 左边一半 —— 右半边 feDisplacementMap 拿到透明图，整块变黑。
 *
 * 滤镜区域 = 元素框本身，**不外扩**：外扩会让框外那一圈拿到透明贴图，
 * 于是玻璃外面多出一圈被平移过的背板，把旁边的文字糊出重影。
 * 而位移需要的框外像素，合成器本来就给了。
 */
function buildFilter(id, shape, p) {
  const svg = hostSvg();
  const refracts = p.amount > 0 && p.band > 0;
  const wantDispersion = refracts && p.dispersion > 0.001;
  let node = svg.querySelector(`#${id}`);

  // 色散要三通道各自位移，是另一条链路；不需要时用短的那条，别白算 8 个原语
  const mode = wantDispersion ? 'disp' : 'plain';
  if (node && node.dataset.mode !== mode) {
    node.remove();
    node = null;
  }

  if (!node) {
    node = document.createElementNS(SVG_NS, 'filter');
    node.id = id;
    node.dataset.mode = mode;
    node.setAttribute('color-interpolation-filters', 'sRGB');
    node.setAttribute('x', '0%');
    node.setAttribute('y', '0%');
    node.setAttribute('width', '100%');
    node.setAttribute('height', '100%');
    node.setAttribute('filterUnits', 'objectBoundingBox');
    node.setAttribute('primitiveUnits', 'userSpaceOnUse');

    // 色散：把位移后的结果拆成 R/G/B 三条，各自再位移一次再 screen 合回来。
    // 三条通道互不重叠，screen 对它们就是精确相加，不会提亮。
    const chroma = wantDispersion
      ? `
      <feColorMatrix in="lens" type="matrix" result="chR"
                     values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
      <feDisplacementMap in="chR" in2="dmap" result="dR"
                         xChannelSelector="R" yChannelSelector="G"/>
      <feColorMatrix in="lens" type="matrix" result="chG"
                     values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
      <feDisplacementMap in="chG" in2="dmap" result="dG"
                         xChannelSelector="R" yChannelSelector="G"/>
      <feColorMatrix in="lens" type="matrix" result="chB"
                     values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"/>
      <feDisplacementMap in="chB" in2="dmap" result="dB"
                         xChannelSelector="R" yChannelSelector="G"/>
      <feBlend in="dR" in2="dG" mode="screen" result="rg"/>
      <feBlend in="rg" in2="dB" mode="screen" result="rgb"/>
      <feColorMatrix in="rgb" type="saturate" result="vib"/>`
      : `<feColorMatrix in="lens" type="saturate" result="vib"/>`;

    node.innerHTML = `
      <feImage result="dmap" preserveAspectRatio="none"/>
      <feDisplacementMap in="SourceGraphic" in2="dmap" result="lens"
                         xChannelSelector="R" yChannelSelector="G"/>
      ${chroma}
      <feFlood result="coat"/>
      <feComposite in="coat" in2="vib" operator="over" result="coated"/>
      <feImage result="hl" preserveAspectRatio="none"/>
      <feComposite in="coated" in2="hl" operator="arithmetic"
                   k1="0" k2="1" k3="1" k4="0" result="lit"/>
      <feColorMatrix in="lit" type="matrix"
                     values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1"/>
    `;
    svg.append(node);
  }

  const imgs = node.querySelectorAll('feImage');
  const floods = node.querySelector('feFlood');
  const sats = node.querySelectorAll('feColorMatrix[type="saturate"]');

  // 两张贴图都必须精确覆盖元素框
  for (const img of imgs) {
    img.setAttribute('x', '0');
    img.setAttribute('y', '0');
    img.setAttribute('width', String(shape.w));
    img.setAttribute('height', String(shape.h));
  }

  imgs[0].setAttribute('href', displacementMap(shape, p));
  imgs[1].setAttribute('href', highlightMap(shape, p));

  // channel ≈ 127.5 × (1 + q)，所以 scale = 2 × 理论峰值。
  // amount=0 或 band=0 时显式 scale=0，避免 8 位中性值 128 带来残余位移。
  // 主折射与 RGB 色散共用同一倍率；amount 不参与 band / 剖面计算。
  const disps = node.querySelectorAll('feDisplacementMap');
  disps[0].setAttribute('scale', glassDisplacementScale(p.amount, p.band).toFixed(3));
  if (wantDispersion) {
    const fringe = glassDisplacementScale(p.amount * p.dispersion * 0.35, p.band);
    disps[1].setAttribute('scale', fringe.toFixed(3));   // R 往一侧
    disps[2].setAttribute('scale', '0');                 // G 不动
    disps[3].setAttribute('scale', (-fringe).toFixed(3)); // B 往另一侧
  }

  for (const sat of sats) sat.setAttribute('values', p.vibrancy.toFixed(3));

  floods.setAttribute('flood-color', p.coatingColor);
  floods.setAttribute('flood-opacity', p.coating.toFixed(4));

  return id;
}

/* ---------------- 模糊半径 ---------------- */

const blurCache = new Map();

function resolveBlur(host, surface) {
  const cs = getComputedStyle(host);

  // 拇指的模糊不能靠探针量：--thumb-blur-px 注册成了 <length> 才能过渡，
  // 而它 inherits:false —— 探针子元素只会拿到 initial-value。
  // 好在这类注册属性的**计算值就是 px**，直接在宿主上读即可。
  if (surface === 'thumb') {
    const v = parseFloat(cs.getPropertyValue('--thumb-blur-px'));
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  }
  // 缓存键包含表达式实际消费的材质令牌和全局倍率；动态改令牌后必须失效。
  // 不加缓存的话，拖一次滑块几十块玻璃各做一次强制布局。
  const key = [
    surface,
    cs.getPropertyValue('--lg').trim() || '1',
    cs.getPropertyValue('--glass-blur-k').trim() || '1',
    cs.getPropertyValue(BLUR_TOKEN[surface] ?? '--m-popover-blur').trim(),
  ].join('|');
  const hit = blurCache.get(key);
  if (hit != null) return hit;

  const expr = BLUR_EXPR[surface] ?? BLUR_EXPR.capsule;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;left:0;top:0;width:0;visibility:hidden;pointer-events:none;' +
    `height:${expr}`;
  host.append(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();

  const out = Number.isFinite(px) && px > 0 ? px : 0;
  // 量到 0 通常是因为宿主还在 display:none 的子树里（隐藏分页、未展开的面板）。
  // 这个 0 不能进缓存：后面所有同材质的玻璃都会拿到 blur(0px)，整块玻璃变透明。
  if (out > 0) {
    if (blurCache.size > 64) blurCache.clear();
    blurCache.set(key, out);
  }
  return out;
}

/* ---------------- 能力探测 ---------------- */

/**
 * 浏览器是否支持 backdrop-filter 里的 SVG 滤镜引用（Chrome / Edge 支持，Safari 不支持）。
 * 只探标准属性名：Chrome 的 -webkit- 别名在 CSS.supports 里不一定认 url()，
 * 用它当判据会把支持的浏览器误判成不支持。
 */
export function supportsNativeGlass() {
  if (nativeOk != null) return nativeOk;
  // 开发/验收用的强制兜底开关：?fallback=1。语法探测通过也不等于每个浏览器
  // 的实际合成结果一致，所以必须保留一条能真实走 CSS 路径的诊断通道。
  if (typeof location !== 'undefined') {
    try {
      if (new URLSearchParams(location.search).get('fallback') === '1') {
        nativeOk = false;
        return nativeOk;
      }
    } catch {}
  }
  nativeOk = typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#a)');
  return nativeOk;
}

/* ---------------- 挂载 ---------------- */

const mountedLenses = new Set();
const lensHosts = new WeakMap();
let unsubscribeTheme = null;

function clearHostGlass(host) {
  host.removeAttribute?.('data-glass');
  host.style?.removeProperty('backdrop-filter');
  host.style?.removeProperty('-webkit-backdrop-filter');
}

function syncThemeSubscription() {
  if (mountedLenses.size && !unsubscribeTheme) {
    unsubscribeTheme = theme.subscribe(refreshAllLenses);
  } else if (!mountedLenses.size && unsubscribeTheme) {
    unsubscribeTheme();
    unsubscribeTheme = null;
  }
}

/**
 * @param {HTMLElement} host 承载玻璃的元素
 * @param {object} [o]
 * @param {string} [o.surface='capsule'] 玻璃面 id（见 theme.GLASS_SURFACES）
 * @param {object|Function} [o.params] 覆盖参数；默认读 theme.getOptics(surface)
 * @param {object|Function} [o.shape] `{w,h,radius}` 或 `{w,h,polygon}`；默认按元素尺寸求
 * @param {number} [o.blur] 直接给模糊半径（px），跳过 CSS 令牌
 * @returns {{kind:string, refresh:Function, invalidate:Function, dispose:Function, filterId:string}|null}
 *   Safari 这类不支持原生滤镜的浏览器返回 null —— 元素上什么都不留，CSS 材质原样生效。
 */
export function mountGlassLens(host, o = {}) {
  if (!host || typeof document === 'undefined') return null;
  if (!supportsNativeGlass()) return null;

  const surface = o.surface && GLASS_SURFACES.some((s) => s.id === o.surface) ? o.surface : 'capsule';
  const paramsOf = o.params
    ? typeof o.params === 'function' ? o.params : () => o.params
    : () => theme.getOptics(surface);
  const shapeOf = o.shape
    ? typeof o.shape === 'function' ? o.shape : () => o.shape
    : null;

  const id = `gg-g${++seq}`;
  let disposed = false;
  let everConnected = !!host.isConnected;
  let signature = '';

  const lens = {
    kind: 'native',
    filterId: id,
    why: '',
    refresh,
    invalidate: refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      ro?.disconnect();
      clearHostGlass(host);
      if (host.__glassLens === lens) delete host.__glassLens;
      // 销毁路径不能为了删滤镜而重新创建共享 SVG。
      svgHost?.querySelector(`#${id}`)?.remove();
      mountedLenses.delete(lens);
      syncThemeSubscription();
    },
  };
  lensHosts.set(lens, host);

  function measure() {
    if (shapeOf) return resolveGlassShape(shapeOf());
    const radius = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0;
    return resolveGlassShape({
      w: host.offsetWidth || 24,
      h: host.offsetHeight || 16,
      radius,
    });
  }

  function refresh() {
    lens.why = '';
    if (disposed) { lens.why = 'disposed'; return false; }
    if (!host.isConnected) {
      // 工厂通常先建组件再插入 DOM；只有曾经上线过的宿主失联才销毁。
      if (everConnected) lens.dispose();
      lens.why = 'host-gone';
      return false;
    }
    everConnected = true;

    const shape = measure();
    if (shape.w < 2 || shape.h < 2) { lens.why = 'zero'; return false; }

    const p = normalizeGlassOptics(paramsOf());

    // 涂层色可以是 'glass'（跟随主题的 --glass-rgb）或任意 CSS 颜色
    if (p.coatingColor === 'glass') {
      const raw = getComputedStyle(host).getPropertyValue('--glass-rgb').trim();
      const ch = raw.split(/[\s,]+/).map(Number).filter(Number.isFinite);
      p.coatingColor = ch.length >= 3 ? `rgb(${ch[0]} ${ch[1]} ${ch[2]})` : '#ffffff';
    }

    const blur = Number.isFinite(o.blur) ? o.blur : resolveBlur(host, surface);

    // 签名一样就不动 DOM：滚动、hover、重排都不该触发重建
    const sig = [
      shape.w, shape.h, shape.radius, shape.verts ? shape.verts.join(',') : '',
      p.band, p.amount, p.depth, p.dispersion, p.vibrancy, p.coating, p.coatingColor,
      p.strokeHalf, p.strokeFeather, p.strokeAlpha, p.falloff, p.light, blur,
    ].join('|');
    if (sig === signature) return true;
    signature = sig;

    buildFilter(id, shape, p);

    // 拇指的模糊不能写成具体数值：它按下时要收到 0，而且中间有 150ms 过渡。
    // 把 CSS 变量原样写进滤镜列表，var 每帧重解析，过渡就还归 CSS 管。
    const blurToken = surface === 'thumb' ? 'var(--thumb-blur-px)' : `${blur.toFixed(2)}px`;
    const value = `blur(${blurToken}) url(#${id})`;
    host.style.setProperty('backdrop-filter', value, 'important');
    host.style.setProperty('-webkit-backdrop-filter', value, 'important');
    host.setAttribute('data-glass', surface);
    return true;
  }

  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => refresh())
    : null;
  ro?.observe(host);

  mountedLenses.add(lens);
  syncThemeSubscription();

  refresh();
  return lens;
}

/** 强制重画所有透镜；曾经连接后失联的实例在这里回收。 */
export function refreshAllLenses() {
  for (const lens of [...mountedLenses]) lens.refresh();
}

/** 当前挂载数量（测试/调试用） */
export function glassLensCount() {
  return mountedLenses.size;
}

/** 幂等释放 root 自身及后代的 lens 和内联痕迹，不移除 root 的 DOM。 */
export function disposeGlassTree(root) {
  if (!root) return;
  const nodes = [root];
  if (typeof root.querySelectorAll === 'function') nodes.push(...root.querySelectorAll('*'));

  // 直接 mountGlassLens() 的实例未必写了 __glassLens，也按注册宿主覆盖。
  for (const lens of [...mountedLenses]) {
    const host = lensHosts.get(lens);
    if (host === root || (typeof root.contains === 'function' && root.contains(host))) {
      lens.dispose();
    }
  }

  for (const node of nodes) {
    const lens = node.__glassLens;
    const hadGlass = !!lens || (typeof node.hasAttribute === 'function' && node.hasAttribute('data-glass'));
    if (lens && typeof lens.dispose === 'function') lens.dispose();
    // 只清理真正承载玻璃的节点；不能把普通节点上无关的内联 backdrop-filter 一并抹掉。
    if (hadGlass) clearHostGlass(node);
    if (node.__glassLens) delete node.__glassLens;
  }
}

/**
 * 给页面里已有的玻璃面挂渲染层（顶栏、侧栏、模态这些是页面直接写的 DOM，
 * 不像胶囊/菜单/提示条那样由工厂创建，所以需要扫一遍）。
 * 幂等：已经挂过的会跳过。
 */
export function mountGlassSurfaces(root = document) {
  const out = [];
  for (const s of GLASS_SURFACES) {
    if (s.id === 'thumb') continue; // 由 Slider 自己挂（它知道轨道在哪）
    // 导航栏是 acrylic，不是液态玻璃：不挂折射滤镜，否则材质立刻穿帮
    if (s.material === 'acrylic') continue;
    for (const el of root.querySelectorAll(s.cls)) {
      if (el.__glassLens) continue;
      const lens = mountGlassLens(el, { surface: s.id });
      if (lens) {
        el.__glassLens = lens;
        out.push(lens);
      }
    }
  }
  return out;
}
