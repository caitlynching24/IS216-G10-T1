<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { notificationApi } from '../services/notificationApi.js'
import { unreadCount, refreshUnreadCount } from '../utils/useNotificationBadge.js'

// How often the open page checks for new notifications
const CHECK_EVERY_MS = 10000

const router = useRouter()
const notifications = ref([])
const loading = ref(true)
const clearing = ref(false)
const loadError = ref('')
const actionError = ref('')
let timer = null
let loadRequestId = 0

const hasUnread = computed(() => notifications.value.some((n) => !n.read))

// Short label and colour for each kind of notification
const TYPE_LABELS = {
  'walk-off-route': { text: 'Off route', badge: 'text-bg-danger' },
  'walk-back-on-route': { text: 'Back on route', badge: 'text-bg-success' },
  'walk-ended-early': { text: 'Ended early', badge: 'text-bg-warning' },
  'booking-requested': { text: 'New request', badge: 'text-bg-primary' },
  'booking-request-sent': { text: 'Request sent', badge: 'text-bg-primary' },
  'booking-accepted': { text: 'Accepted', badge: 'text-bg-success' },
  'booking-confirmed': { text: 'Confirmed', badge: 'text-bg-success' },
  'booking-declined': { text: 'Declined', badge: 'text-bg-danger' },
  'booking-cancelled': { text: 'Cancelled', badge: 'text-bg-secondary' },
  'booking-expired': { text: 'Expired', badge: 'text-bg-warning' },
  'payment-due': { text: 'Payment due', badge: 'text-bg-warning' },
  'payment-successful': { text: 'Paid', badge: 'text-bg-success' },
  'payment-received': { text: 'Payment received', badge: 'text-bg-success' },
  'payment-failed': { text: 'Payment failed', badge: 'text-bg-danger' }
}
const typeLabel = (type) => TYPE_LABELS[type] ?? { text: 'Notice', badge: 'text-bg-secondary' }

// "3:42 pm" for today, otherwise "26 Oct, 3:42 pm"
function formatTime(iso) {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })
  const isToday = date.toDateString() === new Date().toDateString()
  return isToday ? time : `${date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}, ${time}`
}

async function loadNotifications() {
  if (clearing.value) return
  const requestId = ++loadRequestId
  try {
    const result = await notificationApi.getMine()
    if (requestId === loadRequestId) {
      notifications.value = result
      loadError.value = ''
    }
  } catch (err) {
    if (requestId === loadRequestId) {
      loadError.value = err.response?.data?.message ?? 'Could not load your notifications.'
    }
  } finally {
    if (requestId === loadRequestId) loading.value = false
  }
}

onMounted(() => {
  loadNotifications()
  timer = setInterval(loadNotifications, CHECK_EVERY_MS)   // new alerts appear while the page is open
})

onBeforeUnmount(() => clearInterval(timer))

// Clicking a notification marks it as read, then opens the booking it's about (if any)
async function openNotification(notification) {
  if (!notification.read) {
    actionError.value = ''
    try {
      await notificationApi.markRead(notification._id)
      notification.read = true
      refreshUnreadCount()   // update the navbar badge straight away
    } catch (err) {
      actionError.value = err.response?.data?.message ?? 'Could not mark it as read.'
      return
    }
  }
  if (notification.booking) router.push(`/bookings/${notification.booking}`)
}

async function markAllRead() {
  actionError.value = ''
  try {
    await notificationApi.markAllRead()
    notifications.value.forEach((n) => { n.read = true })
    unreadCount.value = 0
  } catch (err) {
    actionError.value = err.response?.data?.message ?? 'Could not mark them as read.'
  }
}

async function clearAllNotifications() {
  if (!notifications.value.length || clearing.value) return
  clearing.value = true
  loadRequestId += 1 // Ignore any list request started before the deletion completes.
  actionError.value = ''
  try {
    await notificationApi.clearAll()
    notifications.value = []
    unreadCount.value = 0
  } catch (err) {
    actionError.value = err.response?.data?.message ?? 'Could not clear your notifications.'
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <div class="noti p-3 d-flex flex-column gap-3">
    <header class="d-flex flex-wrap align-items-end gap-2">
      <div>
        <h1 class="page-title mb-1">Notifications</h1>
        <p class="text-body-secondary mb-0">Updates about your bookings and walks. New ones appear automatically.</p>
      </div>
      <div class="d-flex gap-3 ms-auto">
        <button class="btn btn-link text-secondary p-0" :disabled="!hasUnread" @click="markAllRead">
          Mark all as read
        </button>
        <button class="btn btn-link text-danger p-0" :disabled="!notifications.length || clearing" @click="clearAllNotifications">
          {{ clearing ? 'Clearing…' : 'Clear all' }}
        </button>
      </div>
    </header>

    <p v-if="loading" class="text-body-secondary mb-0">Loading notifications…</p>
    <div v-else-if="loadError" class="alert alert-danger mb-0">{{ loadError }}</div>
    <div v-else-if="notifications.length === 0" class="info-card text-body-secondary">No notifications yet.</div>

    <template v-else>
      <div v-if="actionError" class="alert alert-danger py-2 mb-0">{{ actionError }}</div>

      <ul class="list-unstyled d-flex flex-column gap-2 mb-0">
        <li
          v-for="n in notifications"
          :key="n._id"
          class="info-card notification"
          :class="{ unread: !n.read, linked: n.booking }"
          @click="openNotification(n)"
        >
          <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
            <span v-if="!n.read" class="unread-dot" aria-label="Unread"></span>
            <span class="badge rounded-pill" :class="typeLabel(n.type).badge">{{ typeLabel(n.type).text }}</span>
            <span class="small text-body-secondary ms-auto">{{ formatTime(n.createdAt) }}</span>
          </div>
          <p class="mb-0" :class="{ 'fw-semibold': !n.read }">{{ n.message }}</p>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
/* PetSociety design system */
/* .notifications-page {
  max-width: 760px;
} */
.page-title {
  font-size: 32px;
  font-weight: 700;
}
.info-card {
  background: #fff;
  border: 1px solid #ede3d8;
  border-radius: 10px;
  padding: 12px 16px;
}
/* Every notification: hover darkens the background a little */
.notification {
  border-left: 4px solid transparent;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.notification:hover {
  background: #faf5ef;
}

/* Unread: warm tint, coral marker, dot, bold text */
.notification.unread {
  background: #fff4ec;
  border-left-color: #e8692c;   /* coral marker for unread */
  cursor: pointer;
}
.notification.unread:hover {
  background: #fde6d6;
}

/* Read: plain white, softer text */
.notification:not(.unread) p {
  color: #6c635c;
}

.notification.linked {
  cursor: pointer;
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e8692c;
  flex-shrink: 0;
}

@media (prefers-reduced-motion: reduce) {
  .notification {
    transition: none;
  }
}
</style>
