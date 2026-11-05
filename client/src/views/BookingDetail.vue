<script setup>
// /bookings/:id: one booking, for the owner or the sitter on it.
// Shows the pets (tap a pet to see its care checklist, look only, nothing can be ticked), the owner's notes,
// and a card for the person on the other side, with the buttons to accept / decline / cancel.
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { bookingsApi } from '../services/bookingApi.js'
import { currentUser, fetchUser } from '../services/auth.js'
import StatusPill from '../components/StatusPill.vue'
import ShowStarRating from '../components/ShowStarRating.vue'
import WalkMap from '../components/WalkMap.vue'
import CancelBookingModal from '../components/CancelBookingModal.vue'
import CareDetailsForm from '../components/CareDetailsForm.vue'
import CareDetailsSummary from '../components/CareDetailsSummary.vue'
import { formatPrice, formatBookingWhen, hoursVary, dayTimesList } from '../utils/bookingHelpers.js'
import { reviewsApi, visitsApi } from '../services/api.js'
import ReportRows from '../components/ReportRows.vue'
import VisitReportModal from '../components/VisitReportModal.vue'
import ReviewForm from '../components/ReviewForm.vue'
import { shortDate } from '../utils/visitReport.js'
import SessionChat from '../components/SessionChat.vue'
import { messageApi } from '../services/messageApi.js'
import { prettyDate } from '../utils/bookingTimeHelpers.js'
import { confirmDialog } from '../utils/useConfirm.js'
import { sendNotification } from '../utils/sendNotification.js'
import BackButton from '../components/BackButton.vue'

const route = useRoute()
const router = useRouter()
const booking = ref(null)
const tasks = ref([]) // the care tasks the owner added: [{ title, dailyFrequency, petIds, ... }]
const selectedPetId = ref(null) // the pet whose checklist is shown
const loading = ref(true)
const error = ref('')
const actionError = ref('') // why accepting / declining / cancelling failed (the page stays visible)
const message = ref('')
const busy = ref(false)

const isSitter = computed(() => currentUser.value?.role === 'sitter')

// the person on the other side of the booking
const person = computed(() => (isSitter.value ? booking.value.ownerId : booking.value.sitterId))
const personName = computed(() => person.value?.username || 'Unknown')
const personPicture = computed(() => person.value?.profilePicture?.url || '')
// Only sitters have ratings so far, so the stars are shown when the owner is looking at the sitter's card
const ratingAvg = computed(() => person.value?.sitterProfile?.ratingAvg || 0)
const ratingCount = computed(() => person.value?.sitterProfile?.ratingCount || 0)

const pets = computed(() => (booking.value.petIds || []).filter(Boolean))
const selectedPet = computed(() => pets.value.find((p) => p._id === selectedPetId.value))

// The checklist for the chosen pet. A task the owner set for both pets is in both lists.
// (Tasks saved without any pets are shown for every pet.)
const visibleTasks = computed(() =>
  tasks.value.filter((t) => !t.petIds?.length || t.petIds.map(String).includes(String(selectedPetId.value)))
)
// "Also for shrek": the other pets a task is for
function alsoFor(task) {
  return pets.value
    .filter((p) => p._id !== selectedPetId.value && task.petIds?.map(String).includes(String(p._id)))
    .map((p) => p.name)
}
function petKind(pet) {
  return [pet.species, pet.breed].filter(Boolean).join(' · ')
}

// Walk tasks: the route the owner chose (the sitter only gets the map once the booking is confirmed)
function routeText(task) {
  const r = task.walkRoute
  if (!r || r.mode === 'instructions') return 'No set route: the sitter follows the instructions'
  const km = r.distanceM >= 1000 ? `${(r.distanceM / 1000).toFixed(1)} km` : `${r.distanceM} m`
  return `Route: ${r.name} · ${km}${r.hidden ? ' (map shown once the owner confirms)' : ''}`
}
const openRouteKey = ref(null) // which task's route map is open (one at a time)
const routeKey = (task) => task._id || task.title

