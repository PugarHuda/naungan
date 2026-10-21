<script lang="ts">
    // The iframe an agency or donor pastes into its own site to show this program's live status (web/embed.html).
    let { pid }: { pid: bigint } = $props()
    let copied = $state(false)
    const code = $derived(`<iframe src="${location.origin}/embed?program=${pid}" title="Naungan program #${pid}" width="100%" height="360" style="border:0;max-width:520px" loading="lazy"></iframe>`)
    async function copy() {
        try {
            await navigator.clipboard.writeText(code)
            copied = true
            setTimeout(() => (copied = false), 2000)
        } catch {} // clipboard refused: the code stays selectable in the box
    }
</script>

<details class="embed">
    <summary>Embed this program on your site</summary>
    <textarea readonly rows="3" aria-label="Embed code" onfocus={(e) => (e.currentTarget as HTMLTextAreaElement).select()}>{code}</textarea>
    <button class="btn" type="button" onclick={copy}>{copied ? "Copied" : "Copy code"}</button>
    <a href="/embed?program={pid}" target="_blank" rel="noopener">Preview ↗</a>
</details>

<style>
    .embed { margin-top: 10px; word-break: normal }
    .embed summary { cursor: pointer; color: var(--fg, inherit); font-weight: 600 }
    textarea { display: block; width: 100%; box-sizing: border-box; margin: 8px 0; font: 12px/1.4 "JetBrains Mono", monospace; resize: vertical }
    .embed a { margin-left: 10px }
</style>
