/**
 * Main application bootstrap and event bindings for FaaS Platform.
 */

import { ThemeManager } from './theme.js?v=3.0';
import { FunctionsManager } from './functions.js?v=3.0';
import { initMonaco } from './editor.js?v=3.0';
import { getHealth, DEFAULT_TEMPLATE_CODE, deployFunctionStream, createDraftFunction } from './api.js?v=3.0';
import { Toast, validateFunctionName } from './utils.js?v=3.0';


class App {
  constructor() {
    this.pollingInterval = null;
  }


  async init() {
    // 1. Initialize theme
    ThemeManager.init();

    // 2. Initialize Monaco Editor in background
    initMonaco().catch(err => {
      console.warn('Monaco pre-load background warning:', err);
    });

    // 3. Check health status
    this.checkHealthStatus();

    // 4. Initialize Functions list and workspace
    const listContainer = document.getElementById('functions-container');
    const workspaceContainer = document.getElementById('workspace-section');
    if (listContainer) {
      FunctionsManager.init(listContainer, workspaceContainer);
    }

    // 5. Bind hero creation form
    this.bindCreateForm();

    // 6. Start 30s background polling
    this.startPolling();
  }

  async checkHealthStatus() {
    const healthBadge = document.getElementById('system-health-badge');
    const healthText = document.getElementById('system-health-text');
    const healthDot = healthBadge?.querySelector('.status-dot');

    try {
      const res = await getHealth();
      if (res && (res.status === 'ok' || res.status === 'healthy')) {
        if (healthDot) healthDot.className = 'status-dot dot-green';
        if (healthText) healthText.textContent = 'All Systems Operational';
        healthBadge?.setAttribute('title', res.timestamp ? `Sistem çalışıyor (${new Date(res.timestamp).toLocaleTimeString('tr-TR')})` : 'Sistem düzgün çalışıyor');
      } else if (res && res.status === 'degraded') {
        if (healthDot) healthDot.className = 'status-dot dot-yellow';
        if (healthText) healthText.textContent = 'System Degraded';
        healthBadge?.setAttribute('title', 'Backend çalışıyor, K8s/Redis bağımlılığı bekleniyor');
      } else {
        throw new Error('Unhealthy status');
      }
    } catch {
      if (healthDot) healthDot.className = 'status-dot dot-red';
      if (healthText) healthText.textContent = 'Systems Unavailable';
      healthBadge?.setAttribute('title', 'Backend erişilemiyor');
    }
  }

  bindCreateForm() {
    const form = document.getElementById('create-function-form');
    const nameInput = document.getElementById('fn-name-input');
    const runtimeSelect = document.getElementById('fn-runtime-select');
    const submitBtn = document.getElementById('btn-create-function');
    const validationHint = document.getElementById('fn-name-error');

    if (!form || !nameInput || !submitBtn) return;

    // Real-time validation styling
    nameInput.addEventListener('input', () => {
      const val = nameInput.value.trim();
      if (!val) {
        if (validationHint) validationHint.textContent = '';
        nameInput.classList.remove('input-invalid', 'input-valid');
        return;
      }

      const { isValid, error } = validateFunctionName(val);
      if (!isValid) {
        if (validationHint) validationHint.textContent = error;
        nameInput.classList.add('input-invalid');
        nameInput.classList.remove('input-valid');
      } else {
        if (validationHint) validationHint.textContent = '';
        nameInput.classList.remove('input-invalid');
        nameInput.classList.add('input-valid');
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const functionName = nameInput.value.trim();
      const validation = validateFunctionName(functionName);

      if (!validation.isValid) {
        Toast.error(validation.error);
        if (validationHint) validationHint.textContent = validation.error;
        nameInput.focus();
        return;
      }

      try {
        await createDraftFunction({
          name: functionName,
          runtime: runtimeSelect?.value || 'python'
        });

        nameInput.value = '';
        nameInput.classList.remove('input-valid');
        if (validationHint) validationHint.textContent = '';

        // Reload data from store and select the new function
        await FunctionsManager.loadFunctions(true);
        FunctionsManager.selectFunction(functionName);
      } catch (err) {
        Toast.error(err.message || 'Fonksiyon oluşturulamadı.');
      }
    });
  }



  startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.pollingInterval = setInterval(() => {
      FunctionsManager.loadFunctions(true);
      this.checkHealthStatus();
    }, 30000);
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
