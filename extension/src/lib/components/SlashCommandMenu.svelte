<script context="module" lang="ts">
  export interface SlashCommand {
    name: string;
    description: string;
    action: () => void;
  }
</script>

<script lang="ts">
  export let inputValue: string = '';
  export let commands: SlashCommand[] = [];
  export let onExecute: (command: SlashCommand) => void = () => {};
  export let onDismiss: () => void = () => {};

  let selectedIndex = 0;

  $: visible = inputValue.startsWith('/');
  $: query = visible ? inputValue.slice(1).toLowerCase() : '';
  $: filtered = commands.filter((c) => c.name.startsWith(query));

  $: {
    // Reset selection when filter changes
    void query;
    selectedIndex = 0;
  }

  export function handleKeydown(e: KeyboardEvent): boolean {
    if (!visible || filtered.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % filtered.length;
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) onExecute(filtered[selectedIndex]);
      return true;
    }
    if (e.key === 'Escape') {
      onDismiss();
      return true;
    }
    return false;
  }
</script>

{#if visible && filtered.length > 0}
  <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;margin-bottom:6px">
    {#each filtered as cmd, i}
      <button
        on:click={() => onExecute(cmd)}
        style="display:flex;align-items:center;width:100%;padding:7px 12px;background:{i === selectedIndex ? '#1e3a2e' : 'transparent'};border:none;cursor:pointer;gap:10px;text-align:left"
      >
        <span style="color:{i === selectedIndex ? '#4ade80' : '#555'};font-size:11px;font-weight:600;min-width:80px">/{cmd.name}</span>
        <span style="color:#555;font-size:10px">{cmd.description}</span>
        {#if i === selectedIndex}
          <span style="color:#2a4a3a;font-size:9px;margin-left:auto">↵</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
