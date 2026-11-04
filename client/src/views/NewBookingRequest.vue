<script setup>
import { ref, computed, onMounted } from 'vue'
import defaultAvatar from '../assets/img/tempProfile.jpg'
import { useRoute } from 'vue-router'
import { formatTime, formatBookingWhen, hoursVary } from '../utils/bookingHelpers.js'
import { currentUser } from '../services/auth.js'
import { sendNotification } from '../utils/sendNotification.js'
import { toDateString, prettyDate } from '../utils/bookingTimeHelpers.js'
import { checkBookingRequest, buildBookingPayload } from '../utils/bookingRequestRules.js'
import { SERVICE_PRICES, SERVICE_LABELS, PRICE_LIST_TEXT, priceForTasks, daysForTask } from '../utils/servicePrices.js'
import { bookingsApi } from '../services/bookingApi.js'
import { availabilityApi } from '../services/availabilityApi.js'
import { usersApi, petsApi } from '../services/api.js'
import BookingDatePicker from '../components/BookingDatePicker.vue'
import CareChecklistEditor from '../components/CareChecklistEditor.vue'
import BackButton from '../components/BackButton.vue'

const route = useRoute()
const sitterId = route.query.sitterId // from the URL: /bookings/new?sitterId=...
// dates and times from the owner's search, if they came from there (the date picker fills them in if they suit this sitter)
const fromQuery = (key) => (typeof route.query[key] === 'string' ? route.query[key] : '')
const searchedWhen = { startDate: fromQuery('startDate'), endDate: fromQuery('endDate'), startTime: fromQuery('startTime'), endTime: fromQuery('endTime') }

const sitter = ref(null) // { username, sitterProfile: { services, ratingAvg, ... } }
const pets = ref([]) // the logged-in owner's pets
const availability = ref({}) // { '2026-10-20': { status: 'available' | 'blocked', slots: [540, 570, ...] } }
const busy = ref([]) // times the sitter is already booked: [{ start, end }] as moments (milliseconds) e.g. busy = [  { start: 1792476000000,  end: 1792486800000 } ]

const loadError = ref('')

// What the owner fills in
const selectedPets = ref([]) // array of pet ids
// What the date picker says was chosen (it sends this to us):
// { startDate, startTime, endDate, endTime, dayTimes: [{ date, startTime, endTime }], clash }
const when = ref({ startDate: '', startTime: '', endDate: '', endTime: '', dayTimes: [], clash: false })
const tasks = ref([]) // the care tasks (the checklist editor sends us this list)
const notes = ref('')

const error = ref('')
const notificationError = ref('')
const sending = ref(false) // tracks wether the booking request is currently sent to the server 
const booking = ref(null) // the created booking, once sent

async function notifyBookingRequest() {
  if (!booking.value) return
  const sent = await sendNotification(
    booking.value._id,
    'booking-requested',
    `${currentUser.value?.username || 'The owner'} sent you a booking request for ${prettyDate(booking.value.startDate)}.`
  )
  notificationError.value = sent
    ? ''
    : 'Your booking request was created, but its notifications could not be saved. Try again.'
}

// returns an array of day dates from start to end, inclusive. Empty if the dates aren't filled in properly.
const chosenDays = computed(() => {
  if (!when.value.startDate || !when.value.endDate || when.value.endDate < when.value.startDate) return []
  const days = []
  const d = new Date(when.value.startDate + 'T00:00:00') // dateObj for start-date 
  const end = new Date(when.value.endDate + 'T00:00:00') // dateObj for end-date
  while (d <= end) {
    days.push(toDateString(d)) // convert the current date into a string and add it to days 
    d.setDate(d.getDate() + 1) // move d forward by one day by updating the initial d dateObj
  }
  return days
})

// Price preview: each task's fixed price × times a day × number of days, added up
// (same sum the server does, in utils/servicePrices.js)
const totalPrice = computed(() => priceForTasks(tasks.value, chosenDays.value.length))

// Chosen days the sitter hasn't marked as available
const unavailableDays = computed(() => chosenDays.value.filter((d) => availability.value[d]?.status !== 'available'))
// array of days within chosenDays array where availability != 'available'

