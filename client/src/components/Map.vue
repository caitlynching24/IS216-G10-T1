<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount, watch } from 'vue'
import currentLocationImg from '../assets/img/currentLocationIcon.png'
import L from 'leaflet'
import { useRouter } from 'vue-router'
import { createLocateButton } from '../utils/locateMe.js'

const props = defineProps({profiles:Array, origin: { type: Object, default: null }, userLocation: { type: Object, default: null }})
const router = useRouter()

let originMarker = null
let userMarker = null
const sitterLayer = L.layerGroup()
const mapContainer = ref()
const map = shallowRef(null)

const currentLocationIcon = L.icon({
  iconUrl: currentLocationImg,
  iconSize: [50, 50],
  iconAnchor: [25, 50],   // bottom-centre; use [25, 25] if the image is a round dot
  popupAnchor: [0, -50]
})


watch(() => props.profiles, drawSitters)

watch(() => props.origin, (o) => {
  originMarker?.remove()
  originMarker = null
  if (!o || !map.value) return
  map.value.flyTo([o.lat, o.lng], 14)
  originMarker = L.marker([o.lat, o.lng]).addTo(map.value).bindPopup(o.label)
})


function showOrigin(o, animate = true) {
  originMarker?.remove()
  originMarker = null
  if (!o || !map.value) return
  const to = [o.lat, o.lng]
  animate ? map.value.flyTo(to, 14) : map.value.setView(to, 14)
  originMarker = L.marker(to).addTo(map.value).bindPopup(o.label)
}

watch(() => props.origin, o => showOrigin(o))


showOrigin(props.origin, false)
// draw markers
function drawSitters() {
  sitterLayer.clearLayers()
  props.profiles.forEach(sitter => {
    const coords = sitter.sitterProfile?.serviceArea?.location?.coordinates
    if (!coords) return
    const [lng, lat] = coords                    // GeoJSON order
    // the sitter's name links to their profile
    const label = document.createElement('a')
    label.href = `/users/${sitter._id}`
    label.className = 'fw-bold map-sitter-link'
    label.textContent = sitter.username          // textContent, not HTML
    label.addEventListener('click', (e) => {
      e.preventDefault()
      router.push(`/users/${sitter._id}`)
    })
    L.marker([lat, lng]).bindPopup(label).addTo(sitterLayer)
  })
}

watch(() => props.profiles, drawSitters)

// show where user is/ where user selected
function showUser(u) {
  userMarker?.remove()
  userMarker = null
  if (!u || !map.value) return
  userMarker = L.marker([u.lat, u.lng], { icon: currentLocationIcon })
    .addTo(map.value).bindPopup('You are here')
  if (!props.origin) map.value.setView([u.lat, u.lng], 13)
}

watch(() => props.userLocation, showUser)

// the locate button: moves the "You are here" marker to the user and flies there
function locateMe(u) {
  if (!map.value) return
  userMarker?.remove()
  userMarker = L.marker([u.lat, u.lng], { icon: currentLocationIcon })
    .addTo(map.value).bindPopup('You are here')
  map.value.flyTo([u.lat, u.lng], Math.max(map.value.getZoom(), 14))
}

onMounted(()=>{
    //initialise map inside of map container
     map.value = L.map(mapContainer.value).setView([1.3521, 103.8198], 12);

    //add tile layer to map
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map.value);

    sitterLayer.addTo(map.value)

    // "locate me" button under the zoom buttons: re-centres the map on the user
    const LocateControl = L.Control.extend({
      onAdd: () => {
        const el = createLocateButton(locateMe)
        el.classList.add('leaflet-control', 'locate-control')
        L.DomEvent.disableClickPropagation(el)
        return el
      }
    })
    new LocateControl({ position: 'topleft' }).addTo(map.value)


    showUser(props.userLocation)
    showOrigin(props.origin, false)
    drawSitters()
})

//remove map when unmounted
onBeforeUnmount(() => map.value?.remove())
</script>

<template>
    <div ref="mapContainer"  class="border rounded mb-2 fullScreenMap"></div>

</template>

<style scoped>
  .fullScreenMap {
    height:100%;
    width: 100%;
  }
  /* popup content is made with JS, so it needs :deep to be styled */
  .fullScreenMap :deep(.map-sitter-link) {
    color: var(--accent-deep);
  }

</style>