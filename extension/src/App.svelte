<script lang="ts">
  import SpotlightSearch from "./lib/components/SpotlightSearch.svelte";

  export let sidebarMode = false;
</script>

<div class="extension-container" class:sidebar-mode={sidebarMode}>
  <SpotlightSearch {sidebarMode} />
</div>
