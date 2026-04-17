<script lang="ts">
  import { onMount } from 'svelte';
  import type { Provider } from '../storage';

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

  onMount(async () => {
    const data: any = await new Promise((resolve) =>
      chrome.storage.local.get(['providers', 'activeProviderId', 'activeModel'], resolve)
    );
    providers = data.providers ?? [];
    activeProviderId = data.activeProviderId ?? '';
    activeModel = data.activeModel ?? '';
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
</script>

<div id="extension-app" style="min-height:100vh;background:#111;color:#fff;font-family:system-ui">
  <!-- Tab bar -->
  <div style="display:flex;border-bottom:1px solid #222;padding:0 24px">
    {#each [['providers','Providers'],['appearance','Appearance'],['shortcuts','Shortcuts'],['about','About']] as [tab, label]}
      <button
        style="padding:14px 18px;border:none;background:transparent;color:{activeTab===tab?'#fff':'#555'};font-size:13px;cursor:pointer;border-bottom:2px solid {activeTab===tab?'#4ade80':'transparent'};margin-bottom:-1px"
        on:click={() => switchTab(tab)}
      >{label}</button>
    {/each}
  </div>

  <div style="max-width:640px;margin:0 auto;padding:28px 24px">

    {#if activeTab === 'providers'}
      <h2 style="font-size:16px;font-weight:600;margin:0 0 16px">Your Providers</h2>

      {#each providers as p}
        <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px">
              {p.name}
              {#if p.id === activeProviderId}
                <span style="background:#1a3a2a;color:#4ade80;font-size:10px;padding:1px 7px;border-radius:10px">Active</span>
              {/if}
            </div>
            <div style="color:#555;font-size:11px;margin-top:2px">
              {p.type === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}
              {#if p.url} · {p.url}{/if}
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button on:click={() => openEdit(p)} style="background:#2a2a2a;color:#aaa;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer">Edit</button>
            {#if p.id !== activeProviderId}
              <button on:click={() => setActive(p.id)} style="background:#1a3a2a;color:#4ade80;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer">Set Active</button>
            {/if}
          </div>
        </div>
      {/each}

      {#if providers.length === 0}
        <p style="color:#444;font-size:13px">No providers configured. Add one below.</p>
      {/if}

      {#if !isAdding && !editingProvider}
        <button on:click={openAdd} style="margin-top:8px;width:100%;border:1px dashed #333;background:#151515;color:#555;border-radius:8px;padding:8px;font-size:12px;cursor:pointer">+ Add Provider</button>
      {/if}

      {#if isAdding || editingProvider}
        <div style="background:#161616;border:1px solid #2a2a2a;border-radius:8px;padding:16px;margin-top:12px">
          <h3 style="font-size:13px;font-weight:600;margin:0 0 14px">{isAdding ? 'Add Provider' : 'Edit Provider'}</h3>

          <label style="display:block;margin-bottom:10px">
            <span style="font-size:11px;color:#777;display:block;margin-bottom:4px">Name</span>
            <input bind:value={formName} style="width:100%;background:#222;border:1px solid #333;border-radius:5px;padding:7px 10px;color:#fff;font-size:12px;box-sizing:border-box" placeholder="e.g. My Claude" />
          </label>

          <label style="display:block;margin-bottom:10px">
            <span style="font-size:11px;color:#777;display:block;margin-bottom:4px">Type</span>
            <select bind:value={formType} style="width:100%;background:#222;border:1px solid #333;border-radius:5px;padding:7px 10px;color:#fff;font-size:12px;box-sizing:border-box">
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>

          {#if formType === 'openai-compatible'}
            <label style="display:block;margin-bottom:10px">
              <span style="font-size:11px;color:#777;display:block;margin-bottom:4px">Server URL</span>
              <input bind:value={formUrl} style="width:100%;background:#222;border:1px solid #333;border-radius:5px;padding:7px 10px;color:#fff;font-size:12px;box-sizing:border-box" placeholder="http://localhost:11434" />
            </label>
          {/if}

          <label style="display:block;margin-bottom:10px">
            <span style="font-size:11px;color:#777;display:block;margin-bottom:4px">API Key</span>
            <input type="password" bind:value={formKey} style="width:100%;background:#222;border:1px solid #333;border-radius:5px;padding:7px 10px;color:#fff;font-size:12px;box-sizing:border-box" placeholder="sk-..." />
          </label>

          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <button on:click={fetchFormModels} disabled={fetchingModels} style="background:#222;border:1px solid #333;color:#aaa;border-radius:5px;padding:5px 12px;font-size:11px;cursor:pointer">
              {fetchingModels ? 'Loading...' : 'Load Models'}
            </button>
            {#if availableModels.length > 0}
              <span style="color:#555;font-size:11px">{availableModels.length} models found</span>
            {/if}
          </div>

          {#if formError}
            <p style="color:#f87171;font-size:11px;margin-bottom:8px">{formError}</p>
          {/if}

          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
            {#if editingProvider?.id}
              {#if deleteConfirm === editingProvider.id}
                <span style="font-size:11px;color:#f87171;display:flex;align-items:center;gap:6px">
                  Delete this provider?
                  <button on:click={doConfirmDelete} style="background:#7f1d1d;color:#fca5a5;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">Confirm</button>
                  <button on:click={() => deleteConfirm = null} style="background:#2a2a2a;color:#aaa;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">Cancel</button>
                </span>
              {:else}
                <button on:click={requestDelete} style="background:transparent;color:#555;border:none;font-size:11px;cursor:pointer;margin-right:auto">Delete</button>
              {/if}
            {/if}
            <button on:click={cancelForm} style="background:#2a2a2a;color:#aaa;border:none;border-radius:5px;padding:6px 14px;font-size:12px;cursor:pointer">Cancel</button>
            <button on:click={saveForm} disabled={formSaving} style="background:#1a3a2a;color:#4ade80;border:none;border-radius:5px;padding:6px 14px;font-size:12px;cursor:pointer">
              {formSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      {/if}

    {:else if activeTab === 'appearance'}
      <h2 style="font-size:16px;font-weight:600;margin:0 0 8px">Appearance</h2>
      <p style="color:#555;font-size:13px">Theme and font options — coming soon.</p>

    {:else if activeTab === 'shortcuts'}
      <h2 style="font-size:16px;font-weight:600;margin:0 0 16px">Keyboard Shortcuts</h2>
      {#each [['Open spotlight search','Ctrl+Shift+K'],['Open sidebar','Ctrl+Shift+L'],['Send selected text to AI','Ctrl+Shift+Enter']] as [desc, keys]}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #1e1e1e">
          <span style="font-size:13px;color:#ccc">{desc}</span>
          <kbd style="background:#222;border:1px solid #333;border-radius:4px;padding:3px 8px;font-size:11px;color:#aaa">{keys}</kbd>
        </div>
      {/each}
      <p style="color:#555;font-size:11px;margin-top:14px">To change shortcuts, paste <code style="background:#1e1e1e;padding:1px 5px;border-radius:3px">chrome://extensions/shortcuts</code> into the address bar.</p>

    {:else if activeTab === 'about'}
      <h2 style="font-size:16px;font-weight:600;margin:0 0 8px">{extName}</h2>
      <p style="color:#555;font-size:13px;margin-bottom:4px">Version {version}</p>
      <p style="color:#555;font-size:12px">A spotlight-style AI assistant Chrome extension.</p>
    {/if}

  </div>
</div>
