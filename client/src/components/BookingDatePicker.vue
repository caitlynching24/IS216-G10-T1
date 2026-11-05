<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { formatTime } from '../utils/bookingHelpers.js'
import {
  DAY_MIN,
  DAY_START_MIN,
  SLOT_MS,
  toDateString,
  prettyDate,
  toMinutes,
  toHHMM,
  momentOf,
  isBusy,
  slotsFor,
  slotsCover,
  slotFree,
  dayHasFreeSlot
} from '../utils/bookingTimeHelpers.js'

// The calendar + time dropdowns for choosing when a booking starts and ends.
// A booking has a start date, an end date, and hours for EACH day, always between 7am and 12am midnight
// (so nothing runs overnight). The first tap on the calendar picks the start date, the second the end date (the same day is fine).
// Baby example: Fri 6 Nov to Sun 8 Nov.
//   "Same hours every day" ticked:   one start + end time, e.g. 9am–5pm on Fri, Sat and Sun.
//   Unticked: each day gets its own row, e.g. Fri 10am–12am, Sat 7am–12am, Sun 7am–9am.
// The page gives it the sitter's days and booked times (props), and it tells the page
// what the owner chose (the 'change' event).
const props = defineProps({
  availability: { type: Object, required: true }, // { '2026-10-20': { status: 'available' | 'blocked', slots: [540, 570, ...] } }
  busy: { type: Array, required: true }, // times the sitter is already booked: [{ start, end }] as moments
  initial: { type: Object, default: null }, // from the owner's search: { startDate, endDate, startTime, endTime } (filled in once, only if it suits this sitter)
  dayStep: { type: Number, default: null }, // the step number shown on the Days card (e.g. 2), none if not given
  timeStep: { type: Number, default: null } // the step number shown on the Times card (e.g. 3)
})
const emit = defineEmits(['change'])
// lets BookingDatePicker.vue send a custom event named "change" to its parent component.

const today = toDateString(new Date())
// The time right now, ticking every 30 seconds. Date.now() on its own isn't watched by Vue, so a page left open
// kept offering times that had passed since it loaded. Reading now.value makes the time lists update by themselves.
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 30 * 1000)
onUnmounted(() => clearInterval(clock))

// start and end date + timing that the owner wants 
const startDate = ref('') // 'YYYY-MM-DD'
const startTime = ref('') // '09:00'
const endDate = ref('')
const endTime = ref('') // '17:30' (or '24:00' = end of the day)
// These two are the hours for every day while "Same hours every day" is ticked (or the booking is one day).
const sameHours = ref(true) // untick to choose different hours for each day
const perDay = ref({}) // the hours for each day when unticked: { '2026-11-06': { startTime: '10:00', endTime: '24:00' }, ... }

// The month shown in the calendar picker
const viewYear = ref(new Date().getFullYear()) //2026
const viewMonth = ref(new Date().getMonth()) // 0 = January
const monthName = computed(() =>
  new Date(viewYear.value, viewMonth.value, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })
)
function changeMonth(step) {
  const d = new Date(viewYear.value, viewMonth.value + step, 1)
  viewYear.value = d.getFullYear()
  viewMonth.value = d.getMonth()
}
// The month as rows of 7 slots (empty slots are null), like the sitter's calendar
const weeks = computed(() => {
  const firstWeekday = new Date(viewYear.value, viewMonth.value, 1).getDay() // 0 = Sunday
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate()
  const days = []
  for (let i = 0; i < firstWeekday; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ day: d, date: toDateString(new Date(viewYear.value, viewMonth.value, d)) })
  }
  while (days.length % 7 !== 0) days.push(null)
  const result = []
  for (let i = 0; i < days.length; i += 7) result.push(days.slice(i, i + 7))
  return result
})

// Every day of the booking, start to end: ['2026-11-03', '2026-11-04', '2026-11-05']
const rangeDays = computed(() => {
  if (!startDate.value || !endDate.value) return []
  const days = []
  const d = new Date(startDate.value + 'T00:00:00')
  const end = new Date(endDate.value + 'T00:00:00')
  while (d <= end) {
    days.push(toDateString(d))
    d.setDate(d.getDate() + 1)
  }
  return days
})

// A day the sitter could do at least part of: available, in the future, with a free half-hour left
function dayOpen(date) {
  return date >= today && props.availability[date]?.status === 'available' && dayHasFreeSlot(props.busy, date, slotsFor(props.availability, date))
}

