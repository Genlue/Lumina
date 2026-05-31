// ============================================================
// Photo Album — Toast notifications
// ============================================================

const Toast = {
  /**
   * Show a toast message.
   * @param {string} msg
   * @param {'info'|'success'|'error'} type
   * @param {number} duration - ms
   */
  show(msg, type = 'info', duration = 2500) {
    const container = document.getElementById('toast-c');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          container.removeChild(toast);
        }
      }, 300);
    }, duration);
  },
};
