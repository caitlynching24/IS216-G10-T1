import { Router } from 'express'
import mongoose from 'mongoose'
import Availability, { sgtMidnight, toSgtDateString } from '../models/Availability.js'
import Booking from '../models/bookingModel.js'
import CareChecklist, { CATEGORIES } from '../models/CareChecklist.js'
import Pet from '../models/petModel.js'
import User from '../models/UserModel.js'
import WalkRoute from '../models/walkRouteModel.js'
import { requireOwner, requireLogin } from '../middleware/authMiddleware.js'
import { bookingRange, findClash, describeBooking, toMinutes, slotsOf, slotsCover, START_TIME_RE, END_TIME_RE } from '../utils/bookingTimes.js'
import asyncHandler from '../middleware/asyncHandler.js'
import { removeBookingFromGoogle } from '../utils/googleCalendar.js'
import { bookingPrice, nightsFor } from '../utils/servicePrices.js'

const router = Router()

const DAY_MS = 24 * 60 * 60 * 1000

// Booking statuses where the sitter may see a walk task's route (i.e. the owner has confirmed the booking)
const ROUTE_VISIBLE_STATUSES = ['confirmed', 'in-progress', 'completed', 'paid']

// Works out the route for a walk task.
// choice: the id of one of the owner's routes, or 'instructions' for "follow my instructions".
// Returns { walkRoute } to save on the task, or { error } with a message for the owner.
async function walkRouteFor(choice, ownerId) {
  if (choice === 'instructions') return { walkRoute: { mode: 'instructions' } }
  if (!mongoose.isValidObjectId(choice)) {
    return { error: 'Choose a route for each walk task, or "follow my instructions".' }
  }
  const route = await WalkRoute.findOne({ _id: choice, owner: ownerId }) // must be this owner's own route
  if (!route) return { error: 'That walking route was not found. It may have been deleted.' }
  return {
    walkRoute: { mode: 'route', route: route._id, name: route.name, path: route.path, distanceM: route.distanceM }
  }
}

// Every 'YYYY-MM-DD' from start to end, inclusive.
function daysBetween(start, end) {
  const days = []
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) days.push(toSgtDateString(new Date(t)))
  return days
}

