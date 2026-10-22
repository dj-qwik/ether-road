// Loads the browser bundle (dist/game.js) in Node with a stub DOM, for tests of client-side code.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
export function loadClient() {
  const js = fs.readFileSync(path.join(dist, 'game.js'), 'utf8')
  const noop = () => {}
  const el = () => new Proxy({ style: { setProperty: noop }, dataset: {}, classList: { toggle: noop, add: noop, remove: noop }, addEventListener: noop, setAttribute: noop, removeAttribute: noop, closest: () => null, focus: noop, getContext: () => null, appendChild: noop, querySelector: () => el() }, {
    get: (t, k) => (k in t ? t[k] : k === 'innerHTML' || k === 'textContent' ? '' : undefined), set: (t, k, v) => { t[k] = v; return true },
  })
  const cache = {}, g = {}
  Object.assign(g, {
    document: { body: el(), querySelector: (s) => (cache[s] ||= el()), getElementById: (s) => (cache['#' + s] ||= el()), createElement: () => el(), addEventListener: noop },
    addEventListener: noop, MutationObserver: class { observe() {} }, matchMedia: () => ({ matches: false }), requestAnimationFrame: noop, localStorage: { getItem: () => null, setItem: noop },
    navigator: { getGamepads: () => [] }, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, location: { hash: '', protocol: 'file:' }, setInterval: () => 0, setTimeout: () => 0,
  })
  g.window = g
  const names = Object.keys(g)
  return new Function(...names, js + ';return { createSim, createFollower, RAILGEO, SIM0 }')(...names.map((n) => g[n]))
}
