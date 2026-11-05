// The "locate me" button shared by the app's maps (Map.vue uses Leaflet, WalkMap.vue uses MapLibre).
// It asks the browser for the user's location and hands it to onFound as { lat, lng }.
// Its styles are the .locate-* rules in assets/main.css.
import { getCurrentLocation } from './currentLocation.js'

// a crosshair, like the locate button on most map apps
const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'

// Builds the button. Returns a wrapper element (button plus a small message bubble for errors).
export function createLocateButton(onFound) {
  const wrap = document.createElement('div')
  wrap.className = 'locate-wrap'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'locate-btn'
  button.title = 'Show my location'
  button.setAttribute('aria-label', 'Show my location')
  button.innerHTML = ICON

  // says why it didn't work (e.g. location blocked), then hides itself
  const msg = document.createElement('span')
  msg.className = 'locate-msg'
  msg.setAttribute('role', 'status')
  let hideMsg = null

  button.addEventListener('click', async (e) => {
    e.stopPropagation() // so the click doesn't also land on the map
    if (button.classList.contains('is-busy')) return
    button.classList.add('is-busy')
    button.classList.remove('is-error')
    const found = await getCurrentLocation()
    button.classList.remove('is-busy')
    if (found) {
      const [lng, lat] = found.location
      onFound({ lat, lng })
      return
    }
    button.classList.add('is-error')
    msg.textContent = "Couldn't get your location. Check that location is allowed for this site."
    msg.classList.add('is-shown')
    clearTimeout(hideMsg)
    hideMsg = setTimeout(() => msg.classList.remove('is-shown'), 4000)
  })

  wrap.append(button, msg)
  return wrap
}

// The blue "you are here" dot for MapLibre maps (Leaflet's Map.vue already has its own icon)
export function createMeDot() {
  const el = document.createElement('span')
  el.className = 'locate-me-dot'
  el.setAttribute('aria-hidden', 'true')
  return el
}
