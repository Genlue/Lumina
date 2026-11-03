// ============================================================
// Lumina · Glass Optics
// 渲染层里**只跟形状和参数有关**的那部分：位移图、描边高光图。
//
// 为什么要把它们单独抽出来：
//   1. 它们不需要 DOM —— 传形状和尺寸，返回 Uint8ClampedArray，node 里能直接单测；
//   2. 它们和背板完全无关，所以可以预先算好、缓存、复用；
//   3. 位移图有两个消费者（合成器滤镜、CSS 兜底的 feDisplacementMap），
//      两边必须用同一份数学，否则对拍时分不清是算法错了还是系数错了。
//
// 坐标系：形状是**元素本地 CSS 像素**（左上角原点）；贴图按 mw × mh 生成，
// 内部把形状等比缩到贴图空间再求 SDF。
// ============================================================

import { resolveGlassShape, glassField, glassGradient, gSmoothstep } from './glass-shape.js';
import { GLASS_OPTICS_DEFAULTS, normalizeGlassOptics } from './glass-schema.js';

// 保留旧入口；构建拍平模块时只会有 schema 中的一份声明。
export { GLASS_OPTICS_DEFAULTS, normalizeGlassOptics };

const optClamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * feDisplacementMap 的 scale 契约：通道 ≈ 127.5 × (1 + q)，
 * 所以 scale = 2 × 峰值 CSS px。amount=0 或 band=0 时显式归零，
 * 不让 8 位中性值 128 留下 amount/255 的残余位移。
 */
export function glassDisplacementScale(amount, band) {
  const a = Number(amount);
  const b = Number(band);
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? 2 * a : 0;
}

/** 贴图尺寸：保持长宽比，最长边不超过 max */
export function glassMapSize(shape, max) {
  const k = Math.min(2, max / Math.max(shape.w, shape.h));
  return [Math.max(8, Math.round(shape.w * k)), Math.max(8, Math.round(shape.h * k))];
}

/** 把形状按贴图尺寸重解析一遍（多边形顶点也要跟着缩放） */
function shapeAt(shape, mw, mh) {
  const kx = mw / shape.w;
  const ky = mh / shape.h;
  return resolveGlassShape({
    w: mw,
    h: mh,
    radius: shape.radius * Math.min(kx, ky),
    polygon: shape.verts
      ? shape.verts.map(([x, y]) => [x * kx + mw / 2, y * ky + mh / 2])
      : null,
  });
}

/**
 * 位移贴图：R/G 存单位方向 × 圆弧剖面，B 恒 1，A 恒 255。
 *
 * 未量化时 channel = 127.5 + 127.5 × q（q ∈ [-1, 1]），覆盖完整 0…255。
 * feDisplacementMap 的 offset = scale × (channel / 255 - 0.5) ≈ scale × q / 2，
 * 因此渲染层用 scale = 2 × amount，amount 才是理论单轴峰值 CSS px。
 * 换 amount 不用重画；band / depth 会改变剖面形状，它们进缓存键。
 * 8 位通道最多有 amount / 255 px 量化误差；零折射由渲染层显式设 scale = 0。
 *
 * 剖面必须是圆弧 `1 - √(1-λ²)`，不是线性衰减 —— 线性衰减会让整条边缘带
 * 位移量接近常数，看起来是「整体平移」而不是一块透镜。
 */
export function glassDisplacementField(shape, params, mw, mh) {
  const p = normalizeGlassOptics(params);
  const base = resolveGlassShape(shape);
  const s = shapeAt(base, mw, mh);
  const data = new Uint8ClampedArray(mw * mh * 4);

  const field = [0, 0, 0];
  const grad = [0, 0];
  const bandPx = p.band * (mw / base.w);

  // 没有折射带宽时返回明确的恒等图，不必再求方向场。
  if (bandPx <= 0) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    return data;
  }

  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const cx = x + 0.5 - s.hw;
      const cy = y + 0.5 - s.hh;
      glassField(s, cx, cy, field);

      const d01 = optClamp01(-field[0] / bandPx);
      const lensX = 1 - d01;
      const profile = 1 - Math.sqrt(Math.max(0, 1 - lensX * lensX));

      glassGradient(s, cx, cy, grad);
      const rl = Math.hypot(cx, cy);
      let ux = grad[0] + p.depth * (rl > 1e-4 ? cx / rl : 0);
      let uy = grad[1] + p.depth * (rl > 1e-4 ? cy / rl : 0);
      const ul = Math.hypot(ux, uy);
      if (ul > 1e-5) {
        ux /= ul;
        uy /= ul;
      } else {
        ux = uy = 0;
      }

      // 原式 sample = p - g·d；feDisplacementMap 是 p + offset，所以取反
      const i = (y * mw + x) * 4;
      data[i] = Math.round(127.5 - ux * profile * 127.5);
      data[i + 1] = Math.round(127.5 - uy * profile * 127.5);
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

/**
 * 描边高光贴图：纯白 + alpha。
 *
 * 高光**只跟形状和光照角度有关，跟背板无关** —— 所以它可以预先烤成一张图，
 * 用 feComposite(arithmetic) 加在涂层之上，和逐像素着色器算出来的完全一致。
 *
 * 光从上方来（light = 0）时亮度 ∝ |法线·光源|，所以上下两条边同时亮、左右两侧暗，
 * 这是这套材质「上下对称高光」的来源。
 */
export function glassHighlightField(shape, params, mw, mh) {
  const p = normalizeGlassOptics(params);
  const base = resolveGlassShape(shape);
  const s = shapeAt(base, mw, mh);
  const data = new Uint8ClampedArray(mw * mh * 4);

  const rad = (p.light * Math.PI) / 180;
  const lx = -Math.sin(rad);
  const ly = Math.cos(rad);
  const kx = mw / base.w;
  const f0 = (p.strokeHalf - p.strokeFeather) * kx;
  const f1 = (p.strokeHalf + p.strokeFeather) * kx;
  if (p.strokeAlpha <= 0 || f1 <= 0) return data;

  // 细高光可能只占一个输出像素的一小部分。4×4 分层采样估计像素内的
  // 平均 alpha（面积覆盖率），不永久加粗线条，也不提高贴图分辨率上限。
  // 中心 SDF 距高光带超过像素外接圆半径时，所有子采样都必然在带外。
  const SS = 4;
  const SAMPLES = SS * SS;
  const pixelRadius = Math.SQRT1_2;
  const field = [0, 0, 0];
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      glassField(s, x + 0.5 - s.hw, y + 0.5 - s.hh, field);
      if (Math.abs(field[0]) > f1 + pixelRadius) continue;

      let coverage = 0;
      for (let sy = 0; sy < SS; sy++) {
        const cy = y + (sy + 0.5) / SS - s.hh;
        for (let sx = 0; sx < SS; sx++) {
          const cx = x + (sx + 0.5) / SS - s.hw;
          glassField(s, cx, cy, field);
          const strokeMask = 1 - gSmoothstep(f0, f1, Math.abs(field[0]));
          if (strokeMask <= 0) continue;
          const dh = Math.abs(field[1] * lx + field[2] * ly);
          coverage += Math.pow(dh, p.falloff) * strokeMask;
        }
      }

      const a = (coverage / SAMPLES) * p.strokeAlpha;
      if (a <= 0) continue;
      const i = (y * mw + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(optClamp01(a) * 255);
    }
  }
  return data;
}
