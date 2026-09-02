/**
 * Functions list, active selection, workspace layout, and HackerRank-style code execution.
 */

import {
  getFunctions,
  getFunctionCode,
  getFunctionRevisions,
  getRevisionCode,
  rollbackRevision,
  deleteFunction,
  getFunctionLogs,
  proxyRequest
} from './api.js?v=3.1';
import { createEditor, getEditor, disposeEditor } from './editor.js?v=3.1';
import { DeployManager } from './deploy.js?v=3.1';
import { Toast, Modal, copyToClipboard, escapeHtml, formatDate, validateEnvKey } from './utils.js?v=3.1';


export const FunctionsManager = {
  listContainer: null,
  workspaceContainer: null,
  activeFunctionName: null,
  functionsData: [],
  envVarsState: new Map(),
  testBodyState: new Map(),
  searchQuery: '',
  searchBound: false,

  // In-memory Session Cache per function (RAM / Zero storage footprint)
  sessionCache: new Map(),

  getSession(fnName) {
    if (!this.sessionCache.has(fnName)) {
      this.sessionCache.set(fnName, {
        code: null,
        envMap: new Map(),
        testBody: JSON.stringify({ key1: "value1" }, null, 2),
        isLoaded: false
      });
    }
    return this.sessionCache.get(fnName);
  },

  init(listElement, workspaceElement) {
    this.listContainer = listElement;
    this.workspaceContainer = workspaceElement || document.getElementById('workspace-section');
    this.bindSearchInput();
    this.loadFunctions();
  },

  bindSearchInput() {
    if (this.searchBound) return;
    const searchInput = document.getElementById('fn-search-input');
    if (searchInput) {
      this.searchBound = true;
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        this.renderList();
      });
    }
  },

  /**
   * Load functions and render list.
   * @param {boolean} [silent=false]
   */
  async loadFunctions(silent = false) {
    if (!this.listContainer) return;

    this.bindSearchInput();

    if (!silent) {
      this.listContainer.innerHTML = `
        <div class="table-skeleton">
          <div class="skeleton-row header"></div>
          <div class="skeleton-row"></div>
          <div class="skeleton-row"></div>
        </div>
      `;
    }

    try {
      const data = await getFunctions();
      this.functionsData = data.functions || [];

      // Update count badge
      const countBadge = document.getElementById('functions-count-badge');
      if (countBadge) {
        countBadge.textContent = `${this.functionsData.length} fonksiyon`;
      }

      this.renderList();

      // If active function exists, update status header without destroying workspace
      if (this.activeFunctionName) {
        const currentActive = this.functionsData.find(f => f.name === this.activeFunctionName);
        if (currentActive) {
          const statusCol = this.workspaceContainer?.querySelector('.workspace-title-group .badge');
          if (statusCol) {
            statusCol.outerHTML = this.getStatusBadge(currentActive);
          }
        } else if (this.functionsData.length > 0) {
          // Active function was deleted; select the latest available function
          this.selectFunction(this.functionsData[0].name);
        } else {
          this.closeWorkspace();
        }
      } else if (this.functionsData.length > 0 && !silent) {
        // Auto-select the latest saved function on initial load
        this.selectFunction(this.functionsData[0].name);
      } else if (this.functionsData.length === 0) {
        this.closeWorkspace();
      }
    } catch (err) {
      if (!silent) {
        this.listContainer.innerHTML = `
          <div class="empty-state error-state">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <p class="text-muted">${escapeHtml(err.message)}</p>
            <button class="btn btn-secondary btn-sm mt-2" id="retry-fetch-btn">Tekrar Dene</button>
          </div>
        `;
        this.listContainer.querySelector('#retry-fetch-btn')?.addEventListener('click', () => this.loadFunctions());
      }
    }
  },

  renderList() {
    if (!this.functionsData || this.functionsData.length === 0) {
      this.listContainer.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
          </svg>
          <p class="text-muted">Henüz oluşturulmuş fonksiyon yok.</p>
        </div>
      `;
      return;
    }

    const filtered = this.searchQuery
      ? this.functionsData.filter(f => f.name.toLowerCase().includes(this.searchQuery))
      : this.functionsData;

    if (filtered.length === 0) {
      this.listContainer.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <p class="text-muted">"${escapeHtml(this.searchQuery)}" ile eşleşen fonksiyon bulunamadı.</p>
        </div>
      `;
      return;
    }

    let itemsHtml = '';
    for (const fn of filtered) {
      const isSelected = this.activeFunctionName === fn.name;
      const statusBadge = this.getStatusBadge(fn);

      itemsHtml += `
        <div class="fn-list-item ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(fn.name)}">
          <div class="fn-item-info">
            <div class="fn-item-top">
              <span class="fn-item-name">${escapeHtml(fn.name)}</span>
              ${statusBadge}
            </div>
            <div class="fn-item-meta">
              <span class="badge badge-runtime">Python 3.11</span>
              <span class="fn-item-date">${formatDate(fn.created_at)}</span>
            </div>
          </div>

          <div class="fn-item-actions">
            <button class="icon-btn copy-url-btn" data-url="${escapeHtml(fn.url)}" title="URL'i Kopyala">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <button class="icon-btn delete-btn" data-name="${escapeHtml(fn.name)}" title="Sil">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      `;
    }

    this.listContainer.innerHTML = itemsHtml;
    this.bindListEvents();
  },

  getStatusBadge(fn) {
    if (fn.deploying) {
      return `<span class="badge badge-deploying"><span class="pulse-dot"></span> Deploying</span>`;
    }
    if (fn.ready || fn.deployed) {
      return `<span class="badge badge-ready"><span class="status-dot dot-green"></span> Deployed</span>`;
    }
    return `<span class="badge badge-not-ready"><span class="status-dot dot-red"></span> Not Deployed</span>`;
  },


  getRuntimeIcon(runtime = 'python') {
    const r = (runtime || 'python').toLowerCase();
    if (r.includes('python')) {
      return `
        <span class="workspace-fn-icon icon-python" title="Python 3.11">
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path fill="#387eb8" d="M11.91 2c-5.08 0-4.76 2.2-4.76 2.2l.01 2.28h4.84v.69H5.16S2 6.8 2 11.9c0 5.12 2.76 4.93 2.76 4.93h1.65v-2.32s-.09-2.76 2.71-2.76h4.69s2.58.04 2.58-2.5V4.57S16.8 2 11.91 2zm-2.6 1.48a.93.93 0 1 1 0 1.86.93.93 0 0 1 0-1.86z"/>
            <path fill="#ffe052" d="M12.09 22c5.08 0 4.76-2.2 4.76-2.2l-.01-2.28H12v-.69h6.84S22 17.2 22 12.1c0-5.12-2.76-4.93-2.76-4.93h-1.65v2.32s.09 2.76-2.71 2.76H10.2s-2.58-.04-2.58 2.5v4.68s-.41 2.57 4.48 2.57zm2.6-1.48a.93.93 0 1 1 0-1.86.93.93 0 0 1 0 1.86z"/>
          </svg>
        </span>
      `;
    }
    return `<span class="workspace-fn-icon">&lt;/&gt;</span>`;
  },

  bindListEvents() {
    this.listContainer.querySelectorAll('.fn-list-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.copy-url-btn') || e.target.closest('.delete-btn')) return;
        const name = item.getAttribute('data-name');
        this.selectFunction(name);
      });
    });

    this.listContainer.querySelectorAll('.copy-url-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.getAttribute('data-url');
        copyToClipboard(url, 'Fonksiyon URL\'i panoya kopyalandı');
      });
    });

    this.listContainer.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = btn.getAttribute('data-name');
        const confirmed = await Modal.confirm({
          title: 'Fonksiyonu Sil',
          message: `'${name}' fonksiyonunu silmek istediğinize emin misiniz?`,
          confirmText: 'Sil',
          type: 'danger'
        });

        if (confirmed) {
          try {
            await deleteFunction(name);
            this.sessionCache.delete(name);
            Toast.success(`'${name}' başarıyla silindi.`);

            const wasActive = this.activeFunctionName === name;
            if (wasActive) {
              disposeEditor(`editor-main-${name}`);
              disposeEditor(`editor-test-req-${name}`);
              this.activeFunctionName = null;
            }

            await this.loadFunctions(true);

            if (wasActive) {
              if (this.functionsData.length > 0) {
                this.selectFunction(this.functionsData[0].name);
              } else {
                this.closeWorkspace();
              }
            }
          } catch (err) {
            Toast.error(`Silme başarısız: ${err.message}`);
          }
        }
      });
    });
  },

  /**
   * Select a function and show its spacious workspace.
   * @param {string} name
   */
  async selectFunction(name) {
    if (this.activeFunctionName && this.activeFunctionName !== name) {
      disposeEditor(`editor-main-${this.activeFunctionName}`);
      disposeEditor(`editor-test-req-${this.activeFunctionName}`);
    }
    this.activeFunctionName = name;
    this.renderList();

    const fn = this.functionsData.find(f => f.name === name);
    if (!fn || !this.workspaceContainer) return;

    this.workspaceContainer.classList.remove('hidden');
    this.renderWorkspace(fn);
  },

  closeWorkspace() {
    if (this.workspaceContainer) {
      this.workspaceContainer.classList.add('hidden');
      this.workspaceContainer.innerHTML = '';
    }
    if (this.activeFunctionName) {
      disposeEditor(`editor-main-${this.activeFunctionName}`);
      disposeEditor(`editor-test-req-${this.activeFunctionName}`);
    }
    this.activeFunctionName = null;
    this.renderList();
  },

  /**
   * Render the spacious workspace below the dashboard grid.
   * @param {Object} fn
   */
  async renderWorkspace(fn) {
    const fnName = fn.name;
    const template = document.getElementById('workspace-template');
    if (!template || !this.workspaceContainer) return;

    this.workspaceContainer.innerHTML = '';
    const clone = template.content.cloneNode(true);

    // Populate Header Info
    const runtimeIconSlot = clone.querySelector('.workspace-runtime-icon');
    if (runtimeIconSlot) runtimeIconSlot.innerHTML = this.getRuntimeIcon(fn.runtime);

    const titleEl = clone.querySelector('.workspace-title');
    if (titleEl) titleEl.textContent = fnName;

    const statusBadgeSlot = clone.querySelector('.workspace-status-badge-slot');
    if (statusBadgeSlot) statusBadgeSlot.innerHTML = this.getStatusBadge(fn);

    const urlTextEl = clone.querySelector('.url-text');
    if (urlTextEl) {
      urlTextEl.textContent = fn.url;
      urlTextEl.title = fn.url;
    }

    const copyBtn = clone.querySelector('.copy-url-btn');
    if (copyBtn) copyBtn.dataset.url = fn.url;

    this.workspaceContainer.appendChild(clone);
    this.workspaceContainer.classList.remove('hidden');

    await this.bindWorkspaceEvents(fn);
  },

  async bindWorkspaceEvents(fn) {
    const fnName = fn.name;
    const ws = this.workspaceContainer;
    if (!ws) return;

    // Close button
    ws.querySelector('.workspace-close-btn')?.addEventListener('click', () => {
      this.closeWorkspace();
      this.renderList();
    });

    // Copy URL
    ws.querySelector('.copy-url-btn')?.addEventListener('click', () => {
      copyToClipboard(fn.url, 'Fonksiyon URL\'i panoya kopyalandı');
    });

    // Main Tab Switcher
    const tabBtns = ws.querySelectorAll('.panel-tab-btn');
    const tabPanes = ws.querySelectorAll('.panel-tab-content');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        tabPanes.forEach(pane => {
          if (pane.getAttribute('data-content-tab') === targetTab) {
            pane.classList.remove('hidden');
            pane.classList.add('active');
          } else {
            pane.classList.add('hidden');
            pane.classList.remove('active');
          }
        });

        if (targetTab === 'test') {
          this.setupTestTab(fn);
        } else if (targetTab === 'revisions') {
          this.setupRevisionsTab(fn);
        } else if (targetTab === 'monitor') {
          this.setupMonitorTab(fn);
        } else if (targetTab === 'code') {
          getEditor(`editor-main-${fnName}`)?.layout();
        }
      });
    });

    // Subtabs: Editor vs Env
    const subtabBtns = ws.querySelectorAll('.subtab-btn');
    const editorPane = ws.querySelector('.subtab-pane[data-pane="editor"]');
    const envPane = ws.querySelector('.subtab-pane[data-pane="env"]');
    subtabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const subtab = btn.getAttribute('data-subtab');
        subtabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (subtab === 'editor') {
          editorPane?.classList.remove('hidden');
          editorPane?.classList.add('active');
          envPane?.classList.add('hidden');
          envPane?.classList.remove('active');
          getEditor(`editor-main-${fnName}`)?.layout();
        } else {
          envPane?.classList.remove('hidden');
          envPane?.classList.add('active');
          editorPane?.classList.add('hidden');
          editorPane?.classList.remove('active');
        }
      });
    });

    // Load initial code and env from in-memory session or backend
    const session = this.getSession(fnName);
    if (!session.isLoaded) {
      let codeContent = fn.code || '';
      let envMap = new Map();
      try {
        const codeRes = await getFunctionCode(fnName);
        if (codeRes && codeRes.code) {
          codeContent = codeRes.code;
          if (codeRes.environment) {
            Object.entries(codeRes.environment).forEach(([k, v]) => envMap.set(k, v));
          }
        }
      } catch {
        // fallback
      }
      session.code = codeContent;
      session.envMap = envMap;
      session.isLoaded = true;
    }

    this.renderEnvRows(fnName);

    // Add env variable button
    const addEnvBtn = ws.querySelector('.btn-add-env');
    addEnvBtn?.addEventListener('click', () => {
      const newKey = `KEY_${session.envMap.size + 1}`;
      session.envMap.set(newKey, '');
      this.renderEnvRows(fnName);
    });

    // Initialize Monaco Editor
    const editorContainer = ws.querySelector('.workspace-main-editor');
    if (editorContainer) {
      const editorInstance = await createEditor(editorContainer, {
        id: `editor-main-${fnName}`,
        value: session.code,
        language: 'python'
      });
      editorInstance?.onDidChangeModelContent(() => {
        session.code = editorInstance.getValue();
      });
    }

    // Deploy button
    const deployBtn = ws.querySelector('.btn-deploy');
    deployBtn?.addEventListener('click', async () => {
      const editorInstance = getEditor(`editor-main-${fnName}`);
      const latestCode = editorInstance ? editorInstance.getValue() : session.code;

      // Directly validate and collect from current DOM inputs in Environment pane
      const envRows = ws.querySelectorAll('.env-row');
      const envObj = {};
      let hasEnvError = false;

      envRows.forEach(row => {
        const keyInput = row.querySelector('.env-key-input');
        const valInput = row.querySelector('.env-val-input');
        const errSpan = row.querySelector('.env-key-error');
        const rawKey = keyInput ? keyInput.value.trim() : '';
        const rawVal = valInput ? valInput.value : '';

        if (rawKey) {
          const { isValid, error } = validateEnvKey(rawKey);
          if (!isValid) {
            hasEnvError = true;
            keyInput?.classList.add('input-invalid');
            if (errSpan) errSpan.textContent = error || 'Geçersiz değişken adı';
            Toast.error(error);
          } else {
            keyInput?.classList.remove('input-invalid');
            if (errSpan) errSpan.textContent = '';
            envObj[rawKey] = rawVal;
          }
        }
      });

      if (hasEnvError) {
        return; // Abort deploy if any key is invalid!
      }

      // Determine isUpdate: true only if already deployed before (ready/deployed)
      const currentFn = this.functionsData.find(f => f.name === fnName);
      const isUpdate = Boolean(currentFn && (currentFn.ready || currentFn.deployed || (currentFn.revisions && currentFn.revisions.length > 0)));

      // Set deploying visual state immediately (in list and workspace header)
      if (currentFn) {
        currentFn.deploying = true;
        this.renderList();
        const statusBadgeSlot = ws.querySelector('.workspace-status-badge-slot');
        if (statusBadgeSlot) statusBadgeSlot.innerHTML = this.getStatusBadge(currentFn);
      }

      // Format console container wrapper for DeployManager
      const consoleWrapper = ws.querySelector('.ide-output-container');

      await DeployManager.runDeploy({
        functionName: fnName,
        code: latestCode,
        isUpdate: isUpdate,
        envVars: envObj,
        consoleElement: consoleWrapper,
        deployBtn,
        onComplete: () => {
          if (currentFn) {
            currentFn.deploying = false;
            currentFn.ready = true;
            currentFn.deployed = true;
          }
          session.code = latestCode;
          this.loadFunctions(true);
        },
        onError: () => {
          if (currentFn) {
            currentFn.deploying = false;
            this.renderList();
            const statusBadgeSlot = ws.querySelector('.workspace-status-badge-slot');
            if (statusBadgeSlot) statusBadgeSlot.innerHTML = this.getStatusBadge(currentFn);
          }
        }
      });
    });
  },

  renderEnvRows(fnName) {
    const ws = this.workspaceContainer;
    const container = ws?.querySelector('.env-rows-list');
    if (!container) return;

    const session = this.getSession(fnName);
    const envMap = session.envMap;
    if (envMap.size === 0) {
      container.innerHTML = `<div class="text-muted p-2">Henüz ortam değişkeni tanımlanmadı.</div>`;
      return;
    }

    let rows = '';
    let idx = 0;
    for (const [k, v] of envMap.entries()) {
      const { isValid, error } = validateEnvKey(k);
      const invalidClass = (k && !isValid) ? ' input-invalid' : '';
      const errorText = (k && !isValid) ? (error || '') : '';
      rows += `
        <div class="env-row" data-index="${idx}" style="align-items: flex-start; margin-bottom: 10px;">
          <div class="env-key-col" style="flex: 1; display: flex; flex-direction: column;">
            <input type="text" class="input env-key-input${invalidClass}" placeholder="ANAHTAR (örn: API_KEY)" value="${escapeHtml(k)}" data-oldkey="${escapeHtml(k)}" />
            <span class="env-key-error text-danger" style="font-size: 11px; color: #f87171; min-height: 14px; margin-top: 3px;">${escapeHtml(errorText)}</span>
          </div>
          <div class="env-val-col" style="flex: 1; display: flex; flex-direction: column;">
            <input type="text" class="input env-val-input" placeholder="DEĞER" value="${escapeHtml(v)}" data-key="${escapeHtml(k)}" />
          </div>
          <button class="icon-btn delete-env-btn" data-key="${escapeHtml(k)}" title="Değişkeni Sil" style="margin-top: 6px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;
      idx++;
    }
    container.innerHTML = rows;

    container.querySelectorAll('.env-key-input').forEach(input => {
      input.addEventListener('input', () => {
        const val = input.value.trim();
        const row = input.closest('.env-row');
        const errSpan = row?.querySelector('.env-key-error');
        if (val) {
          const { isValid, error } = validateEnvKey(val);
          if (!isValid) {
            input.classList.add('input-invalid');
            if (errSpan) errSpan.textContent = error || 'Geçersiz değişken adı';
          } else {
            input.classList.remove('input-invalid');
            if (errSpan) errSpan.textContent = '';
          }
        } else {
          input.classList.remove('input-invalid');
          if (errSpan) errSpan.textContent = '';
        }
      });

      input.addEventListener('change', () => {
        const oldKey = input.getAttribute('data-oldkey');
        const newKey = input.value.trim();
        if (oldKey !== newKey && newKey) {
          const val = session.envMap.get(oldKey) || '';
          session.envMap.delete(oldKey);
          session.envMap.set(newKey, val);
          this.renderEnvRows(fnName);
        }
      });
    });

    container.querySelectorAll('.env-val-input').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.getAttribute('data-key');
        if (session.envMap && key) {
          session.envMap.set(key, input.value);
        }
      });
    });

    container.querySelectorAll('.delete-env-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        if (session.envMap && key) {
          session.envMap.delete(key);
          this.renderEnvRows(fnName);
        }
      });
    });
  },

  async setupTestTab(fn) {
    const fnName = fn.name;
    const ws = this.workspaceContainer;
    if (!ws) return;

    const session = this.getSession(fnName);
    const testReqContainer = ws.querySelector('.workspace-test-editor');
    if (testReqContainer) {
      const existing = getEditor(`editor-test-req-${fnName}`);
      const isConnected = existing && testReqContainer.contains(existing.getDomNode());
      if (!isConnected) {
        const testEditor = await createEditor(testReqContainer, {
          id: `editor-test-req-${fnName}`,
          value: session.testBody || JSON.stringify({ key1: "value1" }, null, 2),
          language: 'json',
          fontSize: 14.5
        });
        testEditor?.onDidChangeModelContent(() => {
          session.testBody = testEditor.getValue();
        });
      } else {
        existing.layout();
      }
    }

    const testBtn = ws.querySelector('.btn-run-test');
    if (!testBtn || testBtn.dataset.bound === 'true') {
      return;
    }
    testBtn.dataset.bound = 'true';

    // Toggle details button
    const toggleBtn = ws.querySelector('.lambda-toggle-btn');
    const detailsBody = ws.querySelector('.lambda-details-body');
    toggleBtn?.addEventListener('click', () => {
      const isOpen = toggleBtn.classList.contains('open');
      if (isOpen) {
        toggleBtn.classList.remove('open');
        detailsBody?.classList.add('hidden');
      } else {
        toggleBtn.classList.add('open');
        detailsBody?.classList.remove('hidden');
      }
    });

    // Test button
    testBtn.addEventListener('click', async () => {
      if (testBtn.disabled) return;

      if (!fn.deployed && !fn.ready) {
        Toast.info("Fonksiyon henüz cluster'a deploy edilmedi. Lütfen önce Kod sekmesinden 'Deploy' butonuna basın.");
        return;
      }

      const editor = getEditor(`editor-test-req-${fnName}`);
      let reqBody = {};
      try {
        reqBody = JSON.parse(editor ? editor.getValue() : '{}');
      } catch {
        Toast.error('Geçersiz JSON formatı!');
        return;
      }

      const defaultBtnHtml = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span>Test Et</span>`;
      testBtn.disabled = true;
      testBtn.innerHTML = `<span class="spinner"></span> <span>İstek Gönderiliyor...</span>`;

      const resultBox = ws.querySelector('.lambda-result-box');
      const iconEl = ws.querySelector('.lambda-status-icon');
      const titleEl = ws.querySelector('.lambda-status-title');
      const badgeEl = ws.querySelector('.lambda-status-badge');
      const durEl = ws.querySelector('.lambda-duration-tag');
      const bodyPre = ws.querySelector('.lambda-response-pre');

      try {
        const res = await proxyRequest({
          url: fn.url,
          method: 'POST',
          body: reqBody
        });

        const isSuccess = res.statusCode >= 200 && res.statusCode < 300;

        if (resultBox) {
          resultBox.classList.remove('hidden', 'lambda-test-success', 'lambda-test-fail');
          resultBox.classList.add(isSuccess ? 'lambda-test-success' : 'lambda-test-fail');
        }

        if (iconEl) iconEl.textContent = isSuccess ? '✔' : '✖';
        if (titleEl) titleEl.textContent = isSuccess ? 'Yürütme işlevi: başarılı' : 'Yürütme işlevi: başarısız';
        if (badgeEl) {
          badgeEl.textContent = `${res.statusCode} ${isSuccess ? 'OK' : 'Error'}`;
          badgeEl.className = `badge ${isSuccess ? 'badge-ready' : 'badge-not-ready'}`;
        }
        if (durEl) durEl.textContent = `${res.durationMs} ms`;
        if (bodyPre) {
          bodyPre.textContent = typeof res.body === 'object' ? JSON.stringify(res.body, null, 2) : String(res.body);
        }

        // Ensure details are visible on new test run
        toggleBtn?.classList.add('open');
        detailsBody?.classList.remove('hidden');

        if (isSuccess) {
          Toast.success(`Test başarılı (${res.durationMs}ms)`);
        } else {
          Toast.error(`Test başarısız (${res.statusCode})`);
        }
      } catch (err) {
        if (resultBox) {
          resultBox.classList.remove('hidden', 'lambda-test-success');
          resultBox.classList.add('lambda-test-fail');
        }
        if (iconEl) iconEl.textContent = '✖';
        if (titleEl) titleEl.textContent = 'Yürütme işlevi: başarısız';
        if (badgeEl) {
          badgeEl.textContent = '500 Error';
          badgeEl.className = 'badge badge-not-ready';
        }
        if (durEl) durEl.textContent = '0 ms';
        if (bodyPre) {
          bodyPre.textContent = JSON.stringify({ errorMessage: err.message, errorType: 'ExecutionError' }, null, 2);
        }

        toggleBtn?.classList.add('open');
        detailsBody?.classList.remove('hidden');
        Toast.error(`Test hatası: ${err.message}`);
      } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = defaultBtnHtml;
      }
    });
  },

  async setupMonitorTab(fn) {
    const fnName = fn.name;
    const ws = this.workspaceContainer;
    const refreshBtn = ws?.querySelector('.btn-refresh-logs');

    if (!fn.deployed && !fn.ready) {
      const logsTerminal = ws?.querySelector('.logs-terminal');
      if (logsTerminal) {
        logsTerminal.innerHTML = `<div class="text-muted">Fonksiyon henüz cluster'a deploy edilmediği için pod logu bulunmuyor.</div>`;
      }
      return;
    }

    this.loadLogs(fnName, 100);

    if (refreshBtn && refreshBtn.dataset.bound !== 'true') {
      refreshBtn.dataset.bound = 'true';
      refreshBtn.addEventListener('click', () => {
        this.loadLogs(fnName, 100);
      });
    }
  },

  async loadLogs(fnName, tail = 100) {
    const ws = this.workspaceContainer;
    const logsTerminal = ws?.querySelector('.logs-terminal');
    if (!logsTerminal) return;

    logsTerminal.innerHTML = `<div class="text-muted">Loglar yükleniyor...</div>`;

    try {
      const data = await getFunctionLogs(fnName, tail);
      const logs = data.logs || [];
      if (logs.length === 0) {
        logsTerminal.innerHTML = `<div class="text-muted">${escapeHtml(data.message || 'Kayıtlı pod logu bulunmuyor (fonksiyon sıfıra ölçeklenmiş olabilir).')}</div>`;
        return;
      }
      logsTerminal.innerHTML = logs
        .map(l => `<div class="log-line">${escapeHtml(l)}</div>`)
        .join('');
      logsTerminal.scrollTop = logsTerminal.scrollHeight;
    } catch (err) {
      logsTerminal.innerHTML = `<div class="log-line text-danger">Loglar alınamadı: ${escapeHtml(err.message)}</div>`;
    }
  },

  async setupRevisionsTab(fn) {
    const fnName = fn.name;
    const ws = this.workspaceContainer;
    const revisionsContainer = ws?.querySelector('.revisions-wrapper');
    if (!revisionsContainer) return;

    try {
      const res = await getFunctionRevisions(fnName);
      const revisions = res.revisions || [];

      if (revisions.length === 0) {
        revisionsContainer.innerHTML = `<div class="text-muted p-3">Henüz sürüm geçmişi bulunmuyor.</div>`;
        return;
      }

      let rows = `
        <table class="revisions-table">
          <thead>
            <tr>
              <th>Revision</th>
              <th>Tarih</th>
              <th>Durum</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
      `;

      revisions.forEach(rev => {
        const isActive = rev.is_active;
        const isReady = rev.is_ready !== false;

        let statusBadge = '';
        if (isActive) {
          statusBadge = '<span class="badge badge-active">✅ Aktif</span>';
        } else if (!isReady) {
          statusBadge = '<span class="badge badge-not-ready">❌ Hatalı</span>';
        } else {
          statusBadge = '<span class="badge badge-passive">⬜ Pasif</span>';
        }

        let actionButtons = '';
        if (!isActive) {
          if (isReady) {
            actionButtons += `<button class="btn btn-secondary btn-xs btn-rollback" data-fn="${escapeHtml(fnName)}" data-rev="${escapeHtml(rev.name)}">Rollback</button> `;
          }
          actionButtons += `<button class="btn btn-secondary btn-xs btn-load-code" data-fn="${escapeHtml(fnName)}" data-rev="${escapeHtml(rev.name)}">Kodu Yükle</button>`;
        } else {
          actionButtons = '—';
        }

        rows += `
          <tr>
            <td><code class="revision-code">${escapeHtml(rev.name)}</code></td>
            <td>${formatDate(rev.created_at)}</td>
            <td>${statusBadge}</td>
            <td>${actionButtons}</td>
          </tr>
        `;
      });

      rows += `</tbody></table>`;
      revisionsContainer.innerHTML = rows;

      // Bind Rollback
      revisionsContainer.querySelectorAll('.btn-rollback').forEach(btn => {
        btn.addEventListener('click', async () => {
          const rName = btn.getAttribute('data-rev');
          const confirmed = await Modal.confirm({
            title: 'Sürümü Geri Al (Rollback)',
            message: `Trafiği '${rName}' sürümüne yönlendirmek istediğinize emin misiniz?`,
            confirmText: 'Rollback Yap',
            type: 'primary'
          });

          if (confirmed) {
            try {
              const rbRes = await rollbackRevision(fnName, rName);
              Toast.success(rbRes.message || 'Rollback tamamlandı.');
              this.setupRevisionsTab(fn);
            } catch (err) {
              Toast.error(`Rollback başarısız: ${err.message}`);
            }
          }
        });
      });

      // Bind Load Code
      revisionsContainer.querySelectorAll('.btn-load-code').forEach(btn => {
        btn.addEventListener('click', async () => {
          const rName = btn.getAttribute('data-rev');
          try {
            const revCodeRes = await getRevisionCode(fnName, rName);
            if (revCodeRes && revCodeRes.code) {
              const session = this.getSession(fnName);
              session.code = revCodeRes.code;

              const editor = getEditor(`editor-main-${fnName}`);
              if (editor) {
                editor.setValue(revCodeRes.code);
              }

              Toast.success(`'${rName}' sürümünün kodu editöre yüklendi.`);

              // Switch to Code Tab
              const codeTabBtn = ws.querySelector('.panel-tab-btn[data-tab="code"]');
              codeTabBtn?.click();
            }
          } catch (err) {
            Toast.error(`Sürüm kodu yüklenemedi: ${err.message}`);
          }
        });
      });
    } catch (err) {
      revisionsContainer.innerHTML = `<div class="text-danger p-3">Sürümler yüklenemedi: ${escapeHtml(err.message)}</div>`;
    }
  }
};