const status = computed(() => booking.value?.status)
// Which buttons to show:
// sitter: Accept / Decline a pending request, Decline an accepted one (waiting for the owner), Cancel a confirmed one
// owner:  Withdraw a pending request, Confirm / Withdraw an accepted one, Cancel a confirmed one
const canRespond = computed(() => isSitter.value && status.value === 'pending')
const canDeclineAccepted = computed(() => isSitter.value && status.value === 'accepted')
const canConfirm = computed(() => !isSitter.value && status.value === 'accepted')
const canCancel = computed(() =>
  isSitter.value ? status.value === 'confirmed' : ['pending', 'accepted', 'confirmed'].includes(status.value)
)
const cancelText = computed(() => (status.value === 'confirmed' ? 'Cancel booking' : 'Withdraw request'))

// Care details: the owner adds them once the booking is confirmed. A booking becomes in-progress
// when the first session starts, so they lock from then on (the server checks this too).
const detailsSavedAt = ref(null) // null = not saved yet, so the card keeps asking for them
const detailsFormOpen = ref(false)
const detailsCard = ref(null)
const detailsFromList = ref(false) // the form was opened from My Bookings, so "Add later" / "Cancel" goes back there
const canEditDetails = computed(() => !isSitter.value && status.value === 'confirmed' && tasks.value.length > 0)
const detailsLocked = computed(() => !isSitter.value && status.value === 'in-progress' && tasks.value.length > 0)

async function openDetailsForm() {
  detailsFormOpen.value = true
  await nextTick()
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  detailsCard.value?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
}

// "Add later" / "Cancel": back to My Bookings (Upcoming tab) if the form was opened from there, otherwise just close it
function closeDetailsForm() {
  detailsFormOpen.value = false
  if (detailsFromList.value) router.push({ name: 'owner-bookings', query: { tab: 'upcoming' } })
}

function detailsSaved(saved) {
  tasks.value = saved.items
  detailsSavedAt.value = saved.detailsSavedAt
  detailsFormOpen.value = false
  message.value = 'Care details saved ✅ The sitter can see them on this booking.'
}

async function respond(newStatus) {
  if (newStatus === 'declined' && status.value === 'accepted') {
    const ok = await confirmDialog({
      title: 'Decline this request?',
      message: 'You accepted it, but the owner has not confirmed yet. This cannot be undone.',
      confirmText: 'Decline',
      danger: true
    })
    if (!ok) {
      return
    }
  }
  busy.value = true
  actionError.value = ''
  message.value = ''
  try {
    const updated = await bookingsApi.updateStatus(booking.value._id, newStatus)
    booking.value.status = updated.status
    sendNotification(
      booking.value._id,
      newStatus === 'accepted' ? 'booking-accepted' : 'booking-declined',
      newStatus === 'accepted'
        ? `${currentUser.value.username} accepted your booking request. Confirm it to lock it in.`
        : `${currentUser.value.username} declined your booking request.`
    )
    message.value = newStatus === 'accepted' ? 'Request accepted ✅ Waiting for the owner to confirm.' : 'Request declined.'
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not update the booking.'
  } finally {
    busy.value = false
  }
}

async function confirmBooking() {
  const ok = await confirmDialog({
    title: 'Confirm this booking?',
    message: `This locks in ${personName.value} for these dates. You can still cancel later, but the other person will be notified.`,
    confirmText: 'Confirm booking'
  })
  if (!ok) {
    return
  }
  busy.value = true
  actionError.value = ''
  message.value = ''
  try {
    const updated = await bookingsApi.confirm(booking.value._id)
    booking.value.status = updated.status
    sendNotification(booking.value._id, 'booking-confirmed', `${currentUser.value.username} confirmed your booking.`)
    message.value = 'Booking confirmed ✅ It is now final for you and the sitter.'
    if (canEditDetails.value) await openDetailsForm()
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not confirm the booking.'
  } finally {
    busy.value = false
  }
}

