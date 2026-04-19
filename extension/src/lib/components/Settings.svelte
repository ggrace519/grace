<script lang="ts">
  import { onMount } from 'svelte';
  import type { Provider } from '../storage';
  import { applyAppearance, ACCENT_PRESETS, DEFAULT_APPEARANCE } from '../appearance';
  import type { AppearanceSettings } from '../storage';

  let activeTab: 'providers' | 'appearance' | 'shortcuts' | 'about' = 'providers';

  // Provider list state
  let providers: Provider[] = [];
  let activeProviderId = '';
  let activeModel = '';
  let editingProvider: (Provider & { rawKey?: string }) | null = null;
  let isAdding = false;
  let deleteConfirm: string | null = null;

  // Form state
  let formName = '';
  let formType: 'anthropic' | 'openai-compatible' = 'anthropic';
  let formUrl = '';
  let formKey = '';
  let formError = '';
  let formSaving = false;

  // Model fetch for form
  let availableModels: { id: string; name: string }[] = [];
  let fetchingModels = false;

  // Extension version
  const manifest = (typeof chrome !== 'undefined' && chrome?.runtime?.getManifest?.()) || {};
  const version = (manifest as any).version ?? '—';
  const extName = (manifest as any).name ?? 'AI Extension';

  let appearance: AppearanceSettings = { ...DEFAULT_APPEARANCE };
  let customAccent = appearance.accentColor;
  $: isCustomAccent = !ACCENT_PRESETS.includes(appearance.accentColor);

  onMount(async () => {
    const data: any = await new Promise((resolve) =>
      chrome.storage.local.get(['providers', 'activeProviderId', 'activeModel'], resolve)
    );
    providers = data.providers ?? [];
    activeProviderId = data.activeProviderId ?? '';
    activeModel = data.activeModel ?? '';

    const appearanceData: any = await new Promise((resolve) =>
      chrome.storage.sync.get(['appearance'], resolve)
    );
    appearance = { ...DEFAULT_APPEARANCE, ...(appearanceData.appearance ?? {}) };
    customAccent = appearance.accentColor;
  });

  function openAdd() {
    editingProvider = null;
    isAdding = true;
    formName = '';
    formType = 'anthropic';
    formUrl = '';
    formKey = '';
    formError = '';
    availableModels = [];
  }

  async function openEdit(p: Provider) {
    isAdding = false;
    editingProvider = p;
    formName = p.name;
    formType = p.type;
    formUrl = p.url ?? '';
    formKey = '';
    formError = '';
    availableModels = [];
    const resp: any = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ action: 'decryptProviderKey', providerId: p.id }, resolve)
    );
    if (resp?.key) formKey = resp.key;
  }

  function cancelForm() {
    editingProvider = null;
    isAdding = false;
    formError = '';
    availableModels = [];
  }

  async function fetchFormModels() {
    if (!formKey) { formError = 'Enter an API key first'; return; }
    if (formType === 'openai-compatible' && !formUrl) { formError = 'Enter a server URL first'; return; }
    fetchingModels = true;
    formError = '';
    const resp: any = await new Promise((resolve) =>
      chrome.runtime.sendMessage({
        action: 'fetchModels',
        providerType: formType,
        url: formUrl || null,
        key: '',
        rawKey: formKey,
      }, resolve)
    );
    fetchingModels = false;
    if (resp?.error) { formError = resp.error; return; }
    availableModels = resp?.data?.data ?? [];
  }

  async function saveForm() {
    if (!formName.trim()) { formError = 'Name is required'; return; }
    if (!formKey.trim()) { formError = 'API key is required'; return; }
    if (formType === 'openai-compatible' && !formUrl.trim()) { formError = 'Server URL is required'; return; }
    formSaving = true;
    formError = '';
    const resp: any = await new Promise((resolve) =>
      chrome.runtime.sendMessage({
        action: 'saveProvider',
        provider: {
          id: editingProvider?.id,
          name: formName.trim(),
          type: formType,
          url: formType === 'anthropic' ? null : formUrl.trim(),
          rawKey: formKey,
        },
      }, resolve)
    );
    formSaving = false;
    if (resp?.error) { formError = resp.error; return; }
    providers = resp.providers ?? providers;
    cancelForm();
  }

  async function confirmDelete(providerId: string) {
    const resp: any = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ action: 'deleteProvider', providerId }, resolve)
    );
    providers = resp.providers ?? providers;
    if (activeProviderId === providerId) {
      activeProviderId = providers[0]?.id ?? '';
    }
    deleteConfirm = null;
    cancelForm();
  }

  function switchTab(tab: string) {
    activeTab = tab as 'providers' | 'appearance' | 'shortcuts' | 'about';
  }

  function requestDelete() {
    if (editingProvider) deleteConfirm = editingProvider.id;
  }

  function doConfirmDelete() {
    if (editingProvider) confirmDelete(editingProvider.id);
  }

  async function setActive(providerId: string) {
    await new Promise((resolve) =>
      chrome.runtime.sendMessage({ action: 'setActiveProvider', providerId }, resolve)
    );
    activeProviderId = providerId;
  }

  async function updateAppearance(key: keyof AppearanceSettings, value: string) {
    appearance = { ...appearance, [key]: value };
    applyAppearance(appearance);
    await new Promise((resolve) =>
      chrome.runtime.sendMessage({ action: 'saveAppearance', appearance }, resolve)
    );
  }

  function onAccentInput(e: Event) {
    const input = e.target as HTMLInputElement;
    updateAppearance('accentColor', input.value);
  }
