<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import BookingSheet from './BookingSheet.vue'
import { formatBookingWhen } from '../utils/bookingHelpers.js'
import { toDateString, prettyDate, DAY_MIN, DAY_START_MIN } from '../utils/bookingTimeHelpers.js'
import {
  shortTime,
  groupBookingsByDay,
  dayPart,
  chipText,
  isFullyBooked,
  freeHoursText,
  slotBooked,
  canChangeSlot,
  paintedSlots
} from '../utils/availabilityHelpers.js'

// The sitter's calendar: a Month view and a Week view (30-minute rows) showing their free time and bookings.
// The page gives it the data (props). When it is editable, dragging tells the page which day changed
// and what its new free half-hours are (the 'paint' event); the page keeps the unsaved changes.
const props = defineProps({
  saved: { type: Object, required: true }, // what the server has: { '2026-10-20': [540, 570, ...] } ( [] = unavailable )
  changes: { type: Object, default: () => ({}) }, // unsaved changes, same shape
  bookings: { type: Array, required: true }, // accepted / paid / in-progress bookings
  editable: { type: Boolean, default: false }, // false = look only (no dragging)
  highlight: { type: Object, default: null }, // a booking request to point out: { startDate, startTime, endDate, endTime }
  focusDate: { type: String, default: '' }, // 'YYYY-MM-DD': when this changes, the calendar jumps to that day
  selected: { type: String, default: '' } // 'YYYY-MM-DD': the day the page has picked, drawn with a dark outline
})
// 'select' tells the page which day was clicked (the page can ignore it)
const emit = defineEmits(['paint', 'select'])

const now = new Date()
// new Date() automatically creates a JavaScript Date object containing the browser's current local date and time.
// no arguments = date object for today ; Date(year,month,day)-> date object for that day

const today = toDateString(now)
const nowMinutes = now.getHours() * 60 + now.getMinutes() // minutes after midnight right now

// Phones and tablets can't hover, so there a tap opens a small preview instead of the hover card,
// and a tap only picks the day (dragging to paint would fight with scrolling the page)
const canHover = window.matchMedia('(hover: hover)').matches
const phoneQuery = window.matchMedia('(max-width: 575.98px)') // same width as the phone styles at the bottom
const isPhone = phoneQuery.matches
// true while the window is phone-sized (also when a desktop window is made narrow): then a tap opens the preview sheet, not the hover card
const narrow = ref(phoneQuery.matches)
function onNarrowChange(e) {
  narrow.value = e.matches
  if (e.matches) hovered.value = null
}
onMounted(() => phoneQuery.addEventListener('change', onNarrowChange))
onBeforeUnmount(() => phoneQuery.removeEventListener('change', onNarrowChange))

const year = ref(now.getFullYear())
const month = ref(now.getMonth())
// getFullyr and getMonth are built in js methods for date objects

const monthName = computed(() =>
  new Date(year.value, month.value, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })
)
// todateString : converts month_number -> month_name
// recalculates the month name automatically when it changes

// The month as a list of weeks. Each week has 7 slots; empty slots are null.
const weeks = computed(() => {
  const firstWeekday = new Date(year.value, month.value, 1).getDay() // .getDay() checks date, returns the specific day as a value e.g. 0 = Sunday, 1 = monday etc
  const daysInMonth = new Date(year.value, month.value + 1, 0).getDate()  // for the date object for the last day of the month, .getDate() returns how many days there are in that month

  const days = []
  for (let i = 0; i < firstWeekday; i++) days.push(null)
  // makes it so the days before the first day fo the month are null ( i.e days that belonged to the previous month )
  for (let d = 1; d <= daysInMonth; d++) days.push({ day: d, date: toDateString(new Date(year.value, month.value, d)) })
  // loops thru every day of the month, so days = [ { day: 1, date: "2026-10-01" },... ]
  while (days.length % 7 !== 0)
    days.push(null) // make sure each week has 7 days
  const result = []
  for (let i = 0; i < days.length; i += 7)
  result.push(days.slice(i, i + 7)) // breaks all the weeks into individual weeks
// weeks = [ [1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20, 21] ]
  return result
})