// While picking the END day: the last day the booking can reach before it would run into
// a day the sitter isn't available at all (the exact hours are checked once the times are chosen).
const lastEndDate = computed(() => {
  if (!startDate.value) return ''
  let last = startDate.value
  const d = new Date(startDate.value + 'T00:00:00')
  for (let i = 0; i < 90; i++) {
    d.setDate(d.getDate() + 1) // look at the next day
    const day = toDateString(d)
    if (!dayOpen(day)) break // not available that day: can't go any further
    last = day
  }
  return last
})

// Greyed-out days: past days, days the sitter isn't available, days with no free time left,
// and (once a start day is picked) days beyond the point where the booking would run into a day the sitter is off.
function dayDisabled(date) {
  if (startDate.value && !endDate.value && date > startDate.value) {
    return date > lastEndDate.value // picking the end day: everything from the start to the limit is fine
  }
  return !dayOpen(date)
}

// makes sure the startdate,endate , starttime and endtime are logical 
function inRange(date) {
  return Boolean(startDate.value && endDate.value && date >= startDate.value && date <= endDate.value)
}

// assigns the values to the ref variables for the date and time the user picks 
function pickDay(date) {
  if (dayDisabled(date)) return
  if (!startDate.value || endDate.value || date < startDate.value) {
    // first click (or starting again): this is the start day
    startDate.value = date
    endDate.value = ''
    startTime.value = ''
    endTime.value = ''
    perDay.value = {}
  } else {
    endDate.value = date // second click: the end day (the same day is fine)
  }
}
function clearDates() {
  startDate.value = ''
  endDate.value = ''
  startTime.value = ''
  endTime.value = ''
  perDay.value = {}
}

// One day's own hours are only shown as separate rows when the booking has several days and "Same hours every day" is unticked
const choosingEachDay = computed(() => rangeDays.value.length > 1 && !sameHours.value)

// The Start time options for some days: every 30-minute slot from 7:00 am to 11:30 pm. A slot that has already
// passed on any of those days is left out of the list. The rest are greyed out if, on any of those days, it is
// booked or the sitter isn't free then.
// (Same hours every day → all the booking's days are checked; one row per day → only that day.)
function startSlotsFor(days) {
  const list = []
  for (let m = DAY_START_MIN; m < DAY_MIN; m += 30) {
    if (days.some((day) => momentOf(day, m) <= now.value)) continue // passed: not shown at all
    let note = ''
    for (const day of days) {
      if (slotFree(props.busy, day, m, slotsFor(props.availability, day))) continue
      const startOfSlot = momentOf(day, m)
      note = isBusy(props.busy, startOfSlot, startOfSlot + SLOT_MS) ? ' (booked)' : ' (not available)'
      break // one day that doesn't work is enough
    }
    list.push({ value: toHHMM(m), label: formatTime(toHHMM(m)) + note, disabled: note !== '' })
  }
  return list
}

// The End time options: only times AFTER the chosen start (up to 12:00 am). Greyed out if, on any of
// those days, the hours from the start up to that time aren't all free, or run into a time the sitter is booked.
function endSlotsFor(days, start) {
  if (!start) return []
  const startMin = toMinutes(start)
  const list = []
  for (let m = startMin + 30; m <= DAY_MIN; m += 30) {
    const value = m === DAY_MIN ? '24:00' : toHHMM(m) // 1440 minutes = 12:00 am (end of the day), written '24:00'
    let busyThen = false
    let hoursOk = true
    for (const day of days) {
      if (!slotsCover(slotsFor(props.availability, day), startMin, m)) hoursOk = false // all of those hours are free hours that day
      if (isBusy(props.busy, momentOf(day, startMin), momentOf(day, m))) busyThen = true
    }
    const free = hoursOk && !busyThen
    const note = (value === '24:00' ? ' (end of day)' : '') + (free ? '' : busyThen ? ' (booked)' : ' (not available)')
    list.push({ value, label: formatTime(value) + note, disabled: !free })
  }
  return list
}

// "Same hours every day" (or a one-day booking): one pair of dropdowns, checked against every day
const startSlots = computed(() => (rangeDays.value.length ? startSlotsFor(rangeDays.value) : []))
const endSlots = computed(() => (rangeDays.value.length ? endSlotsFor(rangeDays.value, startTime.value) : []))

