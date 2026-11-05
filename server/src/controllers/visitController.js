import mongoose from 'mongoose'
import Booking from '../models/bookingModel.js'
import CareChecklist, { taskIsOn } from '../models/CareChecklist.js'
import VisitSession from '../models/VisitSession.js'
import Walk from '../models/walkModel.js'
import { sgtMidnight, toSgtDateString } from '../models/Availability.js'
import { uploadImage, deleteImage } from '../config/cloudinary.js'
import User from '../models/UserModel.js'
import { notify, notifyPaymentDue } from '../models/notificationModel.js'
import { HOME_RADIUS_M, MAX_START_ACCURACY_M, isValidPoint, metresBetween } from '../utils/walkGeo.js'
import { sharingEndTime, bookingRange, bookedDays } from '../utils/bookingTimes.js'
import { buildReportEntries } from '../utils/visitReports.js'
import { closeRecords, recordBlocked, recordReading } from '../utils/locationRecords.js'

const STARTABLE = ['confirmed', 'in-progress'] // owners pay at the end, so sessions start once the owner has confirmed
const PAUSED_AFTER_MS = 60 * 1000 // no update for this long: the owner sees "Location paused"
const RECENT_MS = 30 * 24 * 60 * 60 * 1000 // a finished booking stays under "Recently ended" this long after its last booked time
const MAX_WALK_DISTANCE_M = 100000 // a phone sending more than 100 km for one walk is sending nonsense

// to ensure only valid bookings can be started
function startBlockReason(booking, todaysVisits, today) {
  if (!STARTABLE.includes(booking.status)) {
    return `This booking is ${booking.status}, so a session can't be started.`
  }
  if (today < toSgtDateString(booking.startDate) || today > toSgtDateString(booking.endDate)) {
    return 'This booking is not scheduled for today.'
  }
  if (todaysVisits.length > 0) {
    return "Today's session has already been started."
  }
  return ''
}

// Is the sitter at the home? `reading` is { location: [lng, lat], accuracy }, `home` is [lng, lat] or undefined.
// Weak GPS shouldn't flag a sitter standing in the house, so a reading passes if it could be within
// HOME_RADIUS_M once its accuracy is counted. A reading too vague to use counts as no location.
// Returns { passed: true }, or { check: 'out-of-range', distanceM }, or { check: 'no-location' }.
function checkStartLocation(reading, home) {
  const accuracy = Number(reading?.accuracy)
  if (!home || !isValidPoint(reading?.location) || !Number.isFinite(accuracy) || accuracy > MAX_START_ACCURACY_M) {
    return { check: 'no-location' }
  }
  const distanceM = metresBetween(reading.location, home)
  return distanceM - accuracy <= HOME_RADIUS_M ? { passed: true } : { check: 'out-of-range', distanceM: Math.round(distanceM) }
}

// What the owner's live location card shows. `visit` includes lastLocation, `walk` is the walk under way, if any.
// state: 'blocked', 'paused', 'walk', 'home' or 'away'. There's no position once sharing has stopped.
function liveLocationFor(visit, booking, walk) {
  if (Date.now() >= sharingEndTime(visit, booking)) return { state: 'paused', ended: true, at: visit.lastLocation?.at ?? null }
  if (visit.locationBlocked) return { state: 'blocked' }
  const last = visit.lastLocation
  if (!last) return { state: 'paused', at: null }

  const shared = { position: last.coordinates, at: last.at }
  if (Date.now() - last.at.getTime() >= PAUSED_AFTER_MS) return { ...shared, state: 'paused' }
  if (walk) return { ...shared, state: 'walk' }
  const atHome = checkStartLocation({ location: last.coordinates, accuracy: last.accuracy }, visit.home).passed
  return { ...shared, state: atHome ? 'home' : 'away' }
}

// finds the booking and checks the caller is its owner or sitter
async function loadBooking(req, res) {
  if (!mongoose.isValidObjectId(req.params.bookingId)) {
    res.status(404).json({ message: 'Booking not found.' })
    return null
  }
  const booking = await Booking.findById(req.params.bookingId)
  if (!booking) {
    res.status(404).json({ message: 'Booking not found.' })
    return null
  }
  const me = String(req.session.userId)
  if (me !== String(booking.ownerId) && me !== String(booking.sitterId)) {
    res.status(403).json({ message: 'This booking is not yours.' })
    return null
  }
  return booking
}

