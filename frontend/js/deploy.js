/**
 * Deploy flow manager, handling SSE streaming output and console logging.
 */

import { deployFunctionStream } from './api.js';
import { Toast, escapeHtml } from './utils.js';


export const DeployManager = {
  /**
   * Run deployment process for a function and stream logs to console container.
   * @param {Object} params
   * @param {string} params.functionName
   * @param {string} params.code
   * @param {boolean} [params.isUpdate=false]
   * @param {Object} [params.envVars={}]
   * @param {HTMLElement} params.consoleElement
   * @param {HTMLButtonElement} params.deployBtn
   * @param {function(Object=): void} [params.onComplete]
   * @param {function(Error=): void} [params.onError]
   */
  async runDeploy({ functionName, code, isUpdate = false, envVars = {}, consoleElement, deployBtn, onComplete, onError }) {
    if (!consoleElement) return;

    // Show console container if hidden
    consoleElement.classList.remove('hidden');

    const consoleBody = consoleElement.querySelector('.console-body') || consoleElement;
    consoleBody.innerHTML = '';

    const appendLog = (type, message) => {
      const line = document.createElement('div');
      line.className = `console-line console-line-${type}`;

      const timestamp = new Date().toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      if (type === 'step') {
        line.innerHTML = `<span class="console-ts">[${timestamp}]</span> <strong class="console-step">${escapeHtml(message)}</strong>`;
      } else if (type === 'error') {
        line.innerHTML = `<span class="console-ts">[${timestamp}]</span> <span class="console-error">❌ ${escapeHtml(message)}</span>`;
      } else if (type === 'url') {
        line.innerHTML = `<span class="console-ts">[${timestamp}]</span> <span class="console-url">🔗 Endpoint: <a href="${escapeHtml(message)}" target="_blank" rel="noopener noreferrer">${escapeHtml(message)}</a></span>`;
      } else {
        line.innerHTML = `<span class="console-ts">[${timestamp}]</span> <span>${escapeHtml(message)}</span>`;
      }

      consoleBody.appendChild(line);
      consoleBody.scrollTop = consoleBody.scrollHeight;
    };

    // Button loading state
    let originalBtnHtml = '';
    if (deployBtn) {
      originalBtnHtml = deployBtn.innerHTML;
      deployBtn.disabled = true;
      deployBtn.classList.add('loading');
      deployBtn.innerHTML = `
        <span class="spinner"></span>
        <span>Deploy Ediliyor...</span>
      `;
    }

    appendLog('step', `🚀 [${functionName}] Deploy işlemi başlatılıyor...`);

    try {
      const result = await deployFunctionStream(
        functionName,
        code,
        isUpdate,
        envVars,
        (eventType, data) => {
          if (eventType === 'step') {
            appendLog('step', data);
          } else if (eventType === 'log') {
            appendLog('log', data);
          } else if (eventType === 'error') {
            appendLog('error', data);
          } else if (eventType === 'url') {
            appendLog('url', data);
          } else if (eventType === 'done') {
            let status = 'success';
            let detail = data;
            try {
              const parsed = JSON.parse(data);
              status = parsed.status || 'success';
              detail = parsed.detail || parsed.error || data;
            } catch {
              detail = data;
            }

            if (status === 'success') {
              const liveLine = document.createElement('div');
              liveLine.className = 'console-line console-live-badge';
              liveLine.innerHTML = `<span>✅ '${escapeHtml(functionName)}' LIVE!</span>`;
              consoleBody.appendChild(liveLine);
              consoleBody.scrollTop = consoleBody.scrollHeight;
              Toast.success(`'${functionName}' başarıyla deploy edildi!`);
            } else {
              appendLog('error', `Deploy tamamlanamadı: ${detail}`);
              Toast.error(`'${functionName}' deploy edilirken hata oluştu.`);
              if (onError) onError(new Error(detail));
            }
          }
        }
      );

      if (onComplete) onComplete(result);
    } catch (err) {
      appendLog('error', `Deploy Hatası: ${err.message}`);
      Toast.error(`Deploy başarısız: ${err.message}`);
      if (onError) onError(err);
    } finally {
      if (deployBtn) {
        deployBtn.classList.remove('loading');
        deployBtn.disabled = false;
        deployBtn.innerHTML = originalBtnHtml;
      }
    }
  }
};
