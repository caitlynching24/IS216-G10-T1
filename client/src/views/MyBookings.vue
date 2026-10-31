<script setup>
// /owner/bookings: every booking request the owner has sent, 1 row = 1 booking,
// sorted into tabs by status. Each booking is with one sitter (no trips/groups).
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { bookingsApi } from '../services/bookingApi.js'
import { sendNotification } from '../utils/sendNotification.js'
import { currentUser, fetchUser } from '../services/auth.js'
import BookingTable from '../components/BookingTable.vue'
import BookingTabs from '../components/BookingTabs.vue'

const TABS = [
  { key: 'pending', label: 'Pending', statuses: ['pending'] },
  { key: 'to-confirm', label: 'To confirm', statuses: ['accepted'] }, // the sitter said yes; the owner picks which to keep
  { key: 'upcoming', label: 'Upcoming', statuses: ['confirmed', 'in-progress'] },
  { key: 'to-pay', label: 'To pay', statuses: ['completed'] },
  { key: 'past', label: 'Past', statuses: ['paid', 'declined', 'cancelled', 'expired'] }
]

const route = useRoute()
const router = useRouter()

const bookings = ref([])
const loading = ref(true)
const error = ref('')
const message = ref('') // e.g. "Booking cancelled."
const actionError = ref('') // why cancelling failed (the list stays visible)
const busyId = ref(null)
const activeTab = ref(TABS.some((t) => t.key === route.query.tab) ? route.query.tab : 'pending')

function bookingsFor(tabKey) {
  const tab = TABS.find((t) => t.key === tabKey)
  const list = bookings.value.filter((b) => tab.statuses.includes(b.status))
  return tabKey === 'past' ? [...list].reverse() : list
}

const visibleBookings = computed(() => bookingsFor(activeTab.value))

// the tab list with each tab's count, handed to BookingTabs
const tabsWithCounts = computed(() => TABS.map((t) => ({ key: t.key, label: t.label, count: bookingsFor(t.key).length })))

function selectTab(key) {
  activeTab.value = key
  router.replace({ query: { tab: key } })
}

async function loadBookings() {
  loading.value = true
  error.value = ''
  try {
    if (!currentUser.value) await fetchUser()
    if (!currentUser.value) {
      error.value = 'Please log in first.'
      return
    }
    if (currentUser.value.role !== 'owner') {
      error.value = 'This page is for pet owners.'
      return
    }
    bookings.value = await bookingsApi.getMine()
  } catch (err) {
    error.value = err.response?.data?.message || 'Could not load your bookings.'
  } finally {
    loading.value = false
  }
}

// The owner confirms a booking the sitter accepted. Only then is it final for both of them.
async function confirmBooking(id) {
  busyId.value = id
  message.value = ''
  actionError.value = ''
  // prev confirmation status of confirmed booking 
  try {
    const updated = await bookingsApi.confirm(id)
    bookings.value.find((b) => b._id === id).status = updated.status
    sendNotification(id, 'booking-confirmed', `${currentUser.value.username} confirmed your booking.`)
    message.value = 'Booking confirmed ✅ You can find it under Upcoming.'
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not confirm the booking.'
  } finally {
    busyId.value = null
  }
}

async function cancelBooking(id) {
  const booking = bookings.value.find((b) => b._id === id)
  const wasConfirmed = booking.status === 'confirmed'
  const question = booking.status === 'confirmed'
    ? 'Cancel this booking? The sitter will see it as cancelled. This cannot be undone.'
    : 'Withdraw this request? The sitter will see that you withdrew it. This cannot be undone.'
  if (!window.confirm(question)) return
  busyId.value = id
  message.value = ''
  actionError.value = ''
  try {
    const updated = await bookingsApi.cancel(id)
    booking.status = updated.status
    booking.cancelledBy = updated.cancelledBy
    sendNotification(
      id,
      'booking-cancelled',
      wasConfirmed
        ? `${currentUser.value.username} cancelled your booking.`
        : `${currentUser.value.username} withdrew their booking request.`
    )
    message.value = 'Done. You can find it under Past.'
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not cancel the booking.'
  } finally {
    busyId.value = null
  }
}

//window.confirm -> built-in browser popup with two buttons: OK and Cancel.
// if user clicks ok, returns true , so if block runs ; 
// if user clicks cancel, returns false , if block doesnt run 
// bookingsApi runs axios.patch to remove the booking via its id 

onMounted(loadBookings)
</script>

<template>
  <div class="ob">
    <h2 class="mb-4">My Bookings</h2>

    <div v-if="error" class="alert alert-warning">{{ error }}</div>
    <div v-else-if="loading" class="text-muted">Loading your bookings…</div>

    <template v-else>
      <div v-if="message" class="alert alert-success">{{ message }}</div>
      <div v-if="actionError" class="alert alert-warning">{{ actionError }}</div>

      <BookingTabs :tabs="tabsWithCounts" :active-tab="activeTab" @select="selectTab" />

      <div v-if="!visibleBookings.length" class="text-center text-muted py-5">
        <p class="mb-3">No bookings here yet 🐾</p>
        <router-link to="/home" class="btn btn-brand">Find a sitter</router-link>
      </div>

      <p v-if="activeTab === 'to-confirm' && visibleBookings.length" class="small text-muted">
        These sitters said yes. Confirm the bookings you want; the others stay here until you withdraw them,
        the sitter declines, or the start time passes.
      </p>
      <BookingTable v-if="visibleBookings.length" :bookings="visibleBookings" viewer="owner" :busy-id="busyId" @confirm="confirmBooking" @cancel="cancelBooking" />
      <!-- cancelBooking runs with the childs payload thats passed up  -->
    </template>
  </div>
</template>