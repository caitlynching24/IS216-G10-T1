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
import AdditionalFilters from "../components/AdditionalFilters.vue";
import { usePagination } from '../utils/usePagination.js'
import PaginationBar from '../components/PaginationBar.vue'
import { petsApi } from '../services/api.js'
import { availabilityApi } from '../services/availabilityApi.js'
import { formatTime } from '../utils/bookingHelpers.js'
import { shortDateRange } from '../utils/bookingTimeHelpers.js'
import { matchReasons, sortByMatch } from '../utils/recommendSitters.js'

const URL = ''
const sitterProfiles = ref([])
const errorMsg = ref("")
const selectedPets = ref([])
const otherPets = ref("")
const loadingSitters = ref(true)

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

// "Recommended for me" button (owners only): keeps only the sitters that suit this owner's pets and needs.
// The rules are in utils/recommendSitters.js.
const isOwner = computed(() => currentUser.value?.role === 'owner')
const showRecommended = ref(false) // the button is on
const myPetSpecies = ref([]) // the species of the owner's pets, e.g. ['Dog', 'Cat'] (loaded below)
const needs = computed(() => currentUser.value?.ownerProfile?.servicesNeeded || []) // "Services I need" from Edit Profile
// Nothing to go on yet: no pets saved and no services picked
const canRecommend = computed(() => needs.value.length > 0 || myPetSpecies.value.length > 0)
const listEl = ref(null)

//search rating
const userRating = ref(0) //initial rating value

//search name
const searchKey = ref("")

// search date
const availableFrom = ref("")
const availableTo = ref("")

// optional hours for every day, e.g. '09:00' and '17:00' ('' = any time)
const availableTimeFrom = ref("")
const availableTimeTo = ref("")
const freeBySitter = ref({}) // from the server: { sitterId: { freeDays: ['2026-11-05', ...], blockedDays: { '2026-11-06': 'Booked 2:00 pm – 4:00 pm' } } }
const checkingDates = ref(false)
const datesError = ref("")
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

// one call for every sitter: which of the chosen days each one is free (at the chosen hours, if any)
watch([availableFrom, availableTo, availableTimeFrom, availableTimeTo], async () => {
  const requestId = ++availabilityRequestId
  freeBySitter.value = {}
  datesError.value = ""
  if (!requestedDates.value.length) return

  const params = { from: availableFrom.value, to: availableTo.value }
  if (availableTimeFrom.value && availableTimeTo.value) {
    params.start = availableTimeFrom.value
    params.end = availableTimeTo.value
  }
  checkingDates.value = true
  try {
    const list = await availabilityApi.search(params)
    if (requestId === availabilityRequestId) freeBySitter.value = Object.fromEntries(list.map((s) => [s.sitterId, s]))
  } catch (error) {
    if (requestId === availabilityRequestId) datesError.value = error.response?.data?.message || "Could not check the sitters' availability."
  } finally {
    if (requestId === availabilityRequestId) checkingDates.value = false
  }
})

// the chosen days this sitter is free (empty when not searching by dates)
function freeDaysOf(sitter) {
  return requestedDates.value.filter((day) => freeBySitter.value[sitter._id]?.freeDays.includes(day))
}

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

// every filter except the dates
const filteredSitters = computed(() => {
  let results = sittersWithDistance.value
  results = filterByPets(results);
  results = filterByRating(results);
  results = filterBySearch(results);
  results = filterByDistance(results)
  // "Recommended for me" is on: keep only the sitters that suit this owner, with the reasons why, best match first
  if (showRecommended.value && canRecommend.value) {
    results = results
      .map((sitter) => ({ ...sitter, match: matchReasons(sitter, needs.value, myPetSpecies.value) }))
      .filter((sitter) => sitter.match)
    return sortByMatch(results)
  }
  return sortByDistance(results)
});

// searching by dates: only the sitters free on every chosen day
const searchResults = computed(() => {
  if (!requestedDates.value.length) return filteredSitters.value
  return filteredSitters.value.filter((sitter) => freeDaysOf(sitter).length === requestedDates.value.length)
})

// "Partly available": free on some of the chosen days but not all (at most 6 shown)
const partialResults = computed(() => {
  if (!requestedDates.value.length) return []
  return filteredSitters.value.filter((sitter) => {
    const free = freeDaysOf(sitter).length
    return free > 0 && free < requestedDates.value.length
  })
})
const partialShown = computed(() => partialResults.value.slice(0, 6))

// '9:00 am – 5:00 pm' when hours are chosen
const timeLabel = computed(() =>
  availableTimeFrom.value && availableTimeTo.value ? `${formatTime(availableTimeFrom.value)} – ${formatTime(availableTimeTo.value)}` : ''
)

