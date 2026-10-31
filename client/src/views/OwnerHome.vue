<script setup>
import { currentUser } from "../services/auth.js";
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import L from 'leaflet';
import axios from 'axios';
import SitterProfileCard from '../components/SitterProfileCard.vue'
import SitterMap from '../components/Map.vue'
import LocationQuery from "../components/LocationQuery.vue";
import FilterPanel from "../components/FilterPanel.vue";
import DistanceFilter from "../components/DistanceFilter.vue";
import DateRangeFilter from "../components/DateRangeFilter.vue";
import RecommendedSitters from "../components/RecommendedSitters.vue";
import AdditionalFilters from "../components/AdditionalFilters.vue";
import { usePagination } from '../utils/usePagination.js'
import PaginationBar from '../components/PaginationBar.vue'

const URL = 'http://localhost:5000'
const profilePic = computed(() => currentUser.value?.profilePicture?.url || "")
const sitterProfiles = ref([])
const errorMsg = ref("")
const selectedPets = ref([])
const otherPets = ref("")

const showMapModal = ref(false)
const isLg = ref(false)
let mq = null

function syncLg(e) {
  isLg.value = e.matches
  if (e.matches) showMapModal.value = false   // popup is meaningless once the side map exists
}
function onEsc(e) { if (e.key === 'Escape') showMapModal.value = false }

watch(showMapModal, open => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) window.addEventListener('keydown', onEsc)
  else window.removeEventListener('keydown', onEsc)
})

const PAGE_SIZE = 6
const listEl = ref(null)

//search rating
const userRating = ref(0) //initial rating value

//search name
const searchKey = ref("")

const availableFrom = ref("")

// search date
const availableTo = ref("")
const sitterAvailability = ref({})
let availabilityRequestId = 0

