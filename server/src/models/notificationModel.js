import mongoose from 'mongoose'
const { ObjectId } = mongoose.Schema.Types

// The kinds of notification. Add more here as other features need them.
export const NOTIFICATION_TYPES = [
  // walks (to owners)
  'walk-off-route', 'walk-back-on-route', 'walk-ended-early',
  // bookings
  'booking-requested',   // to sitter: an owner sent a request
  'booking-request-sent', // to owner: confirmation that their request was sent
  'booking-accepted',    // to owner: sitter said yes
  'booking-confirmed',   // to sitter: owner picked them
  'booking-declined',    // to owner
  'booking-cancelled',   // to whichever side didn't cancel
  'booking-expired',     // to owner: sitter didn't answer before the start time
  // payments
  'payment-due',         // to owner: booking completed, please pay
  'payment-successful',  // to owner: receipt for their payment
  'payment-received',    // to sitter: owner paid for the booking
  'payment-failed'       // to owner: the payment didn't go through
]

// A message for one user, shown on their Notifications page
const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    walk: { type: ObjectId, ref: 'Walk', default: null },         // the walk it's about, if any
    booking: { type: ObjectId, ref: 'Booking', default: null },   // the booking it's about, if any
    read: { type: Boolean, default: false }
  },
  { timestamps: true }
)


const Notification = mongoose.model('Notification', notificationSchema, 'notifications')

export default Notification


const formatAmount = (amount) => `$${Number(amount).toFixed(2)}`

export async function notify(recipient, type, message, { walk = null, booking = null } = {}) {
  return Notification.create({ recipient, type, message, walk, booking })
}

async function notifyBookingOnce(booking, recipient, type, message) {
  const existing = await Notification.findOne({ booking: booking._id, recipient, type })
  if (existing) return existing
  return notify(recipient, type, message, { booking: booking._id })
}

export async function notifyPaymentDue(booking) {
  await notifyBookingOnce(booking, booking.ownerId, 'payment-due',
    `Your booking is complete. Please pay ${formatAmount(booking.totalPrice)} to your sitter.`,
  )
}

// A successful payment notifies both parties; a failed attempt notifies the owner.
export async function notifyPayment(booking, succeeded) {
  const amount = formatAmount(booking.totalPrice)
  if (succeeded) {
    await notifyBookingOnce(booking, booking.ownerId, 'payment-successful', `Your payment of ${amount} went through.`)
    await notifyBookingOnce(booking, booking.sitterId, 'payment-received', `The owner paid ${amount} for your booking.`)
  } else {
    await notifyBookingOnce(booking, booking.ownerId, 'payment-failed', `Your payment of ${amount} didn't go through. Please try again.`)
  }
}
