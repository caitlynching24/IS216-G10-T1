<script setup>
import { ref, computed, toRef, watch } from 'vue'
import StatusPill from './StatusPill.vue'
import { formatPrice, formatBookingWhen } from '../utils/bookingHelpers'
import { usePagination } from '../utils/usePagination.js'
import PaginationBar from '../components/PaginationBar.vue'

const props = defineProps({
  
  bookings: { type: Array, required: true },
  viewer: { type: String, default: 'owner' }, // 'owner' or 'sitter'
  busyId: { type: String, default: null }, // booking being accepted/declined right now
  paginate: { type: Boolean, default: true},
  pageSize: { type: Number, default: 6 }
})

defineEmits(['accept', 'decline', 'confirm', 'cancel'])

const tableEl = ref(null)

const { page, pageItems, goPage, reset } = usePagination(toRef(props, 'bookings'), {
  pageSize: props.pageSize,
  scrollRef: tableEl
})

const rows = computed(() => (props.paginate ? pageItems.value : props.bookings))

watch(() => props.bookings, reset)

// the person on the other side of the booking
function otherPerson(booking) {
  const person = props.viewer === 'sitter' ? booking.ownerId : booking.sitterId
  return person?.username || person?.name || 'Unknown'
}

function petNames(booking) {
  const names = (booking.petIds || []).map((p) => p?.name).filter(Boolean)
  return names.length ? names.join(', ') : 'No pets listed'
}

function canCancel(booking) {
  if (props.viewer === 'owner') {
    return ['pending', 'accepted', 'confirmed'].includes(booking.status)
  }
  return booking.status === 'confirmed'
}

// for owners, returns true if request is pending/accepted/confirmed ; "Withdraw" a request, or "Cancel" a confirmed booking
// for sitters, returns true if booking is confirmed ; before that they decline instead

// Past bookings (owner): Rebook opens that sitter's profile instead of View details
const PAST = ['paid', 'declined', 'cancelled', 'expired']
function isPast(booking) {
  return props.viewer === 'owner' && PAST.includes(booking.status)
}
// Owner, confirmed booking: are its care details still needed? ('needed' / 'saved' / null, sent by the server)
function careDetails(booking) {
  return props.viewer === 'owner' && booking.status === 'confirmed' ? booking.careDetails ?? null : null
}
function sitterIdOf(booking) {
  return booking.sitterId?._id || booking.sitterId
}
</script>

