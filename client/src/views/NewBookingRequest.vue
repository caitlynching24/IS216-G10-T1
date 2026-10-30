<script setup>
import { ref, computed, onMounted } from 'vue'
import defaultAvatar from '../assets/img/tempProfile.jpg'
import { useRoute } from 'vue-router'
import { formatTime } from '../utils/bookingHelpers.js'
import { currentUser } from '../services/auth.js'
import { sendNotification } from '../utils/sendNotification.js'
import { toDateString, prettyDate } from '../utils/bookingTimeHelpers.js'
import { checkBookingRequest, buildBookingPayload } from '../utils/bookingRequestRules.js'
import { SERVICE_PRICES, SERVICE_LABELS, PRICE_LIST_TEXT, OVERNIGHT_FEE, priceForTasks, nightsFor, bookingPrice } from '../utils/servicePrices.js'
import { bookingsApi } from '../services/bookingApi.js'
import { availabilityApi } from '../services/availabilityApi.js'
import { usersApi, petsApi } from '../services/api.js'
import BookingDatePicker from '../components/BookingDatePicker.vue'
import CareChecklistEditor from '../components/CareChecklistEditor.vue'

const route = useRoute()
const sitterId = route.query.sitterId // from the URL: /bookings/new?sitterId=...

const sitter = ref(null) // { username, sitterProfile: { petsittingRates, ... } }
const pets = ref([]) // the logged-in owner's pets
const availability = ref({}) // { '2026-10-20': { status: 'available' | 'blocked', slots: [540, 570, ...] } }
const busy = ref([]) // times the sitter is already booked: [{ start, end }] as moments (milliseconds) e.g. busy = [  { start: 1792476000000,  end: 1792486800000 } ]

const loadError = ref('')

// What the owner fills in
const selectedPets = ref([]) // array of pet ids
// What the date picker says was chosen (it sends this to us): { startDate, startTime, endDate, endTime, clash }
const when = ref({ startDate: '', startTime: '', endDate: '', endTime: '', clash: false })
const tasks = ref([]) // the care tasks (the checklist editor sends us this list)
const notes = ref('')
const overnight = ref(false) // true = the sitter stays the night at the owner's place

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
const nights = computed(() => nightsFor(chosenDays.value.length, overnight.value)) // e.g. 3 days → 2 nights
const totalPrice = computed(() => bookingPrice(tasks.value, chosenDays.value.length, overnight.value))

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

