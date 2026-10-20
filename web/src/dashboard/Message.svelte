<script lang="ts">
    // Status text with optional links; every part renders as text, never HTML.
    import type { Part } from "./format"
    let { parts }: { parts: Part[] } = $props()
</script>

{#each parts as part, i (i)}{#if typeof part === "string"}{part}{:else}<a href={part.href} target="_blank" rel="noopener">{part.label}</a>{/if}{/each}