// Safety net: did the date picker find that the chosen time runs into a time the sitter is booked?
const clash = computed(() => when.value.clash)

function togglePet(id) {
  if (selectedPets.value.includes(id)) selectedPets.value = selectedPets.value.filter((p) => p !== id) 
  //if pet id is alr in selectedPet arary, clicking the pet means yw to remove it, so .filter keeps only the pets != to that pet id 
  else selectedPets.value.push(id)
  // adds pet id to selectedPets array 
}

// The pets picked above, as full objects (so a task can show their names)
const selectedPetList = computed(() => pets.value.filter((p) => selectedPets.value.includes(p._id)))

// For the "Request sent" screen: the dates as "5 Nov 2026 – 6 Nov 2026 (2 days)" and the hours as one line
const sentDates = computed(() => {
  const n = chosenDays.value.length
  if (!n) return ''
  const range = n === 1 ? prettyDate(chosenDays.value[0]) : `${prettyDate(chosenDays.value[0])} – ${prettyDate(chosenDays.value[n - 1])}`
  return `${range} (${n} day${n === 1 ? '' : 's'})`
})
const sentTime = computed(() => {
  if (hoursVary(when.value)) return 'Hours vary by day'
  if (!when.value.startTime || !when.value.endTime) return ''
  return `${formatTime(when.value.startTime)} – ${formatTime(when.value.endTime)}${chosenDays.value.length > 1 ? ' each day' : ''}`
})

// The sitter's stars for the chip at the top, e.g. "4.8 (12 reviews)", or "New sitter" with no reviews yet
const ratingText = computed(() => {
  const count = sitter.value?.sitterProfile?.ratingCount || 0
  if (!count) return 'New sitter'
  return `${sitter.value.sitterProfile.ratingAvg.toFixed(1)} (${count} review${count === 1 ? '' : 's'})`
})

async function sendRequest() {
  error.value = ''
  notificationError.value = ''
  // Quick checks before calling the server (the server checks these again). The rules are in utils/bookingRequestRules.js
  const message = checkBookingRequest({
    selectedPets: selectedPets.value,
    when: when.value,
    chosenDays: chosenDays.value,
    tasks: tasks.value,
    clash: clash.value,
    unavailableDays: unavailableDays.value
  })
  if (message) return (error.value = message)

  sending.value = true
  try {
    booking.value = await bookingsApi.create(
      buildBookingPayload(sitterId, {
        selectedPets: selectedPets.value,
        when: when.value,
        tasks: tasks.value,
        notes: notes.value
      })
    )

    await notifyBookingRequest()
    
  } catch (err) {
    error.value = err.response?.data?.message || 'Could not send the booking request.'
  } finally {
    sending.value = false
  }
}

onMounted(async () => {
  if (!sitterId) return (loadError.value = 'No sitter selected. Pick a sitter from Search Sitters first.')
  try {
    const [s, p, a, b] = await Promise.all([
      usersApi.getById(sitterId), // sitter's public profile (name, services, rating)
      petsApi.getAll(), // my pets
      availabilityApi.getForSitter(sitterId), // sitter's available days
      availabilityApi.getBusy(sitterId) // times the sitter is already booked
    ])
    sitter.value = s
    pets.value = p
    a.forEach((day) => (availability.value[day.date] = { status: day.status, slots: day.slots }))
    busy.value = b.map((x) => ({ start: new Date(x.start).getTime(), end: new Date(x.end).getTime() })) 
    // uses .getTime() to convert timestamp_str into milliseconds since 1970 so that u can easily compare start-time and end-time 
  } catch (err) {
    loadError.value = err.response?.data?.message || 'Could not load this sitter.'
  }
})
</script>