// GET /api/visits/today  (owner or sitter): this user's bookings that include today
export async function getTodaySessions(req, res) {
  const today = toSgtDateString(new Date())
  const dayStart = sgtMidnight(today)
  const field = req.session.role === 'sitter' ? 'sitterId' : 'ownerId'

  // A session from an earlier day stays until it's ended, so a sitter can still submit a report after midnight
  const earlier = await VisitSession.find({ status: 'active', date: { $lt: today } }).select('booking')

  const bookings = await Booking.find({
    [field]: req.session.userId,
    $or: [
      { startDate: { $lte: dayStart }, endDate: { $gte: dayStart } },
      { _id: { $in: earlier.map((v) => v.booking) } }
    ],
    status: { $in: ['confirmed', 'in-progress', 'completed', 'paid'] }
  })
    .populate('ownerId', 'username profilePicture')
    .populate('sitterId', 'username profilePicture')
    .populate('petIds', 'name species')

  const ids = bookings.map((b) => b._id)
  const [visits, checklists] = await Promise.all([
    // (lastLocation isn't sent as part of a visit: liveLocationFor decides who sees it)
    VisitSession.find({ booking: { $in: ids }, $or: [{ date: today }, { status: 'active' }] }).select('-lastLocation').sort({ date: 1 }),
    CareChecklist.find({ bookingId: { $in: ids } })
  ])
  const visitByBooking = new Map(visits.map((v) => [String(v.booking), v]))
  const itemsByBooking = new Map(checklists.map((c) => [String(c.bookingId), c.items]))

  // Any walk happening now, so the checklist still shows it after the page reloads
  const walks = await Walk.find({ visit: { $in: visits.map((v) => v._id) }, status: 'in-progress' })
    .select('visit task startedAt plannedPath liveDistanceM')
  const walkByVisit = new Map(walks.map((w) => [String(w.visit), w]))
  // every walk started in these sessions, for the owner's timeline ("Walk finished · 1.3 km"); no paths
  const dayWalks = await Walk.find({ visit: { $in: visits.map((v) => v._id) }, startedAt: { $ne: null } })
    .select('visit task routeName status startedAt endedAt distanceM').sort({ startedAt: 1 })

  const isSitterViewer = req.session.role === 'sitter'

  // owners: how many days of each booking have a finished report, so they can read earlier days' reports
  // while the booking is still going (even with today's session in progress or not started)
  const finishedCounts = isSitterViewer ? [] : await VisitSession.aggregate([
    { $match: { booking: { $in: ids }, status: 'completed' } },
    { $group: { _id: '$booking', n: { $sum: 1 } } }
  ])
  const finishedByBooking = new Map(finishedCounts.map((c) => [String(c._id), c.n]))

  // the owner's live location: only their own bookings, and only during an active session
  const locations = isSitterViewer ? [] : await VisitSession.find({ _id: { $in: visits.filter((v) => v.status === 'active').map((v) => v._id) } })
    .select('date home lastLocation locationBlocked')
  const locationByVisit = new Map(locations.map((v) => [String(v._id), v]))
  const confirmed = (b) => ['confirmed', 'in-progress'].includes(b.status)

 const addressByOwner = new Map()
  if (isSitterViewer) {
    // a booking whose owner account was deleted has no ownerId after populate, so it is skipped instead of crashing
    const ownerIds = [...new Set(bookings.filter((b) => confirmed(b) && b.ownerId).map((b) => String(b.ownerId._id)))]
    if (ownerIds.length > 0) {
      const owners = await User.find({ _id: { $in: ownerIds } })
        .select('+ownerProfile.address +ownerProfile.instructions -password')
      owners.forEach((o) => {
        const a = o.ownerProfile?.address
        const instructions = o.ownerProfile?.instructions || ''
        if (a?.line1 || instructions) {
          addressByOwner.set(String(o._id), {
            line1: a?.line1 || '',
            unit: a?.unit || '',
            postalCode: a?.postalCode || '',
            location: a?.location?.coordinates ?? null, // [lng, lat] for the "Where to go" map
            instructions
          })
        }
      })
    }
  }


  const sessions = bookings
    .map((b) => {
      // The session's day is today, or an earlier day if its session is still open from then
      const visit = visitByBooking.get(String(b._id)) ?? null
      const day = visit?.date ?? today
      // That day's hours: bookings made from now on store hours for each day; old ones use the same hours every day
      const dayHours = b.dayTimes?.find((d) => d.date === day)
      // "Day 2 of 3": counted among the booked days, so the browser never has to count dates itself
      const booked = bookedDays(b)
      const session = {
        booking: {
          _id: b._id,
          status: b.status,
          startDate: toSgtDateString(b.startDate),
          startTime: dayHours?.startTime ?? b.startTime,
          endDate: toSgtDateString(b.endDate),
          endTime: dayHours?.endTime ?? b.endTime,
          day, // the day startTime and endTime are for
          dayNumber: booked.findIndex((d) => d.date === day) + 1,
          totalDays: booked.length,
          owner: b.ownerId,
          sitter: b.sitterId,
          pets: b.petIds,
          notes: b.notes || ''
        },
        visit
      }
      // the tasks for this session's day
      session.items = (itemsByBooking.get(String(b._id)) ?? []).filter((item) => taskIsOn(item, day))
      const walk = session.visit ? walkByVisit.get(String(session.visit._id)) : null
      // distanceSoFarM: for the owner's "On a walk, 0.6 km so far"
      session.activeWalk = walk ? { ...walk.toObject(), distanceSoFarM: walk.liveDistanceM } : null
      session.walks = session.visit ? dayWalks.filter((w) => String(w.visit) === String(session.visit._id)) : []
      if (!isSitterViewer) session.finishedDays = finishedByBooking.get(String(b._id)) ?? 0
      if (session.visit?.status === 'active') {
        const located = locationByVisit.get(String(session.visit._id))
        if (located) session.liveLocation = liveLocationFor(located, b, session.activeWalk)
        if (isSitterViewer) session.sharingEndsAt = sharingEndTime(session.visit, b)
      }
      // only a booking's sitter gets the address, and only once it is confirmed
      if (isSitterViewer && confirmed(b)) {
        session.ownerAddress = addressByOwner.get(String(b.ownerId?._id)) ?? null
      }
      return session
    })
    .filter((s) => s.booking.status !== 'completed' || s.visit)
    .sort((a, b) => (a.booking.startTime || '00:00').localeCompare(b.booking.startTime || '00:00'))

  res.json({ today, sessions })
}

