<script lang="ts">
    // The household tells the agency how the aid went, anonymously: a Semaphore proof that an enrolled household
    // answered (never which one), once per card, checked on-chain by Semaphore (lib/feedback.mjs).
    import { TOPICS } from "../../../lib/feedback.mjs"
    import { deployment as d } from "../shared/chain"
    import { t } from "./state.svelte"
    import { sendFeedback, ratedTx } from "./flow"

    let rating = $state(0)
    let topic = $state(0)
    let busy = $state(false)
    let err = $state("")
    let done = $state(ratedTx()) // "already", a tx hash, or null
</script>

<section class="card" id="feedback" aria-labelledby="fbH">
    <h2 id="fbH" class="h2">{t("fbTitle")}</h2>
    {#if done}
        <p class="note ok" role="status">
            {done === "already" ? t("fbAlready") : t("fbDone")}
            {#if done !== "already" && d.explorer}<a target="_blank" rel="noopener" href="{d.explorer}/tx/{done}">{t("tx")}</a>{/if}
        </p>
    {:else}
        <p class="fine">{t("fbHow")}</p>
        <fieldset class="stars">
            <legend class="sr">{t("fbTitle")}</legend>
            {#each [1, 2, 3, 4, 5] as n (n)}
                <label><input type="radio" name="stars" value={n} bind:group={rating} /><span aria-hidden="true">{n <= rating ? "★" : "☆"}</span><span class="sr">{t("fbStars")(n)}</span></label>
            {/each}
        </fieldset>
        <label class="topic">{t("fbTopic")}
            <select bind:value={topic}>{#each TOPICS as k, i (k)}<option value={i}>{t(`fbT_${k}`)}</option>{/each}</select>
        </label>
        <button class="primary" type="button" disabled={!rating || busy} onclick={async () => {
            busy = true
            err = ""
            try { done = await sendFeedback(rating, topic) } catch (e) { err = `${t("err")}: ${(e as Error).message}` }
            busy = false
        }}>{busy ? t("fbSending") : t("fbSend")}</button>
        {#if err}<p class="note bad" role="alert">{err}</p>{/if}
    {/if}
</section>

<style>
    .h2 { font-size: 19px; margin: 0 0 6px; }
    .fine { color: var(--muted); font-size: 14px; margin: 0 0 10px; }
    .stars { border: 0; padding: 0; margin: 0 0 12px; display: flex; gap: 4px; }
    .stars label { position: relative; font-size: 34px; line-height: 1; color: var(--accent); cursor: pointer; padding: 4px; }
    .stars input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
    .stars label:focus-within { outline: 2px solid var(--accent); border-radius: 8px; }
    .topic { display: grid; gap: 6px; font-size: 15px; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
