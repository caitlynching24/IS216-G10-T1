<script setup>
// One session on the Session page ("Today card"), for owners and sitters.
// Header (who, pets, day, hours, progress, chat), a status line with the sitter's Start / End session buttons,
// then the Alert box, the live map or "Where to go", the care checklist, and the owner's timeline or the sitter's report.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { visitsApi } from '../services/api.js'
import { walkApi } from '../services/walkApi.js'
import { usePhotoPicker } from '../utils/usePhotoPicker.js'
import { sendPaymentNotification } from '../utils/sendNotification.js'
import { medicationIncomplete } from '../utils/careDetails.js'
import { getCurrentLocation } from '../utils/currentLocation.js'
import { blocked, deviation, isSharing, resumeTracking, sharingEnded, stopTracking, walkEndedCount } from '../utils/sessionTracker.js'
import { clockText, joinNames, km, timeOf, todayEvents } from '../utils/visitReport.js'
import SessionChat from '../components/SessionChat.vue'
import SessionTask from '../components/SessionTask.vue'
import WalkMap from '../components/WalkMap.vue'
import OwnerLiveLocation from '../components/OwnerLiveLocation.vue'
import CareDetailsForm from '../components/CareDetailsForm.vue'

const props = defineProps({
  session: { type: Object, required: true },
  isSitter: { type: Boolean, default: false },
  active: { type: Boolean, default: true } // false while another session is showing
})
const emit = defineEmits(['visit-change', 'unread', 'walk-ended', 'items-change', 'view-report', 'view-earlier'])

const visit = ref(props.session.visit)
const status = ref(props.session.booking.status)
watch(() => props.session, (s) => {
  visit.value = s.visit
  status.value = s.booking.status
})

const actionError = ref('')
const starting = ref(false)
const checking = ref(false) // waiting for the browser's location
const reading = ref(null) // the last location reading: { location, accuracy }, or null
const startProblem = ref(null) // why the location check didn't pass: { check, distanceM }
const writingNote = ref(false)
const startNote = ref('')
const startNoteError = ref('')
const savingTask = ref(false)
const ending = ref(false)
const confirmingEnd = ref(false) // asking "End anyway?" because some tasks aren't ticked
const walkPrompt = ref(false) // End session was pressed with a walk still going
const notes = ref('')

const slots = [0, 1, 2].map(() => reactive(usePhotoPicker()))
const photoError = computed(() => slots.map((s) => s.error).find(Boolean) || '')

const isActive = computed(() => visit.value?.status === 'active')
const isCompleted = computed(() => visit.value?.status === 'completed')
const canStart = computed(() => !visit.value && ['confirmed', 'in-progress'].includes(status.value))
const canChat = computed(() => ['confirmed', 'in-progress'].includes(status.value))

// ---- Header ----
const booking = computed(() => props.session.booking)
const other = computed(() => (props.isSitter ? booking.value.owner : booking.value.sitter))
const otherName = computed(() => other.value?.username || (props.isSitter ? 'the owner' : 'the sitter'))
const initial = computed(() => (other.value?.username || '?').trim().charAt(0).toUpperCase())
// "Mochi and Bean · Day 4 of 4 · 9:00 am – 12:00 pm" (that day's hours and day number come from the server)
const bookedHours = computed(() => (booking.value.startTime && booking.value.endTime
  ? `${clockText(booking.value.startTime)} – ${clockText(booking.value.endTime)}` : ''))
const multiDay = computed(() => booking.value.totalDays > 1)
const isLastDay = computed(() => multiDay.value && booking.value.dayNumber === booking.value.totalDays)
// Owner: today's report opens with View report once today is done (and Prev reaches earlier days from there).
// Until then, earlier days' reports open with "Earlier reports", even while today's session is in progress.
const canViewToday = computed(() => !props.isSitter && isCompleted.value && !isLastDay.value && multiDay.value)
const earlierReports = computed(() => (props.session.finishedDays ?? 0) - (isCompleted.value ? 1 : 0))
const showEarlier = computed(() => !props.isSitter && !canViewToday.value && earlierReports.value > 0)
const metaLine = computed(() => [
  joinNames((booking.value.pets ?? []).map((p) => p.name)),
  multiDay.value ? `Day ${booking.value.dayNumber} of ${booking.value.totalDays}` : '',
  bookedHours.value
].filter(Boolean).join(' · '))

// Every due time of every task: a task done twice a day counts 2
const totalTicks = computed(() => props.session.items.reduce((sum, it) => sum + it.dailyFrequency, 0))
const doneTicks = computed(() =>
  props.session.items.reduce((sum, it) => sum + Math.min(countFor(it), it.dailyFrequency), 0)
)

// Reminds the sitter once the booked time is over. The session itself closes 6 hours later (utils/endForgottenSessions.js).
const AUTO_END_MS = 6 * 60 * 60 * 1000
const now = ref(Date.now())
let clock = null
onMounted(() => {
  clock = setInterval(() => { now.value = Date.now() }, 5000) // every 5 s, so "Location updated 12 s ago" keeps counting
})
onBeforeUnmount(() => clearInterval(clock))

const bookedEnd = computed(() => {
  if (!visit.value) return null
  const [h, m] = (booking.value.endTime || '24:00').split(':').map(Number)
  return new Date(`${visit.value.date}T00:00:00+08:00`).getTime() + (h * 60 + m) * 60000
})
const pastBookedEnd = computed(() => props.isSitter && isActive.value && now.value >= bookedEnd.value)
const autoEndText = computed(() => timeOf(bookedEnd.value + AUTO_END_MS))

