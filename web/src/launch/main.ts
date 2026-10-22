import "../shared/fonts"
import { mount } from "svelte"
import "../dashboard/style.css" // same tokens, frame, panels and buttons as the dashboard
import "./style.css"
import App from "./App.svelte"

mount(App, { target: document.getElementById("app")! })