// POST /api/visits/booking/:bookingId/start  (sitter)
// In: { location: [lng, lat], accuracy, note }
// A sitter within range starts straight away. Otherwise this answers 409 with { check, distanceM }, and they can
// send it again with a `note` for the owner: the session then starts, and the owner is notified.
export async function startVisit(req, res) {
  const booking = await loadBooking(req, res)
  if (!booking) {
    return
  }
  if (String(booking.sitterId) !== String(req.session.userId)) {
    return res.status(403).json({ message: "Only this booking's sitter can start a session." })
  }

  const today = toSgtDateString(new Date())
  const todays = await VisitSession.find({ booking: booking._id, date: today })
  const reason = startBlockReason(booking, todays, today)
  if (reason) {
    return res.status(400).json({ message: reason })
  }

  // Only one session at a time: the owner of each sees where the sitter is, so two would show one home to the other
  // (a forgotten session can't block this for long: utils/endForgottenSessions.js closes it)
  const otherSession = await VisitSession.exists({ sitter: req.session.userId, status: 'active' })
  if (otherSession) {
    return res.status(409).json({ message: 'End your other session before starting this one.' })
  }

  const owner = await User.findById(booking.ownerId).select('+ownerProfile.address')
  const result = checkStartLocation(req.body, owner?.ownerProfile?.address?.location?.coordinates)
  let startCheck
  if (!result.passed) {
    const note = String(req.body.note ?? '').trim()
    if (!note) {
      return res.status(409).json({ message: 'Your location could not be confirmed.', check: result.check, distanceM: result.distanceM })
    }
    if (note.length > 200) return res.status(400).json({ message: 'The note can be up to 200 characters.' })
    startCheck = { reason: result.check, note, distanceM: result.distanceM }
  }

  try {
    const home = owner?.ownerProfile?.address?.location?.coordinates
    const visit = await VisitSession.create({ booking: booking._id, sitter: req.session.userId, date: today, startCheck, home })
    if (booking.status !== 'in-progress') {
      booking.status = 'in-progress'
      await booking.save()
    }
    // Tell the owner the session has started (a start without the location check gets the warning instead)
    const [type, message] = startCheck
      ? ['session-unverified', `The sitter started without a location check: "${startCheck.note}"`]
      : ['session-started', 'Your sitter has started today\'s session.']
    try {
      await notify(booking.ownerId, type, message, { booking: booking._id })
    } catch (err) {
      // The session should stand even if its notification cannot be saved (the owner still sees it on the Session page).
      console.error(`Could not create ${type} notification:`, err.message)
    }
    return res.status(201).json(visit)
  } catch (err) {
    if (err.code === 11000) {         
      return res.json(await VisitSession.findOne({ booking: booking._id, date: today }))
    }
    throw err
  }
}