// ---- Status line ----
function agoText(at) {
  const seconds = Math.max(0, Math.round((now.value - new Date(at).getTime()) / 1000))
  return seconds < 60 ? `${seconds} s ago` : `${Math.floor(seconds / 60)} min ago`
}
const walkText = computed(() => {
  const d = props.session.activeWalk?.distanceSoFarM
  return d ? `On a walk, ${km(d)} so far` : 'On a walk'
})
// The owner's right-hand text: when the location last came in, or that it has paused
const locationNote = computed(() => {
  const loc = props.session.liveLocation
  if (!loc) return null
  if (loc.ended || ['paused', 'blocked'].includes(loc.state)) return { warn: true, text: 'Location paused' }
  return loc.at ? { warn: false, text: `Location updated ${agoText(loc.at)}`, short: `location ${agoText(loc.at)}` } : null
})
// The sitter's line under "In progress since…": is their location getting through?
const sharingText = computed(() => {
  if (sharingEnded.value) return 'Location sharing has stopped'
  if (blocked.value) return 'Location blocked'
  return `Sharing your location with ${otherName.value}`
})
const statusTone = computed(() => (isActive.value ? 'live' : 'idle'))
const completedText = computed(() => {
  if (!isCompleted.value) return ''
  const times = `${timeOf(visit.value.startedAt)} – ${timeOf(visit.value.endedAt)}`
  if (!props.isSitter) return times
  return `${times} · ${visit.value.autoEnded ? 'Ended automatically' : 'Report sent'}`
})

const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`)
const outOfRange = computed(() => startProblem.value?.check === 'out-of-range')
const problemText = computed(() => (outOfRange.value
  ? `You're ${formatDistance(startProblem.value.distanceM)} from the home. Sessions start within 75 m.`
  : "We couldn't get your location."))
const noteHint = computed(() => (outOfRange.value
  ? 'The owner will be notified, and your location will be shared as usual.'
  : "The owner will be notified and will see 'Location not shared'. Walks can't start until location is on."))

function clearStartProblem() {
  startProblem.value = null
  writingNote.value = false
  startNote.value = ''
  startNoteError.value = ''
}

// Sends the start to the server, which checks the location. `note` is for starting without passing the check.
async function sendStart(note) {
  starting.value = true
  actionError.value = ''
  try {
    visit.value = await visitsApi.start(booking.value._id, { ...reading.value, note })
    status.value = 'in-progress'
    emit('visit-change', visit.value)
    clearStartProblem()
    resumeTracking()
  } catch (err) {
    if (err.response?.status === 409 && err.response.data.check) {
      startProblem.value = { check: err.response.data.check, distanceM: err.response.data.distanceM }
    } else {
      actionError.value = err.response?.data?.message || 'Could not start the session.'
    }
  } finally {
    starting.value = false
  }
}

// Also the "Check again" button, so it clears any note being written
async function startSession() {
  clearStartProblem()
  checking.value = true
  reading.value = await getCurrentLocation()
  checking.value = false
  await sendStart()
}

function startWithNote() {
  if (!startNote.value.trim()) {
    startNoteError.value = 'Add a quick note first.'
    return
  }
  sendStart(startNote.value.trim())
}

function ticksFor(item) {
  return (visit.value?.completedTasks ?? []).filter((t) => String(t.task) === String(item._id))
}
function countFor(item) {
  return ticksFor(item).length
}

async function tick(item, n) {
  savingTask.value = true
  actionError.value = ''
  try {
    visit.value = await visitsApi.setTask(visit.value._id, item._id, n <= countFor(item) ? n - 1 : n)
    emit('visit-change', visit.value)
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not save. Try again.'
  } finally {
    savingTask.value = false
  }
}

// ---- Walk tasks: ticked by doing a tracked walk, not by hand ----
const router = useRouter()
const startingWalk = ref(null) // id of the walk task being started
const WALK_IN_PROGRESS = "You can't start another walk while a walk is in progress."

// the walks that ticked this task today: [{ walk: walkId, ... }]
function walksFor(item) {
  return (visit.value?.completedTasks ?? []).filter((t) => String(t.task) === String(item._id) && t.walk)
}

// Opens the walk page for this task. The server gives back the walk already under way
// for this task if there is one, so pressing this again carries on with the same walk.
// Only one walk can be under way, so a different task's walk is refused here (and by the server).
async function startWalk(item) {
  const walking = props.session.activeWalk
  const isThisWalk = String(walking?.task) === String(item._id)
  if (walking && !isThisWalk) {
    actionError.value = WALK_IN_PROGRESS
    return
  }
  // the walk under way carries on, whatever location is doing; only a new one needs it
  if (blocked.value && !isThisWalk) {
    actionError.value = 'Walks need location switched on.'
    return
  }
  startingWalk.value = item._id
  actionError.value = ''
  try {
    const walk = await walkApi.create({ visitId: visit.value._id, taskId: item._id })
    router.push({ name: 'sitter-walk', params: { id: walk._id } })
  } catch (err) {
    // (409: a walk has started that this page doesn't know about yet)
    actionError.value = err.response?.status === 409 ? WALK_IN_PROGRESS : err.response?.data?.message || 'Could not start the walk.'
  } finally {
    startingWalk.value = null
  }
}