// Cancelling asks for a reason first, in a small window (CancelBookingModal)
const cancelOpen = ref(false)
const cancelError = ref('') // why cancelling failed, shown inside the window
const cancelQuestion = computed(() => status.value === 'confirmed'
  ? { title: 'Cancel this booking?', text: 'The other person will see it as cancelled, along with your reason. This cannot be undone.' }
  : { title: 'Withdraw this request?', text: 'The sitter will see that you withdrew it, along with your reason. This cannot be undone.' }
)
function cancelBooking() {
  cancelError.value = ''
  cancelOpen.value = true
}
// runs when the window sends the reason
async function sendCancel(reason) {
  const wasConfirmed = status.value === 'confirmed' // read before the status changes below
  busy.value = true
  cancelError.value = ''
  actionError.value = ''
  message.value = ''
  try {
    const updated = await bookingsApi.cancel(booking.value._id, reason)
    booking.value.status = updated.status
    booking.value.cancelledBy = updated.cancelledBy
    booking.value.cancelReason = updated.cancelReason
    sendNotification(
      booking.value._id,
      'booking-cancelled',
      wasConfirmed
        ? `${currentUser.value.username} cancelled your booking. Reason: ${reason}`
        : `${currentUser.value.username} withdrew their booking request. Reason: ${reason}`
    )
    cancelOpen.value = false
  } catch (err) {
    cancelError.value = err.response?.data?.message || 'Could not cancel the booking.'
  } finally {
    busy.value = false
  }
}

// Review: once the sitter has finished (completed, or paid after that), the owner can rate the sitter here.
// The sitter sees the owner's review here too. (Same review as on the Sessions page; a booking has at most one.)
const review = ref(null)
const reviewLoaded = ref(false)
const canSeeReview = computed(() => ['completed', 'paid'].includes(booking.value?.status))
const reviewStars = computed(() => (review.value ? '★'.repeat(review.value.rating) + '☆'.repeat(5 - review.value.rating) : ''))
// Chat: open from confirmed on. Once the booking has ended it's read-only, and only shows if there's something to read.
const chatLive = computed(() => ['confirmed', 'in-progress'].includes(status.value))
const hasMessages = ref(false)
const showChat = computed(() => chatLive.value || (['completed', 'paid'].includes(status.value) && hasMessages.value))
async function checkMessages() {
  if (!['completed', 'paid'].includes(status.value)) return
  try {
    hasMessages.value = (await messageApi.getMessages(route.params.id)).length > 0
  } catch (err) {
    console.warn('Could not check the chat', err)
  }
}

// Visit reports (owner): one row per finished session, from the first finished session on.
// Each row opens the same report window as the Session page's "Recently ended".
const reportEntry = ref(null) // the booking's report entry (server/src/utils/visitReports.js), finished days only
const openReport = ref(null) // { dayIndex } while the report window is open
const REPORT_STATUSES = ['in-progress', 'completed', 'paid']
async function loadReports() {
  if (isSitter.value || !REPORT_STATUSES.includes(status.value)) return
  try {
    const entry = await visitsApi.report(route.params.id)
    // a session still going on has no report yet
    const days = entry.days.filter((d) => d.visit?.status === 'completed')
    reportEntry.value = days.length ? { ...entry, days } : null
  } catch (err) {
    console.warn('Could not load the visit reports', err)
  }
}

// Reviews close 30 days after the booking's last booked time (the server sends the date and checks it too)
const reviewUntil = computed(() => (booking.value?.reviewOpenUntil ? shortDate(new Date(booking.value.reviewOpenUntil)) : ''))
const reviewClosed = computed(() => booking.value?.reviewOpenUntil != null && Date.now() > booking.value.reviewOpenUntil)

