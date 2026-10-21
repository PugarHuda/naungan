// Household claim app entry (claim). The proving code is bundled, never loaded from a CDN.
import { mount } from "svelte"
import App from "./App.svelte"
import { start } from "./flow"
import { ui, t } from "./state.svelte"
import "./style.css"

// Scanning a second card in the same tab only changes the fragment (no page load): start over
// so the new card is read and its secret is stripped from the address bar too.
window.addEventListener("hashchange", () => location.reload())
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {})

mount(App, { target: document.getElementById("app")! })
start().catch((e) => (ui.error = `${t("err")}: ${e.message}`))
