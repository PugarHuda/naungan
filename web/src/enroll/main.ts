import "../shared/fonts"
import { mount } from "svelte"
import "../dashboard/style.css"
import "../launch/style.css" // same form fields and numbered steps as the launch page
import App from "./App.svelte"

mount(App, { target: document.getElementById("app")! })
