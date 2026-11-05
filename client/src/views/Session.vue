<script setup>
// /session: today's sessions for sitters and owners, one showing at a time, and the owner's Recently ended list.
// Every session's card stays on the page (only hidden), so a half-written report or a chat
// keeps going while the sitter looks at another session.
// Owners on phones see two tabs, Today and Recently ended, switched by tapping or swiping.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { currentUser } from '../services/auth.js'
import { visitsApi } from '../services/api.js'
import SessionCard from '../components/SessionCard.vue'
import RecentlyEnded from '../components/RecentlyEnded.vue'
import VisitReportModal from '../components/VisitReportModal.vue'

const data = ref(null)
const loading = ref(true)
const error = ref('')

// The booking id, not a position in the list, so a refresh can't switch sessions
const selectedId = ref(null)
const listOpen = ref(false)
const unread = reactive({}) // unread chat messages per booking id

const isSitter = computed(() => currentUser.value?.role === 'sitter')

// Once a booking's last day has been completed it leaves the owner's Today and is only under Recently ended
// (an earlier day that's finished stays until midnight, with View report)
const finished = (s) => !isSitter.value && ['completed', 'paid'].includes(s.booking.status)
  && s.visit?.status === 'completed' && s.booking.dayNumber === s.booking.totalDays
const sessions = computed(() => (data.value?.sessions ?? []).filter((s) => !finished(s)))

const allDone = computed(
  () => sessions.value.length > 0 && sessions.value.every((s) => s.visit?.status === 'completed')
)

function fmt(d) {
  return new Date(`${d}T00:00:00+08:00`).toLocaleDateString('en-SG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
}

// Today's session, not the booking: 'not-started', 'in-progress' or 'completed'
function sessionState(s) {
  if (!s.visit) return 'not-started'
  return s.visit.status === 'active' ? 'in-progress' : 'completed'
}
const STATE_LABELS = { 'not-started': 'Not started', 'in-progress': 'In progress', completed: 'Completed' }

const isInProgress = (s) => sessionState(s) === 'in-progress'
const selectedNumber = computed(() => sessions.value.findIndex((s) => s.booking._id === selectedId.value) + 1)

// The session in progress, then the next unfinished one, then the last of the day
function pickDefault() {
  const list = sessions.value
  const pick = list.find(isInProgress) ?? list.find((s) => sessionState(s) === 'not-started') ?? list[list.length - 1]
  return pick?.booking._id ?? null
}

function selectSession(id) {
  selectedId.value = id
  listOpen.value = false
}

// ---- Recently ended (owners) ----
const recentRef = ref(null)
const recentCount = ref(0)

async function load(quiet = false) {
  const before = new Set(sessions.value.map((s) => s.booking._id))
  try {
    data.value = await visitsApi.today()
    error.value = ''
    if (!sessions.value.some((s) => s.booking._id === selectedId.value)) {
      selectedId.value = pickDefault()
      listOpen.value = !sessions.value.some(isInProgress) // the list stays out of the way during a session
    }
    // a booking just finished its last day: it has moved to Recently ended
    if ([...before].some((id) => !sessions.value.some((s) => s.booking._id === id))) recentRef.value?.load()
  } catch (err) {
    if (!quiet) {
      error.value = err.response?.data?.message || 'Could not load today’s sessions.'
    }
  } finally {
    loading.value = false
  }
}

// the owner's page refreshes itself while a sitter works
let timer = null
onMounted(() => {
  load()
  timer = setInterval(() => {
    if (!isSitter.value && !document.hidden && sessions.value.length && !allDone.value) {
      load(true)
    }
  }, 10000)
})
onBeforeUnmount(() => clearInterval(timer))

// ---- The visit report window (owners) ----
const report = ref(null) // { entry, dayIndex } while the window is open
const reportError = ref('')
function openReport(r) {
  report.value = r
}
// "View report" on a finished day of the Today card: load that booking's reports, open at today's day
async function viewTodayReport(s) {
  reportError.value = ''
  try {
    const entry = await visitsApi.report(s.booking._id)
    report.value = { entry, dayIndex: Math.max(0, entry.days.findIndex((d) => d.date === s.booking.day)) }
  } catch (err) {
    reportError.value = err.response?.data?.message || 'Could not load the report.'
  }
}
// "Earlier reports" on the Today card: the booking's finished days only (not today's session in progress),
// opened at the most recent one; Prev steps back through the rest
async function viewEarlierReports(s) {
  reportError.value = ''
  try {
    const entry = await visitsApi.report(s.booking._id)
    const days = entry.days.filter((d) => d.visit.status === 'completed')
    if (days.length) report.value = { entry: { ...entry, days }, dayIndex: days.length - 1 }
  } catch (err) {
    reportError.value = err.response?.data?.message || 'Could not load the reports.'
  }
}

// ---- Owner's phone tabs ----
const tab = ref('today')
function showTab(name) {
  if (tab.value === name) return
  tab.value = name
  nextTick(() => window.scrollTo({ top: 0 }))
}
// A sideways swipe of more than 70 px switches tabs, unless it started on a map, the session list or a form field
let swipeStart = null
function onTouchStart(e) {
  const t = e.touches[0]
  swipeStart = e.target.closest('.map, .maplibregl-map, .sesh-list, input, textarea, select') ? null : { x: t.clientX, y: t.clientY }
}
function onTouchEnd(e) {
  if (!swipeStart) return
  const t = e.changedTouches[0]
  const dx = t.clientX - swipeStart.x
  const dy = t.clientY - swipeStart.y
  swipeStart = null
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) showTab(dx < 0 ? 'recent' : 'today')
}
</script>