<template>
  <div ref="tableEl" class="data-table-wrap">
    <table class="table align-middle mb-0 booking-table">
      <thead>
        <tr>
          <th>{{ viewer === 'sitter' ? 'Owner' : 'Sitter' }}</th>
          <th>Dates</th>
          <th class="d-none d-lg-table-cell">Price</th>
          <th>Status</th>
          <th class="text-end">Actions</th>
        </tr>
      </thead>

      <tbody>
        <template v-for="b in rows" :key="b._id">
          <!-- main row -->
          <tr :class="{ 'opacity-75': ['declined', 'cancelled', 'expired'].includes(b.status) }">
            <td>
              <div class="d-flex align-items-center gap-2">
                <span class="avatar">{{ otherPerson(b).charAt(0).toUpperCase() }}</span>
                <div>
                  <div class="fw-semibold">{{ otherPerson(b) }}</div>
                  <div class="small text-muted">{{ petNames(b) }}</div>
                </div>
              </div>
            </td>
            <td class="dates-cell">
              {{ formatBookingWhen(b) }}
              <div class="small text-muted d-lg-none">{{ formatPrice(b.totalPrice) }}</div>
            </td>
            <td class="d-none d-lg-table-cell">{{ formatPrice(b.totalPrice) }}</td>
            <td>
              <StatusPill :status="b.status" />
              <div v-if="careDetails(b) === 'needed'" class="care-flag mt-1">
                <span aria-hidden="true">⚠</span> Care details needed
              </div>
              <div v-if="b.status === 'accepted'" class="small text-muted mt-1">
                {{ viewer === 'owner' ? 'Waiting for you to confirm' : 'Waiting for the owner to confirm' }}
              </div>
              <div v-else-if="b.status === 'cancelled' && b.cancelledBy" class="small text-muted mt-1">
                by {{ (viewer === 'owner') === (b.cancelledBy === 'owner') ? 'you' : `the ${b.cancelledBy}` }}
                <div v-if="b.cancelReason" class="cancel-reason">“{{ b.cancelReason }}”</div>
              </div>
            </td>
            <td class="text-end actions-cell">
              <!-- sitters get their buttons stacked top to bottom, all the same width (Accept, Decline, View details); owners keep them in a row -->
              <div
                class="d-flex gap-2 row-actions"
                :class="viewer === 'sitter' ? 'flex-column align-items-stretch actions-stack' : 'flex-wrap justify-content-end align-items-center'"
              >
                <template v-if="viewer === 'sitter' && b.status === 'pending'">
                  <button class="btn btn-sm btn-success" :disabled="busyId === b._id" @click="$emit('accept', b._id)">Accept</button>
                  <button class="btn btn-sm btn-outline-danger" :disabled="busyId === b._id" @click="$emit('decline', b._id)">Decline</button>
                </template>
                <!-- the sitter can still say no while waiting for the owner, so they aren't held forever -->
                <button
                  v-if="viewer === 'sitter' && b.status === 'accepted'"
                  class="btn btn-sm btn-outline-danger"
                  :disabled="busyId === b._id"
                  @click="$emit('decline', b._id)"
                >Decline</button>
                <button
                  v-if="viewer === 'owner' && b.status === 'accepted'"
                  type="button"
                  class="btn btn-sm btn-brand"
                  :disabled="busyId === b._id"
                  @click="$emit('confirm', b._id)"
                >Confirm</button>
                <router-link
                  v-if="viewer === 'owner' && b.status === 'completed'"
                  class="btn btn-sm btn-brand"
                  :to="`/bookings/${b._id}/pay`"
                >Pay now</router-link>
                <!-- Owners add (or change) a confirmed booking's care details: opens Booking Detail with the form open -->
                <router-link
                  v-if="careDetails(b)"
                  class="btn btn-sm text-nowrap"
                  :class="careDetails(b) === 'needed' ? 'btn-brand' : 'btn-outline-secondary'"
                  :to="`/bookings/${b._id}?details=open`"
                >{{ careDetails(b) === 'needed' ? 'Add care details' : 'Edit care details' }}</router-link>
                <!-- Owners can review the sitter once the sitter has finished (before or after paying) -->
                <router-link
                  v-if="viewer === 'owner' && ['completed', 'paid'].includes(b.status)"
                  class="btn btn-sm btn-outline-secondary"
                  :to="`/bookings/${b._id}?review=1`"
                >Review sitter</router-link>
                <button
                  v-if="canCancel(b)" 
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  :disabled="busyId === b._id"
                  @click="$emit('cancel', b._id)"
                >{{ viewer === 'owner' && b.status !== 'confirmed' ? 'Withdraw' : 'Cancel' }}</button>
                <!-- button only exists if they're owners ; emits the cancel event with the payload of booking_id -->
                <!-- sitters open the Booking Detail page, owners open the details row below -->
                <!-- (owners now open the same Booking Detail page; their Past bookings get Rebook instead) -->
                <router-link
                  v-if="isPast(b)"
                  class="btn btn-sm btn-brand text-nowrap"
                  :to="`/users/${sitterIdOf(b)}`"
                >Rebook</router-link>
                <router-link
                  v-else
                  class="btn btn-sm btn-outline-secondary text-nowrap"
                  :to="`/bookings/${b._id}`"
                >View details</router-link>
                <!-- 
                on clicking the button, router-link component directs to that link in the router index.js, which directs it to bookingdetail.vue page 
                -->
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <PaginationBar v-if="paginate" :page="page" :total="bookings.length" :page-size="pageSize" @change="goPage" />
  </div>
</template>

<style scoped>
.care-flag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.55rem;
  border: 1px solid #f1d7a6;
  border-radius: 999px;
  background: #fdf0c4;
  color: #7a5a00;
  font-size: 0.78rem;
  font-weight: 800;
  white-space: nowrap;
}
.cancel-reason { font-style: italic; max-width: 16rem; white-space: normal; overflow-wrap: anywhere; } /* the reason someone gave for cancelling */
.avatar {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  background: #fde9dd;
  color: var(--accent-deep);
}
.actions-stack {
  width: 132px; /* every stacked button is this wide */
  margin-left: auto; /* keeps the stack on the right of the Actions column */
}
/* easier to press than Bootstrap's small buttons */
.row-actions .btn, .details-row .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
}
.dates-cell { white-space: nowrap; }

/* phones and narrow windows: each booking becomes a card, so nothing runs off the screen */
@media (max-width: 991.98px) {
  .booking-table thead { display: none; }
  .booking-table, .booking-table tbody, .booking-table tr, .booking-table td { display: block; width: 100%; }
  .booking-table tr { padding: 0.75rem 0; border-bottom: 1px solid #ede3d8; }
  .booking-table tr:last-child { border-bottom: 0; }
  .booking-table td { padding: 0.25rem 0; border: 0; text-align: left; }
  .dates-cell { white-space: normal; }
  .actions-cell { padding-top: 0.5rem !important; }
  .row-actions { flex-direction: row !important; flex-wrap: wrap; width: 100%; margin-left: 0; justify-content: flex-start !important; }
  .row-actions .btn { flex: 1 1 0; white-space: nowrap; }
}
</style>