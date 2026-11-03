// ============================================================
// Lumina · Refraction
// 移植自 DeskCanvas 的液态玻璃通道（src/DeskCanvas/Services/LiquidGlass/LiquidGlassPass.cs）。
// 原实现是 SkSL 运行时着色器 + 一份逐像素的 CPU 孪生；这里把「位移」这一段搬到浏览器：
// 用形状 SDF 现算一张位移贴图，交给 feDisplacementMap 逐像素偏移后景。
//
// 原式（变量名与 C# 保持一致，方便对照）：
//   sd      = sdRoundedRect(c, halfSize, radius)  |  polygonField(c, verts)
//   depth01 = clamp(-sd / refrHeight, 0, 1)               // 0 = 贴边，1 = 深入
//   lensX   = 1 - depth01
//   d       = (1 - sqrt(1 - lensX*lensX)) * refrAmount    // 圆弧剖面：只贴着边缘抬起来
//   grad    = gradSdRoundedRect(c, halfSize, gradRadius)  // 用「膨胀圆角」算，直边上的方向才平滑
//   g       = normalize(grad + depthEffect * normalize(c))
//   sample  = p - g * d
//
// 三处最容易做错、做错就会退化成「整体平移」的地方：
//   1. 幅度必须是圆弧剖面，不是线性/幂次衰减 —— 线性衰减会让整条边缘带位移量接近常数。
//   2. 方向必须用 gradRadius（1.5× 圆角，且不超过短边一半）算，直接用 radius 会在直边处
//      让方向锁死在轴上，转角出现硬折。（多边形走另一条路：最近边的法线，见 polygonField）
//   3. 方向里要叠 depthEffect × 径向，纯边缘法线看起来是「一层壳」，不是一块有厚度的透镜。
//
// 没有移植的部分（浏览器这条 CSS 管线做不到，别假装做了）：
//   · 色散：原式沿位移方向采 7 个点再按通道加权，feDisplacementMap 每个像素只能采一次。
//   · 镜面高光：原式用 pow(|dot(grad, lightDir)|, falloff) 逐像素打光；这里仍是 CSS 渐变环。
//   · 涂层：原式把背板色与表面色在同一个 pass 里混合；这里对应 .c-slider__mask 那层奶白膜。
//
// 这三件事现在由**渲染层**做（glass-optics / glass-lens）：
// 位移与高光烤成贴图，交给合成器里的 SVG 滤镜，背板是浏览器合成好的真图。
// 本文件因此退成「CSS 兜底路径」：不支持 canvas 2D、或页面没有可画的背板时才会用到。
// 形状求值与渲染层共用 glass-shape.js 的同一份 SDF。
// ============================================================

import { resolveGlassShape, glassField, glassGradient } from './glass-shape.js';

const NS = 'http://www.w3.org/2000/svg';

export const REFRACT_ID = 'gg-refract';

/** 贴图的生成比例（贴图像素 / 元素像素）。语义上等价于「采样分辨率」。 */
const MAP_SCALE = 8;
/** 贴图最长边的上限：别为一块大玻璃生成几百万像素的位移图 */
const MAX_MAP = 256;

const mounted = new Map();

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* ---------------- 位移贴图 ---------------- */

/**
 * 生成位移贴图。R/G 存单位方向 × 剖面（128 = 0），B 存 1。
 * 幅度已归一化到 0…1：真正的像素位移由滤镜的 scale（= refrAmount）给，
 * 所以同一张贴图在任意尺寸下都成立，只要长宽比和 band/半径的比例不变。
 *
 * 形状求值全部走 glass-shape.js —— 和渲染层（glass-optics）**同一份 SDF**。
 * 两条路各写一份的话，对拍时分不清是算法错了还是系数错了。
 */
