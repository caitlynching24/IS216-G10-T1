import Booking from '../models/bookingModel.js'
import CareChecklist from '../models/CareChecklist.js'
import { notifyBookingOnce } from '../models/notificationModel.js'
import { syncBookingToGoogle } from '../utils/googleCalendar.js'
import { bookingRange, dailyRanges, findClash, findPetClash, describeBooking } from '../utils/bookingTimes.js'
import { expirePastBookings } from '../utils/expireBookings.js'

// GET /api/bookings                         -> all my bookings
// GET /api/bookings?status=pending,accepted -> only those statuses
export const getMyBookings = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in' })
  }
  await expirePastBookings().catch((err) => console.error('Could not expire old bookings', err))

  const filter =
    req.session.role === 'sitter'
      ? { sitterId: req.session.userId }
      : { ownerId: req.session.userId }

  if (req.query.status) {
    filter.status = { $in: req.query.status.split(',') }
  }

  const bookings = await Booking.find(filter)
    .populate('ownerId', 'username email')
    .populate('sitterId', 'username email')
    .populate('petIds', 'name species photo')
    .sort({ startDate: 1 })

  if (req.session.role === 'sitter') {
    return res.json(bookings)
  }
  // Owners: whether each confirmed booking's care details are still needed, for My Bookings'
  // "Add care details" button and flag. 'needed' = it has tasks but the details were never saved,
  // 'saved' = saved at least once, null = not confirmed yet, or no tasks to add details to.
  const confirmedIds = bookings.filter((b) => b.status === 'confirmed').map((b) => b._id)
  const checklists = confirmedIds.length
    ? await CareChecklist.find({ bookingId: { $in: confirmedIds } }).select('bookingId detailsSavedAt items._id')
    : []
  const careByBooking = new Map(checklists.map((c) => [
    String(c.bookingId),
    c.items.length === 0 ? null : c.detailsSavedAt ? 'saved' : 'needed'
  ]))
  res.json(bookings.map((b) => ({ ...b.toJSON(), careDetails: careByBooking.get(String(b._id)) ?? null })))
}

// PATCH /api/bookings/:id/status   body: { "status": "accepted" } or { "status": "declined" }
// The sitter accepts or declines a pending request. They can also decline a request they accepted
// while it waits for the owner to confirm, so they aren't held forever.
export const updateBookingStatus = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in' })
  }
  if (req.session.role !== 'sitter') {
    return res.status(403).json({ message: 'Only sitters can accept or decline bookings' })
  }

  const { status } = req.body
  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ message: "Status must be 'accepted' or 'declined'" })
  }

  const booking = await Booking.findById(req.params.id)
  if (!booking) {
    return res.status(404).json({ message: 'Booking not found' })
  }

  if (String(booking.sitterId) !== String(req.session.userId)) {
    return res.status(403).json({ message: 'This booking is not yours' })
  }

  if (status === 'accepted' && booking.status !== 'pending') {
    return res.status(400).json({ message: `Only pending bookings can be accepted. This one is ${booking.status}.` })
  }
  if (status === 'declined' && !['pending', 'accepted'].includes(booking.status)) {
    return res.status(400).json({ message: `Only pending or accepted bookings can be declined. This one is ${booking.status}.` })
  }

  // A sitter can't accept a request that overlaps another booking they already accepted.
  // (Two pending requests may overlap each other, so this is checked again at the moment of accepting.)
  if (status === 'accepted') {
    const clash = await findClash(booking.sitterId, dailyRanges(booking), booking._id) // checked day by day: the times are the hours for each day
    if (clash) {
      return res.status(409).json({ message: `You already have a booking ${describeBooking(clash)}, so you can't accept this overlapping request.` })
    }
  }

  booking.status = status
  await booking.save()

  if (status === 'accepted') {
    try {
      await notifyBookingOnce(
        booking,
        booking.ownerId,
        'booking-accepted',
        'The sitter accepted your booking request. Confirm it to lock it in.'
      )
    } catch (err) {
      // The booking acceptance should stand even if its notification cannot be saved.
      console.error('Could not create booking-accepted notification:', err.message)
    }
  }

  // (The booking goes into the sitter's Google Calendar later, when the owner confirms.)
  res.json(booking)
}

// PATCH /api/bookings/:id/confirm
// The owner confirms a request the sitter has accepted. This makes the booking final for both of them.
// Confirming does nothing to the owner's other requests; they stay as they are.
export const confirmBooking = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not logged in' })
  }
  if (req.session.role !== 'owner') {
    return res.status(403).json({ message: 'Only owners can confirm bookings' })
  }

  const booking = await Booking.findById(req.params.id)
  if (!booking) {
    return res.status(404).json({ message: 'Booking not found' })
  }
  if (String(booking.ownerId) !== String(req.session.userId)) {
    return res.status(403).json({ message: 'This booking is not yours' })
  }
  if (booking.status !== 'accepted') {
    return res.status(400).json({ message: `Only bookings the sitter has accepted can be confirmed. This one is ${booking.status}.` })
  }
  if (bookingRange(booking).start <= Date.now()) {
    return res.status(400).json({ message: 'The start time has already passed, so this booking can no longer be confirmed.' })
  }

  // A pet can't be with two sitters at once: block it if one of these pets already has a confirmed booking at that time
  const clash = await findPetClash(booking)
  if (clash) {
    return res.status(409).json({ message: `You already confirmed a booking for the same pet ${describeBooking(clash)}. Cancel that one first.` })
  }

  booking.status = 'confirmed'
  await booking.save()

  try {
    await notifyBookingOnce(
      booking,
      booking.sitterId,
      'booking-confirmed',
      'The owner confirmed your booking. It is now final.'
    )
  } catch (err) {
    // The booking confirmation should stand even if its notification cannot be saved.
    console.error('Could not create booking-confirmed notification:', err.message)
  }

  // Now that it's final, add the booking to the sitter's Google Calendar.
  // This never blocks or fails the confirm: googleSync just says what happened, e.g. { synced: true }.
  const googleSync = await syncBookingToGoogle(booking)

  res.json({ ...booking.toObject(), googleSync })
}