// Bookings grouped by day: { '2026-11-21': [booking1, booking2,...] }
const bookedDays = computed(() => groupBookingsByDay(props.bookings))

function dayBookings(date) {
  return bookedDays.value[date] || []
}
// returns the actual array of bookings for that date 
// e.g. returns : [booking1, booking2,...]

// The free half-hours of one day: the unsaved change if there is one, else what the server has, else none (unavailable)
function slotsOf(date) {
  return props.changes[date] ?? props.saved[date] ?? []
}
// it checks : 
// 1. props.changes[date] — any unsaved edit the sitter just made 
// 2. props.saved[date] — the availability last loaded from the server/database.
// returns array of all the free hour slots for that day
// e.g. [540,570,990,....]


// What colour a day's square is in the month view
function statusOf(date) {
  if (isFullyBooked(dayBookings(date), date)) return 'booked' // no free time left that day
  if (bookedDays.value[date]) return 'partial' // some bookings, but part of the day is still free
  return slotsOf(date).length ? 'available' : 'blocked'
}
// returns the status of that specific day by checking the bookedDays,changes,saved object
//  if the bookings cover the whole day: 'booked' ; if there are bookings but free time is left: 'partial'
//  else if the day has free half-hours: 'available' ; none: 'blocked'
//  a day the sitter never set counts as 'blocked' (unavailable is the default)

// The free hours written inside an available day's square, e.g. '9am–6pm' (empty for other days)
function freeText(date) {
  return statusOf(date) === 'available' ? freeHoursText(slotsOf(date)) : ''
}

// Past days and days with bookings can't be changed as a whole day (month view).
function canChange(date) {
  return date >= today && !bookedDays.value[date]
}
// reutrns true if the date is ahead of today and its not in bookedDays

// ----- Painting: drag across days (month) or half-hours (week) to make them available / unavailable -----
const mode = ref('available') // what dragging does: 'available' | 'blocked'
const painting = ref(false) // true while the mouse button is held down

// Works out the day's new free half-hours and tells the page (nothing is sent if nothing would change)
function paintRange(date, startMinutes, endMinutes, on) {
  const list = paintedSlots(slotsOf(date), date, startMinutes, endMinutes, on, dayBookings(date), today, nowMinutes)
  if (list) emit('paint', date, list)
}
// slotsOf(date)-> gets the avail slots for that day, including booked slots e.g. [480, 510, 540, 570]
// dayBookings(date) -> the bookings on that day e.g. [ {  startDate: '2026-10-23',  startTime: '10:00', endDate: '2026-10-23',  endTime: '11:00' } ]
// date -> which day are we changing, startMinutes, endMinutes → what time range are we painting?
// on -> make avail/unavail ? 
//  takes in : today -> current date, to check wether the slot is in the past 
// nowMinutes -> time in milliseconds from 1970 ; if the nowMinutes is greater than the time we're trying to edit, this means 
// the time we're trying to edit is already over, so shdnt be able to edit 




// Month view: press on a day, then drag across more days (the whole day is set)
// A plain click only selects the day; nothing is painted until the drag moves into a second day,
// so clicking a saved day to look at it doesn't overwrite its hours.
// props not editable when parent renders calendar in view only mode, e.g. for owner to see sitter avialability
const dragStartDay = ref(null) // the day the press started on, painted only once the drag reaches another day
function startDayPaint(date) {
  emit('select', date)
  if (!props.editable || !canHover || !canChange(date)) return
  painting.value = true
  dragStartDay.value = date
}

// 
function paintDay(date) {
  if (!painting.value) return
  if (dragStartDay.value) {
    if (date === dragStartDay.value) return // still on the first day: no drag yet
    paintWholeDay(dragStartDay.value) // the drag has moved on, so paint the first day too
    dragStartDay.value = null
  }
  paintWholeDay(date)
}
function paintWholeDay(date) {
  if (canChange(date)) paintRange(date, DAY_START_MIN, DAY_MIN, mode.value === 'available') // the whole day = 7am to 12am
}
  

