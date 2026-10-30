import Booking from '../models/bookingModel.js'
import Notification from '../models/notificationModel.js'
import { bookingRange } from './bookingTimes.js'

// Requests the owner never confirmed become 'expired' once their start time passes.
// (Pending ones the sitter never answered expire too.)
const UNCONFIRMED_STATUSES = ['pending', 'accepted']
const CHECK_EVERY_MS = 5 * 60 * 1000 // every 5 minutes

// Marks every unconfirmed booking that should have started by now as 'expired'.
// It never throws: a problem is logged, and the next check tries again.
export async function expireStaleBookings() {
  try {
    // quick filter by day first (startDate is midnight of the start day)...
    const candidates = await Booking.find({ status: { $in: UNCONFIRMED_STATUSES }, startDate: { $lte: new Date() } })
    // ...then the exact start time
    for (const booking of candidates) {
      if (bookingRange(booking).start > Date.now()) continue

      const expired = await Booking.findOneAndUpdate(
        { _id: booking._id, status: { $in: UNCONFIRMED_STATUSES } },
        { status: 'expired' },
        { new: true }
      ).select('ownerId')

      if (expired) {
        try {
          await Notification.create({
            recipient: expired.ownerId,
            type: 'booking-expired',
            message: 'Your booking request expired because it was not confirmed before its start time.',
            booking: expired._id
          })
        } catch (err) {
          console.error('Could not create booking-expired notification:', err.message)
        }
      }
    }
  } catch (err) {
    console.error('Could not expire old booking requests:', err.message)
  }
}

// Called once when the server starts: checks straight away, then every 5 minutes
export function startExpiringBookings() {
  expireStaleBookings()
  setInterval(expireStaleBookings, CHECK_EVERY_MS)
}