<template>
  <div class="sesh" :class="{ 'sesh--owner': !isSitter }" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
    <!-- owners: the page title, and on phones the two tabs -->
    <template v-if="!isSitter">
      <h2 class="sesh-title">Sessions</h2>
      <p v-if="data" class="sesh-date">{{ fmt(data.today) }}</p>
      <div class="sesh-tabs" role="tablist" aria-label="Sessions">
        <button id="tab-today" type="button" role="tab" class="sesh-tab" :aria-selected="tab === 'today'"
                aria-controls="panel-today" @click="showTab('today')">
          <span class="sesh-tab__dot sesh-tab__dot--today" aria-hidden="true"></span>Today ({{ sessions.length }})
        </button>
        <button id="tab-recent" type="button" role="tab" class="sesh-tab" :aria-selected="tab === 'recent'"
                aria-controls="panel-recent" @click="showTab('recent')">
          <span class="sesh-tab__dot" aria-hidden="true"></span>Recently ended ({{ recentCount }})
        </button>
      </div>
    </template>

    <section id="panel-today" class="sesh-panel" :class="{ 'sesh-panel--off': tab !== 'today' }" role="tabpanel" aria-labelledby="tab-today">
      <div class="sesh-head">
        <span class="sesh-head__dot" aria-hidden="true"></span>
        <h3 class="sesh-head__title">Today</h3>
        <button v-if="sessions.length > 1" type="button" class="sesh-switch" :aria-expanded="listOpen"
                @click="listOpen = !listOpen">
          Session {{ selectedNumber }} of {{ sessions.length }}
          <span aria-hidden="true">{{ listOpen ? '▴' : '▾' }}</span>
        </button>
      </div>

      <div v-if="error" class="alert alert-warning">{{ error }}</div>
      <div v-if="reportError" class="alert alert-warning">{{ reportError }}</div>

      <div v-else-if="loading" class="d-flex align-items-center text-muted">
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        Loading today's sessions…
      </div>

      <div v-else-if="!sessions.length" class="sesh-empty">
        <p class="fs-5 mb-1">No sessions for today</p>
        <p class="small mb-0">Confirmed bookings that are happening today will show up here.</p>
      </div>

      <template v-else>
        <ul v-if="listOpen && sessions.length > 1" class="sesh-list" aria-label="Today's sessions">
          <li v-for="s in sessions" :key="s.booking._id">
            <button type="button" class="sesh-item" :class="{ 'sesh-item--on': s.booking._id === selectedId }"
                    :aria-current="s.booking._id === selectedId ? 'true' : undefined"
                    @click="selectSession(s.booking._id)">
              <span class="sesh-item__time">{{ s.booking.startTime }} – {{ s.booking.endTime }}</span>
              <span class="sesh-item__pets">{{ s.booking.pets.map((p) => p.name).join(', ') }}</span>
              <span class="sesh-state" :class="`sesh-state--${sessionState(s)}`">
                <span class="sesh-state__dot" aria-hidden="true"></span>{{ STATE_LABELS[sessionState(s)] }}
              </span>
              <span v-if="unread[s.booking._id]" class="sesh-item__unread">
                <span class="visually-hidden">{{ unread[s.booking._id] }} new messages</span>
              </span>
            </button>
          </li>
        </ul>
        <!-- small phones: one dot per session, so it's clear the row above swipes -->
        <div v-if="listOpen && sessions.length > 1" class="sesh-dots" aria-hidden="true">
          <span v-for="s in sessions" :key="s.booking._id" class="sesh-dot"
                :class="{ 'sesh-dot--on': s.booking._id === selectedId }"></span>
        </div>

        <SessionCard v-for="s in sessions" v-show="s.booking._id === selectedId" :key="s.booking._id" :session="s"
                     :is-sitter="isSitter" :active="s.booking._id === selectedId"
                     @visit-change="s.visit = $event" @unread="unread[s.booking._id] = $event" @walk-ended="load(true)"
                     @items-change="s.items = $event" @view-report="viewTodayReport(s)" @view-earlier="viewEarlierReports(s)" />
      </template>
    </section>

    <!-- owners: finished bookings from the last 30 days -->
    <template v-if="!isSitter">
      <hr class="sesh-rule" />
      <section id="panel-recent" class="sesh-panel" :class="{ 'sesh-panel--off': tab !== 'recent' }" role="tabpanel" aria-labelledby="tab-recent">
        <RecentlyEnded ref="recentRef" @count="recentCount = $event" @open-report="openReport" />
      </section>
    </template>

    <VisitReportModal v-if="report" :entry="report.entry" :day-index="report.dayIndex"
                      @close="report = null" @change-day="report.dayIndex = $event" />
  </div>