function buildLensMap({ w, h, radius, polygon, band, depth }) {
  const k = Math.min(MAP_SCALE, MAX_MAP / Math.max(w, h));
  const mw = Math.max(4, Math.round(w * k));
  const mh = Math.max(4, Math.round(h * k));

  // 多边形顶点：元素本地像素 → 贴图像素（仍是左上角原点，交给 resolveGlassShape 居中）
  const verts = polygon?.map(([x, y]) => [x * k, y * k]) ?? null;
  const shape = resolveGlassShape({
    w: mw,
    h: mh,
    radius: radius * k,
    polygon: verts,
  });

  const bandPx = band * k;

  const cv = document.createElement('canvas');
  cv.width = mw;
  cv.height = mh;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(mw, mh);

  const field = [0, 0];
  const grad = [0, 0];

  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const cx = x + 0.5 - shape.hw;
      const cy = y + 0.5 - shape.hh;

      glassField(shape, cx, cy, field);
      const sd = field[0];

      const depth01 = bandPx > 0 ? clamp01(-sd / bandPx) : 1;
      const lensX = 1 - depth01;
      const profile = 1 - Math.sqrt(Math.max(0, 1 - lensX * lensX)); // ← 圆弧剖面

      glassGradient(shape, cx, cy, grad);
      const rl = Math.hypot(cx, cy);
      let ux = grad[0] + depth * (rl > 1e-4 ? cx / rl : 0);
      let uy = grad[1] + depth * (rl > 1e-4 ? cy / rl : 0);
      const ul = Math.hypot(ux, uy);
      if (ul > 1e-5) {
        ux /= ul;
        uy /= ul;
      } else {
        ux = uy = 0;
      }

      // 原式 sample = p - g*d；feDisplacementMap 是 p + offset，所以这里取反
      const i = (y * mw + x) * 4;
      img.data[i] = Math.round(128 - ux * profile * 127);
      img.data[i + 1] = Math.round(128 - uy * profile * 127);
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

/* ---------------- 挂载 ---------------- */

function hashShape(shape) {
  const s = JSON.stringify(shape ?? 'thumb');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * 挂一块玻璃的折射滤镜（幂等，按形状缓存）。
 *
 * 滤镜链 = 位移 → 涂层，和原实现同一个顺序：
 *   `col = col * (1 - tint) + coating * tint` 对应 feFlood + feComposite(over)。
 * 关键：涂层必须在这一层里完成。放在 CSS 里当半透明背景叠上去的话，
 * 折射结果和背板会同时出现在人眼里 —— 玻璃就成了一扇窗，而不是一块材料。
 *
 * @param {object} [o]
 * @param {number} [o.id] 自定义滤镜 id（同 id 会复用）
 * @param {object} [o.shape] 省略 = 拇指胶囊（24×16，3:2）
 *   · `{ w, h, radius }` 圆角矩形，radius 默认 h/2
 *   · `{ w, h, polygon }` 任意闭合多边形，顶点为元素本地像素 [x,y]，首尾自动闭合
 * @param {number} [o.band] refrHeight，折射带深度（元素 px）
 * @param {number} [o.amount] refrAmount，贴边峰值位移（元素 px）
 * @param {number} [o.depth] depthEffect，径向分量权重
 * @param {{color?:string, alpha?:number}} [o.coating] 涂层：混进去的表面色与强度
 * @returns {{ id: string, url: string, svg: SVGElement, setDisplacement: Function, setCoating: Function } | null}
 */
export function mountRefraction({
  id,
  shape,
  band,
  amount,
  depth = 0.6,
  coating = { color: '#ffffff', alpha: 0.35 },
} = {}) {
  if (typeof document === 'undefined') return null;

  const w = shape?.w ?? 24;
  const h = shape?.h ?? 16;
  const radius = shape?.radius ?? h / 2;
  const polygon = shape?.polygon ?? null;

  // 源默认是给卡片用的 band 24 / amount 10；小件按短边比例收，两者取小。
  // amount 再按 band 的比例封一次：源里 10/24 ≈ 0.42，在这么大的卡上刚好，
  // 放到几十像素的小件上会过冲成折叠，所以收到 0.3。
  const short = Math.min(w, h);
  const bandPx = band ?? Math.min(24, short * 0.45);
  const amountPx = amount ?? Math.min(10, bandPx * 0.3);

  const filterId = id ?? (shape ? `gg-refract-${hashShape(shape)}` : REFRACT_ID);
  const cached = mounted.get(filterId);
  if (cached) return cached;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';

  const tint = Math.min(1, Math.max(0, coating.alpha ?? 0.35));
  const tintColor = coating.color ?? '#ffffff';

  // 滤镜区域 = 元素 bbox。位移只朝内，采样点永远落在区域内，边缘不会出现透明毛边。
  // 最后一步 feComposite(over) 把涂层压上去，输出就是一张不透明的成品图。
  svg.innerHTML = `<defs>
    <filter id="${filterId}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feImage href="${buildLensMap({ w, h, radius, polygon, band: bandPx, depth })}"
               x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${amountPx.toFixed(2)}"
                         xChannelSelector="R" yChannelSelector="G" result="lens" />
      <feFlood flood-color="${tintColor}" flood-opacity="${tint}" result="coat" />
      <feComposite in="coat" in2="lens" operator="over" />
    </filter>
  </defs>`;

  document.body.append(svg);

  const disp = svg.querySelector('feDisplacementMap');
  const flood = svg.querySelector('feFlood');
  const entry = {
    id: filterId,
    /** 直接给 CSS 用：backdrop-filter: ${url} blur(…) */
    url: `url(#${filterId})`,
    svg,
    /** refrAmount：贴边处的峰值位移（px）。0 = 关掉折射，退回纯模糊 */
    setDisplacement(px) {
      disp.setAttribute('scale', String(Math.max(0, Number(px) || 0).toFixed(2)));
    },
    /** 涂层强度 0…1。0 = 纯折射（会透出背板），1 = 全不透明的表面色 */
    setCoating(alpha) {
      flood.setAttribute('flood-opacity', String(Math.min(1, Math.max(0, Number(alpha) || 0))));
    },
  };
  mounted.set(filterId, entry);
  return entry;
}