// Week view: press on a half-hour, then drag across more half-hours (a row or a column)
function startSlotPaint(date, m) {
  emit('select', date)
  if (!props.editable || !canHover) return
  painting.value = true
  paintSlot(date, m)
}
function paintSlot(date, m) {
  if (painting.value) paintRange(date, m, m + 30, mode.value === 'available')
}
function stopPainting() {
  painting.value = false
  dragStartDay.value = null
}

// Month view: click S M T W... to set every day of that weekday in the shown month
function paintWeekday(weekday) {
  if (!props.editable) return
  for (const week of weeks.value) {
    const d = week[weekday]
    if (d && canChange(d.date)) paintRange(d.date, DAY_START_MIN, DAY_MIN, mode.value === 'available')
  }
}

// ----- Month / week view and moving around -----
const view = ref(isPhone ? 'week' : 'month') // 'month' | 'week' (phones start on the week)
const weekStart = ref(startOfWeek(now)) // the Sunday that starts the week shown in the week view

function startOfWeek(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())
}
const weekDays = computed(() => {
  const list = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.value.getFullYear(), weekStart.value.getMonth(), weekStart.value.getDate() + i)
    list.push({
      date: toDateString(d),
      name: d.toLocaleDateString('en-SG', { weekday: 'short' }),
      day: d.getDate()
    })
  }
  return list
})
const title = computed(() => {
  if (view.value === 'month') return monthName.value
  if (isPhone) { // shorter on phones so it fits between the two buttons: '25 Oct – 31 Oct'
    const short = (date) => new Date(date + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
    return `${short(weekDays.value[0].date)} – ${short(weekDays.value[6].date)}`
  }
  return `${prettyDate(weekDays.value[0].date)} – ${prettyDate(weekDays.value[6].date)}`
})

// The week view shows only the hours that can be booked, 7am to 12am, in half-hour rows (it scrolls)
const FIRST_MIN = DAY_START_MIN
const LAST_MIN = DAY_MIN
const ROW_PX = 22 // height of one half-hour row
const rows = []
for (let m = FIRST_MIN; m < LAST_MIN; m += 30) rows.push(m)

// Where a booking sits in a day column of the week view: top and height in pixels
function blockStyle(b, date) {
  const [startMinutes, endMinutes] = dayPart(b, date)
  const top = ((Math.max(startMinutes, FIRST_MIN) - FIRST_MIN) / 30) * ROW_PX
  const height = ((Math.min(endMinutes, LAST_MIN) - Math.max(startMinutes, FIRST_MIN)) / 30) * ROW_PX
  return { top: top + 1 + 'px', height: Math.max(height - 2, 4) + 'px' }
}
// A booking of 30 minutes or less only gets one row, so its name and time share one line
function isShort(b, date) {
  const [startMinutes, endMinutes] = dayPart(b, date)
  return endMinutes - startMinutes <= 30
}

function move(step) {
  if (view.value === 'month') {
    const d = new Date(year.value, month.value + step, 1)
    year.value = d.getFullYear()
    month.value = d.getMonth()
  } else {
    const w = weekStart.value
    weekStart.value = new Date(w.getFullYear(), w.getMonth(), w.getDate() + step * 7)
  }
}
function goTo(date) {
  const d = new Date(date + 'T00:00:00')
  year.value = d.getFullYear()
  month.value = d.getMonth()
  weekStart.value = startOfWeek(d)
}
function goToday() {
  goTo(today)
}
// true when the month / week shown is the one we are in now (then the "Back to ..." link is hidden)
const showingNow = computed(() => {
  if (view.value === 'month') return year.value === now.getFullYear() && month.value === now.getMonth()
  return toDateString(weekStart.value) === toDateString(startOfWeek(now))
})
// Month view on a phone: tapping the day's number opens that week
function openWeek(date) {
  if (canHover) return
  goTo(date)
  view.value = 'week'
}

// The week view scrolls, so open it at the top, 7am (or a little before now, if this week has today in it)
const weekBox = ref(null)
function scrollWeek() {
  if (!weekBox.value) return
  const hasToday = weekDays.value.some((d) => d.date === today)
  const startAt = hasToday ? Math.max(nowMinutes - 3 * 60, FIRST_MIN) : FIRST_MIN
  weekBox.value.scrollTop = ((startAt - FIRST_MIN) / 30) * ROW_PX
}
watch([view, weekStart], () => nextTick(scrollWeek))
onMounted(scrollWeek)
// when the page asks for a day (e.g. a booking request was picked), jump there
watch(() => props.focusDate, (date) => date && goTo(date))

// ----- A booking request the page wants to point out -----
function inHighlight(date) {
  return Boolean(props.highlight && date >= props.highlight.startDate && date <= props.highlight.endDate)
}

// ----- The card that appears next to the mouse when it is over a booking -----
const hovered = ref(null) // { booking, left, top }
const CARD_W = 280 // width of the card
const CARD_H = 100 // roughly how tall it is

// Puts the card just right of the mouse, or to its left / above if there is no room
function placeCard(event) {
  const left = event.clientX + 14 + CARD_W > window.innerWidth ? event.clientX - 14 - CARD_W : event.clientX + 14
  const top = event.clientY + 14 + CARD_H > window.innerHeight ? event.clientY - 14 - CARD_H : event.clientY + 14
  return { left, top }
}
function showBooking(b, event) {
  if (!canHover || narrow.value) return // a tap on a phone also sends mouseenter; the preview sheet is used there instead
  hovered.value = { booking: b, ...placeCard(event) }
}
// b-> booking object currently under the mouse 
// event -> e browser mouse event, which includes the cursor’s position.
// hovered.value = { booking: b,left: 820, top: 300} (rmb the ...{} js creates a copy)
// now that hovered.value!=nth, v-if hovered in the template = true, so the booking card is rendered 

function moveCard(event) { // the card follows the mouse while it moves over the booking
  if (hovered.value) hovered.value = { ...hovered.value, ...placeCard(event) }
}
// hovered.value -> checks if card is currently visible 
// if the card is visible, when the mouse moves, runs placecard agan to find new position of mouse, so that we can position the card correctly 

function hideBooking() {
  hovered.value = null
}
// The pets on the hovered booking, each with a picture address (empty if the pet has no picture)
const hoverPets = computed(() => {
  const b = hovered.value?.booking
  if (!b) return []
  return b.pets || b.petNames.map((name) => ({ name, photo: '' }))
})
// changes hovered.value to null so it isnt rendered

// ----- Phones: tapping a booking opens a short preview at the bottom (BookingSheet) -----
const tapped = ref(null) // the booking being previewed
function tapBooking(b) {
  if (!canHover || narrow.value) tapped.value = b
}
</script>

<template>
  <!-- mouseup anywhere ends a drag, even if the mouse is let go outside the calendar -->
  <div class="avail-cal" @mouseup="stopPainting" @mouseleave="stopPainting">
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
      <div class="d-flex align-items-center gap-2">
        <button type="button" class="cal-nav-btn" :aria-label="view === 'month' ? 'Previous month' : 'Previous week'" @click="move(-1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <h2 class="cal-title mb-0">{{ title }}</h2>
        <button type="button" class="cal-nav-btn" :aria-label="view === 'month' ? 'Next month' : 'Next week'" @click="move(1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <!-- only shows once you have moved away from this month / week -->
        <button v-if="!showingNow" type="button" class="back-link" @click="goToday">
          Back to this {{ view === 'month' ? 'month' : 'week' }}
        </button>
      </div>
      <div class="d-flex flex-wrap align-items-center gap-3">
        <div class="btn-group" role="group" aria-label="Calendar view">
          <button type="button" class="btn" :class="view === 'month' ? 'btn-brand' : 'btn-outline-secondary'" @click="view = 'month'">Month</button>
          <button type="button" class="btn" :class="view === 'week' ? 'btn-brand' : 'btn-outline-secondary'" @click="view = 'week'">Week</button>
        </div>
        <!-- dragging only works with a mouse, so phones and tablets don't get these buttons -->
        <!-- flex-wrap: in a narrow window the two buttons go under "Drag to" instead of running off the page -->
        <div v-if="editable && canHover" class="d-flex flex-wrap align-items-center gap-2 small text-muted">
          Drag to
          <div class="btn-group flex-wrap" role="group" aria-label="What dragging does">
            <button type="button" class="btn" :class="mode === 'available' ? 'btn-brand' : 'btn-outline-secondary'" @click="mode = 'available'">Make available</button>
            <button type="button" class="btn" :class="mode === 'blocked' ? 'btn-brand' : 'btn-outline-secondary'" @click="mode = 'blocked'">Make unavailable</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Month view -->
    <div v-if="view === 'month'" class="calendar">
      <button
        v-for="(name, i) in ['S', 'M', 'T', 'W', 'T', 'F', 'S']"
        :key="i"
        type="button"
        class="weekday"
        :disabled="!editable"
        :title="editable ? 'Set every day of this weekday this month' : ''"
        @click="paintWeekday(i)"
      >
        {{ name }}
      </button>
      <template v-for="week in weeks">
        <template v-for="d in week">
          <div v-if="!d"></div>
          <div
            v-else
            class="day"
            :class="[statusOf(d.date), {
              past: d.date < today,
              today: d.date === today,
              asked: inHighlight(d.date),
              selected: d.date === selected,
              unsaved: changes[d.date] }]"
            @mousedown.prevent="startDayPaint(d.date)"
            @mouseenter="paintDay(d.date)"
          >
          <!-- 
          @mousedown.prevent="startDayPaint(d.date)" -> @mousedown listens for mouse being pressed on that element, 
          .prevent is to stop default browser behaviour, which might interfere with the painting 
        
          @mouseenter -> fires when the pointer moves into an element 

          so initially, when person clicks into first square, @mousedown fires, : 
          startDayPaint fires, painting.value = true 

          then when person drags their cursor through more squares, for each new square,
          @mouseenter fires, paintDay for that date fires, 
          

          -->

            <span class="num" @click="openWeek(d.date)">{{ d.day }}</span>
            <!-- the free hours of an available day, e.g. 9am–6pm -->
            <span v-if="freeText(d.date)" class="free-hours">{{ freeText(d.date) }}</span>
            <!-- up to 2 bookings written inside the square, then "+N more"; hover one for its details -->
            <span
              v-for="b in dayBookings(d.date).slice(0, 2)"
              :key="b._id"
              class="chip"
              @mouseenter="showBooking(b, $event)"
              @mousemove="moveCard"
              @mouseleave="hideBooking"
              @click="tapBooking(b)"
            >
              <span class="chip-text">{{ chipText(b, d.date) }}</span>
              <span class="chip-pet">{{ b.petNames[0] }}</span>
            </span>
            <span v-if="dayBookings(d.date).length > 2" class="more">+{{ dayBookings(d.date).length - 2 }} more</span>
          </div>
        </template>
      </template>
    </div>

    <!-- Week view: one column per day, one row per half-hour. The box scrolls; the day names stay at the top -->
    <div v-else ref="weekBox" class="week-scroll">
    <div class="week">
      <div class="week-head"></div>
      <!-- clicking a day name picks that day, so the Selected day card below shows it (same 'select' event as clicking a day in the month view) -->
      <div
        v-for="d in weekDays"
        :key="d.date"
        class="week-head pick"
        :class="{ today: d.date === today, selected: d.date === selected }"
        role="button"
        tabindex="0"
        :aria-pressed="d.date === selected"
        @click="emit('select', d.date)"
        @keyup.enter="emit('select', d.date)"
      >
        <span class="d-none d-sm-inline">{{ d.name }}</span><span class="d-sm-none">{{ d.name.charAt(0) }}</span>
        <span class="week-num">{{ d.day }}</span>
      </div>

      <div class="time-col">
        <div v-for="m in rows" :key="m" class="time-label">{{ m % 60 === 0 ? shortTime(m) : '' }}</div>
      </div>
      <div v-for="d in weekDays" :key="d.date" class="day-col">
        <div
          v-for="m in rows"
          :key="m"
          class="slot"
          :class="{
            free: slotsOf(d.date).includes(m),
            off: editable && !canChangeSlot(d.date, m, dayBookings(d.date), today, nowMinutes) && !slotBooked(dayBookings(d.date), d.date, m),
            hour: m % 60 === 0,
            looking: !editable,
            unsaved: changes[d.date] && (changes[d.date].includes(m) !== (saved[d.date] || []).includes(m))
          }"
          @mousedown.prevent="startSlotPaint(d.date, m)"
          @mouseenter="paintSlot(d.date, m)"
        ></div>
        <!-- the booking request the page is pointing out, drawn over the hours it asks for -->
        <div v-if="inHighlight(d.date)" class="block asked-block" :style="blockStyle(highlight, d.date)">
          <strong>Request</strong>
        </div>
        <!-- bookings sit on top of the half-hours they take -->
        <div
          v-for="b in dayBookings(d.date)"
          :key="b._id"
          class="block"
          :class="{ short: isShort(b, d.date) }"
          :style="blockStyle(b, d.date)"
          @mouseenter="showBooking(b, $event)"
              @mousemove="moveCard"
          @mouseleave="hideBooking"
          @click="tapBooking(b)"
        >
          <strong>{{ b.petNames.join(', ') }}</strong>
          <span>{{ chipText(b, d.date).split(' · ')[0] }}</span>
        </div>
      </div>
    </div>
    </div>

    <div class="legend d-flex flex-wrap gap-3 small mt-3">
      <span><span class="swatch available"></span> Free</span>
      <span><span class="swatch blocked"></span> Unavailable</span>
      <span><span class="swatch partial"></span> Partly booked</span>
      <span><span class="swatch booked"></span> Fully booked</span>
    </div>
    <p class="small text-muted mt-2 mb-0">
      <template v-if="editable && !canHover">
        Tap a day, then set its hours in the Selected day card.
      </template>
      <template v-else-if="editable && view === 'month'">
        Drag across days to change several at once, or click a weekday letter to set that weekday for the whole month. To set only some hours of a day, use the Week view.
      </template>
      <template v-else-if="editable">
        Drag across the half-hours to make them available or unavailable, for a few hours of a day or across days. Hours in the past and booked hours can't be changed.
      </template>
      {{ canHover ? 'Hover a booking to see its details.' : 'Tap a booking to see its details.' }}
    </p>

    <!-- phones: the short preview of a tapped booking, with a button to its booking details page -->
    <BookingSheet v-if="tapped" :booking="tapped" @close="tapped = null" />

    <!-- The white card next to the mouse. Teleport moves it out to the page's <body>, so the cards around the
         calendar (which are animated) can't shift where it appears on the screen. -->
    <Teleport to="body">
    <div v-if="hovered" class="booking-card" :style="{ left: hovered.left + 'px', top: hovered.top + 'px' }">
      <div class="bc-top">
        <!-- the pets' pictures (their first letter if a pet has no picture) -->
        <span class="bc-pics">
          <span v-for="(pet, i) in hoverPets" :key="i" class="bc-pic">
            <img v-if="pet.photo" :src="pet.photo" :alt="pet.name" />
            <template v-else>{{ pet.name.charAt(0).toUpperCase() }}</template>
          </span>
        </span>
        <div class="bc-main">
          <strong>{{ hoverPets.map((p) => p.name).join(', ') }}</strong>
          <span class="bc-when">
            {{ formatBookingWhen(hovered.booking) }}
          </span>
        </div>
        <span class="bc-price">${{ hovered.booking.totalPrice }}</span>
      </div>
      <div class="bc-bottom">
        <span>with {{ hovered.booking.ownerName }}</span>
        <span class="status-pill">{{ hovered.booking.status }}</span>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* Colours (the PetSociety brown, orange and cream; each kind of day has its own colour:
   free = green, unavailable = grey, partly booked = amber, fully booked = blue) */
