import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true
})

// The logged-in user's notifications (server: /api/notifications)
// No try/catch here: errors are passed up to the caller, which decides what to show
export const notificationApi = {
  async getMine() {
    const res = await api.get('/notifications')
    return res.data
  },

  // { count } of unread notifications, for the navbar badge
  async getUnreadCount() {
    const res = await api.get('/notifications/unread-count')
    return res.data
  },

  async markRead(id) {
    const res = await api.patch(`/notifications/${id}/read`)
    return res.data
  },

  async markAllRead() {
    const res = await api.patch('/notifications/read-all')
    return res.data
  },

  async clearAll() {
    const res = await api.delete('/notifications')
    return res.data
  },

  async create(body) { 
    const res = await api.post('/notifications', body)
    return res.data
  },

  async notifyPayment(bookingId) {
    const res = await api.post('/notifications/payment', { bookingId })
    return res.data
  }
}
