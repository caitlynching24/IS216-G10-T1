<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { circle } from '@turf/turf'
import { createLocateButton, createMeDot } from '../utils/locateMe.js'

// Tell MapLibre where Vite put its worker file (it can't find it on its own)
maplibregl.setWorkerUrl(workerUrl)

// Properties
const props = defineProps({
  position: {type: Array, default: null},
  walkedPath: {type: Array, default: () => []},
  plannedRoute: {type: Array, default: () => []}, // a saved route to show, [[lng, lat], ...]
  home: {type: Array, default: null},          // owner's home, [lng, lat]
  homeRadiusM: {type: Number, default: 75},    // size of the shaded "start and finish here" circle
  // 'pins' (default): map pins. 'dots': home as a dark house and the sitter as a blue teardrop pin (the Session page)
  markers: {type: String, default: 'pins'}
})

const mapEl = ref(null)
let map = null   // plain variable, not a ref (keeps Vue from wrapping the map)

// Brand colours (PetSociety design system)
const CORAL = '#E8692C'
const TEAL = '#2F6F62'
const INK = '#2B2420'
const BLUE = '#2563EB'

// a small HTML marker for the 'dots' style: 'home' (dark house) or 'sitter' (blue teardrop pin, like Google Maps)
const PIN_SVG = '<svg viewBox="0 0 24 34" width="26" height="36" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M12 1C5.9 1 1 5.9 1 12c0 8.3 11 21 11 21s11-12.7 11-21C23 5.9 18.1 1 12 1z" fill="#2563EB" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4.2" fill="#fff"/></svg>'
const HOUSE_SVG = '<svg viewBox="0 0 24 24" width="28" height="28" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M12 2.5 1.8 11.2h3V21.5h14.4V11.2h3z" fill="#2B2420" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><rect x="10" y="14.5" width="4" height="7" rx=".6" fill="#fff"/></svg>'
function dot(kind) {
  const el = document.createElement('span')
  el.setAttribute('aria-hidden', 'true')
  el.style.display = 'block'
  el.innerHTML = kind === 'home' ? HOUSE_SVG : PIN_SVG
  return el
}
// the pin's point (its bottom) sits on the sitter's position; the house is centred on the home
const newMarker = (kind, pinColour) => new maplibregl.Marker(props.markers === 'dots' ? { element: dot(kind), anchor: kind === 'home' ? 'center' : 'bottom' } : { color: pinColour })

// wraps a list of points as a GeoJSON line
const line = (coords) => (
  { type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords}
  })

// shaded circle around home, or nothing if there's no home
const homeArea = (h) => h
  ? circle(h, props.homeRadiusM, { units: 'meters' }) 
  : { type: 'FeatureCollection', features: [] }


let marker = null;
let homeMarker = null;
let meMarker = null;   // the user's own spot, shown after they press the locate button

// "locate me" button: puts a blue dot on the user and re-centres the map there
const locateControl = {
  onAdd() {
    const el = createLocateButton(({ lat, lng }) => {
      if (!map) return
      meMarker ??= new maplibregl.Marker({ element: createMeDot() }).setLngLat([lng, lat]).addTo(map)
      meMarker.setLngLat([lng, lat])
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16) })
    })
    el.classList.add('maplibregl-ctrl', 'locate-control')
    return el
  },
  onRemove() {}
}

// puts the home marker (and its circle) on the map
function showHome(h) {
  if (!h || !map) return
  homeMarker ??= newMarker('home', TEAL).setLngLat(h).addTo(map)
  homeMarker.setLngLat(h)
  map.getSource('home-area')?.setData(homeArea(h))
}

// zooms the map so the whole route fits on screen
function fitTo(coords) {
  if (!map || coords.length < 2) return
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  )
  map.fitBounds(bounds, { padding: 40 })
}

