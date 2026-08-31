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
} from './api.js?v=3.0';
import { createEditor, getEditor, disposeEditor } from './editor.js?v=3.0';
import { DeployManager } from './deploy.js?v=3.0';
import { Toast, Modal, copyToClipboard, escapeHtml, formatDate, validateEnvKey } from './utils.js?v=3.0';


export const FunctionsManager = {
  listContainer: null,
  workspaceContainer: null,
  activeFunctionName: null,
  functionsData: [],
  envVarsState: new Map(),
  testBodyState: new Map(),
  searchQuery: '',
  searchBound: false,

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
    const fnName = escapeHtml(fn.name);
    const statusBadge = this.getStatusBadge(fn);
    const runtimeIcon = this.getRuntimeIcon(fn.runtime);

    this.workspaceContainer.innerHTML = `
      <div class="workspace-header">
        <div class="workspace-header-left">
          <div class="workspace-title-group">
            ${runtimeIcon}
            <h3 class="workspace-title">${fnName}</h3>
            ${statusBadge}
          </div>
          <div class="workspace-url-box">
            <span class="url-text" title="${escapeHtml(fn.url)}">${escapeHtml(fn.url)}</span>
            <button class="icon-btn copy-url-btn" data-url="${escapeHtml(fn.url)}" title="Kopyala">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>
        </div>

        <div class="workspace-header-right">
          <button class="icon-btn workspace-close-btn" title="Kapat">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="panel-tabs-bar">
        <button class="panel-tab-btn active" data-tab="code">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
          <span>Kod</span>
        </button>
        <button class="panel-tab-btn" data-tab="test">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>Test</span>
        </button>
        <button class="panel-tab-btn" data-tab="revisions">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
          <span>Sürümler</span>
        </button>
        <button class="panel-tab-btn tab-disabled" data-tab="monitor" disabled title="Bu özellik MVP'de aktif değildir">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          <span>Monitor</span>
          <span class="badge badge-soon">Yakında</span>
        </button>
      </div>

      <!-- Tab 1: Kod (IDE & HackerRank Style Split View) -->
      <div class="panel-tab-content active" id="tab-content-code-${fnName}">
        <div class="editor-action-bar">
          <div class="code-subtabs-bar">
            <button class="subtab-btn active" data-subtab="editor">Editor</button>
            <button class="subtab-btn" data-subtab="env">Environment</button>
          </div>

          <div class="action-btn-group">
            <button class="btn btn-run" id="run-code-btn-${fnName}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>Run Code</span>
            </button>
            <button class="btn btn-primary btn-deploy" id="deploy-btn-${fnName}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v10m0 0l-4-4m4 4l4-4M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"></path></svg>
              <span>Deploy</span>
            </button>
          </div>
        </div>

        <div class="code-ide-layout">
          <!-- Editor Pane -->
          <div class="ide-editor-container">
            <div class="subtab-pane active" id="pane-editor-${fnName}">
              <div class="editor-wrapper">
                <div id="editor-container-${fnName}" class="monaco-editor-instance"></div>
              </div>
            </div>

            <div class="subtab-pane hidden" id="pane-env-${fnName}">
              <div class="env-vars-manager" id="env-vars-container-${fnName}">
                <div class="env-table-header">
                  <span>Anahtar (Key)</span>
                  <span>Değer (Value)</span>
                  <span>İşlem</span>
                </div>
                <div class="env-rows-list" id="env-rows-${fnName}"></div>
                <button class="btn btn-secondary btn-sm mt-3" id="add-env-btn-${fnName}">
                  + Değişken Ekle
                </button>
              </div>
            </div>
          </div>

          <!-- HackerRank-style Output Pane -->
          <div class="ide-output-container">
            <div class="output-header">
              <span class="output-tab-title">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                Output & Deploy Console
              </span>
            </div>
            <div class="console-body" id="console-body-${fnName}">
              <div class="console-line text-muted">Kodu çalıştırmak için "Run Code", canlıya almak için "Deploy" butonuna basın.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 2: Test -->
      <div class="panel-tab-content hidden" id="tab-content-test-${fnName}">
        <div class="test-layout-wrapper">
          <!-- Request Box -->
          <div class="test-request-box">
            <div class="section-title">Request Body (JSON)</div>
            <div id="editor-test-req-${fnName}" class="monaco-test-editor"></div>
            <button class="btn btn-primary mt-3" id="run-test-btn-${fnName}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>Test Et</span>
            </button>
          </div>

          <!-- Lambda Style Result Card (Hidden until tested) -->
          <div class="lambda-test-card hidden" id="test-result-box-${fnName}">
            <div class="lambda-test-header">
              <div class="lambda-header-left">
                <span class="lambda-status-icon" id="lambda-status-icon-${fnName}">✔</span>
                <span class="lambda-status-title" id="lambda-status-title-${fnName}">Yürütme işlevi: başarılı</span>
              </div>
              <button class="lambda-toggle-btn open" id="lambda-toggle-btn-${fnName}">
                <svg class="lambda-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                <span>Ayrıntılar</span>
              </button>
            </div>

            <div class="lambda-details-body" id="lambda-details-${fnName}">
              <div class="lambda-response-section">
                <div class="lambda-response-header">
                  <span class="lambda-section-subtitle">Response</span>
                  <div class="lambda-meta-tags">
                    <span class="badge" id="lambda-status-badge-${fnName}">200 OK</span>
                    <span class="lambda-duration-tag" id="lambda-duration-tag-${fnName}">0 ms</span>
                  </div>
                </div>
                <pre class="lambda-response-pre" id="lambda-response-pre-${fnName}"></pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 3: Sürümler -->
      <div class="panel-tab-content hidden" id="tab-content-revisions-${fnName}">
        <div class="revisions-wrapper" id="revisions-list-${fnName}">
          <div class="text-muted p-3">Sürümler yükleniyor...</div>
        </div>
      </div>
    `;

    this.bindWorkspaceEvents(fn);
  },

  async bindWorkspaceEvents(fn) {
    const fnName = fn.name;
    const ws = this.workspaceContainer;

    // Close button
    ws.querySelector('.workspace-close-btn')?.addEventListener('click', () => {
      this.closeWorkspace();
      this.renderList();
    });

    // Copy URL
    ws.querySelector('.workspace-url-box .copy-url-btn')?.addEventListener('click', () => {
      copyToClipboard(fn.url, 'Fonksiyon URL\'i panoya kopyalandı');
    });

    // Main Tab Switcher
    const tabBtns = ws.querySelectorAll('.panel-tab-btn:not(.tab-disabled)');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        ws.querySelectorAll('.panel-tab-content').forEach(c => {
          c.classList.add('hidden');
          c.classList.remove('active');
        });

        const activeContent = ws.querySelector(`#tab-content-${targetTab}-${fnName}`);
        if (activeContent) {
          activeContent.classList.remove('hidden');
          activeContent.classList.add('active');
        }

        if (targetTab === 'test') {
          this.setupTestTab(fn);
        } else if (targetTab === 'revisions') {
          this.setupRevisionsTab(fn);
        } else if (targetTab === 'code') {
          getEditor(`editor-main-${fnName}`)?.layout();
        }
      });
    });

    // Subtabs: Editor vs Env
    const subtabBtns = ws.querySelectorAll('.subtab-btn');
    subtabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const subtab = btn.getAttribute('data-subtab');
        subtabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const editorPane = ws.querySelector(`#pane-editor-${fnName}`);
        const envPane = ws.querySelector(`#pane-env-${fnName}`);

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

    // Load initial code and env
    let codeContent = fn.code || '';
    let envMap = new Map();
    try {
      const codeRes = await getFunctionCode(fnName);
      if (codeRes && codeRes.code) {
        codeContent = codeRes.code;
        if (codeRes.env) {
          Object.entries(codeRes.env).forEach(([k, v]) => envMap.set(k, v));
        }
      }
    } catch {
      // fallback
    }

    this.envVarsState.set(fnName, envMap);
    this.renderEnvRows(fnName);

    // Add env variable button
    const addEnvBtn = ws.querySelector(`#add-env-btn-${fnName}`);
    addEnvBtn?.addEventListener('click', () => {
      const currentMap = this.envVarsState.get(fnName) || new Map();
      const newKey = `KEY_${currentMap.size + 1}`;
      currentMap.set(newKey, '');
      this.envVarsState.set(fnName, currentMap);
      this.renderEnvRows(fnName);
    });

    // Initialize Monaco Editor
    const editorContainer = ws.querySelector(`#editor-container-${fnName}`);
    if (editorContainer) {
      await createEditor(editorContainer, {
        id: `editor-main-${fnName}`,
        value: codeContent,
        language: 'python'
      });
    }

    // Run Code Button (HackerRank style quick runner)
    const runBtn = ws.querySelector(`#run-code-btn-${fnName}`);
    runBtn?.addEventListener('click', async () => {
      const editorInstance = getEditor(`editor-main-${fnName}`);
      const latestCode = editorInstance ? editorInstance.getValue() : codeContent;
      const targetConsoleBody = ws.querySelector(`#console-body-${fnName}`) || ws.querySelector('.console-body');

      const origHtml = runBtn.innerHTML;
      runBtn.disabled = true;
      runBtn.innerHTML = `<span class="spinner"></span> <span>Çalışıyor...</span>`;

      if (targetConsoleBody) {
        const timestamp = new Date().toLocaleTimeString('tr-TR');
        targetConsoleBody.innerHTML = `
          <div class="console-line"><span class="console-ts">[${timestamp}]</span> <strong class="console-step">▶ Kod çalıştırılıyor (Local / Proxy Execution)...</strong></div>
        `;
      }

      try {
        const startTime = performance.now();
        const res = await proxyRequest({
          url: fn.url,
          method: 'POST',
          body: { name: 'Test Runner' }
        });
        const duration = Math.round(performance.now() - startTime);

        if (targetConsoleBody) {
          const timestamp = new Date().toLocaleTimeString('tr-TR');
          const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
          const statusClass = isSuccess ? 'dot-green' : 'dot-red';

          targetConsoleBody.innerHTML += `
            <div class="console-line"><span class="console-ts">[${timestamp}]</span> <span class="badge ${isSuccess ? 'badge-ready' : 'badge-not-ready'}"><span class="status-dot ${statusClass}"></span> Status: ${res.statusCode} OK</span> <span class="text-muted">(${duration}ms)</span></div>
            <div class="console-line mt-1"><strong>Program Çıktısı (stdout / return):</strong></div>
            <pre class="console-output-pre">${escapeHtml(JSON.stringify(res.body, null, 2))}</pre>
          `;
          targetConsoleBody.scrollTop = targetConsoleBody.scrollHeight;
        }

        Toast.success(`Kod başarıyla çalıştırıldı (${duration}ms)`);
      } catch (err) {
        if (targetConsoleBody) {
          targetConsoleBody.innerHTML += `<div class="console-line console-error">❌ Hata: ${escapeHtml(err.message)}</div>`;
        }
        Toast.error(`Çalıştırma hatası: ${err.message}`);
      } finally {
        runBtn.disabled = false;
        runBtn.innerHTML = origHtml;
      }
    });

    // Deploy button
    const deployBtn = ws.querySelector(`#deploy-btn-${fnName}`);
    deployBtn?.addEventListener('click', async () => {
      const editorInstance = getEditor(`editor-main-${fnName}`);
      const latestCode = editorInstance ? editorInstance.getValue() : codeContent;

      // Directly validate and collect from current DOM inputs in Environment pane
      const envRows = ws.querySelectorAll(`#env-rows-${fnName} .env-row`);
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
            currentFn.ready = true;
            currentFn.deployed = true;
          }
          this.loadFunctions(true);
        }
      });
    });
  },

  renderEnvRows(fnName) {
    const ws = this.workspaceContainer;
    const container = ws?.querySelector(`#env-rows-${fnName}`);
    if (!container) return;

    const envMap = this.envVarsState.get(fnName) || new Map();
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
        const map = this.envVarsState.get(fnName);
        if (oldKey !== newKey && newKey) {
          const val = map.get(oldKey) || '';
          map.delete(oldKey);
          map.set(newKey, val);
          this.renderEnvRows(fnName);
        }
      });
    });

    container.querySelectorAll('.env-val-input').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.getAttribute('data-key');
        const map = this.envVarsState.get(fnName);
        if (map && key) {
          map.set(key, input.value);
        }
      });
    });

    container.querySelectorAll('.delete-env-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        const map = this.envVarsState.get(fnName);
        if (map && key) {
          map.delete(key);
          this.renderEnvRows(fnName);
        }
      });
    });
  },



  async setupTestTab(fn) {
    const fnName = fn.name;
    const ws = this.workspaceContainer;
    if (!ws) return;

    const testReqContainer = ws.querySelector(`#editor-test-req-${fnName}`);
    if (testReqContainer && !getEditor(`editor-test-req-${fnName}`)) {
      const initialVal = this.testBodyState.get(fnName) || JSON.stringify({ key1: "value1" }, null, 2);
      const testEditor = await createEditor(testReqContainer, {
        id: `editor-test-req-${fnName}`,
        value: initialVal,
        language: 'json',
        fontSize: 14.5
      });
      testEditor.onDidChangeModelContent(() => {
        this.testBodyState.set(fnName, testEditor.getValue());
      });
    } else {
      getEditor(`editor-test-req-${fnName}`)?.layout();
    }

    const testBtn = ws.querySelector(`#run-test-btn-${fnName}`);
    if (!testBtn || testBtn.dataset.bound === 'true') {
      return;
    }
    testBtn.dataset.bound = 'true';

    // Toggle details button
    const toggleBtn = ws.querySelector(`#lambda-toggle-btn-${fnName}`);
    const detailsBody = ws.querySelector(`#lambda-details-${fnName}`);
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

      const resultBox = ws.querySelector(`#test-result-box-${fnName}`);
      const iconEl = ws.querySelector(`#lambda-status-icon-${fnName}`);
      const titleEl = ws.querySelector(`#lambda-status-title-${fnName}`);
      const badgeEl = ws.querySelector(`#lambda-status-badge-${fnName}`);
      const durEl = ws.querySelector(`#lambda-duration-tag-${fnName}`);
      const bodyPre = ws.querySelector(`#lambda-response-pre-${fnName}`);

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

  async loadLogs(fnName) {
    const ws = this.workspaceContainer;
    const logsTerminal = ws?.querySelector(`#logs-terminal-${fnName}`);
    if (!logsTerminal) return;

    try {
      const data = await getFunctionLogs(fnName, 50);
      const logs = data.logs || [];
      if (logs.length === 0) {
        logsTerminal.innerHTML = `<div class="text-muted">Kayıtlı log bulunmuyor.</div>`;
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
    const revisionsContainer = ws?.querySelector(`#revisions-list-${fnName}`);
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
        rows += `
          <tr>
            <td><code class="revision-code">${escapeHtml(rev.name)}</code></td>
            <td>${formatDate(rev.created_at)}</td>
            <td>
              ${isActive
                ? '<span class="badge badge-active">✅ Aktif</span>'
                : '<span class="badge badge-passive">⬜ Pasif</span>'}
            </td>
            <td>
              ${!isActive ? `
                <button class="btn btn-secondary btn-xs btn-rollback" data-fn="${escapeHtml(fnName)}" data-rev="${escapeHtml(rev.name)}">Rollback</button>
                <button class="btn btn-secondary btn-xs btn-load-code" data-fn="${escapeHtml(fnName)}" data-rev="${escapeHtml(rev.name)}">Kodu Yükle</button>
              ` : '—'}
            </td>
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
            const editor = getEditor(`editor-main-${fnName}`);
            if (editor && revCodeRes && revCodeRes.code) {
              editor.setValue(revCodeRes.code);
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