<template>
  <div class="nbr">
  <BackButton label="Back"></BackButton>
  <!-- the title and intro only while filling in the form (not on the "Request sent" screen) -->
  <template v-if="!booking">
    <h1 class="nbr-title">Book a sitter</h1>
    <p class="nbr-sub">Choose your pets, the days and hours, and what the sitter should do.</p>
  </template>

  <div v-if="loadError" class="alert alert-danger">{{ loadError }}</div>

  <!-- After sending: confirmation -->
  <!-- a tick and "Request sent!", what was sent (sitter, status, dates, time, pets, tasks, total), what happens next, then the buttons -->
  <div v-else-if="booking" class="sent">
    <div class="sent-hero">
      <div class="sent-tick" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <h1 class="sent-title">Request sent!</h1>
      <p class="sent-sub">Your request has been sent to {{ sitter.username }}. You only pay after the booking is completed.</p>
    </div>

    <div v-if="notificationError" class="alert alert-warning" role="alert">
      {{ notificationError }}
      <button type="button" class="btn btn-sm btn-outline-dark ms-2" @click="notifyBookingRequest">Retry</button>
    </div>

    <!-- what was sent -->
    <section class="step-card">
      <div class="sent-sitter">
        <img class="avatar-sm rounded-circle" :src="sitter.profilePicture?.url || defaultAvatar" alt="">
        <div class="min-w-0 flex-grow-1">
          <div class="sitter-name">{{ sitter.username }}</div>
          <div class="small text-muted"><span class="star" aria-hidden="true">★</span> {{ ratingText }}</div>
        </div>
        <span class="status-pill">{{ booking.status === 'pending' ? 'Pending · waiting for sitter' : booking.status }}</span>
      </div>
      <hr class="my-3" />
      <div class="sent-grid">
        <div><div class="sent-label">Dates</div><div class="sent-value">{{ sentDates || formatBookingWhen(booking) }}</div></div>
        <div v-if="sentTime"><div class="sent-label">Time</div><div class="sent-value">{{ sentTime }}</div></div>
        <div><div class="sent-label">Pets</div><div class="sent-value">{{ selectedPetList.map((p) => `${p.name} (${p.species})`).join(', ') }}</div></div>
        <div><div class="sent-label">Care tasks</div><div class="sent-value">{{ tasks.map((t) => `${SERVICE_LABELS[t.category]} · ${t.dailyFrequency || 0} a day`).join(', ') }}</div></div>
      </div>
      <div class="sum-total"><span>Total</span><span>${{ booking.totalPrice }}</span></div>
    </section>

    <!-- what happens next -->
    <section class="step-card">
      <h2 class="step-head">What happens next</h2>
      <div class="next-step"><span class="step-num">1</span><span>Once confirmed, you can add more details to the care checklist.</span></div>
      <div class="next-step"><span class="step-num">2</span><span>You pay after the sitter has completed the booking.</span></div>
    </section>

    <div class="sent-actions">
      <router-link to="/owner/bookings" class="btn btn-brand fw-semibold px-4 py-2">View My Bookings</router-link>
      <router-link to="/home" class="btn btn-brand-outline fw-semibold px-4 py-2">Find another sitter</router-link>
    </div>
  </div>

  <!-- The form -->
  <!-- left: the numbered steps; right (big screens): the summary, which stays in view while scrolling. On phones: one column and a bar at the bottom with the Total and Send. -->
  <template v-else-if="sitter">
  <div class="row g-3 align-items-start">
    <div class="col-lg-8 col-xl-9 d-flex flex-column gap-3">
      <!-- Who you're booking: photo, name, stars and services (first in the left column, so it is as wide as the steps and level with the summary) -->
      <div class="sitter-chip">
        <img class="avatar rounded-circle" :src="sitter.profilePicture?.url || defaultAvatar" alt="">
        <div class="min-w-0">
          <div class="sitter-name">{{ sitter.username }}</div>
          <div class="small text-muted"><span class="star" aria-hidden="true">★</span> {{ ratingText }}</div>
          <div v-if="sitter.sitterProfile?.services?.length" class="d-flex flex-wrap gap-1 mt-1">
            <span v-for="service in sitter.sitterProfile.services" :key="service" class="service-tag">{{ service }}</span>
          </div>
        </div>
      </div>
      <!-- Step 1: Pets (tap a card to pick it, tap again to unpick) -->
      <section class="step-card">
        <h3 class="step-head"><span class="step-num">1</span>Which pets?</h3>
        <p v-if="pets.length === 0" class="small text-muted mb-0">You have no pets yet. Add one from your profile first.</p>
        <div class="pet-grid">
          <button
            v-for="pet in pets"
            :key="pet._id"
            type="button"
            class="pet-card"
            :aria-pressed="selectedPets.includes(pet._id)"
            @click="togglePet(pet._id)"
          >
            <img v-if="pet.photo?.url" :src="pet.photo.url" alt="" class="pet-pic">
            <span v-else class="pet-pic pet-pic--blank" aria-hidden="true">🐾</span>
            <span class="min-w-0 text-start">
              <span class="pet-name">{{ pet.name }}</span>
              <span class="pet-species">{{ pet.species }}</span>
            </span>
            <span class="pet-tick" aria-hidden="true">{{ selectedPets.includes(pet._id) ? '✓' : '' }}</span>
          </button>
        </div>
      </section>

      <!-- Steps 2 and 3: Days and Times (the calendar picker makes both cards) -->
      <BookingDatePicker :availability="availability" :busy="busy" :initial="searchedWhen" :day-step="2" :time-step="3" @change="when = $event" />
          <!--
          @change doesnt mean "run whenever sth in the child component changes" ; instead it means : 
          -> run whenever BookingDatePicker emits an event named change.”

          how it works : 

          watch(....) exists within the bookingDatePicker 

          when one of those values within watch(..) changes, watch callback runs, calls emit('change', choice)

          parent page(this page) recieves the emitted event, @change="when = $event" runs : 
          
            1. sends the parents availability,busy varirable into bookingDatePicker(child page) 
            2. within bookingdatepicker, it builds the object called change, and returns it to the parent, which the parent recieves as the when object 
          -->

      <section class="step-card nbr-checklist">
          <h3 class="step-head"><span class="step-num">4</span>Care checklist</h3>
          <!-- Care checklist -->
          <CareChecklistEditor :pets="selectedPetList" :dates="chosenDays" @change="tasks = $event" />
          <!--
          same concept as bookingDatePicker abv
          -->
      </section>

      <!-- Step 5: anything else the sitter should know (optional, sent with the request) -->
      <section class="step-card">
        <h3 class="step-head"><span class="step-num">5</span>Notes <span class="step-optional">(optional)</span></h3>
        <label class="visually-hidden" for="booking-notes">Notes for the sitter</label>
        <textarea id="booking-notes" v-model="notes" class="form-control" rows="3" maxlength="1000"
                  placeholder="e.g. Mochi is shy with strangers; the spare key is with the guard."></textarea>
      </section>
    </div>

    <!-- Price preview (beside the form on big screens, under it on phones, with the Send button) -->
    <div class="col-lg-4 col-xl-3 nbr-summary-col">
      <div class="step-card nbr-summary">
          <h3 class="step-head">Summary</h3>
          <!-- what was chosen so far -->
          <div class="sum-row"><span>Pets</span><span class="text-end">{{ selectedPetList.length ? selectedPetList.map((p) => p.name).join(', ') : '–' }}</span></div>
          <div class="sum-row">
            <span>Dates</span>
            <span class="text-end">{{ chosenDays.length ? (chosenDays.length === 1 ? prettyDate(chosenDays[0]) : `${prettyDate(chosenDays[0])} – ${prettyDate(chosenDays[chosenDays.length - 1])}`) : '–' }}</span>
          </div>
          <!-- One line per task, e.g. "Walk: $20 × 2 a day × 3 days = $120" -->
          <hr class="my-2" />
          <div v-for="(t, i) in tasks" :key="i" class="sum-row">
            <span>{{ SERVICE_LABELS[t.category] }}: ${{ SERVICE_PRICES[t.category] }} × {{ t.dailyFrequency || 0 }} a day × {{ daysForTask(t, chosenDays.length) }} day{{ daysForTask(t, chosenDays.length) === 1 ? '' : 's' }}</span>
            <span>${{ priceForTasks([t], chosenDays.length) }}</span>
          </div>
          <p v-if="tasks.length === 0" class="small text-muted mb-1">Add a care task above to see the price.</p>
          <div class="sum-row"><span>Days</span><span>{{ chosenDays.length || '–' }}</span></div>
          <!-- Hours: one line if every day is the same, otherwise one line per day -->
          <div v-if="when.startTime && when.endTime && !hoursVary(when)" class="sum-row">
            <span>Time</span><span>{{ formatTime(when.startTime) }} – {{ formatTime(when.endTime) }}{{ chosenDays.length > 1 ? ' each day' : '' }}</span>
          </div>
          <template v-else-if="hoursVary(when)">
            <div v-for="d in when.dayTimes" :key="d.date" class="sum-row">
              <span>{{ prettyDate(d.date) }}</span>
              <span>{{ d.startTime && d.endTime ? `${formatTime(d.startTime)} – ${formatTime(d.endTime)}` : '–' }}</span>
            </div>
          </template>
          <div class="sum-total"><span>Total</span><span>${{ totalPrice }}</span></div>
          <p class="sum-note">Same fixed prices for every sitter, per time a task is done: {{ PRICE_LIST_TEXT }}. You pay after the sitter has completed the booking.</p>
          <div v-if="clash" class="alert alert-danger small py-2 mt-3 mb-0">
            The sitter is already booked during this time. Please choose different times.
          </div>
          <div v-if="unavailableDays.length" class="alert alert-warning small py-2 mt-3 mb-0">
            Not available on {{ unavailableDays.map(prettyDate).join(', ') }}
          </div>

          <div v-if="error" class="alert alert-danger small py-2 mt-3 mb-0">{{ error }}</div>
          <!-- on phones the Send button is in the bar at the bottom instead -->
          <button class="btn btn-brand w-100 py-2 fw-semibold mt-3 d-none d-lg-block" :disabled="sending || clash" @click="sendRequest">
            {{ sending ? 'Sending…' : 'Send Booking Request' }}
          </button>
      </div>
    </div>
  </div>

  <!-- Phones: stays at the bottom of the screen while scrolling -->
  <div class="nbr-bar d-lg-none">
    <p v-if="error" class="bar-error" role="alert">{{ error }}</p>
    <div>
      <div class="small text-muted">Total</div>
      <div class="bar-total">${{ totalPrice }}</div>
    </div>
    <button class="btn btn-brand fw-semibold px-4" :disabled="sending || clash" @click="sendRequest">
      {{ sending ? 'Sending…' : 'Send request' }}
    </button>
  </div>
  </template>
  </div>
