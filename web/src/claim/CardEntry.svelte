<script lang="ts">
    // No card yet: scan the QR with the camera app (it opens this page), or paste the code printed under it.
    import { t } from "./state.svelte"
    import { openCard } from "./flow"

    let code = $state("")
    let box: HTMLTextAreaElement

    function open() {
        if (openCard(code.trim()) === "notCard") box.setCustomValidity(t("notCard")), box.reportValidity()
    }
</script>

<section class="card">
    <p>{t("noCard")}</p>
    <label for="code">{t("paste")}</label>
    <textarea id="code" rows="3" autocomplete="off" spellcheck="false" bind:value={code} bind:this={box} oninput={() => box.setCustomValidity("")}></textarea>
    <button class="primary" type="button" onclick={open}>{t("open")}</button>
</section>