// End session: a walk still running comes first, then the notes, then a check for unticked tasks.
// (The server refuses while a walk is running too, in case this page is out of date.)
function endSession() {
  actionError.value = ''
  if (props.session.activeWalk) {
    walkPrompt.value = true
    return
  }
  if (!notes.value.trim()) {
    actionError.value = 'Add your notes for the owner before ending the session.'
    return
  }
  const unfinished = props.session.items.some((item) => countFor(item) < item.dailyFrequency)
  if (unfinished) {
    confirmingEnd.value = true
    return
  }
  submitReport()
}

async function submitReport() {
  confirmingEnd.value = false
  ending.value = true
  actionError.value = ''
  try {
    const form = new FormData()
    form.append('notes', notes.value.trim())
    slots.forEach((s) => {
      if (s.file) {
        form.append('photos', s.file)
      }
    })
    visit.value = await visitsApi.end(visit.value._id, form)
    emit('visit-change', visit.value)
    stopTracking()
    if (visit.value.date === booking.value.endDate) {
      status.value = 'completed'
      sendPaymentNotification(booking.value._id)
    }
    slots.forEach((s) => s.clear())
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not submit the report.'
  } finally {
    ending.value = false
  }
}

// getting address into google maps
const address = computed(() => props.session.ownerAddress)
const mapsUrl = computed(() =>
  address.value
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address.value.line1} Singapore ${address.value.postalCode}`)}`
    : ''
)

// "Where to go": open before the session, a slim row during and after it
const whereOpen = ref(!visit.value)
// the walk under way, to go back to it
const openWalk = () => router.push({ name: 'sitter-walk', params: { id: props.session.activeWalk._id } })
const offRoute = computed(() => props.isSitter && props.session.activeWalk && deviation.level.value !== 'on-route')
const showSharing = computed(() => props.isSitter && isActive.value)

// the tracker ended a walk by itself at the sharing cutoff, so this page is out of date
watch(walkEndedCount, () => emit('walk-ended'))