.avail-cal {
  --ink: #2b2420;
  --muted: #766a60;
  --line: #e4dbd0;
  --accent: var(--accent-main);
  --open: #cfe6c2;
  --open-line: #5f9150;
  --booked: #bfd0e4;
  --booked-line: #5b7ea6;
  --booked-ink: #1f3550;
  --partial: #fbe2a8;
  --partial-line: #c98a12;
  --blocked: #eeebe7;
  color: var(--ink);
}
.cal-title { font-family: 'Fredoka', 'Nunito', sans-serif; font-size: 1.25rem; font-weight: 600; }
.btn-accent { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-accent:hover { background: #b06647; border-color: #b06647; color: #fff; }
/* the round buttons to change month / week: 44px so they are easy to hit with a thumb */
.cal-nav-btn {
  width: 44px;
  height: 44px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  background: #fffdfa;
  color: var(--ink);
}
.cal-nav-btn:hover { background: #f3e2d9; border-color: var(--accent); }
.cal-nav-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.back-link { border: 0; background: none; padding: 10px 4px; color: var(--accent-deep); font-weight: 700; font-size: 0.88rem; text-decoration: underline; text-underline-offset: 3px; }

/* ----- month view ----- */
.calendar {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr)); /* minmax(0, ...) lets a column shrink below its text, so a long pet name can't widen a square */
  gap: 5px;
}
.weekday {
  border: 0;
  background: none;
  padding: 4px 0;
  color: var(--muted);
  font-weight: 600;
  font-size: 0.8rem;
  border-radius: 4px;
}
.weekday:not(:disabled):hover { background: var(--open); color: var(--ink); }
.day {
  min-width: 0;
  min-height: 5.4rem; /* room for the bookings written inside the square */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  text-align: left;
  padding: 6px 7px; /* more than the 3px selected frame, so a little of the square's colour shows between the frame and the bookings */
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fffdfa;
  position: relative;
  user-select: none; /* so dragging does not select text */
}
.num { font-weight: 700; font-size: 0.9rem; }
.chip-pet { display: none; } /* only shown on phones */
.chip { /* one booking inside a day square */
  display: block;
  margin-top: 2px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--booked);
  border-left: 3px solid var(--booked-line);
  color: var(--booked-ink);
  font-size: 0.72rem;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.more { margin-top: 1px; font-size: 0.7rem; color: var(--muted); }
.day.past { opacity: 0.45; }
.day.today { outline: 2px solid var(--accent); outline-offset: -1px; }
.day.asked { outline: 2px dashed var(--accent); outline-offset: -2px; } /* days of the request being looked at */
/* the day picked in the side card. The dark frame is drawn on top of the bookings inside the square
   (an inset box-shadow is drawn underneath them, so the booking chips covered it and looked like they stuck out) */
.day.selected::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 3px solid var(--ink);
  border-radius: 6px;
  pointer-events: none;
  z-index: 1;
}
.day.unsaved::after {
  content: '';
  position: absolute;
  top: 5px;
  right: 5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}