const requestedDates = computed(() => {
  if (!availableFrom.value || !availableTo.value || availableTo.value < availableFrom.value) return []
  const dates = []
  const day = new Date(`${availableFrom.value}T00:00:00`)
  const end = new Date(`${availableTo.value}T00:00:00`)
  while (day <= end) {
    dates.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`)
    day.setDate(day.getDate() + 1)
  }
  return dates
})

watch([availableFrom, availableTo, sitterProfiles], async () => {
  const requestId = ++availabilityRequestId
  sitterAvailability.value = {}
  if (!requestedDates.value.length || !sitterProfiles.value.length) return

  const entries = await Promise.all(sitterProfiles.value.map(async (sitter) => {
    try {
      const response = await axios.get(`${URL}/api/availability/${sitter._id}`)
      return [sitter._id, Object.fromEntries(response.data.map(({ date, status }) => [date, status]))]
    } catch (error) {
      console.warn(`Could not load availability for sitter ${sitter._id}`, error)
      return [sitter._id, {}]
    }
  }))
  if (requestId === availabilityRequestId) sitterAvailability.value = Object.fromEntries(entries)
})

function filterByPets(list) {
  const targetPets = [...selectedPets.value].map((p) => p.toLowerCase().trim());
  const other = otherPets.value.toLowerCase().trim();
  if (other !== "") targetPets.push(other);
  if (targetPets.length === 0) return list;

  return list.filter((sitter) => {
    const sitterPets = (sitter.sitterProfile.petTypes ?? []).map((p) =>
      p.toLowerCase().trim()
    );
    return targetPets.every((pet) => sitterPets.includes(pet));
  });
}

function filterByRating(list) {
  if (userRating.value == 0) return list;
  return list.filter((sitter) => Math.floor(sitter.sitterProfile.ratingAvg) == userRating.value);
}

function filterBySearch(list) {
  const key = searchKey.value.trim().toLowerCase();
  if (key === "") return list;
  return list.filter((sitter) => sitter.username.toLowerCase().includes(key));
}

const searchResults = computed(() => {
  let results = sittersWithDistance.value
  results = filterByPets(results);
  results = filterByRating(results);
  results = filterBySearch(results);
  if (requestedDates.value.length) {
    results = results.filter((sitter) => {
      const availability = sitterAvailability.value[sitter._id]
      return availability && requestedDates.value.every((date) => availability[date] === 'available')
    })
  }
  results = filterByDistance(results)
  return sortByDistance(results)
});

//display for active filters
const fmtDate = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
const activeFilters = computed(() => {
  const chips = []

  if (origin.value) chips.push({
    key: 'location', label: `Near ${origin.value.label}`,
    clear: () => { origin.value = null; locationQuery.value = ''; locationSuggestions.value = [] }
  })

  // only counts when the filter actually applies (matches filterByDistance)
  if (referencePoint.value && maxDistanceKm.value < maxDistanceLimit) chips.push({
    key: 'distance', label: `Within ${maxDistanceKm.value} km`,
    clear: () => { maxDistanceKm.value = maxDistanceLimit }
  })

  if (availableFrom.value && availableTo.value) chips.push({
    key: 'dates', label: `${fmtDate(availableFrom.value)} – ${fmtDate(availableTo.value)}`,
    clear: () => { availableFrom.value = ''; availableTo.value = '' }
  })


  selectedPets.value.forEach(p => chips.push({
    key: `pet-${p}`, label: p.charAt(0).toUpperCase() + p.slice(1),
    clear: () => { selectedPets.value = selectedPets.value.filter(x => x !== p) }
  }))

  const other = otherPets.value.trim()
  if (other) chips.push({ key: 'other', label: other, clear: () => { otherPets.value = '' } })

  if (userRating.value > 0) chips.push({
    key: 'rating', label: `${userRating.value}★ only`,
    clear: () => { userRating.value = 0 }
  })

  return chips
})

function clearFilters(){
  selectedPets.value=[]
  otherPets.value=""
  userRating.value=0
  locationQuery.value=""
  origin.value = null
  maxDistanceKm.value = maxDistanceLimit
  availableFrom.value = ""
  availableTo.value = ""
}


async function loadSitterProfiles(){
  try {
    const response = await axios.get(`${URL}/api/sitters`)
    console.log(response.data)
    sitterProfiles.value = response.data
  } catch (error) {
    console.log(error)
    errorMsg.value = "Error loading data"
  }
}


// handles location queries
const locationQuery = ref("") // location field typed by user
const locationSuggestions = ref([]) // location suggestion dropdown
const origin = ref(null) // location selected when pressed eg. { lat, lng, label } 
let debounceTimer = null
let requestId = 0

const referenceLabel = computed(() =>
  origin.value ? origin.value.label : userLocation.value ? 'your location' : null
)

// fetch location suggestions from sg 'onemap' api 
async function fetchLocationSuggestions(q) {
  const id = ++requestId
  try {
    const res = await axios.get('https://www.onemap.gov.sg/api/common/elastic/search', {
      params: { searchVal: q, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: 1 }
    })
    if (id !== requestId) return // a newer request superseded this one
    locationSuggestions.value = (res.data.results ?? []).slice(0, 6).map(r => ({
      label: r.ADDRESS,
      lat: parseFloat(r.LATITUDE),
      lng: parseFloat(r.LONGITUDE)
    }))
  } catch (e) {
    console.warn('Location search failed', e)
    locationSuggestions.value = []
  }
}

// handles location field input
function onLocationInput() {
  clearTimeout(debounceTimer)
  const q = locationQuery.value.trim()
  if (q === "") {            // clearing the field removes the pin
    origin.value = null
    locationSuggestions.value = []
    return
  }
  if (q.length < 3) return
  //rate limiting
  debounceTimer = setTimeout(() => fetchLocationSuggestions(q), 400)
}

// location selector
function selectLocation(s) {
  origin.value = { lat: s.lat, lng: s.lng, label: s.label }
  locationQuery.value = s.label
  //clear fields
  locationSuggestions.value = []
}


// handles filter by location
const userLocation = ref(null)   // { lat, lng } from GPS
const maxDistanceLimit = 30
const maxDistanceKm = ref(maxDistanceLimit)   // at the limit = "any distance"

// get current location
function locateUser() {
  if (!navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => { userLocation.value = { lat: coords.latitude, lng: coords.longitude } },
    err => console.warn('Geolocation failed:', err.message)
  )
}

// starting point where distance is calculated
const referencePoint = computed(() => origin.value ?? userLocation.value) //starting point chosen depending on whether input field for location filled

const sittersWithDistance = computed(() => {
  //starting point
  const from = referencePoint.value
  // create a distance attribute for each sitter object
  return sitterProfiles.value.map(s => {
    let distanceKm = null
    // sitter coordinates 
    const c = s.sitterProfile?.serviceArea?.location?.coordinates
    if (from && Array.isArray(c) && c.length >= 2) {
      const lng = Number(c[0]), lat = Number(c[1])   // GeoJSON order (mongodb)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        //calculate distance based on lat and lng using leaflet latlng
        distanceKm = L.latLng(from.lat, from.lng).distanceTo([lat, lng]) / 1000
      }
    }
    return { ...s, distanceKm }
  })
})

// filter function for distance
function filterByDistance(list) {
  if (!referencePoint.value || maxDistanceKm.value >= maxDistanceLimit) return list
  return list.filter(s => s.distanceKm !== null && s.distanceKm <= maxDistanceKm.value)
}

function sortByDistance(list) {
  if (!referencePoint.value) return list
  return [...list].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
}

const { page, pageItems: pagedSitters, goPage, reset } = usePagination(searchResults, {
  pageSize: PAGE_SIZE,
  scrollRef: listEl
})

watch(
  [searchKey, selectedPets, otherPets, userRating, origin, maxDistanceKm, availableFrom, availableTo],
  reset,
  { deep: true }
)

onMounted(()=>{
  mq = window.matchMedia('(min-width: 992px)')
  isLg.value = mq.matches
  mq.addEventListener('change', syncLg)
  loadSitterProfiles()
  locateUser()
})

onBeforeUnmount(() => {
  mq?.removeEventListener('change', syncLg)
  window.removeEventListener('keydown', onEsc)
  document.body.style.overflow = ''
})
</script>

<template>
    <div class="owner-home container-fluid">
      <!-- heading -->
      <div class="d-flex flex-column mb-2">
        <!-- search bar  -->
        <div class="col-12 mb-2">
          <input type="text" v-model="searchKey" placeholder="Search by sitter name" class="form-control">
        </div>

        <span class="text-secondary">{{ searchResults.length }} sitters</span>
        <div v-if="activeFilters.length" class="d-flex flex-wrap align-items-center gap-2 mb-2">
          <button v-for="f in activeFilters" :key="f.key" type="button"
                  class="btn btn-outline-danger rounded-pill bg-light text-truncate"
                  style="max-width: 100%"
                  :aria-label="`Remove filter: ${f.label}`" @click="f.clear">
            {{ f.label }} <span aria-hidden="true">✕</span>
          </button>
          <button type="button" class="btn btn-link btn-sm" @click="clearFilters">Clear all</button>
        </div>
      </div>

      <!-- sitters who offer the services this owner needs -->
      <RecommendedSitters />

      <!-- main body -->
      <div class="row gx-2">
      
        <div class="col-md-4 col-lg-2">

          <!-- filter panel  -->
          <FilterPanel :result-count="searchResults.length" @clear="clearFilters" :activeFilters="activeFilters">
            <LocationQuery
              v-model:location-query="locationQuery"
              :location-suggestions="locationSuggestions"
              @enterLocation="onLocationInput"
              @selectLocation="selectLocation" />

            <DistanceFilter v-model="maxDistanceKm" :limit="maxDistanceLimit" :reference-label="referenceLabel" />

            <DateRangeFilter v-model:from="availableFrom" v-model:to="availableTo" />

            <AdditionalFilters v-model:pets="selectedPets" v-model:other="otherPets" v-model:rating="userRating" />
          </FilterPanel>
        </div>
        
        <!-- search body  -->
        <div class="col-md-8 col-lg-5">

          <div class="d-flex align-items-center gap-2 mb-2">
            <button type="button" class="btn btn-outline-danger fw-bold flex-fill d-md-none bg-white"
              data-bs-toggle="offcanvas"
              data-bs-target="#offcanvasBottom"
              aria-controls="offcanvasBottom">
              ⫶☰ Filters
            </button>
            <button type="button" class="btn btn-outline-danger bg-white fw-bold flex-fill flex-md-grow-0 ms-md-auto d-lg-none"
                @click="showMapModal = true">
              🗺 Show map
            </button>
          </div>

          <div ref="listEl" class="row">
            <div class="col-12 mb-3" v-for="sitter in pagedSitters" :key="sitter._id">
              <SitterProfileCard :sitter="sitter">
                <router-link :to="`/users/${sitter._id}`" class="btn btn-outline-danger rounded col-12 fw-semibold bg-light mt-3">View Profile</router-link>
              </SitterProfileCard>
            </div>
          </div>
          <PaginationBar :page="page" :total="searchResults.length" :page-size="PAGE_SIZE" @change="goPage" />
        </div>

        <!-- map: right column at lg only -->
        <div class="col-lg-5 d-none d-lg-block">
          <div class="map-panel">
            <SitterMap v-if="isLg" :profiles="searchResults" :origin="origin" :userLocation="userLocation" />
          </div>
        </div>
      </div>

      <!-- map popup below lg -->
      <div v-if="showMapModal" class="map-modal" role="dialog" aria-modal="true" aria-label="Map of sitters">
        <button type="button" class="map-close" aria-label="Close map" @click="showMapModal = false">✕</button>
        <SitterMap :profiles="searchResults" :origin="origin" :userLocation="userLocation" />
      </div>

    </div>
  
</template>

<style scoped>
.owner-home .btn-outline-danger:hover:not(:disabled),
.owner-home .btn-outline-danger:focus-visible:not(:disabled),
.owner-home :deep(.filter-panel button:not(.btn-link):not(.btn-close):hover:not(:disabled)),
.owner-home :deep(.filter-panel button:not(.btn-link):not(.btn-close):focus-visible:not(:disabled)) {
  background-color: #8f4a2c !important;
  border-color: #8f4a2c !important;
  color: #fff !important;
}

.owner-home .btn-link:hover,
.owner-home .btn-link:focus-visible,
.owner-home :deep(.filter-panel .btn-link:hover),
.owner-home :deep(.filter-panel .btn-link:focus-visible) {
  color: #8f4a2c !important;
}

.map-panel {
  position: sticky;
  top: 7vh;
  height: calc(100vh - 7vh - 1rem);
  border-radius: 10px;
  overflow: hidden;
}

.map-modal {
  position: fixed;
  inset: .5rem;
  z-index: 1060;                       /* above Bootstrap's offcanvas (1045) */
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .5);   /* backdrop without an extra element */
}
.map-close {
  position: absolute; top: .75rem; right: .75rem; z-index: 1100;   /* Leaflet controls sit at 1000 */
  width: 2.5rem; height: 2.5rem; border: 0; border-radius: 50%;
  background: #3b4248; color: #fff; font-size: 1.1rem;
}
.map-close:hover,
.map-close:focus-visible {
  background: #2b2420;
}
</style>
