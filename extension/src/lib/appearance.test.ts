// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveTheme, applyAppearance, DEFAULT_APPEARANCE, ACCENT_PRESETS } from './appearance';
import type { AppearanceSettings } from './storage';

describe('resolveTheme', () => {
  it('returns dark for theme="dark"', () => {
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('returns light for theme="light"', () => {
    expect(resolveTheme('light')).toBe('light');
  });

  it('returns dark for theme="system" when prefers-color-scheme is dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    expect(resolveTheme('system')).toBe('dark');
  });

  it('returns light for theme="system" when prefers-color-scheme is light', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('applyAppearance', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.documentElement;
    vi.spyOn(root, 'setAttribute');
    vi.spyOn(root.style, 'setProperty');
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  it('sets data-grace-theme attribute', () => {
    applyAppearance({ theme: 'light', density: 'normal', accentColor: '#4ade80' });
    expect(root.setAttribute).toHaveBeenCalledWith('data-grace-theme', 'light');
  });

  it('sets data-grace-density attribute', () => {
    applyAppearance({ theme: 'dark', density: 'compact', accentColor: '#4ade80' });
    expect(root.setAttribute).toHaveBeenCalledWith('data-grace-density', 'compact');
  });

  it('sets --grace-accent CSS variable', () => {
    applyAppearance({ theme: 'dark', density: 'normal', accentColor: '#60a5fa' });
    expect(root.style.setProperty).toHaveBeenCalledWith('--grace-accent', '#60a5fa');
  });

  it('sets --grace-accent-bg CSS variable as rgba', () => {
    applyAppearance({ theme: 'dark', density: 'normal', accentColor: '#4ade80' });
    expect(root.style.setProperty).toHaveBeenCalledWith('--grace-accent-bg', 'rgba(74, 222, 128, 0.12)');
  });
});

describe('DEFAULT_APPEARANCE', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      theme: 'dark',
      density: 'normal',
      accentColor: '#4ade80',
    });
  });
});

describe('ACCENT_PRESETS', () => {
  it('contains 8 hex colors', () => {
    expect(ACCENT_PRESETS).toHaveLength(8);
    ACCENT_PRESETS.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
  });
});