// Owner: tasks with no details get an "Add details" link, which opens the same care details form
// as the booking page. The server only takes details before the first session starts.
const canAddDetails = computed(() => !props.isSitter && status.value === 'confirmed' && !visit.value)
const detailsFormOpen = ref(false)
const formEl = ref(null)
async function openDetailsForm() {
  detailsFormOpen.value = true
  await nextTick()
  formEl.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

// the form sends back the whole checklist; copy the new details onto today's tasks
function detailsSaved(saved) {
  const byId = new Map(saved.items.map((t) => [String(t._id), t]))
  emit('items-change', props.session.items.map((it) => ({ ...it, details: byId.get(String(it._id))?.details ?? it.details })))
}

const showWhere = computed(() => props.session.ownerAddress !== undefined && ['confirmed', 'in-progress'].includes(status.value))
watch(visit, (v) => {
  if (v) whereOpen.value = false
})
watch(() => props.active, (isActive) => {
  if (!isActive) {
    confirmingEnd.value = false
    clearStartProblem()
  }
})

// ---- Alert box: things to look at now ----
const chatRef = ref(null)
const alerts = computed(() => {
  const list = []
  const check = visit.value?.startCheck
  if (check && !isCompleted.value) {
    const where = check.reason === 'out-of-range' && check.distanceM != null
      ? `Started ${Math.round(check.distanceM)} m from home`
      : 'Started without a location check'
    list.push({
      id: 'start-check',
      text: props.isSitter ? `${where} · ${otherName.value} was notified` : `${where} · "${check.note}"`,
      time: timeOf(check.at ?? visit.value.startedAt)
    })
  }
  if (!isCompleted.value) {
    const missing = props.session.items.filter(medicationIncomplete)
    for (const item of missing) {
      list.push({
        id: `med-${item._id}`,
        text: missing.length > 1 ? `Medication task has no details: ${item.title}` : 'Medication task has no details',
        link: props.isSitter ? 'message' : canAddDetails.value ? 'add' : 'booking'
      })
    }
  }
  return list
})

// ---- Owner's timeline ----
const SHOWN_EVENTS = 3
const allEvents = ref(false)
const events = computed(() => todayEvents({ ...props.session, visit: visit.value }, props.session.walks ?? []))
const shownEvents = computed(() => (allEvents.value ? events.value : events.value.slice(0, SHOWN_EVENTS)))
</script>

<template>
  <article class="sc" :class="isSitter ? 'sc--sitter' : 'sc--owner'">
    <div class="sc-sticky">
      <!-- header: who, which pets, which day, and how far along -->
      <header class="sc-head">
        <span class="sc-avatar" aria-hidden="true">
          <img v-if="other?.profilePicture?.url" :src="other.profilePicture.url" alt="" />
          <template v-else>{{ initial }}</template>
        </span>
        <div class="sc-head__text">
          <div class="sc-head__line1">
            <router-link v-if="other" :to="`/users/${other._id}`" class="sc-name">{{ other.username }}</router-link>
            <span class="sc-role">{{ isSitter ? 'Owner' : 'Sitter' }}</span>
            <span v-if="isLastDay" class="sc-last">Last day</span>
          </div>
          <div class="sc-head__line2">{{ metaLine }}</div>
        </div>
        <div v-if="totalTicks" class="sc-progress-block">
          <span class="sc-count">{{ doneTicks }} of {{ totalTicks }} done</span>
          <div class="sc-progress" role="progressbar" aria-label="Checklist progress"
               aria-valuemin="0" :aria-valuemax="totalTicks" :aria-valuenow="doneTicks">
            <span :style="{ width: `${(doneTicks / totalTicks) * 100}%` }"></span>
          </div>
        </div>
        <SessionChat ref="chatRef" class="sc-chat" :booking-id="session.booking._id" :is-sitter="isSitter" :can-send="canChat"
                     :active="active" @unread="emit('unread', $event)" />
      </header>

      <!-- the status line; for sitters it holds Start / End session, and is fixed to the bottom on phones -->
      <div class="sc-dock">
        <div class="sc-status" :class="`sc-status--${statusTone}`">
          <div class="sc-status__left">
            <span class="sc-dot" :class="{ 'sc-dot--live': isActive }" aria-hidden="true"></span>
            <div class="sc-status__text">
              <template v-if="isCompleted">
                <strong>Completed</strong><span class="sc-status__sub"> · {{ completedText }}</span>
              </template>
              <template v-else-if="isActive">
                <strong>In progress since {{ timeOf(visit.startedAt) }}</strong>
                <!-- owner: what the sitter is doing; sitter: whether their location is getting through -->
                <span v-if="!isSitter" class="sc-status__sub sc-wide"> · {{ session.activeWalk ? walkText : 'Sitter is working' }}</span>
                <span v-if="!isSitter" class="sc-status__sub sc-narrow">
                  {{ session.activeWalk ? walkText.replace(' so far', '') : 'Sitter is working' }}<template v-if="locationNote?.short"> · {{ locationNote.short }}</template>
                </span>
                <span v-else class="sc-status__sub sc-status__sub--block" :class="{ 'sc-status__sub--warn': blocked || sharingEnded }">{{ sharingText }}</span>
              </template>
              <template v-else-if="isSitter">
                <strong>{{ checking ? 'Checking your location…' : 'Not started' }}</strong>
                <span class="sc-status__sub sc-status__sub--block">Starting checks you're within 75 m of the home</span>
              </template>
              <template v-else>
                <strong>Not started yet</strong><span v-if="bookedHours" class="sc-status__sub"> · Booked {{ bookedHours }}</span>
              </template>
            </div>
          </div>

          <template v-if="isSitter && !isCompleted">
            <button v-if="isActive" type="button" class="sc-btn sc-btn--end" :disabled="ending" @click="endSession">
              <span v-if="ending" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
              {{ ending ? 'Ending…' : 'End session' }}
            </button>
            <button v-else type="button" class="sc-btn sc-btn--start" :disabled="!canStart || starting || checking" @click="startSession">
              <span v-if="starting" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
              {{ starting ? 'Starting…' : 'Start session' }}
            </button>
          </template>
          <!-- owner, a finished day that isn't the booking's last: the report opens in the report window -->
          <button v-else-if="canViewToday" type="button" class="sc-report-btn"
                  @click="emit('view-report')">View report</button>
          <div v-else-if="!isSitter && ((isActive && locationNote) || showEarlier)" class="sc-status__end">
            <small v-if="isActive && locationNote" class="sc-status__right sc-wide"
                   :class="{ 'sc-status__right--warn': locationNote.warn }">{{ locationNote.text }}</small>
            <!-- owner: reports from the booking's earlier days, readable even while today's session is going -->
            <button v-if="showEarlier" type="button" class="sc-report-btn" @click="emit('view-earlier')">
              Earlier reports ({{ earlierReports }})
            </button>
          </div>
        </div>

        <!-- the location check didn't pass: try again, or start with a note for the owner -->
        <div v-if="startProblem" class="sc-panel" role="alert">
          <p class="mb-2">{{ problemText }}</p>
          <div v-if="!writingNote" class="d-flex flex-wrap gap-2">
            <button type="button" class="btn btn-brand sc-panel__btn" :disabled="checking || starting" @click="startSession">Check again</button>
            <button type="button" class="btn btn-outline-secondary sc-panel__btn" @click="writingNote = true">
              {{ outOfRange ? "I'm out of range" : 'I have no location access' }}
            </button>
          </div>
          <form v-else @submit.prevent="startWithNote">
            <label :for="`start-note-${session.booking._id}`" class="form-label small mb-1">Quick note to the owner</label>
            <textarea :id="`start-note-${session.booking._id}`" v-model="startNote" class="form-control mb-1" rows="2" maxlength="200"></textarea>
            <p v-if="startNoteError" class="text-danger small mb-1">{{ startNoteError }}</p>
            <p class="sc-hint mb-2">{{ noteHint }}</p>
            <div class="d-flex flex-wrap gap-2">
              <button type="submit" class="btn btn-brand sc-panel__btn" :disabled="starting">{{ starting ? 'Starting…' : 'Start and notify owner' }}</button>
              <button type="button" class="btn btn-outline-secondary sc-panel__btn" @click="clearStartProblem">Cancel</button>
            </div>
          </form>
        </div>

        <div v-if="walkPrompt" class="sc-panel" role="alert">
          <p class="mb-2">Finish or end your walk before ending the session.</p>
          <div class="d-flex flex-wrap gap-2">
            <button type="button" class="btn btn-brand sc-panel__btn" @click="openWalk">Go to walk</button>
            <button type="button" class="btn btn-outline-secondary sc-panel__btn" @click="walkPrompt = false">Cancel</button>
          </div>
        </div>

        <div v-if="confirmingEnd" class="sc-panel" role="alert">
          <p class="mb-2">Some tasks aren't ticked. End the session and submit the report anyway?</p>
          <div class="d-flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline-secondary sc-panel__btn" @click="confirmingEnd = false">Keep working</button>
            <button type="button" class="btn btn-brand sc-panel__btn" @click="submitReport">End session</button>
          </div>
        </div>

        <!-- on phones the error also shows here, because the checklist may be scrolled out of view -->
        <div v-if="actionError" class="alert alert-warning sc-dock__error" role="alert">{{ actionError }}</div>
      </div>
    </div>

    <div class="sc-body">
      <!-- Alert box: things to look at now -->
      <section v-if="alerts.length" class="sc-alert" :aria-labelledby="`alert-title-${session.booking._id}`">
        <h4 :id="`alert-title-${session.booking._id}`" class="sc-alert__title">Alert</h4>
        <ul class="sc-alert__list">
          <li v-for="a in alerts" :key="a.id" class="sc-alert__row">
            <span aria-hidden="true">⚠</span>
            <strong class="sc-alert__text">{{ a.text }}</strong>
            <span v-if="a.time" class="sc-alert__end">{{ a.time }}</span>
            <button v-else-if="a.link === 'message'" type="button" class="sc-alert__end sc-alert__link" @click="chatRef?.openChat()">Message {{ otherName }}</button>
            <button v-else-if="a.link === 'add'" type="button" class="sc-alert__end sc-alert__link" @click="openDetailsForm">Add details</button>
            <router-link v-else-if="a.link === 'booking'" :to="`/bookings/${session.booking._id}`" class="sc-alert__end sc-alert__link">Add details</router-link>
          </li>
        </ul>
      </section>

      <!-- sitter: notices that need doing something, kept apart from the Alert box -->
      <div v-if="pastBookedEnd" class="sc-banner" role="status">
        Your booking time has ended. End the session and submit your report. It ends automatically at {{ autoEndText }}.
      </div>
      <div v-if="visit?.autoEnded" class="sc-banner" role="status">This session ended automatically, 6 hours after the booked end time.</div>
      <div v-if="offRoute" class="sc-banner sc-banner--action" role="alert">
        <span>{{ deviation.level.value === 'notified' ? "You're off the route, and the owner has been notified." : "You're off the route. Head back to the dashed line." }}</span>
        <button type="button" class="btn btn-brand sc-panel__btn" @click="openWalk">Go to walk</button>
      </div>
      <div v-if="showSharing && (blocked || sharingEnded)" class="sc-banner" role="status">
        <template v-if="sharingEnded">Location sharing has stopped because the booked time has ended.</template>
        <template v-else>Location blocked. The owner sees "Location not shared". Walks need location switched on.</template>
      </div>
      <p v-else-if="showSharing && isSharing" class="sc-hint mb-0">
        Keep PetSociety open while you work: location updates stop if your phone locks or you close the app.
      </p>

      <!-- owner: where the sitter is, only during an active session -->
      <OwnerLiveLocation v-if="!isSitter && isActive && session.liveLocation && active" :location="session.liveLocation"
                         :home="visit.home" :planned-route="session.activeWalk?.plannedPath?.coordinates ?? []"
                         :sitter-name="otherName" />

      <!-- sitter: where to go -->
      <section v-if="showWhere" class="sc-card sc-where-card">
        <button v-if="!whereOpen" type="button" class="sc-where-row" :aria-expanded="false" @click="whereOpen = true">
          <span class="sc-label mb-0">Where to go</span>
          <span v-if="address" class="sc-where-row__short">
            {{ address.line1 }}<template v-if="address.instructions"> · Getting in notes</template>
          </span>
          <span class="ms-auto" aria-hidden="true">▸</span>
        </button>
        <template v-else>
          <button type="button" class="sc-where-row sc-where-row--open" :aria-expanded="true" @click="whereOpen = false">
            <span class="sc-label mb-0">Where to go</span>
            <span class="ms-auto" aria-hidden="true">▾</span>
          </button>
          <div class="sc-where-grid">
            <div v-if="address?.location && active" class="sc-where-map">
              <WalkMap :home="address.location" markers="dots" />
              <span class="sc-where-legend"><svg class="sc-key-home" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 1.8 11.2h3V21.5h14.4V11.2h3z" fill="#2b2420" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><rect x="10" y="14.5" width="4" height="7" rx=".6" fill="#fff"/></svg> Home · circle: 75 m start zone</span>
            </div>
            <div class="sc-where-info">
              <template v-if="address?.line1">
                <address class="sc-address">
                  <strong>{{ address.line1 }}</strong>
                  <strong v-if="address.unit">{{ address.unit }}</strong>
                  <strong v-if="address.postalCode">Singapore {{ address.postalCode }}</strong>
                </address>
                <a :href="mapsUrl" target="_blank" rel="noopener" class="sc-link">Open in Google Maps</a>
              </template>
              <p v-else class="sc-hint mb-0">The owner hasn't added an address yet.</p>

              <template v-if="address?.instructions">
                <h5 class="sc-subtitle">Getting in</h5>
                <p class="sc-instructions">{{ address.instructions }}</p>
              </template>
              <p v-if="address?.line1" class="sc-hint sc-hint--small mt-2 mb-0">Shared with you because this booking is confirmed. Do <strong>not</strong> share this with anyone else.</p>
            </div>
          </div>
        </template>
      </section>

      <div class="sc-cols">
        <!-- care checklist -->
        <section class="sc-card">
          <h4 class="sc-label">Care checklist</h4>

          <div v-if="actionError" class="alert alert-warning">{{ actionError }}</div>

          <div v-if="session.booking.notes" class="sc-notes-box">
            <strong class="d-block">{{ isSitter ? 'Notes from the owner' : 'Your notes for the sitter' }}</strong>
            <p class="sc-notes">{{ session.booking.notes }}</p>
          </div>

          <CareDetailsForm v-if="detailsFormOpen && canAddDetails" ref="formEl" class="mb-3"
                           :booking-id="session.booking._id" :tasks="session.items" close-text="Cancel"
                           @saved="detailsSaved($event); detailsFormOpen = false"
                           @photos-changed="detailsSaved" @close="detailsFormOpen = false" />

          <p v-if="!session.items.length" class="sc-hint mb-0">No care checklist was added to this booking.</p>
          <div v-else>
            <SessionTask v-for="item in session.items" :key="item._id" :item="item" :count="countFor(item)"
                         :tick-times="ticksFor(item).map((t) => t.at)" :walks="walksFor(item)"
                         :active-walk="session.activeWalk" :is-sitter="isSitter" :is-active="isActive"
                         :saving="savingTask" :opening="startingWalk === item._id"
                         :can-add-details="canAddDetails" :booking-id="session.booking._id"
                         @tick="tick(item, $event)" @start-walk="startWalk(item)" @add-details="openDetailsForm" />
          </div>
        </section>

        <!-- owner: what has happened so far, latest first -->
        <section v-if="!isSitter" class="sc-card">
          <div class="sc-card-head">
            <h4 class="sc-card-title">Timeline</h4>
            <small v-if="events.length" class="sc-hint">Latest first</small>
          </div>
          <p v-if="!events.length" class="sc-hint mb-0">Nothing yet. The sitter's start, ticks and walks show up here.</p>
          <ol v-else class="sc-timeline">
            <li v-for="e in shownEvents" :key="e.id" class="sc-event">
              <span class="sc-event__time">{{ timeOf(e.at) }}</span>
              <span class="sc-event__dot" :class="{ 'sc-event__dot--big': e.big }" aria-hidden="true"></span>
              <span class="sc-event__text">{{ e.text }}</span>
            </li>
          </ol>
          <button v-if="events.length > SHOWN_EVENTS" type="button" class="sc-more" :aria-expanded="allEvents" @click="allEvents = !allEvents">
            {{ allEvents ? 'Show fewer ▴' : `Show all ${events.length} events ▾` }}
          </button>
        </section>

        <!-- sitter: the visit report, sent by End session -->
        <section v-else class="sc-card">
          <h4 class="sc-card-title">Visit report</h4>

          <template v-if="isCompleted">
            <p class="sc-report-notes">{{ visit.report.notes }}</p>
            <div v-if="visit.report.photos?.length" class="sc-report-photos">
              <img v-for="p in visit.report.photos" :key="p.url" :src="p.url" alt="Report photo" />
            </div>
          </template>

          <form v-else-if="isActive" @submit.prevent>
            <fieldset :disabled="ending">
              <label :for="`notes-${session.booking._id}`" class="form-label small fw-bold">Notes for the owner</label>
              <textarea :id="`notes-${session.booking._id}`" v-model="notes" class="form-control mb-3" rows="5"
                        maxlength="2000" placeholder="What did you do this visit?"></textarea>

              <div class="sc-slots mb-2">
                <label v-for="(slot, i) in slots" :key="i" class="photo-slot" :class="{ 'photo-slot--full': slot.preview }">
                  <img v-if="slot.preview" :src="slot.preview" alt="Report photo" class="photo-slot__img" />
                  <span v-else>+ photo</span>
                  <input :ref="(el) => (slot.input = el)" type="file" accept="image/jpeg,image/png,image/webp"
                         class="visually-hidden" @change="slot.onPick" />
                  <button v-if="slot.preview" type="button" class="photo-slot__remove"
                          aria-label="Remove photo" @click.prevent="slot.clear()">✕</button>
                </label>
              </div>
              <div v-if="photoError" class="alert alert-warning py-1">{{ photoError }}</div>
              <p class="sc-hint mb-0">Ending the session submits this report.</p>
            </fieldset>
          </form>

          <p v-else class="sc-hint mb-0">Start the session to fill in the report.</p>
        </section>
      </div>
    </div>
  </article>
</template>

<style scoped>
.sc {
  border: 1px solid #e6dcd3;
  border-radius: 14px;
  background: #fff;
}

/* header and status line stay together under the navbar while scrolling on computers */
.sc-sticky {
  position: sticky;
  top: 4.5rem;
  z-index: 1000;
  border-radius: 14px 14px 0 0;
  background: #fff;
}
.sc-head {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1.1rem 1.4rem;
}
.sc-avatar {
  flex: none;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: var(--tint);
  color: var(--accent);
  font-weight: 800;
  font-size: 1.1rem;
}
.sc-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sc-head__text {
  flex: 1;
  min-width: 0;
}
.sc-head__line1 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.5rem;
}
.sc-name {
  color: #2b2420;
  font-size: 1.1rem;
  font-weight: 800;
  text-decoration: none;
  overflow-wrap: anywhere;
}
.sc-name:hover {
  text-decoration: underline;
}
.sc-role {
  color: #6b5f56;
  font-size: 0.85rem;
}
.sc-last {
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  background: #2b2420;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 800;
}
.sc-head__line2 {
  color: #6b5f56;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.sc-progress-block {
  flex: none;
  width: 200px;
}
.sc-count {
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 800;
}
.sc-progress {
  height: 0.45rem;
  margin-top: 0.3rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bar-track);
}
.sc-progress span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--bar-fill); /* theme colour: orange for owners, pink for sitters */
  transition: width 0.4s ease;
}
.sc-chat {
  flex: none;
}

