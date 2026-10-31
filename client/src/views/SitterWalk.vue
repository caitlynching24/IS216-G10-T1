<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { length, lineString, simplify } from '@turf/turf'
import WalkMap from '../components/WalkMap.vue'
import { useGeoTracker } from '../utils/useGeoTracker.js'
import { useHomeCheck, HOME_RADIUS_M } from '../utils/useHomeCheck.js'
import { useDeviationCheck, WARN_M, NOTIFY_M } from '../utils/useDeviationCheck.js'
import { walkApi } from '../services/walkApi.js'

const pageRoute = useRoute()
const walkId = pageRoute.params.id

const walk = ref(null)        // the walk from the server
const loadError = ref('')
const actionError = ref('')   // start / finish / end early failed
const syncError = ref('')     // a deviation report couldn't reach the server
const busy = ref(false)       // waiting on start / finish / end early
const resumed = ref(false)    // page was reloaded during the walk

// End early form
const showEndEarly = ref(false)
const endEarlyReason = ref('')

// Short message after coming back on route
const backOnRouteMessage = ref('')
let backOnRouteTimer = null

// ---- GPS, home and route checks ----
const { position, path, accuracy, error: gpsError, start: startGps, startRecording, stopRecording } = useGeoTracker()

const home = computed(() => walk.value?.home.coordinates ?? null)
// 'instructions' walks have no route: no dashed line, and no going-off-route checks
const hasRoute = computed(() => walk.value?.mode !== 'instructions')
const plannedRoute = computed(() => walk.value?.plannedPath?.coordinates ?? [])

const { metresFromHome, nearHome, hasLeftHome, resetLeftHome } = useHomeCheck(position, home)

const deviation = useDeviationCheck(position, plannedRoute, {
  onWarning(location, metresOff) {
    vibrate([200])
    report(() => walkApi.reportDeviation(walkId, 'warning', location, Math.round(metresOff)))
  },
  onNotify(location, metresOff) {
    vibrate([200, 100, 200])
    report(() => walkApi.reportDeviation(walkId, 'notify', location, Math.round(metresOff)))
  },
  onBackOnRoute(location, ownerWasNotified) {
    showBackOnRoute(ownerWasNotified
      ? "You're back on the route. The owner has been told."
      : "You're back on the route.")
    report(() => walkApi.reportBackOnRoute(walkId, location))
  }
})

// ---- Sending reports to the server in order ----
// Deviation reports must reach the server in the order they happened (warning before notify
// before back on route), so each request waits for the one before it to finish.
let lastRequest = Promise.resolve()
function sendInOrder(request) {
  const previous = lastRequest
  lastRequest = (async () => {
    try { await previous } catch { /* an earlier failure shouldn't block this one */ }
    return await request()
  })()
  return lastRequest
}

// sends a deviation report; if it fails, tells the sitter but carries on with the walk
async function report(request) {
  try {
    walk.value = await sendInOrder(request)
    syncError.value = ''
  } catch (err) {
    syncError.value = "Couldn't reach the server, so the owner may not have been alerted. Check your connection."
  }
}

// ---- Timer for the elapsed time ----
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 1000)

onBeforeUnmount(() => {
  clearInterval(clock)
  clearTimeout(backOnRouteTimer)
})

// ---- Things shown on the page ----
const status = computed(() => walk.value?.status ?? 'loading')
const isWalking = computed(() => status.value === 'in-progress')
const isFinished = computed(() => ['completed', 'ended-early'].includes(status.value))

const walkedM = computed(() =>
  path.value.length < 2 ? 0 : Math.round(length(lineString(path.value), { units: 'meters' }))
)

const elapsedS = computed(() => {
  if (!walk.value?.startedAt) return 0
  const end = walk.value.endedAt ? new Date(walk.value.endedAt) : now.value
  return Math.max(0, Math.round((end - new Date(walk.value.startedAt)) / 1000))
})

// the coral line: the live path while walking, the saved path afterwards
const shownPath = computed(() =>
  isFinished.value ? (walk.value.walkedPath?.coordinates ?? []) : path.value
)

const ownerAlertCount = computed(() => walk.value?.deviations.filter((d) => d.ownerNotifiedAt).length ?? 0)

