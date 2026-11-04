<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { walkRoutesApi } from '../services/walkRouteApi.js'
import { SERVICE_PRICES, SERVICE_LABELS, priceForTasks } from '../utils/servicePrices.js'
import { prettyDate } from '../utils/bookingTimeHelpers.js'

// The care checklist part of the booking form: the owner adds tasks (feed, walk, medication...).
// The page gives it the pets that were picked (prop), and it tells the page the list of tasks
// whenever it changes (the 'change' event).
const props = defineProps({
  pets: { type: Array, required: true }, // the selected pets, as full objects: [{ _id, name, ... }]
  dates: { type: Array, default: () => [] } // every day the booking covers: ['2026-11-03', ...] (empty = no dates yet)
})
const emit = defineEmits(['change'])

const categories = Object.keys(SERVICE_PRICES) // same 6 types the server accepts (each has a fixed price)
const tasks = ref([]) // each task: { category, title, dailyFrequency, petIds, walkRouteId, someDays, days }
const dayCount = computed(() => props.dates.length)

// An example for the "Title" box, different for each type of task
const PLACEHOLDERS = {
  feed: 'e.g. Lunch',
  walk: 'e.g. Afternoon Walk',
  groom: 'e.g. Clean ears and brush coat',
  medication: 'e.g. Dinner Pill',
  clean: 'e.g. Empty Litter Tray',
  play: 'e.g. Playing Fetch'
}

// The owner's recorded walking routes, for the route dropdown on walk tasks
const walkRoutes = ref([])
const routesError = ref('')

onMounted(async () => {
  try {
    walkRoutes.value = await walkRoutesApi.getMyRoutes()
  } catch {
    routesError.value = 'Could not load your walking routes.'
  }
})