/* the status line */
.sc-dock {
  display: flex;
  flex-direction: column;
}
.sc-status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.25rem;
  padding: 0.7rem 1.4rem;
  color: #2b2420;
}
.sc-status--idle {
  background: #f3ece6;
}
.sc-status--live {
  background: #ecf6ef;
}
.sc-status__left {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.sc-status__text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.sc-status__sub {
  color: #6b5f56;
}
.sc-status--live .sc-status__sub {
  color: #14532d;
}
.sc-status__sub--block {
  display: block;
  font-size: 0.85rem;
}
.sc-status__sub--warn,
.sc-status--live .sc-status__sub--warn {
  color: #7a5a00;
  font-weight: 700;
}
.sc-status__right {
  flex: none;
  color: #6b5f56;
}
.sc-status__right--warn {
  color: #7a5a00;
  font-weight: 700;
}
.sc-narrow {
  display: none;
}
.sc-dot {
  flex: none;
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  background: #9a8d83;
}
.sc-dot--live {
  background: #1f8a4c;
  animation: sc-pulse 1.6s ease-out infinite;
}
@keyframes sc-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(31, 138, 76, 0.45);
  }
  100% {
    box-shadow: 0 0 0 0.55rem rgba(31, 138, 76, 0);
  }
}
.sc-btn {
  flex: none;
  min-height: 44px;
  padding: 0 1.4rem;
  border-radius: 999px;
  font-weight: 800;
  transition: background 0.2s;
}
.sc-btn:disabled {
  opacity: 0.55;
}
.sc-btn--start {
  border: 1.5px solid var(--accent);
  background: var(--accent);
  color: #fff;
}
.sc-btn--start:hover:not(:disabled) {
  background: var(--accent-hover);
}
.sc-btn--end {
  border: 1.5px solid var(--accent);
  background: #fff;
  color: var(--accent);
}
.sc-btn--end:hover:not(:disabled) {
  background: var(--tint-soft);
}
.sc-btn:focus-visible,
.sc-alert__link:focus-visible,
.sc-where-row:focus-visible,
.sc-more:focus-visible,
.photo-slot:focus-within {
  outline: 3px solid var(--accent-deep);
  outline-offset: 2px;
}
.sc-status__end {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem 0.9rem;
}
.sc-report-btn {
  flex: none;
  min-height: 40px;
  padding: 0 1rem;
  border: 1.5px solid var(--accent);
  border-radius: 999px;
  background: #fff;
  color: var(--accent);
  font-weight: 800;
}
.sc-report-btn:focus-visible {
  outline: 3px solid var(--accent-deep);
  outline-offset: 2px;
}
.sc-panel {
  margin: 0.6rem 1.4rem 0;
  padding: 0.75rem 1rem;
  border: 1px solid #e6dcd3;
  border-radius: 10px;
  background: #fff;
  color: #2b2420;
}
.sc-panel__btn {
  min-height: 44px;
}
.sc-dock__error {
  display: none;
}