onMounted(() => {
  map = new maplibregl.Map({
    // the div to draw the map into
    container: mapEl.value,
    style: 'https://tiles.openfreemap.org/styles/bright',
    center: props.home ?? [103.8198, 1.3521],  // [lng, lat] (home, or central Singapore)
    zoom: props.home ? 16 : 11,
    maxPitch: 80,
    pitch: 60,
    // the 'dots' maps have a key in the bottom corner, so the map credits fold into an (i) button
    ...(props.markers === 'dots' ? { attributionControl: { compact: true } } : {})
  })

  // adds zoom and compass onto map
  map.addControl(new maplibregl.NavigationControl(), 'top-right')  // zoom buttons
  map.addControl(locateControl, 'top-right')  // "locate me" button, under the zoom buttons
  
  // waits until map is finished loading to load own data
  map.on('load', ()=> {
    // Source: Map Data, Layer: how the data is displayed
    // Sets up the home visual
    map.addSource('home-area', {type: 'geojson', data: homeArea(props.home)})
    map.addLayer({id: 'home-area', type: 'fill', source: 'home-area',
      paint: {'fill-color': TEAL, 'fill-opacity': 0.12, 'fill-outline-color': TEAL} })

    // sets up the saved route visual (teal dashed), drawn under the walked path
    map.addSource('planned', {type: 'geojson', data: line(props.plannedRoute)})
    map.addLayer({id: 'planned', type: 'line', source: 'planned',
      paint: {'line-color': TEAL, 'line-width': 3, 'line-dasharray': [2, 1.5]} })

    // sets up the walked path visual
    map.addSource('walked', {type : 'geojson', data: line(props.walkedPath)})
    map.addLayer({id: 'walked', type: 'line', source: 'walked',
      paint: {'line-color': CORAL, 'line-width': 3} })

    // a walk with no route zooms to where the sitter went instead
    fitTo(props.plannedRoute.length ? props.plannedRoute : props.walkedPath)

    // compact credits start open; fold them so they don't cover the key (the (i) button opens them)
    if (props.markers === 'dots') mapEl.value.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
  })

  showHome(props.home)
  showPosition(props.position) // the position already known when the map opens

  // A map created while hidden (e.g. a session card that isn't showing yet) measures itself too small,
  // so it redraws whenever its box changes size
  resizer = new ResizeObserver(() => map?.resize())
  resizer.observe(mapEl.value)
})
let resizer = null

// moves the home and circle if home changes
watch(() => props.home, showHome)

// redraws the saved route and zooms to it when a different route is chosen
watch(() => props.plannedRoute, (c) => {
  map?.getSource('planned')?.setData(line(c))
  fitTo(c)
})

// watch triggers callback when reactive state changes
// triggers when props.positon is updated
function showPosition(p) {
  // stops early if there is no position or map yet
  if (!p || !map) return;
  // ??= assign only if the marker is currently null
  // creates position marker only on first reading
  marker ??= newMarker('sitter', INK).setLngLat(p).addTo(map);
  // moves marker to new position
  marker.setLngLat(p);
  // moves map to centre on new position, maintaining zoom
  map.easeTo({ center: p, zoom: Math.max(map.getZoom(), 16) });
}
watch(() => props.position, showPosition)

// Fits the map back to the sitter and the home (the owner's Recentre button)
function recentre() {
  const points = [props.position, props.home].filter(Boolean)
  if (points.length === 1) map?.easeTo({ center: points[0], zoom: 16 })
  else fitTo(points)
}
defineExpose({ recentre })

// triggers when walkedPath is changed
// {deep : true makes watch trigger based on change WITHIN the array}
watch(() => props.walkedPath, (c) => map?.getSource('walked')?.setData(line(c)), { deep: true });

onBeforeUnmount(() => {
  resizer?.disconnect()
  map?.remove()
})
</script>

<template>
    <div ref="mapEl" class="map"></div>
</template>

<style scoped>
.map {height: 100%; min-height: 400px; width: 100%; }
</style>
