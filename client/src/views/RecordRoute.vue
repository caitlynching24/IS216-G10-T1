<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { length, lineString, simplify } from '@turf/turf'
import WalkMap from '../components/WalkMap.vue'
import { useFitHeight } from '../utils/useFitHeight.js'
import { useGeoTracker } from '../utils/useGeoTracker.js'
import { useHomeCheck, HOME_RADIUS_M } from '../utils/useHomeCheck.js'
import { currentUser, fetchUser } from '../services/auth.js'
import { walkRoutesApi } from '../services/walkRouteApi.js'
import BackButton from '../components/BackButton.vue'

const { position, path, accuracy, error, start, startRecording, stopRecording } = useGeoTracker()

// Which stage the page is at: 'loading' -> 'ready' -> 'recording' -> 'naming' -> 'saved'
const step = ref('loading');

// the map fills the rest of the screen without scrolling (gap: this page's padding plus the main area's)
const mapRef = ref(null)
useFitHeight(mapRef, { gap: 40 })
const routeName = ref('');
const saving = ref(false);
const saveError = ref('');
const savedRoute = ref(null);

// Re-record mode: opened from /owner/routes/:id/record to replace an existing route's path
// (pageRoute is the page's URL info from Vue Router, not a walking route)
const pageRoute = useRoute()
const routeId = pageRoute.params.id ?? null   // null when recording a new route
const existingRoute = ref(null)               // the route being re-recorded
const loadError = ref('')

// The owner's home as [lng, lat], from the postal code on their profile
const home = computed(() => currentUser.value?.ownerProfile?.address?.location?.coordinates ?? null)

// How far from home, whether they're near home, and whether they've left home since recording started
const { metresFromHome, nearHome, hasLeftHome, resetLeftHome } = useHomeCheck(position, home)

// Length of what's been recorded so far, in metres
const recordedM = computed(() =>
  path.value.length < 2 ? 0 : Math.round(length(lineString(path.value), { units: 'meters' }))
)