</template>

<style scoped>
/* the Days calendar stops at 640px (centred in its card), so the day buttons don't stretch on a wide screen */
.nbr :deep(.rgrid) {
  max-width: 640px;
  margin-inline: auto;
}
.nbr-title { font-size: 1.6rem; font-weight: 800; margin: 0.25rem 0 0.15rem; }
.nbr-sub { color: #6b5f56; margin-bottom: 1.25rem; }
/* the step cards (.step-card, .step-head, .step-num) are in assets/main.css, because the date picker uses them too */

/* the checklist's own "Care Checklist" heading is hidden: the step card already says it */
.nbr-checklist > :deep(h3.text-uppercase) { display: none; }

/* sitter chip under the title: same rounded corners, border and shadow as the step cards (e.g. "Which pets?") */
.sitter-chip {
  display: flex; /* full width of the steps column */
  align-items: center;
  gap: 0.85rem;
  padding: 0.75rem 1.25rem 0.75rem 0.75rem;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 4px 14px rgba(120, 70, 40, 0.06);
}
.avatar {
  width: 52px; 
  height: 52px; 
  object-fit: cover; 
  flex: none;
  border: 2px solid var(--tint);
}
.min-w-0 { min-width: 0; }
.sitter-name { font-size: 1.05rem; font-weight: 800; line-height: 1.2; }
.star { color: var(--accent-deep); }
.service-tag { padding: 0.1rem 0.55rem; border-radius: 999px; background: var(--tint-soft); color: var(--accent); font-size: 0.78rem; font-weight: 600; }

/* pets: one card each, tap to pick, picked = app-colour border and a filled tick */
.pet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 0.6rem; }
.pet-card {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.6rem 0.7rem;
  border: 1.5px solid var(--line);
  border-radius: 14px;
  background: #fff;
  color: #2b2420;
}
.pet-card:hover { border-color: var(--accent-main); }
.pet-card[aria-pressed='true'] { border-color: var(--accent); background: var(--tint-soft); }
.pet-pic { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex: none; }
.pet-pic--blank { display: grid; place-items: center; background: var(--tint-soft); font-size: 1.1rem; }
.pet-name { display: block; font-weight: 800; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pet-species { display: block; font-size: 0.8rem; color: #6b5f56; text-transform: capitalize; }
.pet-tick {
  margin-left: auto;
  width: 22px;
  height: 22px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  font-size: 0.75rem;
  font-weight: 800;
}
.pet-card[aria-pressed='true'] .pet-tick { background: var(--accent); border-color: var(--accent); color: #fff; }

/* the Summary heading has no number circle, so give it the circle's height to line up with the step headings */
.nbr-summary .step-head { min-height: 28px; }

/* summary: stays in view beside the form on big screens */
@media (min-width: 992px) {
  .nbr-summary { position: sticky; top: calc(7vh + 1rem); }
  /* the column runs the full height of the steps, so the sticky card has room to stay in view all the way down to Notes;
     a long summary scrolls inside the card so the Send button can always be reached */
  .nbr-summary-col { align-self: stretch; }
  .nbr-summary { max-height: calc(100vh - 7vh - 2rem); overflow-y: auto; }
}
.sum-row { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.9rem; padding: 0.15rem 0; }
.sum-row > span:first-child { color: #6b5f56; }
.sum-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--line);
  font-weight: 800;
  font-size: 1.05rem;
}
.sum-total span:last-child { font-size: 1.5rem; color: #2e7d32; } /* the total in green */
.sum-note { font-size: 0.78rem; color: #6b5f56; margin: 0.5rem 0 0; }

/* phones: Total + Send stay at the bottom of the screen */
.nbr-bar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin: 1rem calc(-1.25rem - 0.75rem) calc(-2.5rem - 1.5rem); /* full width: past this page's padding and the app's container-fluid padding (0.75rem sides, 1.5rem bottom) */
  padding: 0.7rem 1.25rem calc(0.7rem + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid var(--line);
  box-shadow: 0 -4px 14px rgba(120, 70, 40, 0.08);
}
.bar-total { font-size: 1.35rem; font-weight: 800; color: #2e7d32; line-height: 1.1; }
.bar-error { flex-basis: 100%; margin: 0; font-size: 0.82rem; color: #b02a37; }

/* "Request sent" screen */
.sent { max-width: 760px; margin: 1rem auto 0; display: flex; flex-direction: column; gap: 1.25rem; }
.sent-hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.6rem; }
.sent-tick { width: 64px; height: 64px; border-radius: 50%; background: #e7f3e8; display: grid; place-items: center; }
.sent-tick svg { width: 32px; height: 32px; fill: none; stroke: #2e7d32; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.sent-title { font-size: 1.75rem; font-weight: 700; margin: 0; }
.sent-sub { color: #6b5f56; margin: 0; max-width: 520px; }
.sent-sitter { display: flex; align-items: center; gap: 0.85rem; flex-wrap: wrap; }
.avatar-sm { width: 52px; height: 52px; object-fit: cover; flex: none; border: 2px solid var(--tint); }
.status-pill { background: #fdf0cf; color: #7a5600; font-weight: 700; font-size: 0.82rem; padding: 0.25rem 0.75rem; border-radius: 999px; }
.sent-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.9rem 1.5rem; }
.sent-label { font-size: 0.75rem; font-weight: 700; color: #6b5f56; text-transform: uppercase; letter-spacing: 0.05em; }
.sent-value { font-weight: 700; }
.next-step { display: flex; gap: 0.75rem; align-items: center; padding: 0.2rem 0; }
.sent-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.75rem; }
/* phones: one column of details, full-width buttons */
@media (max-width: 575.98px) {
  .sent-grid { grid-template-columns: minmax(0, 1fr); }
  .sent-actions .btn { width: 100%; }
}
</style>
