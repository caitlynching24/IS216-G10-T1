import { ref } from 'vue'
import { notificationApi } from '../services/notificationApi.js'

// How often the badge checks for new notifications
const CHECK_EVERY_MS = 10000

// One shared count for the whole app: the navbar badge shows it, and the
// Notifications page updates it straight away when something is marked as read.
export const unreadCount = ref(0)

let timer = null

// Asks the server for the latest unread count
export async function refreshUnreadCount() {
  try {
    const { count } = await notificationApi.getUnreadCount()
    unreadCount.value = count
  } catch {
    // e.g. offline for a moment: keep showing the last count and try again next time
  }
}

// Starts checking every 10 seconds (does nothing if already running)
export function startCheckingUnread() {
  if (timer) return
  refreshUnreadCount()
  timer = setInterval(refreshUnreadCount, CHECK_EVERY_MS)
}

// Stops checking and clears the badge (e.g. on logout)
export function stopCheckingUnread() {
  clearInterval(timer)
  timer = null
  unreadCount.value = 0
}