// PATCH /api/visits/:visitId/tasks/:taskId   body: { count }  (sitter)
// POST /api/visits/:visitId/location  (sitter)   body: { location: [lng, lat], accuracy, walkDistanceM } or { blocked: true }
// Only the latest location is kept. walkDistanceM (optional) is the walk's distance so far, worked out by the phone
// from the path it records. Out: { sharing }, false once the booked time plus 30 minutes has passed.
export async function updateLocation(req, res) {
  if (!mongoose.isValidObjectId(req.params.visitId)) {
    return res.status(404).json({ message: 'Session not found.' })
  }
  const visit = await VisitSession.findOne({ _id: req.params.visitId, sitter: req.session.userId })
  if (!visit) {
    return res.status(404).json({ message: 'Session not found.' })
  }
  if (visit.status !== 'active') {
    return res.status(400).json({ message: 'This session is not active.' })
  }

  const booking = await Booking.findById(visit.booking)
  if (!booking || Date.now() >= sharingEndTime(visit, booking)) {
    await VisitSession.updateOne({ _id: visit._id }, { $unset: { lastLocation: 1 } })
    return res.json({ sharing: false })
  }

  // (from here on it's before the sharing cutoff, so the care report's location records are kept too)
  if (req.body.blocked === true) {
    await VisitSession.updateOne({ _id: visit._id }, { $set: { locationBlocked: true, ...recordBlocked(visit) }, $unset: { lastLocation: 1 } })
    return res.json({ sharing: true })
  }

  const { location } = req.body
  const accuracy = Number(req.body.accuracy)
  if (!isValidPoint(location) || !Number.isFinite(accuracy)) {
    return res.status(400).json({ message: 'Your location is missing.' })
  }
  const walking = Boolean(await Walk.exists({ visit: visit._id, status: 'in-progress' }))
  await VisitSession.updateOne({ _id: visit._id }, {
    $set: {
      locationBlocked: false,
      lastLocation: { coordinates: location, accuracy, at: new Date() },
      ...recordReading(visit, { location, accuracy }, walking) // left home, location gaps
    }
  })
  const walkDistanceM = Number(req.body.walkDistanceM)
  if (req.body.walkDistanceM != null && Number.isFinite(walkDistanceM) && walkDistanceM >= 0 && walkDistanceM <= MAX_WALK_DISTANCE_M) {
    await Walk.updateOne({ visit: visit._id, status: 'in-progress' }, { $set: { liveDistanceM: Math.round(walkDistanceM) } })
  }
  res.json({ sharing: true })
}

export async function setTaskCount(req, res) {
  if (!mongoose.isValidObjectId(req.params.visitId)) {
    return res.status(404).json({ message: 'Session not found.' })
  }
  const visit = await VisitSession.findOne({ _id: req.params.visitId, sitter: req.session.userId })
  if (!visit) {
    return res.status(404).json({ message: 'Session not found.' })
  }
  if (visit.status !== 'active') {
    return res.status(400).json({ message: 'This session is not active.' })
  }

  const checklist = await CareChecklist.findOne({ bookingId: visit.booking })
  const item = checklist?.items.id(req.params.taskId)
  if (!item) {
    return res.status(404).json({ message: 'Task not found.' })
  }
  if (!taskIsOn(item, visit.date)) {
    return res.status(400).json({ message: 'This task is not scheduled for today.' })
  }
  // walk tasks are ticked by finishing a tracked walk (walkController), not by hand
  if (item.category === 'walk') {
    return res.status(400).json({ message: 'Walk tasks are ticked off by doing the walk. Press Start walk.' })
  }

  const count = Number(req.body.count)
  if (!Number.isInteger(count) || count < 0 || count > item.dailyFrequency) {
    return res.status(400).json({ message: `Count must be 0 to ${item.dailyFrequency}.` })
  }

  const mine = visit.completedTasks.filter((t) => String(t.task) === String(item._id))
  if (count > mine.length) {
    for (let i = mine.length; i < count; i++) {
      visit.completedTasks.push({ task: item._id, title: item.title })
    }
  } else if (count < mine.length) {
    for (const t of mine.slice(count)) {
      visit.completedTasks.pull(t._id)
    }
  }
  await visit.save()
  res.json(visit)
}