</script>

<div id="extension-app" style="min-height:100vh;background:var(--grace-bg);color:var(--grace-text);font-family:system-ui">
  <!-- Tab bar -->
  <div style="display:flex;border-bottom:1px solid var(--grace-border);padding:0 24px">
    {#each [['providers','Providers'],['appearance','Appearance'],['shortcuts','Shortcuts'],['about','About']] as [tab, label]}
      <button
        style="padding:14px 18px;border:none;background:transparent;color:{activeTab===tab?'var(--grace-text)':'var(--grace-text-faint)'};font-size:var(--grace-font-md);cursor:pointer;border-bottom:2px solid {activeTab===tab?'var(--grace-accent)':'transparent'};margin-bottom:-1px"
        on:click={() => switchTab(tab)}
      >{label}</button>
    {/each}
  </div>

  <div style="max-width:640px;margin:0 auto;padding:28px 24px">

    {#if activeTab === 'providers'}
      <h2 style="font-size:var(--grace-font-lg);font-weight:600;margin:0 0 16px">Your Providers</h2>

      {#each providers as p}
        <div style="background:var(--grace-bg-surface);border:1px solid var(--grace-border);border-radius:8px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:var(--grace-font-md);font-weight:500;display:flex;align-items:center;gap:8px">
              {p.name}
              {#if p.id === activeProviderId}
                <span style="background:var(--grace-accent-bg);color:var(--grace-accent);font-size:var(--grace-font-xs);padding:1px 7px;border-radius:10px">Active</span>
              {/if}
            </div>
            <div style="color:var(--grace-text-faint);font-size:var(--grace-font-sm);margin-top:2px">
              {p.type === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}
              {#if p.url} · {p.url}{/if}
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button on:click={() => openEdit(p)} style="background:var(--grace-bg-input);color:var(--grace-text-muted);border:none;border-radius:4px;padding:4px 10px;font-size:var(--grace-font-sm);cursor:pointer">Edit</button>
            {#if p.id !== activeProviderId}
              <button on:click={() => setActive(p.id)} style="background:var(--grace-accent-bg);color:var(--grace-accent);border:none;border-radius:4px;padding:4px 10px;font-size:var(--grace-font-sm);cursor:pointer">Set Active</button>
            {/if}
          </div>
        </div>
      {/each}

      {#if providers.length === 0}
        <p style="color:var(--grace-text-faint);font-size:var(--grace-font-md)">No providers configured. Add one below.</p>
      {/if}

      {#if !isAdding && !editingProvider}
        <button on:click={openAdd} style="margin-top:8px;width:100%;border:1px dashed var(--grace-border);background:var(--grace-bg);color:var(--grace-text-faint);border-radius:8px;padding:8px;font-size:var(--grace-font-sm);cursor:pointer">+ Add Provider</button>
      {/if}

      {#if isAdding || editingProvider}
        <div style="background:var(--grace-bg-surface);border:1px solid var(--grace-border);border-radius:8px;padding:16px;margin-top:12px">
          <h3 style="font-size:var(--grace-font-md);font-weight:600;margin:0 0 14px">{isAdding ? 'Add Provider' : 'Edit Provider'}</h3>

          <label style="display:block;margin-bottom:10px">
            <span style="font-size:var(--grace-font-sm);color:var(--grace-text-faint);display:block;margin-bottom:4px">Name</span>
            <input bind:value={formName} style="width:100%;background:var(--grace-bg-input);border:1px solid var(--grace-border);border-radius:5px;padding:7px 10px;color:var(--grace-text);font-size:var(--grace-font-sm);box-sizing:border-box" placeholder="e.g. My Claude" />
          </label>

          <label style="display:block;margin-bottom:10px">
            <span style="font-size:var(--grace-font-sm);color:var(--grace-text-faint);display:block;margin-bottom:4px">Type</span>
            <select bind:value={formType} style="width:100%;background:var(--grace-bg-input);border:1px solid var(--grace-border);border-radius:5px;padding:7px 10px;color:var(--grace-text);font-size:var(--grace-font-sm);box-sizing:border-box">
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>

          {#if formType === 'openai-compatible'}
            <label style="display:block;margin-bottom:10px">
              <span style="font-size:var(--grace-font-sm);color:var(--grace-text-faint);display:block;margin-bottom:4px">Server URL</span>
              <input bind:value={formUrl} style="width:100%;background:var(--grace-bg-input);border:1px solid var(--grace-border);border-radius:5px;padding:7px 10px;color:var(--grace-text);font-size:var(--grace-font-sm);box-sizing:border-box" placeholder="http://localhost:11434" />
            </label>
          {/if}

          <label style="display:block;margin-bottom:10px">
            <span style="font-size:var(--grace-font-sm);color:var(--grace-text-faint);display:block;margin-bottom:4px">API Key</span>
            <input type="password" bind:value={formKey} style="width:100%;background:var(--grace-bg-input);border:1px solid var(--grace-border);border-radius:5px;padding:7px 10px;color:var(--grace-text);font-size:var(--grace-font-sm);box-sizing:border-box" placeholder="sk-..." />
          </label>

          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <button on:click={fetchFormModels} disabled={fetchingModels} style="background:var(--grace-bg-input);border:1px solid var(--grace-border);color:var(--grace-text-muted);border-radius:5px;padding:5px 12px;font-size:var(--grace-font-sm);cursor:pointer">
              {fetchingModels ? 'Loading...' : 'Load Models'}
            </button>
            {#if availableModels.length > 0}
              <span style="color:var(--grace-text-faint);font-size:var(--grace-font-sm)">{availableModels.length} models found</span>
            {/if}
          </div>

          {#if formError}
            <p style="color:#f87171;font-size:var(--grace-font-sm);margin-bottom:8px">{formError}</p>
          {/if}

          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
            {#if editingProvider?.id}
              {#if deleteConfirm === editingProvider.id}
                <span style="font-size:var(--grace-font-sm);color:#f87171;display:flex;align-items:center;gap:6px">
                  Delete this provider?
                  <button on:click={doConfirmDelete} style="background:#7f1d1d;color:#fca5a5;border:none;border-radius:4px;padding:3px 8px;font-size:var(--grace-font-xs);cursor:pointer">Confirm</button>
                  <button on:click={() => deleteConfirm = null} style="background:var(--grace-bg-input);color:var(--grace-text-muted);border:none;border-radius:4px;padding:3px 8px;font-size:var(--grace-font-xs);cursor:pointer">Cancel</button>
                </span>
              {:else}
                <button on:click={requestDelete} style="background:transparent;color:var(--grace-text-faint);border:none;font-size:var(--grace-font-sm);cursor:pointer;margin-right:auto">Delete</button>
              {/if}
            {/if}
            <button on:click={cancelForm} style="background:var(--grace-bg-input);color:var(--grace-text-muted);border:none;border-radius:5px;padding:6px 14px;font-size:var(--grace-font-md);cursor:pointer">Cancel</button>
            <button on:click={saveForm} disabled={formSaving} style="background:var(--grace-accent-bg);color:var(--grace-accent);border:none;border-radius:5px;padding:6px 14px;font-size:var(--grace-font-md);cursor:pointer">
              {formSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      {/if}

    {:else if activeTab === 'appearance'}
      <h2 style="font-size:var(--grace-font-lg);font-weight:600;margin:0 0 20px">Appearance</h2>

      <!-- Theme -->
      <div style="margin-bottom:24px">
        <span style="font-size:var(--grace-font-sm);color:var(--grace-text-muted);display:block;margin-bottom:8px">Theme</span>
        <div style="display:flex;gap:8px">
          {#each [['dark','Dark'],['light','Light'],['system','System']] as [val, label]}
            <button
              on:click={() => updateAppearance('theme', val)}
              style="flex:1;padding:8px;border-radius:6px;border:1px solid {appearance.theme===val?'var(--grace-accent)':'var(--grace-border)'};background:{appearance.theme===val?'var(--grace-accent-bg)':'var(--grace-bg-surface)'};color:{appearance.theme===val?'var(--grace-accent)':'var(--grace-text-muted)'};font-size:var(--grace-font-sm);cursor:pointer;transition:border-color 0.15s"
            >{label}</button>
          {/each}
        </div>
      </div>

      <!-- Density -->
      <div style="margin-bottom:24px">
        <span style="font-size:var(--grace-font-sm);color:var(--grace-text-muted);display:block;margin-bottom:8px">UI Density</span>
        <div style="display:flex;gap:8px">
          {#each [['compact','Compact'],['normal','Normal'],['comfortable','Comfortable']] as [val, label]}
            <button
              on:click={() => updateAppearance('density', val)}
              style="flex:1;padding:8px;border-radius:6px;border:1px solid {appearance.density===val?'var(--grace-accent)':'var(--grace-border)'};background:{appearance.density===val?'var(--grace-accent-bg)':'var(--grace-bg-surface)'};color:{appearance.density===val?'var(--grace-accent)':'var(--grace-text-muted)'};font-size:var(--grace-font-sm);cursor:pointer;transition:border-color 0.15s"
            >{label}</button>
          {/each}
        </div>
      </div>

      <!-- Accent Color -->
      <div style="margin-bottom:24px">
        <span style="font-size:var(--grace-font-sm);color:var(--grace-text-muted);display:block;margin-bottom:8px">Accent Color</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          {#each ACCENT_PRESETS as preset}
            <button
              on:click={() => updateAppearance('accentColor', preset)}
              style="width:26px;height:26px;border-radius:50%;background:{preset};border:2px solid {appearance.accentColor===preset?'var(--grace-text)':'transparent'};cursor:pointer;padding:0;flex-shrink:0"
              title={preset}
            ></button>
          {/each}
          <label style="position:relative;cursor:pointer;flex-shrink:0" title="Custom color">
            <input
              type="color"
              bind:value={customAccent}
              on:input={onAccentInput}
              style="opacity:0;position:absolute;inset:0;width:26px;height:26px;cursor:pointer"
            />
            <div style="width:26px;height:26px;border-radius:50%;background:{isCustomAccent?appearance.accentColor:'var(--grace-bg-input)'};border:2px solid {isCustomAccent?'var(--grace-text)':'var(--grace-border)'};display:flex;align-items:center;justify-content:center;font-size:var(--grace-font-md);color:var(--grace-text-muted);line-height:1">+</div>
          </label>
        </div>
        {#if isCustomAccent}
          <p style="font-size:var(--grace-font-xs);color:var(--grace-text-faint);margin-top:6px">{appearance.accentColor}</p>
        {/if}
      </div>

    {:else if activeTab === 'shortcuts'}
      <h2 style="font-size:var(--grace-font-lg);font-weight:600;margin:0 0 16px">Keyboard Shortcuts</h2>
      {#each [['Open spotlight search','Ctrl+Shift+K'],['Open sidebar','Ctrl+Shift+L'],['Send selected text to AI','Ctrl+Shift+Enter']] as [desc, keys]}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--grace-border)">
          <span style="font-size:var(--grace-font-md);color:var(--grace-text-muted)">{desc}</span>
          <kbd style="background:var(--grace-bg-input);border:1px solid var(--grace-border);border-radius:4px;padding:3px 8px;font-size:var(--grace-font-sm);color:var(--grace-text-muted)">{keys}</kbd>
        </div>
      {/each}
      <p style="color:var(--grace-text-faint);font-size:var(--grace-font-sm);margin-top:14px">To change shortcuts, paste <code style="background:var(--grace-bg-surface);padding:1px 5px;border-radius:3px">chrome://extensions/shortcuts</code> into the address bar.</p>

    {:else if activeTab === 'about'}
      <h2 style="font-size:var(--grace-font-lg);font-weight:600;margin:0 0 8px">{extName}</h2>
      <p style="color:var(--grace-text-faint);font-size:var(--grace-font-md);margin-bottom:4px">Version {version}</p>
      <p style="color:var(--grace-text-faint);font-size:var(--grace-font-sm)">Browser Integrated Conversation Engine — summarize pages and chat with AI.</p>
    {/if}

  </div>
</div>
