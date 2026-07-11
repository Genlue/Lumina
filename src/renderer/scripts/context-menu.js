// ============================================================
// Lumina — Context Menu (CM)
// ============================================================

const CM = {
  /**
   * Show context menu at position.
   * @param {number} x
   * @param {number} y
   */
  show(x, y) {
    const menu = document.getElementById('ctx-m');
    if (!menu) return;
    menu.classList.remove('hidden');
    const w = menu.offsetWidth || 180;
    const h = menu.offsetHeight;
    const maxX = window.innerWidth - w - 8;
    let finalY = y;
    if (y + h > window.innerHeight - 8) {
      finalY = y - h;
    }
    if (finalY < 4) finalY = 4;
    menu.style.left = Math.min(x, maxX) + 'px';
    menu.style.top = finalY + 'px';
  },

  /** Hide context menu */
  hide() {
    const menu = document.getElementById('ctx-m');
    if (menu) menu.classList.add('hidden');
  },
};

