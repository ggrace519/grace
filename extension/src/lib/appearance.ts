import type { AppearanceSettings } from './storage';

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'dark',
  density: 'normal',
  accentColor: '#4ade80',
};

export const ACCENT_PRESETS: string[] = [
  '#4ade80', // green
  '#60a5fa', // blue
  '#a78bfa', // purple
  '#fb923c', // orange
  '#f87171', // red
  '#facc15', // yellow
  '#2dd4bf', // teal
  '#f472b6', // pink
];

export function resolveTheme(theme: AppearanceSettings['theme']): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

export function applyAppearance(settings: AppearanceSettings): void {
  const root = document.documentElement;
  root.setAttribute('data-grace-theme', resolveTheme(settings.theme));
  root.setAttribute('data-grace-density', settings.density);
  root.style.setProperty('--grace-accent', settings.accentColor);
  const hex = settings.accentColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  root.style.setProperty('--grace-accent-bg', `rgba(${r}, ${g}, ${b}, 0.12)`);
}

export async function loadAndApplyAppearance(): Promise<AppearanceSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['appearance'], (data: Record<string, any>) => {
      const settings: AppearanceSettings = {
        ...DEFAULT_APPEARANCE,
        ...(data.appearance ?? {}),
      };
      applyAppearance(settings);
      resolve(settings);
    });
  });
}