const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`)

onMounted(async () => {
  if (!currentUser.value) await fetchUser()

  // when re-recording, load the old route so it can be shown on the map and its name kept
  if (routeId) {
    try {
      existingRoute.value = await walkRoutesApi.getById(routeId)
      routeName.value = existingRoute.value.name
    } catch (err) {
      loadError.value = err.response?.data?.message ?? 'Could not load this route.'
      step.value = 'ready'
      return
    }
  }

  step.value = 'ready'
  if (home.value) start()   // GPS on straight away, so the owner can see how far they are from home
})

function beginRecording() {
  resetLeftHome()
  startRecording()
  step.value = 'recording'
}

function finishRecording() {
  stopRecording()
  step.value = 'naming'
}

// Throws the current recording away and goes back to the start
// used by buttons Cancel, Discard and Record another route(after saving)
function reset() {
  resetLeftHome()
  stopRecording()
  path.value = []
  routeName.value = existingRoute.value?.name ?? ''   // re-recording keeps the old name
  saveError.value = ''
  savedRoute.value = null
  step.value = 'ready'
}

//
async function save() {
  const name = routeName.value.trim()
  if (!name) {
    saveError.value = 'Give your route a name.'
    return
  }

  saving.value = true
  saveError.value = ''
  try {
    // Drop points that barely change the shape (within about 2 m), so the route is smaller to store
    const simplified = simplify(lineString(path.value), { tolerance: 0.00002 }).geometry.coordinates
    savedRoute.value = routeId
      ? await walkRoutesApi.update(routeId, { name, path: simplified })   // re-record: replace the old path
      : await walkRoutesApi.create(name, simplified)                      // new route
    step.value = 'saved'
  } catch (err) {
    saveError.value = err.response?.data?.message ?? 'Could not save the route. Please try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="d-flex flex-column p-3 gap-3">
    <header>
      <!-- <router-link :to="{ name: 'my-routes' }" class="btn btn-link text-secondary p-0 mb-1">← My routes</router-link> -->
      <BackButton label="My Routes"></BackButton>
      <h1 class="page-title mb-1">{{ existingRoute ? `Re-record "${existingRoute.name}"` : 'Record a walking route' }}</h1>
      <p class="text-body-secondary mb-0">
        Walk the route with your phone. It must start and finish at your home.
        <template v-if="existingRoute">The old route is shown as a dashed line.</template>
      </p>
    </header>

    <!-- Couldn't load the route being re-recorded -->
    <div v-if="loadError" class="alert alert-danger mb-0">{{ loadError }}</div>

    <!-- No home location yet: can't record -->
    <div v-else-if="step !== 'loading' && !home" class="alert alert-danger mb-0">
      Add your postal code in <router-link to="/editProfile">Edit Profile</router-link> first.
      We use it to check that routes start and finish at your home.
    </div>

    <template v-else-if="step !== 'loading'">
      <!-- Stats and main buttons -->
      <div class="info-card d-flex flex-wrap align-items-center gap-4">
        <div>
          <div class="section-label">From home</div>
          <div class="stat">{{ metresFromHome === null ? 'Locating…' : formatDistance(metresFromHome) }}</div>
        </div>
        <div v-if="step !== 'ready'">
          <div class="section-label">Recorded</div>
          <div class="stat">{{ formatDistance(recordedM) }}</div>
        </div>
        <div v-if="accuracy">
          <div class="section-label">GPS accuracy</div>
          <div class="stat">±{{ Math.round(accuracy) }} m</div>
        </div>

        <div class="ms-auto d-flex gap-2">
          <button v-if="step === 'ready'" class="btn btn-brand" :disabled="!nearHome" @click="beginRecording">
            Start recording
          </button>
          <template v-else-if="step === 'recording'">
            <button class="btn bg-white border" @click="reset">Cancel</button>
            <button class="btn btn-brand" :disabled="!(hasLeftHome && nearHome)" @click="finishRecording">
              End recording
            </button>
          </template>
        </div>
      </div>

      <!-- Messages -->
      <div v-if="error" class="alert alert-danger mb-0">{{ error }}</div>
      <template v-else-if="metresFromHome !== null">
        <div v-if="step === 'ready'" class="alert mb-0" :class="nearHome ? 'alert-success' : 'alert-danger'">
          <template v-if="nearHome">You're at home. Press <strong>Start recording</strong> when you're ready to walk.</template>
          <template v-else>You're {{ formatDistance(metresFromHome) }} from home. Go within {{ HOME_RADIUS_M }} m of home to start.</template>
        </div>
        <p v-else-if="step === 'recording'" class="text-body-secondary small mb-0">
          {{ hasLeftHome && nearHome ? "You're back home. Press End to end the walk." : 'Recording… walk your route, then come back home to finish.' }}
        </p>
      </template>

      <!-- Name and save -->
      <form v-if="step === 'naming'" class="info-card" @submit.prevent="save">
        <label class="section-label form-label" for="route-name">Route name</label>
        <input id="route-name" v-model="routeName" class="form-control mb-2" maxlength="60" placeholder="e.g. Morning park loop" />
        <div v-if="saveError" class="alert alert-danger py-2">{{ saveError }}</div>
        <div class="d-flex gap-2 justify-content-end">
          <button type="button" class="btn bg-white border" @click="reset">Discard</button>
          <button type="submit" class="btn btn-brand" :disabled="saving">{{ saving ? 'Saving…' : 'Save route' }}</button>
        </div>
      </form>

      <!-- Saved -->
      <div v-if="step === 'saved'" class="alert alert-success d-flex flex-wrap align-items-center gap-2 mb-0">
        <span>Saved <strong>{{ savedRoute.name }}</strong> ({{ formatDistance(savedRoute.distanceM) }}).</span>
        <span class="ms-auto d-flex gap-3">
          <button v-if="!routeId" class="btn btn-link text-secondary p-0" @click="reset">Record another route</button>
          <router-link :to="{ name: 'my-routes' }" class="btn btn-link text-secondary p-0">Back to my routes</router-link>
        </span>
      </div>

      <WalkMap
        ref="mapRef"
        class="rounded-3 border"
        :home="home"
        :home-radius-m="HOME_RADIUS_M"
        :position="position"
        :walked-path="path"
        :planned-route="existingRoute?.path.coordinates ?? []"
      />
    </template>
  </div>
</template>

<style scoped>
/* PetSociety design system */
.page-title {
  font-size: 32px;
  font-weight: 700;
}
.info-card {
  background: #fff;
  border: 1px solid #ede3d8;
  border-radius: 10px;
  padding: 12px 16px;
}
.section-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--bs-secondary-color);
}
.stat {
  font-size: 18px;
  font-weight: 600;
}
</style>
