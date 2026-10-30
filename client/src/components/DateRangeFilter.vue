<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'

const from = defineModel('from', { type: String, default: '' })
const to = defineModel('to', { type: String, default: '' })

const showDatePicker = ref(false)
const dateRangeButton = ref(null)
const availabilityPicker = ref(null)
const pickerPosition = ref({ top: '8px', left: '8px' })
const draftFrom = ref('')
const draftTo = ref('')
const calendarMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const todayKey = dateKey(new Date())

const calendarTitle = computed(() => calendarMonth.value.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' }))
const calendarWeeks = computed(() => {
  const year = calendarMonth.value.getFullYear()
  const month = calendarMonth.value.getMonth()
  const days = []
  const offset = new Date(year, month, 1).getDay()
  for (let i = 0; i < offset; i++) days.push(null)
  for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
    days.push({ key: dateKey(new Date(year, month, day)), day })
  }
  while (days.length % 7) days.push(null)
  return Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7))
})
const dateRangeLabel = computed(() => {
  if (!from.value) return 'Select dates'
  const format = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
  return to.value ? `${format(from.value)} – ${format(to.value)}` : `${format(from.value)} – choose end date`
})

function changeCalendarMonth(offset) {
  calendarMonth.value = new Date(calendarMonth.value.getFullYear(), calendarMonth.value.getMonth() + offset, 1)
}
function pickAvailabilityDate(date) {
  if (!date || date < todayKey) return
  if (!draftFrom.value || draftTo.value || date < draftFrom.value) {
    draftFrom.value = date
    draftTo.value = ''
    return
  }
  draftTo.value = date
}
function isInSelectedRange(date) {
  return Boolean(date && draftFrom.value && draftTo.value && date >= draftFrom.value && date <= draftTo.value)
}
function confirmAvailabilityDates() {
  if (!draftFrom.value || !draftTo.value) return
  from.value = draftFrom.value
  to.value = draftTo.value
  showDatePicker.value = false
}
function clearAvailabilityDates() {
  draftFrom.value = ''
  draftTo.value = ''
  from.value = ''
  to.value = ''
}
function toggleDatePicker() {
  if (!showDatePicker.value) { draftFrom.value = from.value; draftTo.value = to.value }
  showDatePicker.value = !showDatePicker.value
}

function positionPicker() {
  const button = dateRangeButton.value
  const picker = availabilityPicker.value
  if (!button || !picker) return

  const buttonRect = button.getBoundingClientRect()
  const gap = 8
  const width = Math.min(picker.offsetWidth, window.innerWidth - gap * 2)
  const height = picker.offsetHeight
  const left = Math.max(gap, Math.min(buttonRect.left, window.innerWidth - width - gap))
  const roomBelow = window.innerHeight - buttonRect.bottom - gap
  const top = roomBelow >= height + gap
    ? buttonRect.bottom + gap
    : Math.max(gap, buttonRect.top - height - gap)

  pickerPosition.value = { top: `${top}px`, left: `${left}px`, width: `${width}px` }
}

function removePositionListeners() {
  window.removeEventListener('resize', positionPicker)
  window.removeEventListener('scroll', positionPicker, true)
}

watch(showDatePicker, async (isOpen) => {
  if (!isOpen) {
    removePositionListeners()
    return
  }

  await nextTick()
  if (!showDatePicker.value) return
  positionPicker()
  window.addEventListener('resize', positionPicker)
  window.addEventListener('scroll', positionPicker, true)
}, { flush: 'post' })

// parent's "Clear filters" resets from/to; keep the drafts in step
watch([from, to], ([f, t]) => { draftFrom.value = f; draftTo.value = t })

onBeforeUnmount(removePositionListeners)
</script>

<template>
  <div>
    <label class="form-label fw-bold">Available dates</label>
    <div class="position-relative mb-3">
        <!-- paste your existing toggle button + v-if="showDatePicker" popup markup here, unchanged -->
        <button ref="dateRangeButton" type="button" class="form-control text-start d-flex justify-content-between align-items-center" aria-haspopup="dialog" :aria-expanded="showDatePicker" @click="toggleDatePicker">
            <span>{{ dateRangeLabel }}</span><span aria-hidden="true">▦</span>
        </button>
        <!-- show date calandar to pick date  -->
        <Teleport to="body">
        <div v-if="showDatePicker" ref="availabilityPicker" :style="pickerPosition" class="availability-picker shadow bg-white border rounded p-3" role="dialog" aria-label="Choose available date range">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <button type="button" class="btn btn-sm btn-outline-secondary" aria-label="Previous month" @click="changeCalendarMonth(-1)">‹</button>
                <strong>{{ calendarTitle }}</strong>
                <button type="button" class="btn btn-sm btn-outline-secondary" aria-label="Next month" @click="changeCalendarMonth(1)">›</button>
            </div>
            <div class="availability-calendar">
                <span v-for="weekday in ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']" :key="weekday" class="weekday">{{ weekday }}</span>
                <template v-for="(week, weekIndex) in calendarWeeks" :key="weekIndex">
                <span v-for="(date, dayIndex) in week" :key="date?.key || `blank-${weekIndex}-${dayIndex}`" class="day-cell"
                :class="{
                    'range-cell': isInSelectedRange(date?.key),
                    'range-start': date && draftFrom && draftTo && draftFrom !== draftTo && date.key === draftFrom,
                    'range-end': date && draftFrom && draftTo && draftFrom !== draftTo && date.key === draftTo
                }">
                    <button v-if="date" type="button" class="calendar-day" :class="{ endpoint: date.key === draftFrom || date.key === draftTo }" :disabled="date.key < todayKey" @click="pickAvailabilityDate(date.key)">{{ date.day }}</button>
                </span>
                </template>
            </div>
            <div class="d-flex justify-content-between align-items-center mt-3">
                <button type="button" class="btn btn-outline-secondary btn-sm" @click="clearAvailabilityDates">Clear days</button>
                <button type="button" class="btn btn-primary btn-sm apply-days" :disabled="!draftFrom || !draftTo" @click="confirmAvailabilityDates">Confirm dates</button>
            </div>
        </div>
        </Teleport>
    </div>
    
  </div>
</template>

<style scoped>
/* paste .availability-picker, .availability-calendar, .weekday, .day-cell*, .calendar-day* here */

.availability-picker {
  position: fixed;
  z-index: 1080;
  width: 300px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  font-family: Roboto, system-ui, -apple-system, sans-serif;
}

.availability-calendar {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  row-gap: 4px;
  text-align: center;
}

/* MO TU WE ... headers */
.weekday {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #3c3c3c;
  padding-bottom: 8px;
}

.day-cell {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Light orange range band; start/end rules must stay below range-cell. */
.day-cell.range-cell  { background: #fff0e3; }
.day-cell.range-start { background: linear-gradient(to right, transparent 50%, #fff0e3 50%); }
.day-cell.range-end   { background: linear-gradient(to right, #fff0e3 50%, transparent 50%); }

.calendar-day {
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  font-size: 15px;
  color: #333;
  cursor: pointer;
}
.calendar-day:hover:not(:disabled) { background: #fce2cf; }

/* past dates: grey + strikethrough */
.calendar-day:disabled {
  color: #c8c8c8;
  text-decoration: line-through;
  cursor: default;
}

/* Selected endpoints: solid light orange circles. */
.calendar-day.endpoint,
.calendar-day.endpoint:hover {
  background: #c46b17;
  color: white;
  font-weight: 700;
}

</style>