// One row per day: make sure every day of the booking has an entry (an empty pair until the owner picks the hours)
watch(rangeDays, (days) => {
  const next = {}
  for (const day of days) next[day] = perDay.value[day] || { startTime: '', endTime: '' }
  perDay.value = next
}, { immediate: true })
// That day's own hours
function hoursOf(day) {
  return perDay.value[day] || { startTime: '', endTime: '' }
}
// Is this time allowed in that day's dropdown?
function allowed(slots, value) {
  return slots.some((slot) => slot.value === value && !slot.disabled)
}

// When the owner unticks "Same hours every day", start each day with the hours already chosen (where that day allows them)
watch(sameHours, (same) => {
  if (same) return
  for (const day of rangeDays.value) {
    const h = hoursOf(day)
    if (!h.startTime && allowed(startSlotsFor([day]), startTime.value)) h.startTime = startTime.value
    if (!h.endTime && h.startTime && allowed(endSlotsFor([day], h.startTime), endTime.value)) h.endTime = endTime.value
  }
})

// Button in "each day" mode: copy the first day's hours to every other day (only where that day allows them)
const copyNote = ref('')
function copyFirstDay() {
  const first = hoursOf(rangeDays.value[0])
  const skipped = []
  for (const day of rangeDays.value.slice(1)) {
    const h = hoursOf(day)
    if (allowed(startSlotsFor([day]), first.startTime) && allowed(endSlotsFor([day], first.startTime), first.endTime)) {
      h.startTime = first.startTime
      h.endTime = first.endTime
    } else {
      skipped.push(prettyDate(day))
    }
  }
  copyNote.value = skipped.length ? `Not copied to ${skipped.join(', ')}: the sitter isn't free then. Choose those days' hours below.` : ''
}

// A chosen start time that has passed while the page was open is cleared, so it can't be sent
watch(startSlots, () => {
  if (startTime.value && !allowed(startSlots.value, startTime.value)) startTime.value = ''
})
watch(now, () => {
  for (const day of Object.keys(perDay.value)) {
    const h = perDay.value[day]
    if (h.startTime && !allowed(startSlotsFor([day]), h.startTime)) { h.startTime = ''; h.endTime = '' }
  }
})

// If a start time changes and the chosen end time is no longer allowed, clear it
watch([startTime, endDate], () => {
  if (!allowed(endSlots.value, endTime.value)) endTime.value = ''
})
watch(perDay, () => {
  for (const day of rangeDays.value) {
    const h = hoursOf(day)
    if (h.endTime && !allowed(endSlotsFor([day], h.startTime), h.endTime)) h.endTime = ''
  }
}, { deep: true })

// The hours for each day of the booking, which is what gets sent: [{ date, startTime, endTime }, ...]
const dayTimes = computed(() => {
  if (!endDate.value) return []
  if (!choosingEachDay.value) return rangeDays.value.map((date) => ({ date, startTime: startTime.value, endTime: endTime.value }))
  return rangeDays.value.map((date) => ({ date, startTime: perDay.value[date]?.startTime || '', endTime: perDay.value[date]?.endTime || '' }))
})

// Safety net: with everything chosen, does any day of the booking run into a booked time? (The greying should stop this.)
const clash = computed(() =>
  dayTimes.value.some((d) => d.startTime && d.endTime &&
    isBusy(props.busy, momentOf(d.date, toMinutes(d.startTime)), momentOf(d.date, toMinutes(d.endTime))))
)

// Fill in the dates (and hours) the owner searched for, once the sitter's days have loaded.
// Skipped silently if those days don't work for this sitter; the hours are only kept if they are free on every day.
let initialDone = false
watch(() => Object.keys(props.availability).length, (count) => {
  if (initialDone || !count || !props.initial) return
  initialDone = true
  const { startDate: start, endDate: end, startTime: from, endTime: until } = props.initial
  if (!start || !end || end < start || !dayOpen(start)) return
  startDate.value = start
  if (end > lastEndDate.value) return (startDate.value = '') // runs into a day the sitter is off
  endDate.value = end
  const shown = new Date(start + 'T00:00:00') // show the start date's month
  viewYear.value = shown.getFullYear()
  viewMonth.value = shown.getMonth()
  if (from && allowed(startSlots.value, from)) {
    startTime.value = from
    if (until && allowed(endSlots.value, until)) endTime.value = until
  }
}, { immediate: true })

// Tell the page whenever the choice changes (immediately too, so it starts with the empty choice)
watch(
  () => ({
    startDate: startDate.value,
    startTime: dayTimes.value[0]?.startTime || '', // the first day's start
    endDate: endDate.value,
    endTime: dayTimes.value[dayTimes.value.length - 1]?.endTime || '', // the last day's end
    dayTimes: dayTimes.value, // the hours for each day
    clash: clash.value
  }),
  (choice) => emit('change', choice), //sends a custom event called change back to the parent 
  { immediate: true }
)
</script>