// green / amber pill on each card, e.g. 'Free 9:00 am – 5:00 pm, all 3 days' or 'Free 2 of 3 days'
function freeNoteFor(sitter) {
  const total = requestedDates.value.length
  if (!total) return ''
  const free = freeDaysOf(sitter).length
  if (free < total) return `Free ${free} of ${total} days`
  const days = total === 1 ? fmtDate(availableFrom.value) : `all ${total} days`
  return timeLabel.value ? `Free ${timeLabel.value}, ${days}` : `Free ${days}`
}
// one chip per chosen day, for partly free sitters
function dayChipsFor(sitter) {
  const free = freeDaysOf(sitter)
  return requestedDates.value.map((day) => ({ day, free: free.includes(day) }))
}
// why the first two days aren't free, e.g. 'Fri 6: Booked 2:00 pm – 4:00 pm'
const dayName = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric' })
function freeReasonFor(sitter) {
  const blocked = freeBySitter.value[sitter._id]?.blockedDays || {}
  return requestedDates.value.filter((day) => blocked[day]).slice(0, 2).map((day) => `${dayName(day)}: ${blocked[day]}`).join(' · ')
}

// no one is free every day: do the partly free sitters cover every day between them?
// e.g. 'Daniel K. and Priya R. together cover every day.' (most days first, then whoever adds a missing day)
const coverNote = computed(() => {
  const covered = new Set()
  const names = []
  const byMostDays = [...partialResults.value].sort((a, b) => freeDaysOf(b).length - freeDaysOf(a).length)
  for (const sitter of byMostDays) {
    const adds = freeDaysOf(sitter).filter((day) => !covered.has(day))
    if (!adds.length) continue
    adds.forEach((day) => covered.add(day))
    names.push(sitter.username)
  }
  if (covered.size < requestedDates.value.length || names.length < 2) return ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} together cover every day.`
})

// the searched dates and times go along to the profile and the booking form, so they can be filled in
const bookingQuery = computed(() => {
  if (!requestedDates.value.length) return {}
  const query = { startDate: availableFrom.value, endDate: availableTo.value }
  if (timeLabel.value) {
    query.startTime = availableTimeFrom.value
    query.endTime = availableTimeTo.value
  }
  return query
})

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

  // same wording as the date button, e.g. '5 – 8 Nov, 9:00 am – 5:00 pm each day'
  if (availableFrom.value && availableTo.value) chips.push({
    key: 'dates',
    label: shortDateRange(availableFrom.value, availableTo.value) +
      (timeLabel.value ? `, ${timeLabel.value}${availableFrom.value !== availableTo.value ? ' each day' : ''}` : ''),
    clear: () => { availableFrom.value = ''; availableTo.value = ''; availableTimeFrom.value = ''; availableTimeTo.value = '' }
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

  // "Recommended for me" has no chip: its own button turns it off

  return chips
})

// any filter on, including "Recommended for me" (Clear all is hidden otherwise)
const hasFilters = computed(() => activeFilters.value.length > 0 || showRecommended.value)

function clearFilters(){
  selectedPets.value=[]
  otherPets.value=""
  userRating.value=0
  locationQuery.value=""
  origin.value = null
  maxDistanceKm.value = maxDistanceLimit
  availableFrom.value = ""
  availableTo.value = ""
  availableTimeFrom.value = ""
  availableTimeTo.value = ""
  showRecommended.value = false
}


async function loadSitterProfiles(){
  try {
    const response = await axios.get(`${URL}/api/sitters`)
    console.log(response.data)
    sitterProfiles.value = response.data
  } catch (error) {
    console.log(error)
    errorMsg.value = "Error loading data"
  } finally {
    loadingSitters.value = false
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
  [searchKey, selectedPets, otherPets, userRating, origin, maxDistanceKm, availableFrom, availableTo, availableTimeFrom, availableTimeTo, showRecommended],
  reset,
  { deep: true }
)

onMounted(()=>{
  mq = window.matchMedia('(min-width: 992px)')
  isLg.value = mq.matches
  mq.addEventListener('change', syncLg)
  loadSitterProfiles()
  locateUser()
  // Owners: the species of their pets, for "Recommended for me" (if this fails, only the services are used)
  if (isOwner.value) {
    petsApi.getAll()
      .then((pets) => { myPetSpecies.value = pets.map((p) => p.species).filter(Boolean) })
      .catch(() => {})
  }
})

onBeforeUnmount(() => {
  mq?.removeEventListener('change', syncLg)
  window.removeEventListener('keydown', onEsc)
  document.body.style.overflow = ''
})
</script>

<template>
    <div class="owner-home">
      <!-- heading -->
      <div class="d-flex flex-column mb-2">
        <!-- search bar  -->
        <div class="col-12 mb-2">
          <input type="text" v-model="searchKey" placeholder="Search by sitter name" class="form-control">
        </div>

        <!-- the sitter count, (owners only) the "Recommended for me" on/off button, then the active filter chips -->
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
          <span class="text-secondary">{{ searchResults.length }} sitters<template v-if="partialResults.length"> · {{ partialResults.length }} partly available</template></span>
          <button v-if="isOwner" type="button" class="rec-btn" :class="{ 'rec-btn--on': showRecommended }"
                  :aria-pressed="showRecommended" @click="showRecommended = !showRecommended">
            ✨ Recommended for me <span v-if="showRecommended" aria-hidden="true">✕</span>
          </button>
          <button v-for="f in activeFilters" :key="f.key" type="button"
                  class="filter-chip"
                  :aria-label="`Remove filter: ${f.label}`" @click="f.clear">
            {{ f.label }} <span aria-hidden="true">✕</span>
          </button>
          <button v-if="hasFilters" type="button" class="plain-action" @click="clearFilters">Clear all</button>
        </div>
        <!-- on, but nothing to match on yet -->
        <div v-if="showRecommended && !canRecommend" class="rec-note mb-2">
          We don't know what your pets need yet. Add your pets and pick <strong>Services I need</strong> in
          <router-link to="/editProfile">Edit Profile</router-link>, then try again.
        </div>
      </div>

      <!-- main body -->
      <div class="row gx-2">
      
        <div class="col-md-4 col-lg-2">

          <!-- filter panel  -->
          <FilterPanel :result-count="searchResults.length" @clear="clearFilters" :activeFilters="activeFilters" :has-filters="hasFilters">
            <LocationQuery
              v-model:location-query="locationQuery"
              :location-suggestions="locationSuggestions"
              @enterLocation="onLocationInput"
              @selectLocation="selectLocation" />

            <DistanceFilter v-model="maxDistanceKm" :limit="maxDistanceLimit" :reference-label="referenceLabel" />

            <DateRangeFilter v-model:from="availableFrom" v-model:to="availableTo" v-model:time-from="availableTimeFrom" v-model:time-to="availableTimeTo" />

            <AdditionalFilters v-model:pets="selectedPets" v-model:other="otherPets" v-model:rating="userRating" />
          </FilterPanel>
        </div>
        
        <!-- search body  -->
        <div class="col-md-8 col-lg-5">

          <div class="d-flex align-items-center gap-2 mb-2">
            <button type="button" class="btn btn-brand-outline btn-sm fw-bold flex-fill d-md-none"
              data-bs-toggle="offcanvas"
              data-bs-target="#offcanvasBottom"
              aria-controls="offcanvasBottom">
              ⫶☰ Filters
            </button>
            <button type="button" class="btn btn-brand-outline btn-sm fw-bold flex-fill d-lg-none"
                @click="showMapModal = true">
              🗺 Show map
            </button>
          </div>

          <div v-if="errorMsg" class="alert alert-warning">{{ errorMsg }}</div>
          <div v-else-if="loadingSitters" class="d-flex align-items-center text-muted"> 
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span> 
            Loading sitters... 
          </div>

          <template v-else>
            <!-- on, but no sitter suits this owner -->
            <p v-if="showRecommended && canRecommend && !searchResults.length" class="rec-empty">
              No sitters match what your pets need yet. Turn this off to see everyone.
            </p>

            <!-- searching by dates: sitters free on every day first -->
            <div v-if="datesError" class="alert alert-warning py-2 small">{{ datesError }}</div>
            <template v-else-if="requestedDates.length">
              <h2 class="group-title">Free for the whole range <span v-if="!checkingDates">{{ searchResults.length }} sitter{{ searchResults.length === 1 ? '' : 's' }}</span></h2>
              <p v-if="checkingDates" class="text-secondary small mb-0">Checking availability…</p>
              <div v-else-if="!searchResults.length" class="dates-empty">
                {{ requestedDates.length === 1 ? `No sitter is free on ${fmtDate(availableFrom)}` : `No single sitter is free for all ${requestedDates.length} days` }}{{ timeLabel ? ' at those hours' : '' }}.
                <template v-if="partialResults.length"> See who covers part of it below.</template>
                <div v-if="coverNote" class="mt-1 fw-semibold">{{ coverNote }}</div>
              </div>
            </template>

            <!-- grid with equal rows, so every card is as tall as the tallest one on the page -->
            <div ref="listEl" class="sitter-list" :class="{ 'rec-dim': showRecommended && !canRecommend }">
              <div v-for="sitter in pagedSitters" :key="sitter._id">
                <SitterProfileCard :sitter="sitter" :reasons="sitter.match?.reasons || []" :free-note="freeNoteFor(sitter)">
                  <router-link :to="{ path: `/users/${sitter._id}`, query: bookingQuery }" class="btn btn-brand-outline rounded col-12 fw-semibold mt-1">View Profile</router-link>
                </SitterProfileCard>
              </div>
            </div>
            <PaginationBar :page="page" :total="searchResults.length" :page-size="PAGE_SIZE" @change="goPage" />

            <!-- free on some of the days, not all -->
            <template v-if="partialShown.length && !checkingDates">
              <h2 class="group-title">Partly available <span>book each part separately</span></h2>
              <div class="sitter-list">
                <div v-for="sitter in partialShown" :key="sitter._id">
                  <SitterProfileCard :sitter="sitter" :reasons="sitter.match?.reasons || []" :free-note="freeNoteFor(sitter)"
                    :day-chips="dayChipsFor(sitter)" :free-reason="freeReasonFor(sitter)">
                    <router-link :to="{ path: `/users/${sitter._id}`, query: bookingQuery }" class="btn btn-brand-outline rounded col-12 fw-semibold mt-3">View Profile</router-link>
                  </SitterProfileCard>
                </div>
              </div>
            </template>
          </template>
        </div>

        <!-- map: right column at lg only -->
        <div class="col-lg-5 d-none d-lg-block">
          <div class="map-panel">
            <SitterMap v-if="isLg" :profiles="searchResults" :origin="origin" :userLocation="userLocation" />
          </div>
        </div>
      </div>

      <!-- map popup below lg (tap the dimmed part to close it) -->
      <div v-if="showMapModal" class="map-backdrop" @click="showMapModal = false"></div>
      <div v-if="showMapModal" class="map-modal" role="dialog" aria-modal="true" aria-label="Map of sitters">
        <button type="button" class="map-close" aria-label="Close map" @click="showMapModal = false">✕</button>
        <SitterMap :profiles="searchResults" :origin="origin" :userLocation="userLocation" />
      </div>

    </div>
  
</template>

<style scoped>
.owner-home .btn-outline-danger:hover:not(:disabled),
.owner-home .btn-outline-danger:focus-visible:not(:disabled),
.owner-home :deep(.filter-panel button:not(.btn-link):not(.btn-close):not(.star-button):not(.filter-chip):not(.plain-action):hover:not(:disabled)),
.owner-home :deep(.filter-panel button:not(.btn-link):not(.btn-close):not(.star-button):not(.filter-chip):not(.plain-action):focus-visible:not(:disabled)) {
  background-color: var(--accent-hover) !important;
  border-color: var(--accent-hover) !important;
  color: #fff !important;
}

.owner-home .btn-link:hover,
.owner-home .btn-link:focus-visible,
.owner-home :deep(.filter-panel .btn-link:hover),
.owner-home :deep(.filter-panel .btn-link:focus-visible) {
  color: var(--accent-hover) !important;
}

.rec-btn { /* "Recommended for me": outlined when off, filled when on */
  border: 1.5px solid var(--accent-deep);
  border-radius: 999px;
  padding: 0.3rem 0.9rem;
  background: #fff;
  color: var(--accent-deep);
  font-weight: 700;
  font-size: 0.9rem;
}
.rec-btn:hover { background: var(--tint-soft, #fbeee8); }
.rec-btn--on,
.rec-btn--on:hover {
  background: var(--accent-deep);
  color: #fff;
}
.rec-note { /* shown when the button is on but the owner hasn't said what their pets need */
  background: #fbeee8;
  border-radius: 12px;
  padding: 0.75rem 1rem;
  font-size: 0.9rem;
}
.rec-empty {
  border-left: 3px solid var(--accent-deep);
  padding-left: 0.75rem;
  color: #6c757d;
}
.rec-dim { opacity: 0.5; } /* the full list stays underneath, faded */

.group-title { /* "Free for the whole range" / "Partly available" */
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 700;
  border-bottom: 1px solid #e3dad5;
  padding-bottom: 0.3rem;
  margin: 0.75rem 0 0;
}
.group-title span {
  font-weight: 400;
  font-size: 0.85rem;
  color: #6c757d;
}
.dates-empty {
  border: 1px dashed #e3dad5;
  border-radius: 10px;
  padding: 0.75rem 1rem;
  margin-top: 0.75rem;
  color: #6c757d;
}

.sitter-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr); /* the column can be narrower than a card's content, so cards never push the page wider than the screen */
  gap: 1rem;
  margin-top: 1rem;
  margin-bottom: 1rem;
  align-items:start;
}

/* phones: a little more room from the page edges */
@media (max-width: 767.98px) {
  .owner-home { padding-inline: 1rem; }
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
  left: .5rem;
  right: .5rem;
  bottom: .5rem;
  height: 75vh;                        /* a large card, not the whole screen */
  z-index: 1060;                       /* above Bootstrap's offcanvas (1045) */
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
}
.map-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1059;
  background: rgba(0, 0, 0, .5);
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
