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
import CancelBookingModal from '../components/CancelBookingModal.vue'
import MessageBar from '../components/MessageBar.vue'
import { confirmDialog } from '../utils/useConfirm.js'

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
  const booking = bookings.value.find((b) => b._id === id)
  const ok = await confirmDialog({
    title: 'Confirm this booking?',
    message: `This locks in ${booking?.sitterId?.username || 'the sitter'} for these dates. You can still cancel later, but the sitter will be notified.`,
    confirmText: 'Confirm booking'
  })
  if (!ok) {
    return
  }
  busyId.value = id
  message.value = ''
  actionError.value = ''
  // prev confirmation status of confirmed booking 
  try {
    const updated = await bookingsApi.confirm(id)
    bookings.value.find((b) => b._id === id).status = updated.status
    sendNotification(id, 'booking-confirmed', `${currentUser.value.username} confirmed your booking.`)
    // straight on to the booking's page, with the care details form open
    router.push({ name: 'booking-detail', params: { id }, query: { details: 'open', confirmed: '1' } })
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not confirm the booking.'
  } finally {
    busyId.value = null
  }
}

// Cancelling asks for a reason first, in a small window (CancelBookingModal)
const cancelling = ref(null) // the booking the reason window is open for (null = closed)
const cancelError = ref('') // why cancelling failed, shown inside the window
const cancelQuestion = computed(() => cancelling.value?.status === 'confirmed'
  ? { title: 'Cancel this booking?', text: 'The sitter will see it as cancelled, along with your reason. This cannot be undone.', button: 'Cancel booking' }
  : { title: 'Withdraw this request?', text: 'The sitter will see that you withdrew it, along with your reason. This cannot be undone.', button: 'Withdraw request' }
)

function cancelBooking(id) {
  cancelError.value = ''
  cancelling.value = bookings.value.find((b) => b._id === id)
}

// runs when the window sends the reason
async function sendCancel(reason) {
  const booking = cancelling.value
  const id = booking._id
  const wasConfirmed = booking.status === 'confirmed'
  busyId.value = id
  message.value = ''
  actionError.value = ''
  cancelError.value = ''
  try {
    const updated = await bookingsApi.cancel(id, reason)
    booking.status = updated.status
    booking.cancelledBy = updated.cancelledBy
    booking.cancelReason = updated.cancelReason
    sendNotification(
      id,
      'booking-cancelled',
      wasConfirmed
        ? `${currentUser.value.username} cancelled your booking. Reason: ${reason}`
        : `${currentUser.value.username} withdrew their booking request. Reason: ${reason}`
    )
    cancelling.value = null
    message.value = 'Done. You can find it under Past.'
  } catch (err) {
    cancelError.value = err.response?.data?.message || 'Could not cancel the booking.'
  } finally {
    busyId.value = null
  }
}

// bookingsApi runs axios.patch to remove the booking via its id 

onMounted(loadBookings)
</script>

<template>
  <div class="ob">
    <!-- title, with the "+ Book a sitter" button always on the right -->
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-4">
      <h2 class="mb-0">My Bookings</h2>
      <router-link to="/home" class="btn btn-brand fw-semibold">+ Book a sitter</router-link>
    </div>

    <MessageBar v-if="error" type="error" @close="error = ''">{{ error }}</MessageBar>
    <div v-else-if="loading" class="d-flex align-items-center text-muted">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Loading your bookings...
    </div>

    <template v-else>
      <MessageBar v-if="message" @close="message = ''">{{ message }}</MessageBar>
      <MessageBar v-if="actionError" type="error" @close="actionError = ''">{{ actionError }}</MessageBar>

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

    <!-- asks for the reason before cancelling -->
    <CancelBookingModal
      v-if="cancelling"
      :title="cancelQuestion.title"
      :text="cancelQuestion.text"
      :confirm-label="cancelQuestion.button"
      :busy="busyId === cancelling._id"
      :error="cancelError"
      @confirm="sendCancel"
      @close="cancelling = null"
    />
  </div>
</template>