<template>
  <!-- Two cards: Days (the calendar + Start date / End date) and Times (the time boxes). The page puts them in its list of steps. -->
  <section class="step-card">
  <!-- Dates: pick a start day, then an end day (greyed-out days can't be picked) -->
  <h3 class="step-head"><span v-if="dayStep" class="step-num">{{ dayStep }}</span>Days</h3>
  <!-- what the colours mean -->
  <div class="legend">
    <span><i class="key key--open"></i>Available</span>
    <span><i class="key key--off"></i>Not available</span>
    <span><i class="key key--mine"></i>Your booking</span>
  </div>
  <div class="mb-2">
    <!-- 44px round buttons right beside the month name (same look as the sitter's My Calendar), easy to hit with a thumb -->
    <div class="d-flex justify-content-center align-items-center gap-2 mb-2">
      <button type="button" class="month-btn" aria-label="Previous month" @click="changeMonth(-1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <span class="month-name">{{ monthName }}</span>
      <button type="button" class="month-btn" aria-label="Next month" @click="changeMonth(1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </div>
    <div class="rgrid">
      <div v-for="name in ['S', 'M', 'T', 'W', 'T', 'F', 'S']" class="text-center small text-muted fw-semibold">{{ name }}</div>
      <template v-for="week in weeks">
        <template v-for="d in week">
          <div v-if="!d"></div>
          <button
            v-else
            type="button"
            class="rday"
            :class="{ start: d.date === startDate, end: d.date === endDate, inrange: inRange(d.date) }"
            :disabled="dayDisabled(d.date)"
            @click="pickDay(d.date)"
          >
            {{ d.day }}
          </button>
        </template>
      </template>
    </div>
  </div>
  <p class="small text-muted mb-3">
    <template v-if="!startDate">Tap the start date. Greyed-out days can't be chosen.</template>
    <template v-else-if="!endDate">Now tap the end date (<strong>tap the same day again for a one-day booking</strong>).</template>
    <template v-else>{{ rangeDays.length }} day{{ rangeDays.length === 1 ? '' : 's' }}. Tap a new start date to change.</template>
    <button v-if="startDate" type="button" class="btn btn-link btn-sm p-0 ms-2" @click="clearDates">Clear</button>
  </p>

  <!-- Start date and End date fill in from the taps on the calendar above -->
  <div class="row g-2 mb-2">
    <div class="col-6">
      <label class="form-label small" for="start-date">Start date</label>
      <input id="start-date" class="form-control" readonly :value="startDate ? prettyDate(startDate) : ''" placeholder="Tap a day" />
    </div>
    <div class="col-6">
      <label class="form-label small" for="end-date">End date</label>
      <input id="end-date" class="form-control" readonly :value="endDate ? prettyDate(endDate) : ''" placeholder="Tap the last day" />
    </div>
  </div>
  </section>

  <section class="step-card">
  <h3 class="step-head"><span v-if="timeStep" class="step-num">{{ timeStep }}</span>Times</h3>

  <!-- Times: every 30 minutes from 7:00 am to 12:00 am; passed times are left out, booked times are greyed out. A whole day is 7:00 am to 12:00 am. -->
  <div v-if="rangeDays.length > 1 && endDate" class="form-check mb-2">
    <input id="same-hours" v-model="sameHours" class="form-check-input" type="checkbox" />
    <label class="form-check-label small" for="same-hours">Same hours every day</label>
  </div>

  <!-- One pair of dropdowns: for a one-day booking, or the same hours on every day -->
  <template v-if="!choosingEachDay">
    <div class="row g-2">
      <div class="col-12 col-sm-6">
        <label class="form-label small" for="start-time">Start time{{ rangeDays.length > 1 ? ' (each day)' : '' }}</label>
        <select id="start-time" v-model="startTime" class="form-select" :disabled="!endDate">
          <option value="" disabled>{{ endDate ? 'Choose a time' : 'Pick the dates first' }}</option>
          <option v-for="slot in startSlots" :key="slot.value" :value="slot.value" :disabled="slot.disabled">{{ slot.label }}</option>
        </select>
      </div>
      <div class="col-12 col-sm-6">
        <label class="form-label small" for="end-time">End time{{ rangeDays.length > 1 ? ' (each day)' : '' }}</label>
        <select id="end-time" v-model="endTime" class="form-select" :disabled="!endDate || !startTime">
          <option value="" disabled>{{ !endDate ? 'Pick the dates first' : !startTime ? 'Pick a start time first' : 'Choose a time' }}</option>
          <option v-for="slot in endSlots" :key="slot.value" :value="slot.value" :disabled="slot.disabled">{{ slot.label }}</option>
        </select>
      </div>
    </div>
    <p v-if="endDate && rangeDays.includes(today)" class="small text-muted mt-2 mb-0">
      Your booking starts today, so times that have already passed aren't shown.
    </p>
    <p v-if="rangeDays.length > 1 && endDate" class="small text-muted mt-2 mb-0">
      These hours are used on all {{ rangeDays.length }} days. Need different hours on some days (e.g. a later start today)? Untick "Same hours every day".
    </p>
  </template>

  <!-- One row per day: each day has its own start and end time -->
  <template v-else>
    <template v-for="day in rangeDays" :key="day">
    <div v-if="perDay[day]" class="row g-2 align-items-end mb-2">
      <div class="col-12 col-sm-4 small fw-semibold">{{ prettyDate(day) }}</div>
      <div class="col-6 col-sm-4">
        <label class="visually-hidden" :for="`start-${day}`">Start time on {{ prettyDate(day) }}</label>
        <select :id="`start-${day}`" v-model="perDay[day].startTime" class="form-select form-select-sm">
          <option value="" disabled>Start</option>
          <option v-for="slot in startSlotsFor([day])" :key="slot.value" :value="slot.value" :disabled="slot.disabled">{{ slot.label }}</option>
        </select>
      </div>
      <div class="col-6 col-sm-4">
        <label class="visually-hidden" :for="`end-${day}`">End time on {{ prettyDate(day) }}</label>
        <select :id="`end-${day}`" v-model="perDay[day].endTime" class="form-select form-select-sm" :disabled="!perDay[day].startTime">
          <option value="" disabled>End</option>
          <option v-for="slot in endSlotsFor([day], perDay[day].startTime)" :key="slot.value" :value="slot.value" :disabled="slot.disabled">{{ slot.label }}</option>
        </select>
      </div>
    </div>
    </template>
    <button type="button" class="btn btn-link btn-sm p-0" :disabled="!hoursOf(rangeDays[0]).endTime" @click="copyFirstDay">
      Use {{ prettyDate(rangeDays[0]) }}'s hours for every day
    </button>
    <p v-if="copyNote" class="small text-muted mt-1 mb-0">{{ copyNote }}</p>
  </template>
  </section>
</template>

<style scoped>
.month-btn { /* 44px circle, the size Apple and Google recommend for touch */
  width: 44px;
  height: 44px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1.5px solid #e4dbd0;
  background: #fffdfa;
  color: #2b2420;
}
.month-btn:hover { background: #f3e2d9; border-color: var(--accent-deep); }
.month-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.month-name { font-weight: 600; min-width: 9.5em; text-align: center; }
.rgrid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.rday {
  height: 2.8rem; /* the calendar stretches the full width; each day keeps a fixed height */
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fff;
}
.rday:disabled { /* greyed out: can't be picked (the sitter isn't available, it has passed, or it's fully booked) */
  background: #f3f3f3;
  border-color: #ececec;
  color: #b5b5b5;
  text-decoration: line-through;
  cursor: not-allowed;
}
.rday:hover:not(:disabled) { border-color: var(--accent-main); }
.rday.inrange { background: var(--tint-soft); border-color: var(--line); }
.rday.start, .rday.end { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 800; }

/* the key above the calendar: same colours as the day boxes */
.legend { display: flex; flex-wrap: wrap; gap: 0.35rem 1rem; font-size: 0.8rem; color: #6b5f56; margin-bottom: 0.75rem; }
.legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
.key { width: 14px; height: 14px; border-radius: 4px; display: inline-block; }
.key--open { background: #fff; border: 1px solid #e0e0e0; }
.key--off { background: #f3f3f3; border: 1px solid #ececec; background-image: linear-gradient(to bottom right, transparent 45%, #b5b5b5 45%, #b5b5b5 55%, transparent 55%); }
.key--mine { background: var(--accent); }
/* the Clear link and the tick box in the app colour instead of Bootstrap blue */
.btn-link { color: var(--accent); font-weight: 700; text-decoration: none; } /* no underline on Clear (or "Use ...'s hours for every day") */
.form-check-input:checked { background-color: var(--accent); border-color: var(--accent); }
</style>