async function sendRequest() {
  error.value = ''
  notificationError.value = ''
  // Quick checks before calling the server (the server checks these again). The rules are in utils/bookingRequestRules.js
  const message = checkBookingRequest({
    selectedPets: selectedPets.value,
    when: when.value,
    tasks: tasks.value,
    clash: clash.value,
    unavailableDays: unavailableDays.value,
    overnight: overnight.value
  })
  if (message) return (error.value = message)

  sending.value = true
  try {
    booking.value = await bookingsApi.create(
      buildBookingPayload(sitterId, {
        selectedPets: selectedPets.value,
        when: when.value,
        tasks: tasks.value,
        notes: notes.value,
        overnight: overnight.value
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
      usersApi.getById(sitterId), // sitter's public profile (name, rate)
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
  <h1 class="h3 fw-bold mb-3">New Booking Request</h1>

  <div v-if="loadError" class="alert alert-danger">{{ loadError }}</div>

  <!-- After sending: confirmation -->
  <div v-else-if="booking" class="card shadow-sm">
    <div class="card-body text-center py-5">
      <div class="fs-1">🐾</div>
      <h2 class="h5">Request sent to {{ sitter.username }}</h2>
      <p class="text-muted mb-1">
        {{ prettyDate(booking.startDate) }}, {{ formatTime(booking.startTime) }} – {{ prettyDate(booking.endDate) }}, {{ formatTime(booking.endTime) }} · ${{ booking.totalPrice }}
      </p>
      <p class="small">Status: <span class="badge text-bg-warning">{{ booking.status }}</span></p>
      <p v-if="booking.tasks" class="small text-muted">{{ booking.tasks }} care task{{ booking.tasks === 1 ? '' : 's' }} included</p>
      <div v-if="notificationError" class="alert alert-warning mx-auto" role="alert">
        {{ notificationError }}
        <button type="button" class="btn btn-sm btn-outline-dark ms-2" @click="notifyBookingRequest">Retry</button>
      </div>
      <router-link to="/owner/bookings" class="btn btn-dark mt-2">View My Bookings</router-link>
    </div>
  </div>

  <!-- The form -->
  <div v-else-if="sitter" class="row g-3">
    <div class="col-12">
      <div class="card shadow-sm">
        <div class="card-body">
          <!-- Sitter -->
          <div class="d-flex align-items-center gap-3 mb-4">
            <img class="avatar rounded-circle img-fluid" :src="sitter.profilePicture?.url || defaultAvatar">
            <div>
              <div class="fw-semibold">{{ sitter.username }}</div>
                            <div v-if="sitter.sitterProfile?.services?.length" class="small text-muted">{{ sitter.sitterProfile.services.join(' · ') }}</div>
            </div>
          </div>

          <!-- Pets -->
          <h3 class="h6 text-uppercase text-muted fw-bold">Select Pet</h3>
          <p v-if="pets.length === 0" class="small text-muted">You have no pets yet. Add one from your profile first.</p>
          <div class="d-flex flex-wrap gap-2 mb-4">
            <button
              v-for="pet in pets"
              :key="pet._id"
              type="button"
              class="btn btn-sm rounded-pill px-3"
              :class="selectedPets.includes(pet._id) ? 'btn-dark' : 'btn-outline-secondary'"
              @click="togglePet(pet._id)"
            >
              {{ pet.name }}
            </button>
          </div>

          <!-- Dates and times (the calendar picker) -->
          <div class="mb-3">
            <BookingDatePicker :availability="availability" :busy="busy" @change="when = $event" />
          </div>
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

          <p v-if="chosenDays.length" class="small mb-4">
            {{ chosenDays.length }} day{{ chosenDays.length === 1 ? '' : 's' }} booked
          </p>

          <!-- Overnight stay -->
          <div class="form-check mb-4">
            <input id="overnight" v-model="overnight" class="form-check-input" type="checkbox" />
            <label class="form-check-label" for="overnight">
              🌙 The sitter stays overnight at my place (+${{ OVERNIGHT_FEE }} a night)
            </label>
            <div class="form-text">For bookings that end on a later day, e.g. Fri to Sun = 2 nights.</div>
          </div>

          <!-- Notes -->
          <h3 class="h6 text-uppercase text-muted fw-bold">Notes to Sitter</h3>
          <textarea v-model="notes" class="form-control" rows="4" placeholder="Feeding times, medication, walking routine…"></textarea>

          <!-- Care checklist -->
          <CareChecklistEditor :pets="selectedPetList" @change="tasks = $event" />
          <!-- 
          same concept as bookingDatePicker abv 
          -->
        </div>
      </div>
    </div>

    <!-- Price preview (full width, just above the Send button) -->
    <div class="col-12">
      <div class="card shadow-sm">
        <div class="card-body">
          <h3 class="h6 text-uppercase text-muted fw-bold mb-3">Price Preview</h3>
          <!-- One line per task, e.g. "Walk: $20 × 2 a day × 3 days = $120" -->
          <div v-for="(t, i) in tasks" :key="i" class="d-flex justify-content-between small">
            <span>{{ SERVICE_LABELS[t.category] }}: ${{ SERVICE_PRICES[t.category] }} × {{ t.dailyFrequency || 0 }} a day × {{ chosenDays.length }} day{{ chosenDays.length === 1 ? '' : 's' }}</span>
            <span>${{ priceForTasks([t], chosenDays.length) }}</span>
          </div>
          <p v-if="tasks.length === 0" class="small text-muted mb-1">Add a care task below to see the price.</p>
            <div v-if="nights" class="d-flex justify-content-between small">
            <span>🌙 Overnight: ${{ OVERNIGHT_FEE }} × {{ nights }} night{{ nights === 1 ? '' : 's' }}</span>
            <span>${{ OVERNIGHT_FEE * nights }}</span>
          </div>
          <div class="d-flex justify-content-between small"><span>Days</span><span>{{ chosenDays.length || '–' }}</span></div>
          <div v-if="when.startTime && when.endTime" class="d-flex justify-content-between small">
            <span>Time</span><span>{{ formatTime(when.startTime) }} – {{ formatTime(when.endTime) }}</span>
          </div>
          <hr />
          <div class="d-flex justify-content-between fw-bold"><span>Total</span><span>${{ totalPrice }}</span></div>
          <p class="small text-muted mt-2 mb-0">Same fixed prices for every sitter, per time a task is done: {{ PRICE_LIST_TEXT }}. Overnight stay: ${{ OVERNIGHT_FEE }} a night. You pay after the sitter has completed the booking.</p>
          <div v-if="clash" class="alert alert-danger small py-2 mt-3 mb-0">
            The sitter is already booked during this time. Please choose different times.
          </div>
          <div v-if="unavailableDays.length" class="alert alert-warning small py-2 mt-3 mb-0">
            Not available on {{ unavailableDays.map(prettyDate).join(', ') }}
          </div>
        </div>
      </div>
    </div>

    <div class="col-12">
      <div v-if="error" class="alert alert-danger py-2">{{ error }}</div>
      <button class="btn btn-dark w-100 py-2 fw-semibold" :disabled="sending || clash" @click="sendRequest">
        {{ sending ? 'Sending…' : 'Send Booking Request' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.avatar {
  width: 50px; 
  height: 50px; 
  object-fit: cover; 
  border:1px solid grey
}
</style>
