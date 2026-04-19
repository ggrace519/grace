export type ProviderType = 'anthropic' | 'openai-compatible';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  encryptedKey: string;
  url: string | null;
}

export interface StorageSchema {
  providers: Provider[];
  activeProviderId: string;
  activeModel: string;
}

export interface NewProviderInput {
  name: string;
  type: ProviderType;
  encryptedKey: string;
  url: string | null;
}

export function buildNewProvider(input: NewProviderInput): Provider {
  return { id: crypto.randomUUID(), ...input };
}

export function getActiveProvider(providers: Provider[], id: string): Provider | undefined {
  return providers.find((p) => p.id === id);
}

export function migrateStorageIfNeeded(raw: Record<string, any>): StorageSchema | null {
  if (Array.isArray(raw.providers)) return null;
  if (!raw.url && !raw.key) return null;

  const provider = buildNewProvider({
    name: 'My OpenAI Service',
    type: 'openai-compatible',
    encryptedKey: raw.key ?? '',
    url: raw.url || null,
  });

  return {
    providers: [provider],
    activeProviderId: provider.id,
    activeModel: raw.model ?? '',
  };
}

export interface AppearanceSettings {
  theme: 'dark' | 'light' | 'system';
  density: 'compact' | 'normal' | 'comfortable';
  accentColor: string;
}
