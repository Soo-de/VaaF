/**
 * Utility functions for UI helpers, DOM operations, notifications, and modals.
 */

// Toast notification manager
export const Toast = {
  container: null,

  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  /**
   * Display a notification toast.
   * @param {string} message - Message text to display
   * @param {'success'|'error'|'warning'|'info'} [type='info'] - Toast style type
   * @param {number} [duration=4000] - Duration in ms before auto-dismiss
   */
  show(message, type = 'info', duration = 4000) {
    this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconMap = {
      success: `<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`,
      error: `<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>`,
      warning: `<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`,
      info: `<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>`
    };

    toast.innerHTML = `
      <div class="toast-content">
        ${iconMap[type] || iconMap.info}
        <span class="toast-message">${escapeHtml(message)}</span>
      </div>
      <button class="toast-close" aria-label="Kapat">&times;</button>
      <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    const dismiss = () => {
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 250);
    };

    let timer = setTimeout(dismiss, duration);

    toast.addEventListener('mouseenter', () => {
      clearTimeout(timer);
      const progress = toast.querySelector('.toast-progress');
      if (progress) progress.style.animationPlayState = 'paused';
    });

    toast.addEventListener('mouseleave', () => {
      timer = setTimeout(dismiss, 1800);
      const progress = toast.querySelector('.toast-progress');
      if (progress) progress.style.animationPlayState = 'running';
    });

    this.container.appendChild(toast);
  },

  success(msg, duration) { this.show(msg, 'success', duration); },
  error(msg, duration) { this.show(msg, 'error', duration); },
  warning(msg, duration) { this.show(msg, 'warning', duration); },
  info(msg, duration) { this.show(msg, 'info', duration); }
};

// Modal dialog manager
export const Modal = {
  backdrop: null,
  activeResolve: null,

  init() {
    if (!this.backdrop) {
      this.backdrop = document.createElement('div');
      this.backdrop.id = 'modal-backdrop';
      this.backdrop.className = 'modal-backdrop hidden';
      this.backdrop.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h3 class="modal-title" id="modal-title">Onay</h3>
            <button class="modal-close-btn" id="modal-close" aria-label="Kapat">&times;</button>
          </div>
          <div class="modal-body" id="modal-body"></div>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel-btn">İptal</button>
            <button class="btn btn-danger" id="modal-confirm-btn">Onayla</button>
          </div>
        </div>
      `;
      document.body.appendChild(this.backdrop);

      const cancelBtn = this.backdrop.querySelector('#modal-cancel-btn');
      const confirmBtn = this.backdrop.querySelector('#modal-confirm-btn');
      const closeBtn = this.backdrop.querySelector('#modal-close');

      const closeHandler = (confirmed) => {
        this.backdrop.classList.add('hidden');
        if (this.activeResolve) {
          this.activeResolve(confirmed);
          this.activeResolve = null;
        }
      };

      cancelBtn.addEventListener('click', () => closeHandler(false));
      closeBtn.addEventListener('click', () => closeHandler(false));
      confirmBtn.addEventListener('click', () => closeHandler(true));

      this.backdrop.addEventListener('click', (e) => {
        if (e.target === this.backdrop) closeHandler(false);
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !this.backdrop.classList.contains('hidden')) {
          closeHandler(false);
        }
      });
    }
  },

  /**
   * Prompts a confirmation dialog.
   * @param {Object} options
   * @param {string} options.title - Modal title
   * @param {string} options.message - Message or explanation
   * @param {string} [options.confirmText='Onayla'] - Confirmation button label
   * @param {'danger'|'primary'} [options.type='danger'] - Button styling
   * @returns {Promise<boolean>}
   */
  confirm({ title = 'Onay', message, confirmText = 'Onayla', type = 'danger' }) {
    this.init();
    return new Promise((resolve) => {
      this.activeResolve = resolve;
      this.backdrop.querySelector('#modal-title').textContent = title;
      this.backdrop.querySelector('#modal-body').textContent = message;

      const confirmBtn = this.backdrop.querySelector('#modal-confirm-btn');
      confirmBtn.textContent = confirmText;
      confirmBtn.className = `btn btn-${type}`;

      this.backdrop.classList.remove('hidden');
      confirmBtn.focus();
    });
  }
};

/**
 * Copies text to clipboard and triggers a toast.
 * @param {string} text
 * @param {string} [successMsg='Panoya kopyalandı!']
 */
export async function copyToClipboard(text, successMsg = 'Panoya kopyalandı!') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    Toast.success(successMsg);
  } catch (err) {
    Toast.error('Kopyalama başarısız oldu.');
  }
}

/**
 * HTML escape helper to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formats ISO date string to localized readable string.
 * @param {string} isoString
 * @returns {string}
 */
export function formatDate(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('tr-TR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

/**
 * Validates function name string.
 * Regex: /^[a-z][a-z0-9-]{2,49}$/
 * @param {string} name
 * @returns {{isValid: boolean, error: string|null}}
 */
export function validateFunctionName(name) {
  if (!name || typeof name !== 'string') {
    return { isValid: false, error: 'Fonksiyon adı boş olamaz.' };
  }
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 50) {
    return { isValid: false, error: 'Fonksiyon adı 3 ile 50 karakter arasında olmalıdır.' };
  }
  const regex = /^[a-z][a-z0-9-]{2,49}$/;
  if (!regex.test(trimmed)) {
    return {
      isValid: false,
      error: 'Fonksiyon adı küçük harfle başlamalı ve sadece küçük harf, rakam ve tire (-) içermelidir.'
    };
  }
  return { isValid: true, error: null };
}