const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`)

function addTask() {
  // petIds: [] means "all the selected pets"
  // walkRouteId (walk tasks only): a route's id, 'instructions', or '' (not chosen yet)
  // someDays: false = every day; true = only on the dates in `days`
  tasks.value.push({ category: 'feed', title: '', dailyFrequency: 1, petIds: [], walkRouteId: '', someDays: false, days: [] })
}

function removeTask(index) {
  tasks.value.splice(index, 1) // remove 1 task at this position
}

// The − / + buttons for "Times a day" (1 to 10, same limits as the server)
function changeTimes(task, step) {
  task.dailyFrequency = Math.min(10, Math.max(1, (Number(task.dailyFrequency) || 1) + step))
}

// Price of one task for one day, and of all the tasks for the whole booking
const taskPrice = (task) => (SERVICE_PRICES[task.category] ?? 0) * (Number(task.dailyFrequency) || 0)
const total = computed(() => priceForTasks(tasks.value, dayCount.value))

// "Certain days" shows the day boxes straight away; "Every day" hides them and clears the days
function setSomeDays(task, someDays) {
  task.someDays = someDays
  if (!someDays) task.days = []
}

function toggleTaskDay(task, date) {
  if (task.days.includes(date)) task.days = task.days.filter((d) => d !== date)
  else task.days = props.dates.filter((d) => d === date || task.days.includes(d)) // keep them in date order
}

// Dates as local days (no time zone shifts)
const toDate = (date) => new Date(`${date}T00:00:00`)
const weekday = (date) => toDate(date).getDay() // 0 = Sunday ... 6 = Saturday
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayNum = (date) => toDate(date).getDate()
const shortDay = (date) => `${WEEKDAY_SHORT[weekday(date)]} ${dayNum(date)}` // "Wed 11"

// The week grid: Mon–Sun columns, starting on the Monday before the first booked day.
// Days in the range that aren't booked (and the padding) are null, so they show as blanks.
const weeks = computed(() => {
  if (!props.dates.length) return []
  const first = toDate(props.dates[0])
  const last = toDate(props.dates[props.dates.length - 1])
  const cursor = new Date(first)
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)) // back to Monday
  const rows = []
  while (cursor <= last) {
    const row = []
    for (let i = 0; i < 7; i++) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      row.push(props.dates.includes(iso) ? iso : null)
      cursor.setDate(cursor.getDate() + 1)
    }
    rows.push(row)
  }
  return rows
})

// "Wed 11, Sat 14, Tue 17" (long lists are cut short)
function dayList(days, max = 6) {
  const names = days.map(shortDay)
  return names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', ')
}

// Schedule at a glance: is this task on this day?
const isOn = (task, date) => (task.someDays ? task.days.includes(date) : true)
// Tapping a cell. An every-day task switches to certain days (all the other days stay on).
function toggleCell(task, date) {
  if (!task.someDays) {
    task.someDays = true
    task.days = props.dates.filter((d) => d !== date)
  } else {
    toggleTaskDay(task, date)
  }
}
const taskName = (task) => task.title.trim() || SERVICE_LABELS[task.category]
// Days with no task at all (every day needs at least one)
const emptyDays = computed(() => props.dates.filter((d) => tasks.value.length && !tasks.value.some((t) => isOn(t, d))))

// Changing the booking's dates: a task can't stay on a day that's no longer booked,
// and with only one day there's nothing to choose
watch(() => props.dates, (dates) => {
  for (const task of tasks.value) {
    task.days = task.days.filter((d) => dates.includes(d))
    if (dates.length < 2) setSomeDays(task, false)
  }
})

// Same idea as togglePet (on the booking page), but for the pets chosen on one task
function toggleTaskPet(task, id) {
  if (task.petIds.includes(id)) task.petIds = task.petIds.filter((p) => p !== id)
  else task.petIds.push(id)
}

// Tell the page whenever the tasks change (deep: also when a task's title or pets change)
watch(tasks, () => emit('change', tasks.value), { deep: true })
</script>

<template>
  <h3 class="h6 text-uppercase text-muted fw-bold mt-4">Care Checklist</h3>
  <p class="small text-muted">Add your tasks here. Don't worry, more details can be added once the booking is confirmed.</p>

  <!-- Labels written once, above every task (on phones each task shows its own labels instead) -->
  <div v-if="tasks.length" class="cl-grid cl-head">
    <span>Type</span><span>Title</span><span>Times a day</span><span class="text-end">Per day</span><span></span>
  </div>

  <div v-for="(task, i) in tasks" :key="i" class="cl-task">
    <!-- one row: every task uses the same columns, so the boxes and buttons line up -->
    <div class="cl-grid">
      <div class="cl-type">
        <label class="cl-label" :for="`task-type-${i}`">Type</label>
        <select :id="`task-type-${i}`" v-model="task.category" class="form-select form-select-sm">
          <option v-for="c in categories" :key="c" :value="c">{{ SERVICE_LABELS[c] }} (${{ SERVICE_PRICES[c] }})</option>
        </select>
      </div>
      <div class="cl-what">
        <label class="cl-label" :for="`task-title-${i}`">Title</label>
        <input :id="`task-title-${i}`" v-model="task.title" type="text" maxlength="120" class="form-control form-control-sm" :placeholder="PLACEHOLDERS[task.category]" />
      </div>
      <div>
        <span class="cl-label">Times a day</span>
        <div class="stepper" role="group" :aria-label="`Times a day for task ${i + 1}`">
          <button type="button" aria-label="Fewer times" :disabled="task.dailyFrequency <= 1" @click="changeTimes(task, -1)">−</button>
          <span>{{ task.dailyFrequency }}</span>
          <button type="button" aria-label="More times" :disabled="task.dailyFrequency >= 10" @click="changeTimes(task, 1)">+</button>
        </div>
      </div>
      <div class="cl-price"><span class="cl-label">Per day</span>${{ taskPrice(task) }}</div>
      <div class="cl-x-cell">
        <button type="button" class="cl-x" aria-label="Remove task" @click="removeTask(i)">✕</button>
      </div>
    </div>

    <!-- Walk tasks: which route the sitter should follow -->
    <div v-if="task.category === 'walk'" class="cl-sub">
      <label class="cl-sub-label" :for="`walk-route-${i}`">Route</label>
      <div>
        <select :id="`walk-route-${i}`" v-model="task.walkRouteId" class="form-select form-select-sm">
          <option value="" disabled>Choose a route…</option>
          <option v-for="r in walkRoutes" :key="r._id" :value="r._id">{{ r.name }} · {{ formatDistance(r.distanceM) }}</option>
          <option value="instructions">No route – follow my instructions</option>
        </select>
        <p v-if="routesError" class="small text-danger mb-0 mt-1">{{ routesError }}</p>
        <p v-else-if="walkRoutes.length === 0" class="small text-muted mb-0 mt-1">
          You haven't recorded any routes yet.
          <router-link to="/owner/routes/new" target="_blank">Record a route</router-link>, or choose "follow my instructions".
        </p>
        <p v-else-if="task.walkRouteId === 'instructions'" class="small text-muted mb-0 mt-1">
          Walk without a fixed route. Walk is still tracked.
        </p>
      </div>
    </div>

    <!-- Only worth choosing days when the booking covers more than one -->
    <template v-if="dates.length > 1">
      <div class="cl-sub">
        <span class="cl-sub-label">Days</span>
        <div class="d-flex flex-wrap align-items-center gap-2">
          <div class="seg" role="group" :aria-label="`Which days for task ${i + 1}`">
            <button type="button" :aria-pressed="!task.someDays" @click="setSomeDays(task, false)">Every day</button>
            <button type="button" :aria-pressed="task.someDays" @click="setSomeDays(task, true)">Certain days</button>
          </div>
        </div>
      </div>

      <template v-if="task.someDays">
        <div class="cl-sub cl-sub--top">
          <span class="cl-sub-label">Tap days</span>
          <div class="week">
            <div class="week-row week-head" aria-hidden="true">
              <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
            </div>
            <div v-for="(row, w) in weeks" :key="w" class="week-row">
              <template v-for="(d, c) in row" :key="d || `blank-${w}-${c}`">
                <button v-if="d" type="button" class="day" :aria-pressed="task.days.includes(d)" :aria-label="prettyDate(d)" @click="toggleTaskDay(task, d)">
                  <strong>{{ dayNum(d) }}</strong>
                  <span v-if="task.days.includes(d)" class="day-note">✓</span>
                </button>
                <span v-else></span>
              </template>
            </div>
            <p class="week-summary mb-0 mt-1" aria-live="polite">
              <template v-if="task.days.length"><strong>{{ task.days.length }} of {{ dayCount }} days</strong> · {{ dayList(task.days) }}</template>
              <template v-else>Choose at least one day.</template>
            </p>
          </div>
        </div>
      </template>
    </template>

    <!-- Only worth choosing pets when more than one is selected -->
    <div v-if="pets.length > 1" class="cl-sub">
      <span class="cl-sub-label">For</span>
      <div class="d-flex flex-wrap align-items-center gap-2">
        <!-- "All pets" is picked when no single pet is (petIds: [] means all the selected pets); tapping it clears the picks -->
        <button type="button" class="pet-chip" :aria-pressed="task.petIds.length === 0" @click="task.petIds = []">All pets</button>
        <button
          v-for="pet in pets"
          :key="pet._id"
          type="button"
          class="pet-chip"
          :aria-pressed="task.petIds.includes(pet._id)"
          @click="toggleTaskPet(task, pet._id)"
        >
          {{ pet.name }}
        </button>
      </div>
    </div>
  </div>

  <!-- Schedule at a glance: every task against every booked day, tap a cell to change it -->
  <section v-if="tasks.length && dates.length > 1" class="sched mb-2" aria-label="Schedule at a glance">
    <div class="d-flex flex-wrap justify-content-between align-items-baseline gap-2 mb-2">
      <h4 class="sched-title mb-0">Schedule at a glance</h4>
      <span class="small text-muted">Tap a cell to add or remove that day</span>
    </div>
    <!-- every booked day on one row: fits the card on wider screens, scrolls sideways on phones -->
    <div class="sched-scroll">
    <table class="sched-grid">
      <colgroup>
        <col class="sched-name-col" />
        <col v-for="d in dates" :key="d" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col"><span class="visually-hidden">Task</span></th>
          <th v-for="d in dates" :key="d" scope="col" :class="{ 'is-empty': emptyDays.includes(d) }">
            <span class="sched-wd">{{ WEEKDAY_SHORT[weekday(d)][0] }}</span>{{ dayNum(d) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(task, i) in tasks" :key="i">
          <th scope="row" class="sched-name" :title="taskName(task)">{{ taskName(task) }}</th>
          <td v-for="d in dates" :key="d">
            <button type="button" class="cell" :aria-pressed="isOn(task, d)"
                    :aria-label="`${taskName(task)} on ${prettyDate(d)}`" @click="toggleCell(task, d)"></button>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    <p v-if="emptyDays.length" class="sched-warn mb-0" role="alert">
      {{ dayList(emptyDays) }} {{ emptyDays.length === 1 ? 'has' : 'have' }} no tasks. Every day needs at least one.
    </p>
  </section>

  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
    <button type="button" class="cl-add" @click="addTask">+ Add task</button>
    <span v-if="tasks.length" class="small">
      <template v-if="dayCount">{{ dayCount }} day{{ dayCount === 1 ? '' : 's' }} booked · <strong class="cl-total">${{ total }}</strong></template>
    </span>
  </div>
</template>

<style scoped>
/* One grid for the label row and every task, so all the columns line up:
   Type | What to do | Times a day | Per day | ✕ */
.cl-grid {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 112px 64px 34px;
  gap: 10px;
  align-items: center;
}
.cl-head {
  padding: 0 12px 4px;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #766a60;
}
.cl-task {
  border: 1px solid #e4dbd0;
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.cl-label { display: none; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #766a60; } /* phones only */
.cl-sub { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 10px; align-items: center; } /* lines up with "What to do" */
.cl-sub-label { font-size: 0.78rem; font-weight: 700; color: #766a60; }
.stepper { display: inline-flex; align-items: center; border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden; height: 32px; }
.stepper button { width: 32px; height: 100%; border: 0; background: #f6f2ee; font-weight: 800; }
.stepper button:disabled { opacity: 0.4; }
.stepper span { width: 40px; text-align: center; font-weight: 800; font-variant-numeric: tabular-nums; }
.cl-price { text-align: right; font-weight: 800; color: #3f8a4a; font-variant-numeric: tabular-nums; }
.cl-x { width: 32px; height: 32px; border-radius: 50%; border: 1px solid #e4dbd0; background: transparent; color: #766a60; }
.cl-x:hover { border-color: #b3412b; color: #b3412b; }
.cl-add { border: 1.5px dashed #c9bfb3; background: transparent; border-radius: 10px; padding: 6px 14px; font-weight: 700; font-size: 0.9rem; }
.cl-add:hover { border-color: var(--accent-deep); color: var(--accent-deep); }
.cl-total { color: #3f8a4a; }

/* ---- Choosing the days a task is done on ---- */
.cl-sub--top { align-items: start; }
.cl-sub--top .cl-sub-label { padding-top: 26px; } /* lines up with the first row of days */

/* Every day | Certain days */
.seg { display: inline-grid; grid-template-columns: 1fr 1fr; border: 1.5px solid var(--line); border-radius: 999px; padding: 2px; background: #fff; }
.seg button { border: 0; background: none; border-radius: 999px; padding: 0 14px; min-height: 32px; font-size: 0.85rem; font-weight: 700; color: #6b5f56; }
.seg button[aria-pressed='true'] { background: var(--accent); color: #fff; font-weight: 800; }

/* the "For" pets: same look as the day boxes (light border, picked = app colour with white text) */
.pet-chip { border: 1.5px solid var(--line); background: #fff; color: #2b2420; border-radius: 999px; padding: 0 14px; min-height: 32px; font-size: 0.85rem; font-weight: 700; }
.pet-chip:hover { border-color: var(--accent-main); }
.pet-chip[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: #fff; }

.chip { border: 1.5px solid var(--line); background: #fff; color: #2b2420; border-radius: 999px; padding: 0 12px; min-height: 32px; font-size: 0.82rem; font-weight: 700; white-space: nowrap; }
.chip:hover:not(:disabled) { border-color: var(--accent-main); }
.chip[aria-pressed='true'] { border-color: var(--accent); background: var(--tint); color: var(--accent); }
.chip:disabled { opacity: 0.45; }

/* Week grid: only the booked days are buttons */
.week { display: flex; flex-direction: column; gap: 5px; max-width: 420px; }
.week-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
.week-head span { text-align: center; font-size: 0.72rem; font-weight: 700; color: #6b5f56; }
.day { min-height: 44px; border-radius: 10px; border: 1.5px solid var(--line); background: #fff; color: #2b2420; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.05; padding: 2px 0; }
.day strong { font-size: 0.95rem; font-weight: 800; }
.day-note { font-size: 0.65rem; font-weight: 700; color: #6b5f56; }
.day:hover { border-color: var(--accent-main); }
.day[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: #fff; }
.day[aria-pressed='true'] .day-note { color: #fff; }
.week-summary { font-size: 0.85rem; color: #4a3f37; }

/* Schedule at a glance */
.sched { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: #fff; }
.sched-title { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #6b5f56; }
.sched-grid { width: calc(100% + 8px); table-layout: fixed; border-collapse: separate; border-spacing: 4px; margin: -4px; }
.sched-name-col { width: 120px; }
.sched-grid th { font-size: 0.72rem; font-weight: 700; color: #6b5f56; text-align: center; white-space: nowrap; padding: 2px 0; border-radius: 6px; line-height: 1.15; }
.sched-wd { display: block; font-weight: 600; }
.sched-grid td { padding: 0; }
.sched-name { text-align: left !important; font-size: 0.85rem !important; color: #2b2420 !important; white-space: normal !important; overflow-wrap: anywhere; line-height: 1.2; } /* long task names wrap onto the next line instead of being cut off with "…" */
.cell { display: block; width: 100%; height: 30px; border: 0; border-radius: 6px; background: var(--bar-track); }
.cell[aria-pressed='true'] { background: var(--accent-main); }
.cell:hover { filter: brightness(0.94); }
.cell:focus-visible { outline: 2px solid #2b2420; outline-offset: 1px; } /* keyboard only */
.sched-grid th.is-empty { color: #9a5a00; background: #fdf0dc; }
.sched-warn { margin-top: 8px; font-size: 0.85rem; font-weight: 700; color: #9a5a00; background: #fdf0dc; border-left: 3px solid #e8890c; border-radius: 6px; padding: 6px 10px; }

@media (max-width: 640px) { /* phones: each task becomes a small card with its own labels */
  .cl-head { display: none; }
  .cl-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .cl-type { grid-column: 1 / -1; padding-right: 40px; }
  .cl-what { grid-column: 1 / -1; }
  .cl-label { display: block; margin-bottom: 2px; }
  .cl-price { text-align: left; }
  .cl-x-cell { position: absolute; top: 10px; right: 10px; }
  .cl-sub { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .cl-sub--top .cl-sub-label { padding-top: 0; }
  .week { max-width: none; }
  .sched-name-col { width: 84px; }
  /* phones: full-size cells, scroll sideways, task names stay pinned on the left */
  .sched-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .sched-grid { width: auto; }
  .sched-grid td .cell { width: 34px; }
  .sched-name { position: sticky; left: 0; background: #fff; z-index: 1; max-width: 84px; }
}
</style>