/* the body */
.sc-body {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 1.2rem 1.4rem;
  border-top: 1px solid #f0e8e0;
  border-radius: 0 0 14px 14px;
  background: #faf6f2;
}

/* Alert box */
.sc-alert {
  padding: 0.85rem 1rem 0.85rem 1.1rem;
  border: 1px solid #f1d7a6;
  border-left: 5px solid #c98a12;
  border-radius: 12px;
  background: #fff;
}
.sc-alert__title {
  margin: 0 0 0.35rem;
  color: #7a5a00;
  font-size: 1rem;
  font-weight: 800;
}
.sc-alert__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.sc-alert__row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0;
  color: #7a5a00;
}
.sc-alert__row + .sc-alert__row {
  border-top: 1px solid #f6e6c4;
}
.sc-alert__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.sc-alert__end {
  flex: none;
  color: #6b5f56;
  font-size: 0.85rem;
}
.sc-alert__link {
  min-height: 32px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-deep);
  font-weight: 700;
  text-decoration: underline;
}

/* notices for the sitter */
.sc-banner {
  padding: 0.6rem 0.9rem;
  border-radius: 10px;
  background: #fdf0c4;
  color: #7a5a00;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.sc-banner--action {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
}

/* cards */
.sc-card {
  min-width: 0;
  padding: 1rem 1.1rem;
  border: 1px solid #f0e8e0;
  border-radius: 12px;
  background: #fff;
}
.sc-label {
  margin: 0 0 0.6rem;
  color: #5c524b;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.sc-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}
.sc-card-title {
  margin: 0 0 0.6rem;
  color: #2b2420;
  font-size: 1.05rem;
  font-weight: 800;
}
.sc-card-head .sc-card-title {
  margin: 0;
}
.sc-subtitle {
  margin: 0.9rem 0 0.2rem;
  color: #2b2420;
  font-size: 0.95rem;
  font-weight: 800;
}
.sc-cols {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 1.1rem;
  align-items: start;
}
.sc-hint {
  color: #6b5f56;
  font-size: 0.9rem;
}
.sc-hint--small {
  font-size: 0.8rem;
}

/* where to go */
.sc-where-row {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  gap: 0.75rem;
  padding: 0;
  border: 0;
  background: none;
  color: #2b2420;
  text-align: left;
}
.sc-where-row--open {
  margin-bottom: 0.6rem;
}
.sc-where-row__short {
  min-width: 0;
  overflow: hidden;
  color: #6b5f56;
  font-size: 0.9rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-where-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 1.1rem;
}
.sc-where-map {
  position: relative;
  height: 300px;
  overflow: hidden;
  border: 1px solid #e6dcd3;
  border-radius: 10px;
}
.sc-where-map :deep(.map) {
  min-height: 0;
}
.sc-where-legend {
  position: absolute;
  bottom: 0.6rem;
  left: 0.6rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.65rem;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(43, 36, 32, 0.15);
  font-size: 0.8rem;
}
.sc-key-home {
  width: 1.1rem;
  height: 1.1rem;
}
.sc-address {
  display: flex;
  flex-direction: column;
  margin: 0 0 0.5rem;
  font-style: normal;
  color: #2b2420;
  overflow-wrap: anywhere;
}
.sc-instructions {
  margin: 0;
  color: #2b2420;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.sc-link {
  color: var(--accent-deep);
  font-weight: 700;
}

/* checklist */
.sc-notes-box {
  margin-bottom: 0.5rem;
  padding: 0.65rem 0.8rem;
  border-radius: 10px;
  background: #faf6f2;
  overflow-wrap: anywhere;
}
.sc-notes {
  margin: 0;
  color: #2b2420;
  white-space: pre-line;
}

/* the owner's timeline */
.sc-timeline {
  margin: 0;
  padding: 0;
  list-style: none;
}
.sc-event {
  display: grid;
  grid-template-columns: 4.5rem 1rem 1fr;
  align-items: start;
  gap: 0.5rem;
  padding: 0.35rem 0;
}
.sc-event__time {
  color: #2b2420;
  font-size: 0.8rem;
  font-weight: 800;
  text-align: right;
}
.sc-event__dot {
  justify-self: center;
  width: 0.45rem;
  height: 0.45rem;
  margin-top: 0.35rem;
  border-radius: 50%;
  background: #9a8d83;
}
.sc-event__dot--big {
  width: 0.7rem;
  height: 0.7rem;
  margin-top: 0.25rem;
}
.sc-event__text {
  color: #2b2420;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.sc-more {
  min-height: 36px;
  margin-top: 0.3rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-deep);
  font-weight: 700;
}

