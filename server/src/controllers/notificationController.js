import mongoose from 'mongoose'
import Notification, {
  NOTIFICATION_TYPES,
  notifyPaymentDue,
  notifyPayment
} from '../models/notificationModel.js'
import Booking from '../models/bookingModel.js'

const MAX_LISTED = 50   // the Notifications page shows the newest 50

// GET /api/notifications -> the logged-in user's newest notifications, newest first
export async function getMyNotifications(req, res) {
  const notifications = await Notification.find({ recipient: req.session.userId })
    .sort({ createdAt: -1 })
    .limit(MAX_LISTED)
  res.json(notifications)
}

// GET /api/notifications/unread-count -> { count } for the navbar badge
// (kept separate and small because the badge asks every 10 seconds)
export async function getUnreadCount(req, res) {
  const count = await Notification.countDocuments({ recipient: req.session.userId, read: false })
  res.json({ count })
}

// POST /api/notifications -> sends a notification to the other person on a booking
// Body: { bookingId, type, message }
// The recipient is worked out from the booking, never taken from the body,
// so users can only notify someone they share a booking with.
export async function createNotification(req, res) {
  const { bookingId, type, message } = req.body
  const bookingTypes = [
    'booking-requested',
    'booking-accepted',
    'booking-confirmed',
    'booking-declined',
    'booking-cancelled'
  ]

  if (!NOTIFICATION_TYPES.includes(type) || !bookingTypes.includes(type)) {
    return res.status(400).json({ message: 'Unknown or unsupported booking notification type' })
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: 'Message is required' })
  }
  if (message.trim().length > 300) {
    return res.status(400).json({ message: 'Message must be 300 characters or fewer' })
  }
  if (!mongoose.isValidObjectId(bookingId)) {
    return res.status(400).json({ message: 'A valid bookingId is required' })
  }

  const booking = await Booking.findById(bookingId).select('ownerId sitterId status cancelledBy')
  if (!booking) return res.status(404).json({ message: 'Booking not found' })

  const me = String(req.session.userId)
  let recipient
  if (String(booking.ownerId) === me) recipient = booking.sitterId
  else if (String(booking.sitterId) === me) recipient = booking.ownerId
  else return res.status(403).json({ message: 'You are not part of this booking' })

  const senderRole = String(booking.ownerId) === me ? 'owner' : 'sitter'
  const expected = {
    'booking-requested': { role: 'owner', status: 'pending' },
    'booking-accepted': { role: 'sitter', status: 'accepted' },
    'booking-confirmed': { role: 'owner', status: 'confirmed' },
    'booking-declined': { role: 'sitter', status: 'declined' },
    'booking-cancelled': { role: booking.cancelledBy, status: 'cancelled' }
  }[type]
  if (senderRole !== expected.role || booking.status !== expected.status) {
    return res.status(409).json({ message: 'That notification does not match the booking state.' })
  }

  const notifications = [{
    recipient,
    type,
    message: message.trim(),
    booking: booking._id
  }]
  if (type === 'booking-requested') {
    notifications.push({
      recipient: booking.ownerId,
      type: 'booking-request-sent',
      message: 'Your booking request was sent to the sitter.',
      booking: booking._id
    })
  }

  const created = []
  for (const item of notifications) {
    const alreadySent = await Notification.exists({
      booking: booking._id,
      recipient: item.recipient,
      type: item.type
    })
    if (!alreadySent) created.push(await Notification.create(item))
  }
  res.status(created.length ? 201 : 200).json({ notifications: created })
}

// POST /api/notifications/payment -> ensures the right payment notifications exist
// Body: { bookingId }
// What gets sent comes from the booking's status in the database, not from the request:
//   completed -> 'payment-due' to owner
//   paid -> 'payment-successful' to owner and 'payment-received' to sitter
// so nobody can fake a payment receipt.
export async function createPaymentNotification(req, res) {
  const { bookingId } = req.body
  if (!mongoose.isValidObjectId(bookingId)) {
    return res.status(400).json({ message: 'A valid bookingId is required' })
  }

  const booking = await Booking.findById(bookingId).select('ownerId sitterId totalPrice status')
  if (!booking) return res.status(404).json({ message: 'Booking not found' })

  const me = String(req.session.userId)
  if (String(booking.ownerId) !== me && String(booking.sitterId) !== me) {
    return res.status(403).json({ message: 'You are not part of this booking' })
  }

  const TYPE_FOR_STATUS = { completed: 'payment-due', paid: 'payment-successful' }
  const type = TYPE_FOR_STATUS[booking.status]
  if (!type) {
    return res.status(400).json({ message: `No payment notification for a ${booking.status} booking` })
  }

  if (type === 'payment-due') await notifyPaymentDue(booking)
  else await notifyPayment(booking, true)

  res.json({ message: 'Payment notification(s) ensured', type })
}

// PATCH /api/notifications/:id/read -> marks one notification as read
export async function markRead(req, res) {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.session.userId },   // only your own notifications
    { read: true },
    { new: true }
  )
  if (!notification) return res.status(404).json({ message: 'Notification not found' })
  res.json(notification)
}

// PATCH /api/notifications/read-all -> marks all of the user's notifications as read
export async function markAllRead(req, res) {
  await Notification.updateMany({ recipient: req.session.userId, read: false }, { read: true })
  res.json({ message: 'All notifications marked as read' })
}

// DELETE /api/notifications -> deletes only the logged-in user's notifications
export async function clearAllNotifications(req, res) {
  const result = await Notification.deleteMany({ recipient: req.session.userId })
  res.json({ message: 'Notifications cleared', deletedCount: result.deletedCount })
}