// POST /api/bookings
// Body: { sitterId, petIds: [id], startDate: 'YYYY-MM-DD', startTime: '09:00', endDate: 'YYYY-MM-DD', endTime: '17:30', notes, tasks }
// Times are Singapore time in 30-minute steps; endTime can be '24:00' (end of the day).
// Creates a 'pending' booking if every check passes.
router.post('/', requireOwner, asyncHandler(async (req, res) => {
  const { sitterId, petIds, startDate, startTime, endDate, endTime, notes = '', tasks = [], overnight = false } = req.body
  const ownerId = req.session.userId

  // 1. Input checks
  if (!mongoose.isValidObjectId(sitterId)) return res.status(400).json({ message: 'Choose a sitter.' })
  if (!Array.isArray(petIds) || petIds.length === 0) return res.status(400).json({ message: 'Select at least one pet.' })

  const start = sgtMidnight(startDate)
  const end = sgtMidnight(endDate)
  if (!start || !end) return res.status(400).json({ message: 'Choose a valid start and end date.' })
  if (startDate < toSgtDateString(new Date())) return res.status(400).json({ message: 'Start date cannot be in the past.' })
  if (end < start) return res.status(400).json({ message: 'End date must be on or after the start date.' })

  // Times are compulsory: HH:00 or HH:30. (An all-day booking is 00:00 to 24:00.)
  if (!START_TIME_RE.test(startTime || '') || !END_TIME_RE.test(endTime || '') || endTime === '00:00') {
    return res.status(400).json({ message: 'Choose a start time and an end time (in 30-minute steps).' })
  }
  if (startDate === endDate && toMinutes(endTime) <= toMinutes(startTime)) {
    return res.status(400).json({ message: 'End time must be after the start time.' })
  }
  const range = bookingRange({ startDate: start, endDate: end, startTime, endTime }) // exact start and end moments
  if (range.start <= Date.now()) return res.status(400).json({ message: 'The start time has already passed.' })

  // 2. The sitter exists
  const sitter = await User.findById(sitterId)
  if (!sitter || sitter.role !== 'sitter') return res.status(404).json({ message: 'Sitter not found.' })

  // 3. The pets belong to this owner
  const pets = await Pet.find({ _id: { $in: petIds }, owner: ownerId })
  if (pets.length !== petIds.length) return res.status(400).json({ message: 'You can only book for your own pets.' })

  // 4. The sitter is available on every day, and for the hours asked for on each day
  const days = daysBetween(start, end)
  const saved = await Availability.find({ sitterId, date: { $gte: start, $lte: end } })
  const byDay = Object.fromEntries(saved.map((a) => [toSgtDateString(a.date), a]))
  const missing = days.filter((d) => byDay[d]?.status !== 'available')
  if (missing.length) {
    return res.status(409).json({ message: `The sitter is not available on ${missing.join(', ')}.` })
  }
  const wrongHours = days.filter((d) => {
    const startMinutes = d === startDate ? toMinutes(startTime) : 0 // the first day starts at the start time, the last day ends at the end time
    const endMinutes = d === endDate ? toMinutes(endTime) : 24 * 60
    return !slotsCover(slotsOf(byDay[d]), startMinutes, endMinutes)
  })
  if (wrongHours.length) {
    return res.status(409).json({ message: `The sitter is not available at those times on ${wrongHours.join(', ')}.` })
  }

  // 5. No clash with the sitter's accepted / confirmed / paid / in-progress bookings, checked by exact time.
  // (Pending requests don't block, because the sitter hasn't said yes yet.)
  const clash = await findClash(sitterId, range)
  if (clash) {
    return res.status(409).json({ message: `The sitter is already booked ${describeBooking(clash)}.` })
  }

  // 6. Care checklist: at least one task, because the price is worked out from the tasks
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ message: 'Add at least one care task. The price is based on the tasks.' })
  }
  if (tasks.length > 20) {
    return res.status(400).json({ message: 'Send at most 20 care tasks.' })
  }
  const bookingPetIds = petIds.map(String)
  const items = []
  for (const t of tasks) {
    const title = String(t.title || '').trim()
    if (!title) return res.status(400).json({ message: 'Every care task needs a description.' })
    if (!CATEGORIES.includes(t.category)) return res.status(400).json({ message: `"${t.category}" is not a task type.` })
    if (!Number.isInteger(t.dailyFrequency) || t.dailyFrequency < 1 || t.dailyFrequency > 10) {
      return res.status(400).json({ message: 'Times per day must be a whole number from 1 to 10.' })
    }
    // A task is for the pets chosen on it, which must be pets in this booking. None chosen = all of them.
    const taskPets = Array.isArray(t.petIds) && t.petIds.length ? t.petIds.map(String) : bookingPetIds
    if (!taskPets.every((id) => bookingPetIds.includes(id))) {
      return res.status(400).json({ message: 'A care task can only be for a pet in this booking.' })
    }
    // Walk tasks need a route (copied from the owner's routes) or "follow my instructions"
    let walkRoute
    if (t.category === 'walk') {
      const result = await walkRouteFor(t.walkRouteId, ownerId)
      if (result.error) return res.status(400).json({ message: result.error })
      walkRoute = result.walkRoute
    }
    items.push({ category: t.category, title, dailyFrequency: t.dailyFrequency, petIds: taskPets, walkRoute })
  }

  // 7. Overnight stay needs at least one night, so the booking must end on a later day than it starts
  const wantsOvernight = overnight === true
  if (wantsOvernight && days.length < 2) {
    return res.status(400).json({ message: 'An overnight stay needs the booking to end on a later day.' })
  }

  // 8. Create the booking.
  // Price = each task's fixed price × times a day × number of days, added up, + overnight fee × nights
  const booking = await Booking.create({
    ownerId,
    sitterId,
    petIds,
    startDate: start,
    startTime,
    endDate: end,
    endTime,
    notes,
    overnight: wantsOvernight,
    totalPrice: bookingPrice(items, days.length, wantsOvernight),
    status: 'pending'
  })

  // 9. Save the care checklist, linked to the booking by bookingId
  if (items.length) await CareChecklist.create({ bookingId: booking._id, items })

  res.status(201).json({
    _id: booking._id,
    startDate: toSgtDateString(booking.startDate),
    startTime: booking.startTime,
    endDate: toSgtDateString(booking.endDate),
    endTime: booking.endTime,
    days: days.length,
    nights: nightsFor(days.length, wantsOvernight),
    totalPrice: booking.totalPrice,
    status: booking.status,
    tasks: items.length
  })
}))

