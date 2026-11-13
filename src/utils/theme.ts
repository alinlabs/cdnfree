import type { ThemeMode } from '../types/settings';

const THEME_COLOR_HEX: Record<ThemeMode, string> = {
  light: '#ffffff',
  dark: '#111113',
};

export function resolveThemeMode(value: unknown): ThemeMode {
  return value === 'light' ? 'light' : 'dark';
}

export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = theme === 'dark';

  root.classList.toggle('dark', isDark);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', THEME_COLOR_HEX[theme]);
  }
}
