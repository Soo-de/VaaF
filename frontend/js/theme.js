/**
 * Dark/Light theme manager with localStorage persistence and Monaco sync.
 */

const THEME_STORAGE_KEY = 'faas-theme';

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    const dom = document.documentElement.getAttribute('data-theme');
    if (dom === 'light' || dom === 'dark') return dom;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch { }
  return 'dark';
}

export const ThemeManager = {
  currentTheme: getInitialTheme(),

  init() {
    const theme = getInitialTheme();
    this.setTheme(theme, false);

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem(THEME_STORAGE_KEY)) {
          this.setTheme(e.matches ? 'dark' : 'light', false);
        }
      });
    }

    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.toggle();
      });
    }
  },

  /**
   * Set specific theme.
   * @param {'dark'|'light'} theme
   * @param {boolean} [persist=true]
   */
  setTheme(theme, persist = true) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }

    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) {
      toggleBtn.setAttribute('title', theme === 'dark' ? 'Açık Temaya Geç' : 'Koyu Temaya Geç');
      toggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Açık Temaya Geç' : 'Koyu Temaya Geç');
    }

    if (window.monaco && window.monaco.editor) {
      window.monaco.editor.setTheme(this.getMonacoTheme());
    }

    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  },

  /**
   * Toggle between dark and light themes.
   */
  toggle() {
    const nextTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(nextTheme, true);
  },

  getMonacoTheme() {
    const active = document.documentElement.getAttribute('data-theme') || this.currentTheme;
    return active === 'light' ? 'vs' : 'vs-dark';
  }
};