// GET /api/bookings/:id/care-tasks
// The care tasks the owner added to this booking request. Only the booking's owner or sitter can read them.
// Out: { items: [{ category, title, petIds, dailyFrequency }] } (empty list if there are none)
router.get('/:id/care-tasks', requireLogin, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' })
  const booking = await Booking.findById(req.params.id)
  if (!booking) return res.status(404).json({ message: 'Booking not found.' })

  const me = String(req.session.userId)
  if (me !== String(booking.ownerId) && me !== String(booking.sitterId)) {
    return res.status(403).json({ message: 'This booking is not yours.' })
  }

  const checklist = await CareChecklist.findOne({ bookingId: booking._id })
  const items = checklist ? checklist.items.map((item) => item.toObject()) : []

  // The sitter only gets a walk route's path once the owner has confirmed the booking; before that, just its name
  const isSitter = me === String(booking.sitterId)
  if (isSitter && !ROUTE_VISIBLE_STATUSES.includes(booking.status)) {
    for (const item of items) {
      if (item.walkRoute?.path) {
        delete item.walkRoute.path
        item.walkRoute.hidden = true
      }
    }
  }
  res.json({ items })
}))

// GET /api/bookings/:id
// One booking, for the Booking Detail page. Only the booking's owner or sitter can read it.
router.get('/:id', requireLogin, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' })
  const booking = await Booking.findById(req.params.id)
    .populate('ownerId', 'username email profilePicture') // the picture is for the owner card on the Booking Detail page
    .populate('sitterId', 'username email profilePicture sitterProfile.ratingAvg sitterProfile.ratingCount') // + the stars for the sitter card
    .populate('petIds', 'name species breed photo') // + the pets' pictures and breed
  if (!booking) return res.status(404).json({ message: 'Booking not found.' })

  const me = String(req.session.userId)
  if (me !== String(booking.ownerId._id) && me !== String(booking.sitterId._id)) {
    return res.status(403).json({ message: 'This booking is not yours.' })
  }

  res.json(booking)
}))

// PATCH /api/bookings/:id/cancel
// The booking's owner or sitter cancels it. Only pending, accepted or confirmed bookings that haven't started yet can be cancelled
// (a paid booking would need a refund, which doesn't exist yet). The owner uses this to withdraw a request.
// The sitter's hours free up by themselves: only accepted / confirmed / paid / in-progress bookings block the calendar.
// Out: the booking, plus googleRemoved: { removed, reason }
router.patch('/:id/cancel', requireLogin, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' })
  const booking = await Booking.findById(req.params.id)
  if (!booking) return res.status(404).json({ message: 'Booking not found.' })

  const me = String(req.session.userId)
  if (me !== String(booking.ownerId) && me !== String(booking.sitterId)) {
    return res.status(403).json({ message: 'This booking is not yours.' })
  }
  if (!['pending', 'accepted', 'confirmed'].includes(booking.status)) {
    return res.status(400).json({ message: `Only pending, accepted or confirmed bookings can be cancelled. This one is ${booking.status}.` })
  }
  if (bookingRange(booking).start <= Date.now()) {
    return res.status(400).json({ message: 'This booking has already started, so it can no longer be cancelled.' })
  }

  booking.status = 'cancelled'
  booking.cancelledBy = me === String(booking.ownerId) ? 'owner' : 'sitter' // so the other side can see who called it off
  await booking.save()

  // Take the booking out of the sitter's Google Calendar. This never blocks or fails the cancel.
  const googleRemoved = await removeBookingFromGoogle(booking)

  res.json({ ...booking.toObject(), googleRemoved })
}))

// doesnt delete from database itself ; kiv this 
// can use to see which people cancel, and the booking wont js vanish from sitter pov 

export default router
