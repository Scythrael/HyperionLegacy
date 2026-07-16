import { mount } from 'svelte'
import './app.css'
// Root.svelte is now the top-level component: it routes "/" -> Landing page
// and "/play" -> the game (App.svelte). App is no longer mounted directly.
import Root from './Root.svelte'

const app = mount(Root, {
  target: document.getElementById('app')!,
})

export default app