.available { background: var(--open); border-color: var(--open-line); }
.blocked { background: var(--blocked); }
.partial { background: var(--partial); border-color: var(--partial-line); }
.booked { background: var(--booked); border-color: var(--booked-line); }
.day.blocked .num { color: var(--muted); }
.free-hours { font-size: 0.72rem; font-weight: 700; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.day.booked .chip { background: #d3e0ee; }

/* ----- week view ----- */
.week-scroll { max-height: 560px; overflow-y: auto; border-bottom: 1px solid var(--line); }
.week {
  display: grid;
  grid-template-columns: 44px repeat(7, minmax(0, 1fr));
  border-top: 1px solid var(--line);
  border-left: 1px solid var(--line);
  user-select: none;
}
.week > * { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.week-head { text-align: center; padding: 6px 2px; font-weight: 600; font-size: 0.85rem; position: sticky; top: 0; z-index: 3; background: #fffdfa; }
.week-head.today { color: var(--accent); box-shadow: inset 0 -3px 0 var(--accent); }
.week-head.pick { cursor: pointer; }
.week-head.pick:hover { background: #f7ece4; }
.week-head.selected { background: #f3e2d9; } /* the day picked in the side card */
.week-num { display: block; font-family: 'Fredoka', sans-serif; font-size: 1.05rem; }
.time-col { display: grid; grid-auto-rows: 22px; }
.time-label { font-size: 0.7rem; color: var(--muted); text-align: right; padding-right: 5px; line-height: 1; transform: translateY(-4px); }
.time-label:first-child { transform: none; padding-top: 3px; } /* the top label stays inside the grid, so the day names can't cover it */
.day-col { position: relative; display: grid; grid-auto-rows: 22px; }
.slot { border-bottom: 1px dotted var(--line); cursor: pointer; background: var(--blocked); }
.slot.looking { cursor: default; }
.slot.hour { border-bottom: 1px solid var(--line); }
.slot.free { background: var(--open); }
.slot.off { opacity: 0.5; cursor: not-allowed; }
.slot.unsaved { box-shadow: inset 0 0 0 2px var(--accent); }
.block {
  position: absolute;
  z-index: 2;
  left: 3px;
  right: 3px;
  background: var(--booked);
  border-left: 4px solid var(--booked-line);
  color: var(--booked-ink);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.72rem;
  line-height: 1.25;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.block.short { flex-direction: row; align-items: center; gap: 6px; white-space: nowrap; padding-top: 0; padding-bottom: 0; } /* one row: name and time side by side */
.block.short strong { flex: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; } /* the name keeps its room */
.block.short span { min-width: 0; overflow: hidden; text-overflow: ellipsis; } /* the time is cut short first */
.asked-block { /* the request being looked at: dashed orange, drawn first so real bookings sit on top */
  background: rgba(196, 119, 86, 0.18);
  border: 2px dashed var(--accent);
  border-left-width: 2px;
  color: var(--ink);
  pointer-events: none;
}

/* the white card next to the mouse. It is moved to the page body, so it can't use the colour names above: the colours are written out */
.booking-card {
  position: fixed;
  z-index: 1080;
  width: 280px;
  background: #fff;
  color: #2b2420;
  border: 1px solid #e4dbd0;
  border-radius: 14px;
  box-shadow: 0 10px 28px rgba(43, 36, 32, 0.18);
  padding: 12px 14px;
  font-family: 'Nunito', system-ui, sans-serif;
  pointer-events: none; /* so the card never gets in the way of the mouse */
}
.bc-top { display: flex; gap: 10px; align-items: center; }
.bc-pics { display: flex; flex: none; }
.bc-pic {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 2px solid #fff;
  margin-left: -12px;
  background: var(--accent-main);
  color: #fff;
  display: grid;
  place-items: center;
  font-family: 'Fredoka', sans-serif;
  font-weight: 600;
  overflow: hidden;
}
.bc-pic:first-child { margin-left: 0; }
.bc-pic img { width: 100%; height: 100%; object-fit: cover; }
.bc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.bc-main strong { font-family: 'Fredoka', sans-serif; font-weight: 600; font-size: 1rem; }
.bc-when { color: #766a60; font-size: 0.78rem; }
.bc-price { color: #3f8a4a; font-family: 'Fredoka', sans-serif; font-weight: 600; font-size: 1.05rem; align-self: flex-start; }
.bc-bottom { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; color: #766a60; font-size: 0.82rem; }
.status-pill {
  background: #dff0e0;
  color: #24572b;
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 8px;
  border-radius: 999px;
}

.swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 1px solid #c9bfb3;
  border-radius: 3px;
  vertical-align: -2px;
  margin-right: 4px;
}

@media (max-width: 575.98px) { /* phones: squares are small, so each booking is a tappable chip with just the pet's name */
  .day { min-height: 4.4rem; padding: 4px; } /* the squares are narrow, so the selected frame is thinner here and the padding is only just more than it */
  .day.selected::before { border-width: 2px; }
  .chip { min-height: 22px; line-height: 22px; padding: 0 1px; border-left-width: 2px; font-size: 0.68rem; font-weight: 700; }
  .chip-text { display: none; }
  .chip-pet { display: block; overflow: hidden; text-overflow: ellipsis; }
  .more { font-size: 0.66rem; }
  .free-hours { display: none; } /* no room on a phone; the green colour already says the day is free */
  .week-scroll { max-height: 65vh; }
  .week { grid-template-columns: 34px repeat(7, minmax(0, 1fr)); }
  .week-head { font-size: 0.75rem; padding: 4px 0; }
  .time-label { font-size: 0.62rem; padding-right: 3px; }
  .block { left: 1px; right: 1px; padding: 1px 2px; font-size: 0.66rem; border-left-width: 3px; }
  .block span { display: none; }
}
</style>
