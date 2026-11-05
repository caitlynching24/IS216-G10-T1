<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { length, lineString } from '@turf/turf'
import WalkMap from '../components/WalkMap.vue'
import { useFitHeight } from '../utils/useFitHeight.js'
import { HOME_RADIUS_M } from '../utils/useHomeCheck.js'
import { WARN_M, NOTIFY_M } from '../utils/useDeviationCheck.js'
import {
  position, path, accuracy, gpsError, home, metresFromHome, nearHome, hasLeftHome, deviation, trackedWalk,
  syncError, backOnRouteMessage, sendInOrder, beginWalk, resumeWalk, endWalk, simplifiedPath, resumeTracking, startGps, stopGpsIfIdle
} from '../utils/sessionTracker.js'
import { walkApi } from '../services/walkApi.js'
import BackButton from '../components/BackButton.vue'

const pageRoute = useRoute()
const router = useRouter()
const walkId = pageRoute.params.id

// the map fills the rest of the screen without scrolling (gap: this page's padding plus the main area's)
const mapRef = ref(null)
useFitHeight(mapRef, { gap: 40 })

const walk = ref(null)        // the walk from the server
const loadError = ref('')
const actionError = ref('')   // start / finish / end early failed
const busy = ref(false)       // waiting on start / finish / end early
const resumed = ref(false)    // the page was reloaded during the walk and no path was saved on the phone

// End early form
const showEndEarly = ref(false)
const endEarlyReason = ref('')

// ---- GPS, home and route checks ----
// The shared tracker does these (utils/sessionTracker.js), so a walk carries on if the sitter leaves this page
const hasRoute = computed(() => walk.value?.mode !== 'instructions')
const plannedRoute = computed(() => walk.value?.plannedPath?.coordinates ?? [])
watch(trackedWalk, (w) => {
  if (w?._id === walkId) walk.value = w
})

// ---- Timer for the elapsed time ----
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 1000)

onBeforeUnmount(() => {
  clearInterval(clock)
  stopGpsIfIdle()
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

// ---- Loading ----
onMounted(async () => {
  try {
    walk.value = await walkApi.getById(walkId)
  } catch (err) {
    loadError.value = err.response?.data?.message ?? 'Could not load this walk.'
    return
  }

  home.value = walk.value.home.coordinates
  if (isFinished.value) return   // just show the summary

  await resumeTracking()
  startGps()

  // back on this page, or reloaded part-way through: carry on from here
  if (isWalking.value) resumed.value = !resumeWalk(walk.value)
})

// ---- Actions ----
async function startWalk() {
  busy.value = true
  actionError.value = ''
  try {
    walk.value = await walkApi.start(walkId, position.value)
    beginWalk(walk.value)
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
    endWalk()
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
    endWalk()
    showEndEarly.value = false
  } catch (err) {
    actionError.value = err.response?.data?.message ?? 'Could not end the walk. Please try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BackButton label='Back' class="mt-1 mb-0"></BackButton>
  <div class="d-flex flex-column p-3 gap-3">
    <header>
      <h1 class="page-title mb-1">{{ walk?.routeName || 'Walk' }}</h1>
      <p class="text-body-secondary mb-0">
        {{ hasRoute ? 'Follow the dashed route.' : "No set route: follow the owner's instructions." }}
        Start and finish within {{ HOME_RADIUS_M }} m of the owner's home.
      </p>
      <p v-if="isWalking" class="small text-body-secondary mb-0">Keep this app open: locking your phone leaves gaps in the path.</p>
    </header>

    <!-- The walk task's text from the owner, then anything they added after confirming (like where the leash is).
         For an 'instructions' walk this is the whole plan. -->
    <div v-if="walk?.instructions || walk?.ownerNotes" class="info-card">
      <div class="section-label">Owner's instructions</div>
      <div>{{ walk.instructions }}</div>
      <div v-if="walk.ownerNotes" class="owner-notes">{{ walk.ownerNotes }}</div>
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
          <button v-if="status === 'ready'" class="btn btn-brand" :disabled="!nearHome || busy" @click="startWalk">
            {{ busy ? 'Starting…' : 'Start walk' }}
          </button>
          <template v-else-if="isWalking && !showEndEarly">
            <button class="btn bg-white border" :disabled="busy" @click="showEndEarly = true">End early</button>
            <button class="btn btn-brand" :disabled="!(hasLeftHome && nearHome) || busy" @click="finishWalk">
              {{ busy ? 'Saving…' : 'End walk' }}
            </button>
          </template>
          <router-link v-else-if="isFinished" to="/session" class="btn btn-brand">Back to session</router-link>
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
        ref="mapRef"
        class="rounded-3 border"
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
.owner-notes {
  white-space: pre-line; /* keeps the owner's line breaks */
  overflow-wrap: anywhere;
}
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
