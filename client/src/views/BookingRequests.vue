<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { bookingsApi } from '../services/bookingApi.js'
import BookingTable from '../components/BookingTable.vue'
import BookingTabs from '../components/BookingTabs.vue'

// /sitter/requests: every booking made with this sitter, sorted into
// To accept / Awaiting confirmation / Upcoming / Awaiting payment / Past tabs (like the tabs on the owner's My Bookings)
const TABS = [
  { key: 'pending', label: 'To accept', statuses: ['pending'] }, // new requests the sitter hasn't answered
  { key: 'awaiting-confirmation', label: 'Awaiting confirmation', statuses: ['accepted'] }, // accepted, waiting for the owner to confirm
  { key: 'upcoming', label: 'Upcoming', statuses: ['confirmed', 'in-progress'] },
  { key: 'awaiting-payment', label: 'Awaiting payment', statuses: ['completed'] }, // done, the owner hasn't paid yet
  { key: 'past', label: 'Past', statuses: ['paid', 'declined', 'cancelled', 'expired'] }
]

const route = useRoute()
const router = useRouter()

const bookings = ref([])
const loading = ref(true)
const error = ref('')
const message = ref('')
const actionError = ref('') // why accepting / declining a request failed (the lists stay visible)
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

async function loadRequests() {
  loading.value = true
  error.value = ''
  try {
    bookings.value = await bookingsApi.getMine()
  } catch (err) {
    error.value = err.response?.data?.message || 'Could not load booking requests.'
  } finally {
    loading.value = false
  }
}

async function respond(id, status) {
  const booking = bookings.value.find((b) => b._id === id)
  // declining a request you already accepted: check first
  if (status === 'declined' && booking.status === 'accepted' &&
      !window.confirm('Decline this request? You accepted it, but the owner has not confirmed yet. This cannot be undone.')) return
  busyId.value = id
  error.value = ''
  actionError.value = ''
  message.value = ''
  try {
    const updated = await bookingsApi.updateStatus(id, status)
    booking.status = updated.status
    message.value = status === 'accepted'
      ? 'Request accepted ✅ The hours are held for you while the owner confirms. It goes into your Google Calendar once confirmed.'
      : 'Request declined.'
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not update the booking.'
  } finally {
    busyId.value = null
  }
}

// A sitter can cancel a booking the owner has confirmed (shown under Upcoming)
async function cancelBooking(id) {
  if (!window.confirm('Cancel this booking? The owner will see it as cancelled and can book another sitter. This cannot be undone.')) return
  busyId.value = id
  error.value = ''
  actionError.value = ''
  message.value = ''
  try {
    const updated = await bookingsApi.cancel(id)
    const booking = bookings.value.find((b) => b._id === id)
    booking.status = updated.status
    booking.cancelledBy = updated.cancelledBy
    message.value = 'Booking cancelled. The hours are free on your calendar again.'
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not cancel the booking.'
  } finally {
    busyId.value = null
  }
}

onMounted(loadRequests)
</script>

<template>
  <div class="br">
    <h2 class="mb-4">Booking Requests</h2>

    <div v-if="error" class="alert alert-warning">{{ error }}</div>
    <div v-if="message" class="alert alert-success">{{ message }}</div>
    <div v-if="actionError" class="alert alert-warning">{{ actionError }}</div>

    <div v-if="loading" class="text-muted">Loading requests…</div>

    <template v-else-if="!error">
      <BookingTabs :tabs="tabsWithCounts" :active-tab="activeTab" @select="selectTab" />

      <p v-if="!visibleBookings.length" class="text-center text-muted py-5">
        {{ activeTab === 'pending' ? 'No new requests right now 🐾' : 'Nothing here yet.' }}
      </p>
      <BookingTable
        v-else
        :bookings="visibleBookings"
        viewer="sitter"
        :busy-id="busyId"
        @accept="respond($event, 'accepted')"
        @decline="respond($event, 'declined')"
        @cancel="cancelBooking"
      />
    </template>
  </div>
</template>