</template>

<style scoped>
.sesh-title {
  margin: 0;
  color: #2b2420;
  font-size: 2rem;
  font-weight: 800;
}
.sesh-date {
  margin: 0 0 1.25rem;
  color: #6b5f56;
}
.sesh-tabs {
  display: none;
}
.sesh-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
}
.sesh-head__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #1f8a4c;
}
.sesh-head__title {
  margin: 0;
  color: #2b2420;
  font-size: 1.5rem;
  font-weight: 800;
}
.sesh-switch {
  min-height: 44px;
  margin-left: auto;
  padding: 0 1rem;
  border: 1px solid #e6dcd3;
  border-radius: 999px;
  background: #fff;
  color: #2b2420;
  font-weight: 800;
}
.sesh-switch:hover {
  background: var(--tint-soft);
}
.sesh-switch:focus-visible,
.sesh-item:focus-visible,
.sesh-tab:focus-visible {
  outline: 3px solid var(--accent-deep);
  outline-offset: 2px;
}
.sesh-empty {
  padding: 2.5rem 1rem;
  border: 2px dashed #e6dcd3;
  border-radius: 14px;
  color: #6b5f56;
  text-align: center;
}
.sesh-rule {
  margin: 2rem 0;
  border: 0;
  border-top: 1px solid var(--line);
  opacity: 1;
}

/* the session list scrolls sideways inside its own row */
.sesh-list {
  display: flex;
  gap: 0.6rem;
  margin: 0 0 1rem;
  padding: 0 0 0.25rem;
  overflow-x: auto;
  list-style: none;
}
.sesh-list li {
  flex: 0 0 12.5rem;
}
.sesh-dots {
  display: none;
}
.sesh-item {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid #e6dcd3;
  border-radius: 10px;
  background: #fff;
  color: #2b2420;
  text-align: left;
}
.sesh-item:hover {
  background: var(--tint-soft);
}
.sesh-item--on {
  border-color: var(--accent-deep);
  box-shadow: inset 0 0 0 1px var(--accent-deep);
}
.sesh-item__time {
  font-weight: 800;
}
.sesh-item__pets {
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.sesh-item__unread {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  background: var(--accent-deep);
}
.sesh-state {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  font-weight: 700;
}
.sesh-state__dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: currentColor;
}
.sesh-state--not-started {
  color: #6b5f56;
}
.sesh-state--in-progress {
  color: #14532d;
}
.sesh-state--completed {
  color: #5c524b;
}

/* owners on phones: tabs instead of one long page */
@media (max-width: 767.98px) {
  .sesh-title {
    font-size: 1.6rem;
  }
  .sesh-date {
    margin-bottom: 0.5rem;
  }
  .sesh--owner .sesh-tabs {
    display: flex;
    gap: 1.25rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--line);
  }
  .sesh-tab {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: -1px;
    padding: 0;
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: #6b5f56;
    font-weight: 700;
  }
  .sesh-tab[aria-selected='true'] {
    border-bottom-color: #2b2420;
    color: #2b2420;
    font-weight: 800;
  }
  .sesh-tab__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #8a7d73;
  }
  .sesh-tab__dot--today {
    background: #1f8a4c;
  }
  /* the tab names the section, so its own heading is hidden (the session switcher stays) */
  .sesh--owner .sesh-head__dot,
  .sesh--owner .sesh-head__title,
  .sesh--owner .sesh-rule,
  .sesh--owner :deep(.re-dot),
  .sesh--owner :deep(.re-title) {
    display: none;
  }
  .sesh--owner .sesh-head:not(:has(.sesh-switch)) {
    display: none;
  }
  .sesh--owner .sesh-panel--off {
    display: none;
  }
}

/* small phones (under 576px): each session card is 75% wide so the next one peeks in, it snaps into place, and dots show how many there are */
@media (max-width: 575.98px) {
  .sesh-list {
    margin-bottom: 0.4rem;
    scroll-snap-type: x mandatory;
  }
  .sesh-list li {
    flex: 0 0 75%;
    scroll-snap-align: start;
  }
  .sesh-dots {
    display: flex;
    justify-content: center;
    gap: 0.4rem;
    margin: 0 0 1rem;
  }
  .sesh-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #d9cdc2;
  }
  .sesh-dot--on {
    background: var(--accent);
  }
}
</style>
