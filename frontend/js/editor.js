/**
 * Monaco Editor loader, lifecycle manager, and multi-file model management.
 */

import { ThemeManager } from './theme.js';


let isMonacoReady = false;
let monacoReadyPromise = null;
const editorInstances = new Map();
const editorModels = new Map();
const editorViewStates = new Map();

const EXTENSION_LANGUAGE_MAP = {
  'py': 'python',
  'json': 'json',
  'yaml': 'yaml',
  'yml': 'yaml',
  'txt': 'plaintext',
  'sql': 'sql',
  'md': 'markdown',
  'csv': 'plaintext',
  'ini': 'ini',
  'xml': 'xml',
  'env': 'plaintext',
};

// Top-level listener for theme changes across all editors
if (typeof window !== 'undefined') {
  window.addEventListener('themechange', (e) => {
    const currentTheme = e.detail?.theme || ThemeManager.currentTheme;
    const monacoTheme = currentTheme === 'light' ? 'vs' : 'vs-dark';
    if (window.monaco && window.monaco.editor) {
      window.monaco.editor.setTheme(monacoTheme);
    }
  });
}

/**
 * Determine Monaco language from file path extension.
 * @param {string} filePath
 * @returns {string}
 */
export function getLanguageForFile(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_LANGUAGE_MAP[ext] || 'plaintext';
}

/**
 * Initializes Monaco loader CDN.
 * @returns {Promise<void>}
 */
export function initMonaco() {
  if (monacoReadyPromise) return monacoReadyPromise;

  monacoReadyPromise = new Promise((resolve, reject) => {
    if (window.monaco) {
      isMonacoReady = true;
      window.monaco.editor.setTheme(ThemeManager.getMonacoTheme());
      resolve();
      return;
    }

    const applyCurrentTheme = () => {
      isMonacoReady = true;
      if (window.monaco && window.monaco.editor) {
        window.monaco.editor.setTheme(ThemeManager.getMonacoTheme());
      }
      resolve();
    };

    if (!window.require) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs/loader.js';
      script.onload = () => {
        window.require.config({
          paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' }
        });
        window.require(['vs/editor/editor.main'], () => {
          applyCurrentTheme();
        });
      };
      script.onerror = (err) => {
        console.error('Failed to load Monaco editor:', err);
        reject(err);
      };
      document.head.appendChild(script);
    } else {
      window.require.config({
        paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' }
      });
      window.require(['vs/editor/editor.main'], () => {
        applyCurrentTheme();
      });
    }
  });

  return monacoReadyPromise;
}

/**
 * Creates or retrieves a Monaco editor instance for a container.
 * @param {HTMLElement|string} container
 * @param {Object} options
 * @param {string} [options.id]
 * @param {string} [options.value='']
 * @param {string} [options.language='python']
 * @param {boolean} [options.readOnly=false]
 * @param {number} [options.fontSize=14]
 * @param {boolean} [options.minimap=false]
 * @returns {Promise<monaco.editor.IStandaloneCodeEditor>}
 */
export async function createEditor(container, options = {}) {
  await initMonaco();

  const element = typeof container === 'string' ? document.getElementById(container) : container;
  if (!element) throw new Error('Editor container element not found');

  const editorId = options.id || element.id || Math.random().toString(36).substring(7);

  // If already exists for this ID, dispose it first to avoid duplicate bindings
  if (editorInstances.has(editorId)) {
    const existing = editorInstances.get(editorId);
    existing.dispose();
    editorInstances.delete(editorId);
  }

  const isLight = document.documentElement.getAttribute('data-theme') === 'light' || localStorage.getItem('faas-theme') === 'light';
  const monacoTheme = isLight ? 'vs' : 'vs-dark';
  window.monaco.editor.setTheme(monacoTheme);

  const editor = window.monaco.editor.create(element, {
    value: options.value ?? '',
    language: options.language || 'python',
    theme: monacoTheme,
    minimap: { enabled: Boolean(options.minimap) },
    fontSize: options.fontSize || 14,
    lineHeight: options.lineHeight || 20,
    fontFamily: options.fontFamily || "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
    lineNumbers: options.lineNumbers !== undefined ? options.lineNumbers : 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    readOnly: options.readOnly ?? false,
    renderLineHighlight: options.renderLineHighlight || 'line',
    padding: options.padding || { top: 6, bottom: 6 },
    scrollbar: {
      alwaysConsumeMouseWheel: false
    }
  });

  editorInstances.set(editorId, editor);

  // Trigger layout refresh when element becomes visible
  const resizeObserver = new ResizeObserver(() => {
    if (element.offsetParent !== null) {
      editor.layout();
    }
  });
  resizeObserver.observe(element);

  return editor;
}

