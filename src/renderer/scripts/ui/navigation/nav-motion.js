// Golden Gate · navigation/nav-motion


/**
 * 标记「导航栏正在开合」。
 *
 * 导航栏是覆盖层：开合的那 380ms 会压在内容上。系统 Acrylic 模糊的是窗口
 * **背后**的桌面，不是 webview 里的内容 —— 不补一层，内容会原样透出来，
 * 和底下的桌面模糊叠成双重曝光。样式在 layout.css 的「覆盖期材质」。
 *
 * 用法：toggle 里先调它，再切 `l-app--nav-hidden`。两个动作在同一帧，
 * 不会漏掉第一帧。
 *
 * @param {HTMLElement} app `.l-app`
 * @param {number} [duration] 覆盖动画时长；不传就读 `--nav-dur`
 * @returns {number} 实际保持的毫秒数
 */
const navMoveTimers = new WeakMap();

export function markNavMoving(app, duration) {
  if (!app) return 0;
  const raw = getComputedStyle(app).getPropertyValue('--nav-dur').trim();
  const ms = duration || parseFloat(raw) || 380;
  const hold = ms + 80;

  app.classList.add('l-app--nav-moving');
  clearTimeout(navMoveTimers.get(app));
  navMoveTimers.set(
    app,
    setTimeout(() => {
      app.classList.remove('l-app--nav-moving');
      navMoveTimers.delete(app);
    }, hold)
  );
  return hold;
}
