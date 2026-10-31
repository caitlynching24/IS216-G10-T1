import { notificationApi } from '../services/notificationApi.js'

// Fire-and-forget helpers for the notification backend.
// They never throw, so a failed notification can't break the booking action that triggered it.

// POST /api/notifications -> notifies the other person on the booking
export async function sendNotification(bookingId, type, message) {
  try {
    await notificationApi.create({ bookingId, type, message })
    return true
  } catch (err) {
    console.warn(`Could not send ${type} notification`, err)
    return false
  }
}

// POST /api/notifications/payment -> the server picks 'payment-due' or 'payment-successful'
// from the booking's status, so call it right after the booking becomes completed or paid
export async function sendPaymentNotification(bookingId) {
  try {
    await notificationApi.notifyPayment(bookingId)
  } catch (err) {
    console.warn('Could not send payment notification', err)
  }
}