/* the sitter's report */
.sc-report-notes {
  color: #2b2420;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.sc-report-photos {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.sc-report-photos img {
  width: 90px;
  height: 90px;
  border-radius: 8px;
  object-fit: cover;
}
.sc-slots {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}
.photo-slot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  overflow: hidden;
  border: 2px dashed #e2d6ca;
  border-radius: 10px;
  background: #faf6f2;
  color: #6b5f56;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}
.photo-slot:hover {
  border-color: var(--accent-main);
}
.photo-slot--full {
  border-style: solid;
}
.photo-slot__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-slot__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: rgba(43, 36, 32, 0.75);
  color: #fff;
  font-size: 0.8rem;
  line-height: 1;
}
fieldset:disabled .photo-slot {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .sc-dot--live {
    animation: none;
  }
  .sc-progress span {
    transition: none;
  }
}

@media (max-width: 991.98px) {
  .sc-where-grid {
    grid-template-columns: 1fr;
  }
}

/* phones */
@media (max-width: 767.98px) {
  .sc-sticky {
    position: static;
  }
  .sc-head {
    flex-wrap: wrap;
    padding: 1rem;
  }
  .sc-head__text {
    flex: 1 1 calc(100% - 48px - 44px - 1.8rem);
  }
  .sc-progress-block {
    order: 3;
    width: 100%;
  }
  .sc-status {
    flex-wrap: wrap;
    padding: 0.65rem 1rem;
  }
  /* the owner's "Earlier reports" goes on its own line, under the status text */
  .sc-status__end {
    flex: 1 1 100%;
    justify-content: flex-start;
    padding-left: 1.25rem;
  }
  .sc-wide {
    display: none;
  }
  .sc-narrow {
    display: block;
    font-size: 0.85rem;
  }
  .sc-body {
    padding: 1rem;
  }
  .sc-cols {
    grid-template-columns: 1fr;
  }
  .sc-panel {
    margin: 0.5rem 1rem 0;
  }
  .sc-link {
    display: inline-block;
    padding: 0.35rem 0;
  }
  .sc-alert__row {
    align-items: flex-start;
  }

  /* the sitter's status bar, with Start / End session, is fixed to the bottom of the screen */
  .sc--sitter {
    margin-bottom: 7rem; /* keeps the end of the card reachable above the fixed bar */
  }
  .sc--sitter .sc-dock {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 1020;
    pointer-events: none;
  }
  .sc--sitter .sc-dock > * {
    pointer-events: auto;
  }
  .sc--sitter .sc-status {
    order: 3;
    border-top: 1px solid #e6dcd3;
    padding-bottom: calc(0.65rem + env(safe-area-inset-bottom));
  }
  .sc--sitter .sc-status__sub--block {
    font-size: 0.8rem;
  }
  .sc--sitter .sc-panel {
    order: 1;
    margin: 0 0.75rem 0.5rem;
    box-shadow: 0 4px 12px rgba(43, 36, 32, 0.18);
  }
  .sc--sitter .sc-dock__error {
    display: block;
    order: 2;
    margin: 0 0.75rem 0.5rem;
  }
}

/* small phones (under 576px): the white cards sit edge to edge inside the session card, one box less, so the checklist has more width */
@media (max-width: 575.98px) {
  .sc-body {
    padding: 0.75rem 0;
  }
  .sc-card {
    padding: 0.9rem 1rem;
    border-right: 0;
    border-left: 0;
    border-radius: 0;
  }
}
</style>