// POST /api/visits/:visitId/end   multipart: notes, photos (up to 3)  (sitter)
export async function endVisit(req, res) {
  if (!mongoose.isValidObjectId(req.params.visitId)) {
    return res.status(404).json({ message: 'Session not found.' })
  }
  const visit = await VisitSession.findOne({ _id: req.params.visitId, sitter: req.session.userId })
  if (!visit) {
    return res.status(404).json({ message: 'Session not found.' })
  }
  if (visit.status !== 'active') {
    return res.status(400).json({ message: 'This session is not active.' })
  }

  // a walk still going on would have nowhere to be ticked off, so it must end first
  if (await Walk.exists({ visit: visit._id, status: 'in-progress' })) {
    return res.status(400).json({ message: 'Finish or end the walk you are on before submitting the report.' })
  }

  const notes = String(req.body.notes ?? '').trim()
  if (!notes) {
    return res.status(400).json({ message: 'Please write a short note for the owner.' })
  }

  const photos = []
  try {
    for (const file of req.files ?? []) {
      const r = await uploadImage(file.buffer, {
        folder: 'petsociety/reports',
        transformation: [{ width: 1200, height: 1200, crop: 'limit' }]
      })
      photos.push({ url: r.secure_url, publicId: r.public_id })
    }
    visit.report = { notes, photos }
    visit.status = 'completed'
    visit.endedAt = new Date()
    visit.set(closeRecords(visit, visit.endedAt)) // anything still open in the location records ends here
    visit.lastLocation = undefined // sharing stops when the session ends
    await visit.save()
  } catch (err) {
    for (const p of photos) {
      await deleteImage(p.publicId)
    }
    throw err
  }

  const booking = await Booking.findById(visit.booking)
  if (booking && visit.date === toSgtDateString(booking.endDate)) {
    booking.status = 'completed'
    await booking.save()
    try {
      await notifyPaymentDue(booking)
    } catch (err) {
      // The booking completion should stand even if saving its notification fails.
      console.error('Could not create payment-due notification:', err.message)
    }
  }
  res.json(visit)
}

// the people and pets a care report shows
const populateForReport = (query) => query
  .populate('sitterId', 'username profilePicture')
  .populate('ownerId', 'username profilePicture')
  .populate('petIds', 'name species')

// GET /api/visits/recent  (owner)
// The owner's finished bookings (completed or paid) whose last booked time was in the last 30 days, newest first,
// with each day's care report. Bookings where no session was ever started are left out.
// Out: { bookings: [entry, ...] }, see utils/visitReports.js
export async function getRecentBookings(req, res) {
  const cutoff = Date.now() - RECENT_MS
  // a rough filter in the database first (endDate is that day's midnight), then the exact end time below
  const candidates = await populateForReport(Booking.find({
    ownerId: req.session.userId,
    status: { $in: ['completed', 'paid'] },
    endDate: { $gte: new Date(cutoff - 24 * 60 * 60 * 1000) }
  }))
  const recent = candidates
    .filter((b) => bookingRange(b).end >= cutoff)
    .sort((a, b) => bookingRange(b).end - bookingRange(a).end)
  const entries = await buildReportEntries(recent)
  res.json({ bookings: entries.filter((e) => e.days.length > 0) })
}

// GET /api/visits/booking/:bookingId/report  (that booking's owner)
// One booking's care reports, whatever its status. Used by "View report" on a completed day of the Today card.
export async function getBookingReport(req, res) {
  if (!mongoose.isValidObjectId(req.params.bookingId)) {
    return res.status(404).json({ message: 'Booking not found.' })
  }
  const booking = await populateForReport(Booking.findById(req.params.bookingId))
  if (!booking) {
    return res.status(404).json({ message: 'Booking not found.' })
  }
  if (String(booking.ownerId?._id) !== String(req.session.userId)) {
    return res.status(403).json({ message: 'Only the owner of this booking can see its reports.' })
  }
  const [entry] = await buildReportEntries([booking])
  res.json(entry)
}
