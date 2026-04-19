<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let providers: { id: string; name: string; type: string; url: string | null; encryptedKey: string }[] = [];
  export let activeProviderId: string = '';
  export let activeModel: string = '';
  export let models: { id: string; name: string }[] = [];
  export let loadingModels: boolean = false;
  export let onProviderChange: (id: string) => void = () => {};
  export let onModelChange: (model: string) => void = () => {};
  export let onOpenSettings: () => void = () => {};

  let showProviderDropdown = false;
  let showModelDropdown = false;

  $: activeProvider = providers.find((p) => p.id === activeProviderId);
  $: noProviders = providers.length === 0;

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.provider-switcher-root')) {
      showProviderDropdown = false;
      showModelDropdown = false;
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
  });

  onDestroy(() => {
    document.removeEventListener('mousedown', handleClickOutside);
  });

  function toggleProvider() {
    if (noProviders) { onOpenSettings(); return; }
    showProviderDropdown = !showProviderDropdown;
    showModelDropdown = false;
  }

  function toggleModel() {
    if (noProviders) { onOpenSettings(); return; }
    showModelDropdown = !showModelDropdown;
    showProviderDropdown = false;
  }

  function selectProvider(id: string) {
    onProviderChange(id);
    showProviderDropdown = false;
  }

  function selectModel(modelId: string) {
    onModelChange(modelId);
    showModelDropdown = false;
  }
</script>

<div class="provider-switcher-root" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #222;position:relative;z-index:50">

  <!-- Provider pill -->
  <div style="position:relative">
    <button
      on:click={toggleProvider}
      style="display:flex;align-items:center;gap:6px;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:6px;padding:4px 10px;color:#fff;font-size:11px;cursor:pointer;white-space:nowrap"
    >
      <div style="width:7px;height:7px;border-radius:50%;background:{noProviders ? '#555' : '#4ade80'}"></div>
      <span>{noProviders ? 'No provider' : (activeProvider?.name ?? 'Unknown')}</span>
      <span style="color:#444;font-size:9px">▾</span>
    </button>

    {#if showProviderDropdown}
      <div style="position:absolute;top:calc(100% + 4px);left:0;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;min-width:160px;z-index:100;overflow:hidden">
        {#each providers as p}
          <button
            on:click={() => selectProvider(p.id)}
            style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 12px;background:{p.id === activeProviderId ? '#1e3a2e' : 'transparent'};border:none;color:{p.id === activeProviderId ? '#4ade80' : '#aaa'};font-size:11px;cursor:pointer;text-align:left"
          >
            <div style="width:6px;height:6px;border-radius:50%;background:{p.id === activeProviderId ? '#4ade80' : '#444'}"></div>
            {p.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Model pill -->
  <div style="position:relative">
    <button
      on:click={toggleModel}
      style="display:flex;align-items:center;gap:6px;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:6px;padding:4px 10px;color:#aaa;font-size:11px;cursor:pointer;white-space:nowrap"
    >
      {#if loadingModels}
        <span style="color:#555">Loading...</span>
      {:else}
        <span>{activeModel || 'No model'}</span>
      {/if}
      <span style="color:#444;font-size:9px">▾</span>
    </button>

    {#if showModelDropdown && models.length > 0}
      <div style="position:absolute;top:calc(100% + 4px);left:0;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;min-width:200px;z-index:100;max-height:200px;overflow-y:auto">
        {#each models as m}
          <button
            on:click={() => selectModel(m.id)}
            style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 12px;background:{m.id === activeModel ? '#1e3a2e' : 'transparent'};border:none;color:{m.id === activeModel ? '#4ade80' : '#aaa'};font-size:11px;cursor:pointer;text-align:left"
          >
            {#if m.id === activeModel}
              <span style="color:#4ade80;font-size:10px">✓</span>
            {:else}
              <span style="width:14px;display:inline-block"></span>
            {/if}
            {m.id}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div style="flex:1"></div>

  <button
    on:click={onOpenSettings}
    style="background:transparent;border:none;color:#444;font-size:11px;cursor:pointer;padding:4px"
    title="Open Settings"
  >⚙ Settings</button>

</div>
