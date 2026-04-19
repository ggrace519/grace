import { describe, it, expect } from 'vitest';
import {
  migrateStorageIfNeeded,
  buildNewProvider,
  getActiveProvider,
  type Provider,
  type StorageSchema,
} from './storage';
import type { AppearanceSettings } from './storage';

describe('migrateStorageIfNeeded', () => {
  it('returns null when no old schema present and no providers', () => {
    const result = migrateStorageIfNeeded({});
    expect(result).toBeNull();
  });

  it('returns null when providers array already exists', () => {
    const existing: StorageSchema = {
      providers: [{ id: 'abc', name: 'Test', type: 'anthropic', encryptedKey: 'enc', url: null }],
      activeProviderId: 'abc',
      activeModel: 'claude-sonnet-4-6',
    };
    const result = migrateStorageIfNeeded(existing as any);
    expect(result).toBeNull();
  });

  it('migrates old {url, key, model} schema to providers array', () => {
    const old = { url: 'http://localhost:11434', key: 'enc-key-data', model: 'llama3' };
    const result = migrateStorageIfNeeded(old);
    expect(result).not.toBeNull();
    expect(result!.providers).toHaveLength(1);
    expect(result!.providers[0].type).toBe('openai-compatible');
    expect(result!.providers[0].name).toBe('My OpenAI Service');
    expect(result!.providers[0].url).toBe('http://localhost:11434');
    expect(result!.providers[0].encryptedKey).toBe('enc-key-data');
    expect(result!.activeModel).toBe('llama3');
    expect(result!.activeProviderId).toBe(result!.providers[0].id);
  });

  it('sets activeModel to empty string when old model is absent', () => {
    const old = { url: 'http://localhost', key: 'enc' };
    const result = migrateStorageIfNeeded(old);
    expect(result!.activeModel).toBe('');
  });
});

describe('buildNewProvider', () => {
  it('creates an anthropic provider with null url', () => {
    const p = buildNewProvider({ name: 'My Claude', type: 'anthropic', encryptedKey: 'enc', url: null });
    expect(p.type).toBe('anthropic');
    expect(p.url).toBeNull();
    expect(p.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('creates an openai-compatible provider with url', () => {
    const p = buildNewProvider({ name: 'Ollama', type: 'openai-compatible', encryptedKey: 'enc', url: 'http://localhost:11434' });
    expect(p.type).toBe('openai-compatible');
    expect(p.url).toBe('http://localhost:11434');
  });
});

describe('getActiveProvider', () => {
  it('returns the provider matching activeProviderId', () => {
    const providers: Provider[] = [
      { id: 'a', name: 'A', type: 'anthropic', encryptedKey: 'enc', url: null },
      { id: 'b', name: 'B', type: 'openai-compatible', encryptedKey: 'enc2', url: 'http://localhost' },
    ];
    expect(getActiveProvider(providers, 'b')!.id).toBe('b');
  });

  it('returns undefined when no match', () => {
    expect(getActiveProvider([], 'x')).toBeUndefined();
  });
});

describe('AppearanceSettings', () => {
  it('has correct theme union type values', () => {
    const themes: AppearanceSettings['theme'][] = ['dark', 'light', 'system'];
    expect(themes).toHaveLength(3);
  });

  it('has correct density union type values', () => {
    const densities: AppearanceSettings['density'][] = ['compact', 'normal', 'comfortable'];
    expect(densities).toHaveLength(3);
  });

  it('accentColor is a string', () => {
    const s: AppearanceSettings = { theme: 'dark', density: 'normal', accentColor: '#4ade80' };
    expect(typeof s.accentColor).toBe('string');
  });
});