const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`)
const formatDuration = (s) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function vibrate(pattern) {
  navigator.vibrate?.(pattern)   // not supported on every phone (e.g. iPhones), so it's optional
}

function showBackOnRoute(message) {
  backOnRouteMessage.value = message
  clearTimeout(backOnRouteTimer)
  backOnRouteTimer = setTimeout(() => { backOnRouteMessage.value = '' }, 5000)
}

// Drop points that barely change the shape (within about 2 m), so the path is smaller to send
const simplifiedPath = () =>
  path.value.length < 2 ? [...path.value] : simplify(lineString(path.value), { tolerance: 0.00002 }).geometry.coordinates

// ---- Loading ----
onMounted(async () => {
  try {
    walk.value = await walkApi.getById(walkId)
  } catch (err) {
    loadError.value = err.response?.data?.message ?? 'Could not load this walk.'
    return
  }

  if (isFinished.value) return   // just show the summary

  startGps()

  // the page was reloaded part-way through: carry on from here
  if (isWalking.value) {
    resumed.value = true
    startRecording()
    if (hasRoute.value) deviation.start()
    hasLeftHome.value = true   // they've been out walking, so coming home should allow ending the walk
  }
})

// ---- Actions ----
async function startWalk() {
  busy.value = true
  actionError.value = ''
  try {
    walk.value = await walkApi.start(walkId, position.value)
    resetLeftHome()
    startRecording()
    if (hasRoute.value) deviation.start()
  } catch (err) {
    actionError.value = err.response?.data?.message ?? 'Could not start the walk. Please try again.'
  } finally {
    busy.value = false
  }
}

// Recording carries on while the request is sent, and only stops once the server has saved the walk,
// so if saving fails nothing is lost and the sitter can try again.
async function finishWalk() {
  busy.value = true
  actionError.value = ''
  try {
    walk.value = await sendInOrder(() => walkApi.finish(walkId, simplifiedPath()))
    stopRecording()
    deviation.stop()
  } catch (err) {
    actionError.value = err.response?.data?.message ?? 'Could not finish the walk. Please try again.'
  } finally {
    busy.value = false
  }
}

async function endWalkEarly() {
  const reason = endEarlyReason.value.trim()
  if (!reason) {
    actionError.value = 'Tell the owner why you are ending the walk early.'
    return
  }

  busy.value = true
  actionError.value = ''
  try {
    walk.value = await sendInOrder(() => walkApi.endEarly(walkId, simplifiedPath(), reason))
    stopRecording()
    deviation.stop()
    showEndEarly.value = false
  } catch (err) {
    actionError.value = err.response?.data?.message ?? 'Could not end the walk. Please try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="d-flex flex-column vh-100 p-3 gap-3">
    <header>
      <h1 class="page-title mb-1">{{ walk?.routeName || 'Walk' }}</h1>
      <p class="text-body-secondary mb-0">
        {{ hasRoute ? 'Follow the dashed route.' : "No set route: follow the owner's instructions." }}
        Start and finish within {{ HOME_RADIUS_M }} m of the owner's home.
      </p>
    </header>

    <!-- The walk task's text from the owner. For an 'instructions' walk this is the whole plan. -->
    <div v-if="walk?.instructions" class="info-card">
      <div class="section-label">Owner's instructions</div>
      <div>{{ walk.instructions }}</div>
      <div v-if="!hasRoute" class="small text-body-secondary mt-1">
        This walk is tracked, but not checked against a route.
      </div>
    </div>

    <p v-if="status === 'loading' && !loadError" class="text-body-secondary mb-0">Loading walk…</p>
    <div v-if="loadError" class="alert alert-danger mb-0">{{ loadError }}</div>

    <template v-else-if="walk">
      <!-- Off-route pop-up -->
      <div
        v-if="isWalking && deviation.level.value !== 'on-route'"
        class="alert route-alert shadow"
        :class="deviation.level.value === 'notified' ? 'alert-danger' : 'alert-warning'"
        role="alert"
      >
        <strong v-if="deviation.level.value === 'warning'">You're {{ deviation.metresOffRoute.value }} m off the route.</strong>
        <strong v-else>The owner has been notified.</strong>
        <div v-if="deviation.level.value === 'warning'">
          Head back to the dashed line. The owner will be notified if you go more than {{ NOTIFY_M }} m off.
        </div>
        <div v-else>
          You're {{ deviation.metresOffRoute.value }} m off the route. Head back; they'll be told when you're back on it.
        </div>
      </div>

      <!-- Back on route message -->
      <div v-if="isWalking && backOnRouteMessage" class="alert alert-success route-alert shadow" role="status">
        {{ backOnRouteMessage }}
      </div>

      <!-- Stats and main buttons -->
      <div class="info-card d-flex flex-wrap align-items-center gap-4">
        <template v-if="!isFinished">
          <div>
            <div class="section-label">From home</div>
            <div class="stat">{{ metresFromHome === null ? 'Locating…' : formatDistance(metresFromHome) }}</div>
          </div>
          <div v-if="isWalking && hasRoute">
            <div class="section-label">From route</div>
            <div class="stat">{{ deviation.metresOffRoute.value === null ? '–' : `${deviation.metresOffRoute.value} m` }}</div>
          </div>
          <div v-if="isWalking">
            <div class="section-label">Walked</div>
            <div class="stat">{{ formatDistance(walkedM) }}</div>
          </div>
          <div v-if="isWalking">
            <div class="section-label">Time</div>
            <div class="stat">{{ formatDuration(elapsedS) }}</div>
          </div>
          <div v-if="accuracy">
            <div class="section-label">GPS accuracy</div>
            <div class="stat">±{{ Math.round(accuracy) }} m</div>
          </div>
        </template>

        <!-- Summary once the walk has ended -->
        <template v-else>
          <div>
            <div class="section-label">Status</div>
            <div class="stat">{{ status === 'completed' ? 'Completed' : 'Ended early' }}</div>
          </div>
          <div>
            <div class="section-label">Distance</div>
            <div class="stat">{{ formatDistance(walk.distanceM) }}</div>
          </div>
          <div>
            <div class="section-label">Time</div>
            <div class="stat">{{ formatDuration(walk.durationS) }}</div>
          </div>
          <template v-if="hasRoute">
            <div>
              <div class="section-label">Off route</div>
              <div class="stat">{{ walk.deviations.length }} time{{ walk.deviations.length === 1 ? '' : 's' }}</div>
            </div>
            <div>
              <div class="section-label">Owner alerted</div>
              <div class="stat">{{ ownerAlertCount }} time{{ ownerAlertCount === 1 ? '' : 's' }}</div>
            </div>
          </template>
          <div v-else>
            <div class="section-label">Route check</div>
            <div class="stat">Not checked</div>
          </div>
        </template>

        <div class="ms-auto d-flex gap-2">
          <button v-if="status === 'ready'" class="btn btn-primary" :disabled="!nearHome || busy" @click="startWalk">
            {{ busy ? 'Starting…' : 'Start walk' }}
          </button>
          <template v-else-if="isWalking && !showEndEarly">
            <button class="btn bg-white border" :disabled="busy" @click="showEndEarly = true">End early</button>
            <button class="btn btn-primary" :disabled="!(hasLeftHome && nearHome) || busy" @click="finishWalk">
              {{ busy ? 'Saving…' : 'End walk' }}
            </button>
          </template>
          <router-link v-else-if="isFinished" to="/session" class="btn btn-primary">Back to session</router-link>
        </div>
      </div>

      <!-- Messages -->
      <div v-if="gpsError" class="alert alert-danger mb-0">{{ gpsError }}</div>
      <div v-if="actionError" class="alert alert-danger mb-0">{{ actionError }}</div>
      <div v-if="syncError" class="alert alert-warning mb-0">{{ syncError }}</div>
      <div v-if="resumed && isWalking" class="alert alert-warning mb-0">
        The page was reloaded during the walk. Your path is being recorded again from here.
      </div>

      <template v-if="!gpsError && metresFromHome !== null">
        <div v-if="status === 'ready'" class="alert mb-0" :class="nearHome ? 'alert-success' : 'alert-danger'">
          <template v-if="nearHome">You're at the owner's home. Press <strong>Start walk</strong> when you're ready.</template>
          <template v-else>You're {{ formatDistance(metresFromHome) }} from the owner's home. Go within {{ HOME_RADIUS_M }} m to start.</template>
        </div>
        <p v-else-if="isWalking && deviation.level.value === 'on-route'" class="text-body-secondary small mb-0">
          {{ hasLeftHome && nearHome
            ? "You're back at the owner's home. Press End walk to finish."
            : hasRoute
              ? `Walking… stay within ${WARN_M} m of the dashed route, then come back to the home to finish.`
              : 'Walking… come back to the home to finish.' }}
        </p>
      </template>

      <!-- End early form -->
      <form v-if="isWalking && showEndEarly" class="info-card" @submit.prevent="endWalkEarly">
        <label class="section-label form-label" for="end-reason">Why are you ending the walk early?</label>
        <textarea id="end-reason" v-model="endEarlyReason" class="form-control mb-2" rows="2" maxlength="200"
          placeholder="e.g. Heavy rain, the dog hurt its paw"></textarea>
        <p class="small text-body-secondary mb-2">The owner will be notified with this reason.</p>
        <div class="d-flex gap-2 justify-content-end">
          <button type="button" class="btn bg-white border" @click="showEndEarly = false">Keep walking</button>
          <button type="submit" class="btn btn-danger" :disabled="busy">{{ busy ? 'Ending…' : 'End walk early' }}</button>
        </div>
      </form>

      <!-- Ended early: show the reason -->
      <div v-if="status === 'ended-early'" class="alert alert-warning mb-0">
        Ended early: {{ walk.endedEarlyReason }}
      </div>

      <WalkMap
        class="flex-grow-1 rounded-3 border"
        :home="home"
        :home-radius-m="HOME_RADIUS_M"
        :position="isFinished ? null : position"
        :walked-path="shownPath"
        :planned-route="plannedRoute"
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
/* Pop-up pinned to the top of the screen so the sitter sees it while walking */
.route-alert {
  position: fixed;
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  width: min(92vw, 520px);
  z-index: 1050;
  margin: 0;
  border-radius: 10px;
  padding: 12px 16px;
}
</style>
