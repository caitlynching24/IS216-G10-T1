<script setup>
// /bookings/:id/pay (owner): pay for a booking AFTER the sitter has completed it, using Stripe Checkout.
// Test mode: no real money moves.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { bookingsApi } from '../services/bookingApi.js'
import { paymentsApi } from '../services/paymentApi.js'
import { currentUser } from '../services/auth.js'
import { sendPaymentNotification } from '../utils/sendNotification.js'
import { petNames, formatDateRange, formatPrice } from '../utils/bookingHelpers.js'
import { SERVICE_PRICES, SERVICE_LABELS, OVERNIGHT_FEE, priceForTasks, nightsFor } from '../utils/servicePrices.js'

const route = useRoute()
const router = useRouter()

const booking = ref(null)
const tasks = ref([]) // the booking's care tasks (they make up the price)
const loading = ref(true)
const loadError = ref('')

const paying = ref(false) // true while we are getting the Stripe link
const payError = ref('')
const receipt = ref(null) // the successful payment, once paid

function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.push(currentUser.value ? '/home' : '/browse')
  }
}

// Number of days in the booking (start and end day both count)
const days = computed(() => {
  const b = booking.value
  if (!b) return 0
  return Math.round((new Date(b.endDate) - new Date(b.startDate)) / 86400000) + 1
})

// Nights the sitter stayed over (0 if this wasn't an overnight booking)
const nights = computed(() => (booking.value ? nightsFor(days.value, booking.value.overnight) : 0))

// 'visa' → 'Visa', 'mastercard' → 'Mastercard', 'paynow' → 'Paynow'
function brandLabel(brand) {
  if (!brand) return 'Card'
  return brand.charAt(0).toUpperCase() + brand.slice(1)
}

async function loadBooking() {
  booking.value = await bookingsApi.getOne(route.params.id)
  const res = await bookingsApi.getCareTasks(route.params.id)
  tasks.value = res.items || []
}

onMounted(async () => {
  const { session_id: sessionId, cancelled } = route.query
  try {
    if (sessionId) {
      // Back from Stripe after paying: check it really went through
      const result = await paymentsApi.confirm(sessionId)
      receipt.value = result.payment
      sendPaymentNotification(route.params.id)   // owner: "Your payment of $X went through."
    } else if (cancelled) {
      // Back from Stripe without paying
      await paymentsApi.cancel(cancelled).catch(() => {}) // fine if it was already marked
      payError.value = 'Payment was cancelled. You can try again.'
    }
    // Clean the address bar so a refresh does not confirm/cancel again
    if (sessionId || cancelled) router.replace({ query: {} })

    await loadBooking()
    if (!receipt.value) {
      if (booking.value.status === 'paid') {
        loadError.value = 'This booking has already been paid. Thank you!'
      } else if (booking.value.status !== 'completed') {
        loadError.value = 'You can pay once the sitter has completed this booking.'
      }
    }
  } catch (err) {
    loadError.value = err.response?.data?.message || 'Could not load this booking.'
  } finally {
    loading.value = false
  }
})

async function pay() {
  payError.value = ''
  paying.value = true
  try {
    const { url } = await paymentsApi.checkout(booking.value._id)
    window.location.href = url // leave our site and go to Stripe's checkout page
  } catch (err) {
    payError.value = err.response?.data?.message || 'Could not start the payment. Please try again.'
    paying.value = false
  }
}
</script>

<template>
  <div class="pay">
    <button type="button" class="pf-back" @click="goBack">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      Back to My Bookings
    </button>

    <h2 class="mt-3 mb-4">Payment</h2>

    <div v-if="loading" class="text-muted">Loading booking…</div>

    <!-- Paid -->
    <div v-else-if="receipt" class="card shadow-sm pay-card text-center p-4 mx-auto success-card">
      <div class="display-6 mb-2">✅</div>
      <h4 class="mb-2">Payment successful</h4>
      <p class="text-muted mb-1">
      {{ formatPrice(receipt.amount) }} paid with {{ brandLabel(receipt.method) }}<span v-if="receipt.cardLast4"> •••• {{ receipt.cardLast4 }}</span>
      </p>
      <p class="text-muted small mb-4">Thank you! This booking is now paid.</p>
      <router-link to="/owner/bookings?tab=past" class="btn btn-brand">Back to My Bookings</router-link>
    </div>

    <div v-else-if="loadError" class="alert alert-warning">{{ loadError }}</div>

    <div v-else class="row g-4">
      <!-- Booking summary -->
      <div class="col-12 col-lg-7">
        <div class="card shadow-sm pay-card">
          <div class="card-body">
            <h3 class="h6 text-uppercase text-muted fw-bold mb-3">Booking summary</h3>
            <dl class="row small mb-0">
              <dt class="col-4">Sitter</dt>
              <dd class="col-8">{{ booking.sitterId?.username }}</dd>
              <dt class="col-4">Pets</dt>
              <dd class="col-8">{{ petNames(booking) }}</dd>
              <dt class="col-4">When</dt>
              <dd class="col-8">{{ formatDateRange(booking.startDate, booking.endDate, booking.startTime, booking.endTime) }}</dd>
              <dt class="col-4">Days</dt>
              <dd class="col-8">{{ days }}</dd>
            </dl>
            <hr />
            <!-- One line per care task, e.g. "Walk: $20 × 2 a day × 1 day   $40.00" -->
            <div v-for="(t, i) in tasks" :key="i" class="d-flex justify-content-between small mb-1">
              <span>{{ SERVICE_LABELS[t.category] }}: ${{ SERVICE_PRICES[t.category] }} × {{ t.dailyFrequency }} a day × {{ days }} day{{ days === 1 ? '' : 's' }}</span>
              <span>{{ formatPrice(priceForTasks([t], days)) }}</span>
            </div>
            <div v-if="nights" class="d-flex justify-content-between small mb-1">
              <span>🌙 Overnight: ${{ OVERNIGHT_FEE }} × {{ nights }} night{{ nights === 1 ? '' : 's' }}</span>
              <span>{{ formatPrice(OVERNIGHT_FEE * nights) }}</span>
            </div>
            <hr />
            <div class="d-flex justify-content-between fw-bold fs-5">
              <span>Total</span><span>{{ formatPrice(booking.totalPrice) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Pay button -->
      <div class="col-12 col-lg-5">
        <div class="card shadow-sm pay-card">
          <div class="card-body">
            <h3 class="h6 text-uppercase text-muted fw-bold mb-3">Pay securely</h3>
            <div v-if="payError" class="alert alert-danger py-2">{{ payError }}</div>
            <p class="small text-muted">You will be taken to Stripe's secure page to enter your card, then brought back here.</p>
            <button type="button" class="btn btn-brand w-100 py-2" :disabled="paying" @click="pay">
              <span v-if="paying" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
              {{ paying ? 'Opening Stripe…' : `Pay ${formatPrice(booking.totalPrice)} with Stripe` }}
            </button>

            <div class="test-cards small mt-4">
              <strong>Test cards (no real money):</strong><br />
              4242 4242 4242 4242 (Visa) · 5555 5555 5555 4444 (Mastercard) ·
              4000 0000 0000 0002 (declined). Any future expiry like 12/30, any CVC, any name.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pay-card {
  border: 1px solid #ede3d8;
  border-radius: 12px;
}
.success-card {
  max-width: 480px;
}
.test-cards {
  background: #fff9f4;
  border: 1px dashed #ede3d8;
  border-radius: 8px;
  padding: 0.75rem;
}
</style>