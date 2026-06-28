// ============================================================
// Photo Album — Context Menu (CM)
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

    // Position
    const w = 180;
    const h = menu.offsetHeight || 200;
    const maxX = window.innerWidth - w - 8;
    const maxY = window.innerHeight - h - 8;
    menu.style.left = Math.min(x, maxX) + 'px';
    menu.style.top = Math.min(y, maxY) + 'px';
    menu.classList.remove('hidden');
  },

  /** Hide context menu */
  hide() {
    const menu = document.getElementById('ctx-m');
    if (menu) menu.classList.add('hidden');
  },
};

// Global click handler to close menu
document.addEventListener('click', (e) => {
  const menu = document.getElementById('ctx-m');
  if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) {
    CM.hide();
  }
});

// Prevent default context menu on app
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('#image-grid') && !e.target.closest('#album-grid') && !e.target.closest('.home-card')) {
    // Let browser show default on other elements
    return;
  }
});
