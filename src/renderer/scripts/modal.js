// ============================================================
// Lumina — Modal
// ============================================================

const Modal = {
  _open: false,

  show(title, content, buttons) {
    // Remove any stale overlays
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
    return new Promise(resolve => {
      const done = (r) => { resolve(r); };
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';

      let btnHtml = '';
      buttons.forEach((b, i) => {
        let cls = 'modal-btn';
        if (b.primary) cls += ' modal-btn-primary';
        if (b.danger) cls += ' modal-btn-danger';
        btnHtml += `<button class="${cls}" data-idx="${i}">${b.label}</button>`;
      });

      overlay.innerHTML = `
        <div class="modal">
          <h3>${title}</h3>
          <p>${content}</p>
          <div class="modal-actions">${btnHtml}</div>
        </div>
      `;

      document.body.appendChild(overlay);

      overlay.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          document.body.removeChild(overlay);
          done({ idx: parseInt(btn.dataset.idx) });
        });
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          document.body.removeChild(overlay);
          done({ idx: -1 });
        }
      });
    });
  },

  /**
   * Prompt (text input) modal.
   * @param {string} title
   * @param {string} placeholder
   * @param {string} defaultValue
   * @returns {Promise<string|null>}
   */
  prompt(title, placeholder = '', defaultValue = '') {
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
    return new Promise(resolve => {
      const done = (r) => { resolve(r); };
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';

      overlay.innerHTML = `
        <div class="modal">
          <h3>${title}</h3>
          <input type="text" class="modal-input" placeholder="${placeholder}" value="${defaultValue}" autofocus>
          <div class="modal-actions">
            <button class="modal-btn" data-a="cancel">取消</button>
            <button class="modal-btn modal-btn-primary" data-a="ok">确定</button>
          </div>
        </div>
      `;

      const input = overlay.querySelector('input');
      document.body.appendChild(overlay);
      input.focus();
      input.select();

      overlay.querySelector('[data-a="ok"]').addEventListener('click', (e) => {
        e.stopPropagation();
        document.body.removeChild(overlay);
        done(input.value || null);
      });
      overlay.querySelector('[data-a="cancel"]').addEventListener('click', (e) => {
        e.stopPropagation();
        document.body.removeChild(overlay);
        done(null);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          document.body.removeChild(overlay);
          done(input.value || null);
        }
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          document.body.removeChild(overlay);
          done(null);
        }
      });
    });
  },
};
