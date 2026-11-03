// ============================================================
// Lumina · Glass Shape
// 液态玻璃的形状层：把 { w, h, radius | polygon } 变成一个可求值的场。
//
// 这里是**唯一**一版 SDF。CSS 那条路（refraction.js 生成位移贴图）和渲染层
// （glass-optics.js 生成位移图与高光图）都从这里取数，不允许各写一份 ——
// 两份迟早会漂移，而对拍的时候你分不清是算法错了还是系数错了。
//
// 坐标系：形状本地像素、原点在左上角；求值时传的是**以中心为原点**的 cx, cy。
// 内部为负、外部为正，和 DeskCanvas 的 LiquidGlassShape 一致。
// ============================================================

const G_EPS = 1e-5;

/** 纯函数，无 DOM、无状态：可以在 node 里直接单测 */
export function gSmoothstep(edge0, edge1, x) {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 圆角矩形 SDF（iq 的式子，与 LiquidGlassPass.sdRoundedRect 同一个） */
export function sdRoundedRect(px, py, hw, hh, r) {
  const qx = Math.abs(px) - hw + r;
  const qy = Math.abs(py) - hh + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return Math.min(Math.max(qx, qy), 0) + outside - r;
}

/**
 * 方向场：用「膨胀后的圆角」重算一遍，四个分支逐字对应 gradSdRoundedRect。
 * 返回外法线（指向形状外侧）。直边上的方向必须由这个膨胀场给出，
 * 用真实圆角算会锁死在轴上，转角出现硬折。
 */
export function gradSdRoundedRect(px, py, hw, hh, r) {
  const cornerX = Math.abs(px) - (hw - r);
  const cornerY = Math.abs(py) - (hh - r);
  const sx = px >= 0 ? 1 : -1;
  const sy = py >= 0 ? 1 : -1;

  if (cornerX >= 0 && cornerY >= 0) {
    const mx = Math.max(cornerX, G_EPS);
    const my = Math.max(cornerY, G_EPS);
    const l = Math.hypot(mx, my);
    return [sx * mx / l, sy * my / l];
  }
  if (cornerX >= 0) return [sx, 0];
  if (cornerY >= 0) return [0, sy];

  const ex = Math.max(-cornerX, G_EPS);
  const ey = Math.max(-cornerY, G_EPS);
  const l = Math.hypot(ex, ey);
  return [sx * ey / l, sy * ex / l];
}

/**
 * 任意闭合多边形：贪心求最近边 + 射线奇偶判内外，逐字对应 PolygonField。
 * verts 是「以形状中心为原点」的顶点环，首尾自动闭合（不要重复首点）。
 * 写进 out：[sd（内负外正）, 法线x, 法线y]，不返回新数组 —— 这是个逐像素热路径。
 */
export function polygonField(px, py, verts, out) {
  let nearestX = 0;
  let nearestY = 0;
  let minD2 = Infinity;
  let sign = 1;

  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const wx = px - a[0];
    const wy = py - a[1];

    const ee = ex * ex + ey * ey;
    const t = ee > 0 ? Math.min(1, Math.max(0, (wx * ex + wy * ey) / ee)) : 0;

    const dx = wx - ex * t;
    const dy = wy - ey * t;
    const d2 = dx * dx + dy * dy;
    if (d2 < minD2) {
      minD2 = d2;
      nearestX = dx;
      nearestY = dy;
    }

    const c1 = py >= a[1];
    const c2 = py < b[1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
  }

  const len = Math.sqrt(minD2);
  if (len <= G_EPS) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  out[0] = sign * len;
  out[1] = (sign * nearestX) / len;
  out[2] = (sign * nearestY) / len;
  return out;
}

/** 方向场的膨胀圆角：1.5× 圆角，且不超过短边一半 */
export function glassGradientRadius(w, h, radius) {
  const short = Math.min(w, h);
  const r = Math.min(Math.max(radius, 0), short / 2);
  return Math.min(Math.max(r * 1.5, r), short / 2);
}

/**
 * 把用户给的形状描述补齐成求值用的结构（幂等：已经是解析过的直接返回）。
 * @param {{w?:number,h?:number,radius?:number,polygon?:number[][]}} [shape]
 *   多边形顶点用元素本地像素（左上角为原点），首尾自动闭合。
 */
export function resolveGlassShape(shape = {}) {
  if (shape && shape.__resolved) return shape;

  const w = Math.max(1, Number(shape?.w) || 24);
  const h = Math.max(1, Number(shape?.h) || 16);
  const short = Math.min(w, h);
  const rawPolygon = Array.isArray(shape?.polygon) && shape.polygon.length >= 3 ? shape.polygon : null;
  const radius = Math.min(Math.max(Number(shape?.radius ?? h / 2) || 0, 0), short / 2);

  // 顶点换算到「以中心为原点」的坐标系，一次算完，逐像素循环里不再减
  const verts = rawPolygon
    ? rawPolygon.map(([x, y]) => [Number(x) - w / 2, Number(y) - h / 2])
    : null;

  return {
    __resolved: true,
    w,
    h,
    hw: w / 2,
    hh: h / 2,
    radius,
    gradRadius: glassGradientRadius(w, h, radius),
    isPolygon: !!verts,
    verts,
    edgeCount: verts ? verts.length : 0,
  };
}

/**
 * 求一点的场。cx/cy 是以中心为原点的本地像素。
 * 写进 out：[sd, 法线x, 法线y]（法线是「真实圆角 / 最近边」的那一版，用于打光）
 */
export function glassField(shape, cx, cy, out = [0, 0, 0]) {
  if (shape.isPolygon) return polygonField(cx, cy, shape.verts, out);
  out[0] = sdRoundedRect(cx, cy, shape.hw, shape.hh, shape.radius);
  const g = gradSdRoundedRect(cx, cy, shape.hw, shape.hh, shape.gradRadius);
  out[1] = g[0];
  out[2] = g[1];
  return out;
}

/** 位移用的方向场：多边形走最近边法线，圆角矩形走膨胀圆角 */
export function glassGradient(shape, cx, cy, out = [0, 0]) {
  if (shape.isPolygon) {
    const f = polygonField(cx, cy, shape.verts, [0, 0, 0]);
    out[0] = f[1];
    out[1] = f[2];
    return out;
  }
  const g = gradSdRoundedRect(cx, cy, shape.hw, shape.hh, shape.gradRadius);
  out[0] = g[0];
  out[1] = g[1];
  return out;
}

/**
 * 形状掩膜：内部 1、外部 0。
 * @param {number} sd 有符号距离（内部为负）
 * @param {number} [edge=0.75] 抗锯齿半宽，**以输出像素为单位**
 *   —— 渲染层会传 `0.75 / (输出像素/本地像素)`，这样 DPR 2/3 下边缘依旧只糊 1~2 个像素
 */
export function glassMask(sd, edge = 0.75) {
  return 1 - gSmoothstep(-edge, edge, sd);
}

/** 判断一点是否在形状内，给测试和命中检测用 */
export function glassContains(shape, cx, cy) {
  return glassField(shape, cx, cy, [0, 0, 0])[0] < 0;
}