onMounted(async () => {
  try {
    if (!currentUser.value) await fetchUser()
    booking.value = await bookingsApi.getOne(route.params.id)
    const care = await bookingsApi.getCareTasks(route.params.id)
    tasks.value = care.items
    detailsSavedAt.value = care.detailsSavedAt
    selectedPetId.value = booking.value.petIds?.[0]?._id || null // start on the first pet
    await checkMessages()
    await loadReports()
    if (canSeeReview.value) {
      review.value = await reviewsApi.getForBooking(route.params.id).catch(() => null)
      reviewLoaded.value = true
    }
  } catch (err) {
    error.value = err.response?.data?.message || 'Could not load this booking.'
  } finally {
    loading.value = false
  }
  // Came from the "Review sitter" button on My Bookings: scroll down to the review
  if (route.query.review && reviewLoaded.value) {
    await nextTick()
    document.getElementById('review')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // Confirming from My Bookings comes here with ?details=open.
  // The address is then cleaned up, so refreshing the page doesn't reopen the form.
  if (route.query.details === 'open') {
    const justConfirmed = Boolean(route.query.confirmed)
    router.replace({ query: {} })
    if (canEditDetails.value) {
      detailsFromList.value = true
      // ?confirmed=1 when coming straight from confirming on My Bookings (not from its "Add care details" button)
      if (justConfirmed) message.value = 'Booking confirmed ✅ Add the care details now, or come back to them later.'
      await openDetailsForm()
    }
  }
})
// checks if the user is logged in , then gets their booking and careTasks

</script>

<template>
  <div class="detail-wrap">
    <BackButton label="Back" :fallback="isSitter ? '/sitter/requests' : '/owner/bookings'" />

    <div v-if="loading" class="d-flex align-items-center text-muted">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Loading this booking...
    </div>

    
    <div v-else-if="error" class="alert alert-warning mt-3">{{ error }}</div>

    <template v-else>
      <div class="d-flex flex-wrap align-items-center gap-3 mt-2 mb-1">
        <h2 class="detail-title mb-0">Booking Detail</h2>
        <StatusPill :status="booking.status" />
        <!-- the booking's chat: live while it's confirmed or in progress, read-only once it has ended -->
        <SessionChat v-if="showChat" class="ms-auto" :booking-id="booking._id" :is-sitter="isSitter"
                     :can-send="chatLive" button-text="Chat" />
      </div>
      <!-- from 992px: two columns, the booking's cards on the left and the date, price and the other person (with the buttons) on the right.
           Under 992px both wrappers use display: contents, so the cards stay in one column in the same order as before (see .bd-*). -->
      <div class="bd-layout">
      <div class="bd-side">
      <div class="bd-when">
      <p class="text-muted fw-semibold mb-3">
        {{ formatBookingWhen(booking) }} · {{ formatPrice(booking.totalPrice) }}
      </p>
      <!-- Different hours on different days: list them, e.g. "Fri 6 Nov: 10:00 am – 12:00 am" -->
      <ul v-if="hoursVary(booking)" class="small text-muted mb-3 ps-3">
        <li v-for="line in dayTimesList(booking)" :key="line">{{ line }}</li>
      </ul>
      </div>
      <!-- The other person, with the buttons at the end of the page -->
      <div class="detail-card bd-person p-4 mb-3">
        <h6 class="section-title">{{ isSitter ? 'Owner' : 'Sitter' }}</h6>
        <!-- flex-wrap: on narrow phones View profile moves under the name instead of pushing the page wider -->
        <div class="d-flex flex-wrap align-items-center gap-3">
          <img v-if="personPicture" :src="personPicture" :alt="personName" class="avatar" />
          <span v-else class="avatar">{{ personName.charAt(0).toUpperCase() }}</span>
          <div class="flex-grow-1">
            <div class="fw-bold fs-5">{{ personName }}</div>
            <div class="small text-muted">{{ isSitter ? 'Pet owner' : 'Pet sitter' }}</div>
            <!-- stars from the sitter's profile (owners have no ratings yet, so the sitter doesn't see this row) -->
            <div v-if="!isSitter" class="d-flex flex-wrap align-items-center gap-2 mt-1">
              <template v-if="ratingCount">
                <ShowStarRating :modelValue="Math.round(ratingAvg)" :maxStars="5" />
                <span class="small"><strong>{{ ratingAvg.toFixed(1) }}</strong> from {{ ratingCount }} review{{ ratingCount === 1 ? '' : 's' }}</span>
              </template>
              <span v-else class="small text-muted">No reviews yet</span>
            </div>
          </div>
          <!-- on the right of the same row; sitters can open the owner's profile too, owners open the sitter's -->
          <router-link :to="`/users/${person._id}`" class="btn btn-outline-secondary flex-shrink-0">View profile</router-link>
        </div>

        <!-- the buttons run across the whole card, under a line -->
        <div v-if="canRespond || canDeclineAccepted || canConfirm || canCancel" class="border-top mt-3 pt-3 text-center">
          <div v-if="canRespond" class="row g-2">
            <div class="col-6"><button type="button" class="btn btn-success w-100" :disabled="busy" @click="respond('accepted')">Accept request</button></div>
            <div class="col-6"><button type="button" class="btn btn-outline-danger w-100" :disabled="busy" @click="respond('declined')">Decline</button></div>
          </div>
          <template v-else-if="canDeclineAccepted">
            <button type="button" class="btn btn-outline-danger w-100" :disabled="busy" @click="respond('declined')">Decline</button>
            <p class="small text-muted mt-2 mb-0">You can still decline until the owner confirms.</p>
          </template>
          <div v-else-if="canConfirm" class="row g-2">
            <div class="col-6"><button type="button" class="btn btn-brand w-100" :disabled="busy" @click="confirmBooking">Confirm booking</button></div>
            <div class="col-6"><button type="button" class="btn btn-outline-danger w-100" :disabled="busy" @click="cancelBooking">Withdraw request</button></div>
          </div>
          <template v-else>
            <button type="button" class="btn btn-outline-danger w-100" :disabled="busy" @click="cancelBooking">{{ cancelText }}</button>
            <p class="small text-muted mt-2 mb-0">You can cancel until the booking starts. Once it is paid, it can't be cancelled here.</p>
          </template>
        </div>
      </div>

      </div>
      <div class="bd-main">

      <div v-if="booking.status === 'cancelled'" class="alert alert-secondary bd-o2">
        {{ booking.cancelledBy === 'owner' ? 'The owner withdrew or cancelled this booking.' : booking.cancelledBy === 'sitter' ? 'The sitter cancelled this booking.' : 'This booking was cancelled.' }}
        The hours are free on the sitter's calendar again.
        <div v-if="booking.cancelReason" class="mt-2"><strong>Reason:</strong> “{{ booking.cancelReason }}”</div>
      </div>
      <div v-else-if="booking.status === 'expired'" class="alert alert-secondary bd-o2">
        This booking is no longer valid: its start time has passed.
      </div>
      <div v-else-if="booking.status === 'accepted'" class="alert alert-info bd-o2">
        {{ isSitter ? 'You accepted this request. Waiting for the owner to confirm; the hours are held for you until then.'
                    : 'The sitter accepted your request. Confirm it below to make the booking final.' }}
      </div>
      <!-- <div v-if="message" class="alert alert-success">{{ message }}</div> -->
      <div v-if="actionError" class="alert alert-warning bd-o2">{{ actionError }}</div>

      <!-- Visit reports (owner): the same rows as in "Recently ended" on the Session page; each opens the report window -->
      <div v-if="reportEntry" class="detail-card bd-o3 p-4 mb-3">
        <ReportRows :entry="reportEntry" @open="openReport = { dayIndex: $event }" />
      </div>

      <!-- Pets: tap one to show its checklist below. With one pet there is nothing to choose, so this card is left out
           and the pet's picture and name go at the top of the checklist card instead -->
      <div v-if="pets.length !== 1" class="detail-card bd-o3 p-4 mb-3" :class="{ 'opacity-75': booking.status === 'cancelled' }">
        <h6 class="section-title">Pets · tap a pet to see its checklist</h6>
        <p v-if="!pets.length" class="text-muted mb-0">No pets listed.</p>
        <div class="row g-2">
          <div v-for="pet in pets" :key="pet._id" class="col-12 col-sm-6">
            <button
              type="button"
              class="pet-card"
              :class="{ active: pet._id === selectedPetId }"
              :aria-pressed="pet._id === selectedPetId"
              @click="selectedPetId = pet._id"
            >
              <img v-if="pet.photo?.url" :src="pet.photo.url" :alt="pet.name" class="pet-photo" />
              <span v-else class="pet-photo pet-initial">{{ pet.name.charAt(0).toUpperCase() }}</span>
              <span>
                <strong class="pet-name d-block">{{ pet.name }}</strong>
                <small class="text-muted">{{ petKind(pet) }}</small>
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Care checklist for the chosen pet: look only, so the boxes are switched off -->
      <div class="detail-card bd-o3 p-4 mb-3" :class="{ 'opacity-75': booking.status === 'cancelled' }">
        <h6 class="section-title">
          {{ pets.length > 1 && selectedPet ? `${selectedPet.name}'s checklist` : 'Care checklist' }}
          · {{ visibleTasks.length }} task{{ visibleTasks.length === 1 ? '' : 's' }}
        </h6>
        <!-- one pet: its picture, name and kind sit at the top of this card -->
        <div v-if="pets.length === 1" class="one-pet-row d-flex align-items-center gap-3">
          <img v-if="pets[0].photo?.url" :src="pets[0].photo.url" :alt="pets[0].name" class="pet-photo" />
          <span v-else class="pet-photo pet-initial">{{ pets[0].name.charAt(0).toUpperCase() }}</span>
          <span>
            <strong class="pet-name d-block">{{ pets[0].name }}</strong>
            <small class="text-muted">{{ petKind(pets[0]) }}</small>
          </span>
        </div>
        <p v-if="!visibleTasks.length" class="text-muted mb-0">No tasks added{{ pets.length > 1 && selectedPet ? ` for ${selectedPet.name}` : '' }}.</p>
        <div v-for="(task, i) in visibleTasks" :key="i" class="task-row">
          <div class="form-check d-flex align-items-center gap-2 mb-0 ps-0">
            <input :id="`task-${i}`" class="form-check-input mt-0" type="checkbox" disabled />
            <label class="form-check-label flex-grow-1" :for="`task-${i}`">
              {{ task.title }}
              <small v-if="pets.length > 1" class="d-block text-muted">
                {{ alsoFor(task).length ? `Also for ${alsoFor(task).join(', ')}` : `Only for ${selectedPet?.name}` }}
              </small>
              <small v-if="task.days?.length" class="d-block text-muted">Only on {{ task.days.map(prettyDate).join(', ') }}</small>
              <small v-if="task.category === 'walk'" class="d-block text-muted">{{ routeText(task) }}</small>
            </label>
            <span v-if="task.dailyFrequency > 1" class="freq-badge">{{ task.dailyFrequency }} times a day</span>
          </div>
          <CareDetailsSummary :task="task" />
          <!-- the route map, when this viewer is allowed to see the path -->
          <template v-if="task.walkRoute?.path">
            <button type="button" class="btn btn-link btn-sm p-0 route-toggle"
                    @click="openRouteKey = openRouteKey === routeKey(task) ? null : routeKey(task)">
              {{ openRouteKey === routeKey(task) ? 'Hide route' : 'Show route' }}
            </button>
            <WalkMap v-if="openRouteKey === routeKey(task)" class="route-map mt-2"
                     :planned-route="task.walkRoute.path.coordinates" />
          </template>
        </div>
      </div>

      <!-- Care details: the owner fills these in after confirming -->
      <div v-if="canEditDetails || detailsLocked" ref="detailsCard" class="detail-card details-card bd-o3 p-4 mb-3">
        <h6 class="section-title">Care details</h6>
        <CareDetailsForm
          v-if="canEditDetails && detailsFormOpen"
          :booking-id="booking._id"
          :tasks="tasks"
          :close-text="detailsSavedAt ? 'Cancel' : 'Add later'"
          @saved="detailsSaved"
          @photos-changed="tasks = $event.items"
          @close="closeDetailsForm"
        />
        <p v-else-if="detailsLocked" class="text-muted mb-0">Care details are locked because the first session has started.</p>
        <template v-else>
          <div v-if="!detailsSavedAt" class="alert alert-warning">
            <strong>Care details needed.</strong> Tell the sitter things like the food amount, medicine dosage and where the leash is kept.
          </div>
          <p v-else class="text-muted">Saved. You can change these until the first session starts.</p>
          <button type="button" class="btn btn-brand w-100" @click="openDetailsForm">
            {{ detailsSavedAt ? 'Edit care details' : 'Add care details' }}
          </button>
        </template>
      </div>

      <div v-if="booking.notes" class="detail-card bd-o3 p-4 mb-3" :class="{ 'opacity-75': booking.status === 'cancelled' }">
        <h6 class="section-title">Notes from owner</h6>
        <p class="mb-0">"{{ booking.notes }}"</p>
      </div>

      <!-- Review: the owner rates the sitter (or sees their review); the sitter sees the owner's review -->
      <div v-if="canSeeReview && reviewLoaded" id="review" class="detail-card bd-o5 p-4 mb-3">
        <h6 class="section-title">{{ isSitter ? "Owner's review" : 'Review your sitter' }}</h6>
        <template v-if="review">
          <div class="fs-5" style="color:#FFD700;">{{ reviewStars }}</div>
          <p v-if="review.comment" class="mb-1 text-break">{{ review.comment }}</p>
          <p v-if="!isSitter" class="small text-muted mb-0">Thanks, your review has been posted.</p>
        </template>
        <p v-else-if="isSitter" class="small text-muted mb-0">The owner hasn't left a review yet.</p>
        <p v-else-if="reviewClosed" class="small text-muted mb-0">Reviews for this booking closed on {{ reviewUntil }}.</p>
        <template v-else>
          <ReviewForm :booking-id="booking._id" @saved="review = $event" />
          <p v-if="reviewUntil" class="small text-muted mt-2 mb-0">You can review until {{ reviewUntil }}.</p>
        </template>
      </div>
      </div>
      </div>
    </template>

    <VisitReportModal v-if="openReport && reportEntry" :entry="reportEntry" :day-index="openReport.dayIndex"
                      @close="openReport = null" @change-day="openReport.dayIndex = $event" />

    <!-- asks for the reason before cancelling -->
    <CancelBookingModal
      v-if="cancelOpen"
      :title="cancelQuestion.title"
      :text="cancelQuestion.text"
      :confirm-label="cancelText"
      :busy="busy"
      :error="cancelError"
      @confirm="sendCancel"
      @close="cancelOpen = false"
    />
  </div>
