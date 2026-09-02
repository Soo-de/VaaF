/**
 * Monaco Editor loader and lifecycle manager.
 */

import { ThemeManager } from './theme.js?v=3.3';


let isMonacoReady = false;
let monacoReadyPromise = null;
const editorInstances = new Map();

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
    minimap: { enabled: options.minimap ?? false },
    fontSize: options.fontSize || 15.5,
    lineHeight: 22,
    fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
    lineNumbers: options.lineNumbers !== undefined ? options.lineNumbers : 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    readOnly: options.readOnly ?? false,
    renderLineHighlight: 'all',
    padding: { top: 14, bottom: 14 }
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
 * Retrieve active editor instance by ID.
 * @param {string} id
 * @returns {monaco.editor.IStandaloneCodeEditor|undefined}
 */
export function getEditor(id) {
  return editorInstances.get(id);
}

/**
 * Dispose editor instance by ID.
 * @param {string} id
 */
export function disposeEditor(id) {
  if (editorInstances.has(id)) {
    const editor = editorInstances.get(id);
    editor.dispose();
    editorInstances.delete(id);
  }
}