/**
 * Get or create a Monaco model for a specific file within an editor scope.
 * @param {string} editorId
 * @param {string} filePath
 * @param {string} content
 * @returns {monaco.editor.ITextModel}
 */
export function getOrCreateModel(editorId, filePath, content) {
  const key = `${editorId}::${filePath}`;
  if (editorModels.has(key)) {
    return editorModels.get(key);
  }
  const language = getLanguageForFile(filePath);
  const model = window.monaco.editor.createModel(content || '', language);
  editorModels.set(key, model);
  return model;
}

/**
 * Switch the editor to display a different file. Saves view state of current file.
 * @param {string} editorId
 * @param {string} filePath
 * @param {string} content - Fallback content if model doesn't exist yet
 */
export function switchEditorFile(editorId, filePath, content) {
  const editor = editorInstances.get(editorId);
  if (!editor) return;

  // Save current view state
  const currentModel = editor.getModel();
  if (currentModel) {
    const currentKey = _findModelKey(editorId, currentModel);
    if (currentKey) {
      editorViewStates.set(currentKey, editor.saveViewState());
    }
  }

  // Switch to target model
  const model = getOrCreateModel(editorId, filePath, content);
  editor.setModel(model);

  // Restore view state if previously saved
  const targetKey = `${editorId}::${filePath}`;
  const savedState = editorViewStates.get(targetKey);
  if (savedState) {
    editor.restoreViewState(savedState);
  }

  editor.focus();
}

/**
 * Update content of an existing model without switching to it.
 * @param {string} editorId
 * @param {string} filePath
 * @param {string} content
 */
export function updateModelContent(editorId, filePath, content) {
  const key = `${editorId}::${filePath}`;
  const model = editorModels.get(key);
  if (model) {
    model.setValue(content);
  }
}

/**
 * Dispose all models associated with an editor scope.
 * @param {string} editorId
 */
export function disposeEditorModels(editorId) {
  const prefix = `${editorId}::`;
  for (const [key, model] of editorModels.entries()) {
    if (key.startsWith(prefix)) {
      model.dispose();
      editorModels.delete(key);
      editorViewStates.delete(key);
    }
  }
}

/**
 * Retrieve active editor instance by ID.
 * @param {string} id
 * @returns {monaco.editor.IStandaloneCodeEditor|undefined}
 */
export function getEditor(id) {
  return editorInstances.get(id);
}

/**
 * Dispose editor instance by ID and all its associated models.
 * @param {string} id
 */
export function disposeEditor(id) {
  disposeEditorModels(id);
  if (editorInstances.has(id)) {
    const editor = editorInstances.get(id);
    editor.dispose();
    editorInstances.delete(id);
  }
}

/**
 * Find the model key for a given Monaco model within an editor scope.
 * @param {string} editorId
 * @param {monaco.editor.ITextModel} model
 * @returns {string|null}
 */
function _findModelKey(editorId, model) {
  const prefix = `${editorId}::`;
  for (const [key, m] of editorModels.entries()) {
    if (key.startsWith(prefix) && m === model) {
      return key;
    }
  }
  return null;
}

/**
 * Get the file path from an editor's currently active model.
 * @param {string} editorId
 * @returns {string|null}
 */
export function getActiveFilePath(editorId) {
  const editor = editorInstances.get(editorId);
  if (!editor) return null;

  const currentModel = editor.getModel();
  if (!currentModel) return null;

  const key = _findModelKey(editorId, currentModel);
  if (!key) return null;

  return key.split('::')[1] || null;
}
