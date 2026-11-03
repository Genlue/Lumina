// ============================================================
// Lumina · Spring
// Apple 的弹簧模型：只暴露「阻尼比 damping」和「响应时长 response」两个参数。
// 弹簧天生可被打断，所以动画永远从当前屏幕上的值接着走，而不是从目标值重新开始。
// ============================================================

const SUBSTEP = 1 / 240; // 固定步长积分，保证不同刷新率下手感一致
const MAX_DT = 0.064;

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 从 from 弹到 to。
 * @param {object} o
 * @param {number} o.from 起始值（一定是当前屏幕值）
 * @param {number} o.to 目标值
 * @param {number} [o.damping=1] 1 = 临界阻尼无回弹；0.8 = 带一点点过冲
 * @param {number} [o.response=0.35] 到达目标的速度（秒），不是时长
 * @param {number} [o.velocity=0] 初速度（单位/秒），手势释放时接管
 * @param {(v:number)=>void} [o.onUpdate]
 * @param {()=>void} [o.onComplete]
 * @returns {{ stop: () => void, velocity: () => number }}
 */
export function spring(o) {
  const {
    from,
    to,
    damping = 1,
    response = 0.35,
    velocity = 0,
    onUpdate,
    onComplete,
  } = o;

  if (reducedMotion() || response <= 0) {
    onUpdate?.(to);
    onComplete?.();
    return { stop() {}, velocity: () => 0 };
  }

  const omega = (2 * Math.PI) / response;
  const stiffness = omega * omega; // 质量恒为 1
  const dampingCoef = 2 * damping * omega;

  let x = from;
  let v = velocity;
  let raf = 0;
  let last = performance.now();
  let stopped = false;

  const tick = (now) => {
    if (stopped) return;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > MAX_DT) dt = MAX_DT;

    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(SUBSTEP, remaining);
      const a = -stiffness * (x - to) - dampingCoef * v;
      v += a * step;
      x += v * step;
      remaining -= step;
    }

    // 静止判据：位移足够小且速度足够小
    if (Math.abs(x - to) < 0.0015 && Math.abs(v) < 0.02) {
      x = to;
      onUpdate?.(x);
      stopped = true;
      onComplete?.();
      return;
    }

    onUpdate?.(x);
    raf = requestAnimationFrame(tick);
  };

  onUpdate?.(x);
  raf = requestAnimationFrame(tick);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
    velocity: () => v,
  };
}

/**
 * 可复用的弹簧值。适合手势驱动的属性（拖拽位移、缩放比例）。
 */
export function springValue(initial = 0, opts = {}) {
  let value = initial;
  let handle = null;
  const { damping = 1, response = 0.35, onUpdate } = opts;

  return {
    get: () => value,
    set(v) {
      handle?.stop();
      value = v;
      onUpdate?.(value);
    },
    to(target, extra = {}) {
      handle?.stop();
      handle = spring({
        from: value,
        to: target,
        damping: extra.damping ?? damping,
        response: extra.response ?? response,
        velocity: extra.velocity ?? 0,
        onUpdate: (v) => {
          value = v;
          onUpdate?.(v);
        },
        onComplete: extra.onComplete,
      });
      return handle;
    },
    stop() {
      handle?.stop();
    },
  };
}

/**
 * 动量投影：一个小小的甩动应该被放大成一段滑行。
 * 用指数衰减形式（Apple 实际发布的公式），不是物理课本里的 v²/2a。
 */
export function project(velocity, decelerationRate = 0.998) {
  return (velocity / 1000) * (decelerationRate / (1 - decelerationRate));
}

/** 边界橡皮筋：越往外拖越拖不动，而不是硬停 */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (
    (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
  );
}

/** 从元素当前的 transform 里读出 translateY，用于打断时接着动画 */
export function currentTranslateY(el) {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return m.m42;
}