</template>

<style scoped>
.detail-title {
  font-family: 'Fredoka', 'Nunito', sans-serif;
  font-weight: 600;
}
.detail-card {
  background: #fff;
  border: 1px solid #ede3d8;
  border-radius: 12px;
}

/* the two columns (from 992px). Phones and tablets: one column in this order, as before:
   date and price, notices, pets / checklist / care details / notes, the other person, the review */
.bd-layout { display: flex; flex-direction: column; }
.bd-side, .bd-main { display: contents; }
.bd-when { order: 1; }
.bd-o2 { order: 2; }
.bd-o3 { order: 3; }
.bd-person { order: 4; }
.bd-o5 { order: 5; }
@media (min-width: 992px) {
  .bd-layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 0 1.5rem;
    align-items: start;
  }
  .bd-main { display: block; grid-column: 1; grid-row: 1; }
  /* the right column stays in view while the left one scrolls */
  .bd-side { display: block; grid-column: 2; grid-row: 1; position: sticky; top: 1rem; }
  .bd-when {
    margin-bottom: 1rem;
    padding: 1rem 1.25rem 0.25rem;
    background: #fff;
    border: 1px solid #ede3d8;
    border-radius: 12px;
  }
}
.details-card {
  scroll-margin-top: 5rem; /* stops the top bar covering the card when the page scrolls to it */
}
.section-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #766a60;
  font-weight: 800;
  margin-bottom: 0.9rem;
}
.pet-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-align: left;
  background: #fffaf6;
  border: 1.5px solid #ede3d8;
  border-radius: 12px;
  padding: 0.7rem 0.8rem;
  cursor: pointer;
}
.pet-card:hover {
  border-color: var(--accent-main);
}
.pet-card.active {
  border-color: var(--accent-main);
  box-shadow: 0 0 0 3px #f6e3d9;
  background: #fff;
}
.pet-photo {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  border-radius: 14px;
  object-fit: cover;
}
.pet-initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-main);
  color: #fff;
  font-family: 'Fredoka', sans-serif;
  font-size: 1.5rem;
  font-weight: 600;
}
.pet-name {
  font-family: 'Fredoka', sans-serif;
  font-weight: 600;
  font-size: 1.05rem;
}
.one-pet-row {
  padding-bottom: 0.9rem;
  margin-bottom: 0.25rem;
  border-bottom: 1px dashed #ede3d8;
}
.task-row {
  padding: 0.75rem 0 0.75rem 1.75rem;
  border-top: 1px solid #f1ece6;
}
.route-toggle {
  color: var(--accent-deep);
  font-weight: 600;
}
.route-map {
  height: 240px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #ede3d8;
}
.freq-badge {
  background: #f6e3d9;
  color: var(--accent-main);
  border-radius: 999px;
  padding: 0.1rem 0.7rem;
  font-weight: 800;
  font-size: 0.75rem;
  white-space: nowrap;
}
.avatar {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.3rem;
  background: #fde9dd;
  color: var(--accent-deep);
}
</style>
