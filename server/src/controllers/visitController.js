import mongoose from 'mongoose'
import Booking from '../models/bookingModel.js'
import CareChecklist from '../models/CareChecklist.js'
import VisitSession from '../models/VisitSession.js'
import Walk from '../models/walkModel.js'
import { sgtMidnight, toSgtDateString } from '../models/Availability.js'
import { uploadImage, deleteImage } from '../config/cloudinary.js'
import User from '../models/UserModel.js'

const STARTABLE = ['confirmed', 'in-progress'] // owners pay at the end, so sessions start once the owner has confirmed

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

  const bookings = await Booking.find({
    [field]: req.session.userId,
    startDate: { $lte: dayStart },
    endDate: { $gte: dayStart },
    status: { $in: ['confirmed', 'in-progress', 'completed', 'paid'] }
  })
    .populate('ownerId', 'username profilePicture')
    .populate('sitterId', 'username profilePicture')
    .populate('petIds', 'name species')

  const ids = bookings.map((b) => b._id)
  const [visits, checklists] = await Promise.all([
    VisitSession.find({ booking: { $in: ids }, date: today }),
    CareChecklist.find({ bookingId: { $in: ids } })
  ])
  const visitByBooking = new Map(visits.map((v) => [String(v.booking), v]))
  const itemsByBooking = new Map(checklists.map((c) => [String(c.bookingId), c.items]))

  const isSitterViewer = req.session.role === 'sitter'
  const confirmed = (b) => ['confirmed', 'in-progress'].includes(b.status)

  const addressByOwner = new Map()
  if (isSitterViewer) {
    // (a booking whose owner account was deleted has no ownerId after populate, so it is skipped instead of crashing)
    const ownerIds = [...new Set(bookings.filter((b) => confirmed(b) && b.ownerId).map((b) => String(b.ownerId._id)))]
    if (ownerIds.length > 0) {
      const owners = await User.find({ _id: { $in: ownerIds } }).select('+ownerProfile.address -password')
      owners.forEach((o) => {
        const a = o.ownerProfile?.address
        if (a?.line1) {
          addressByOwner.set(String(o._id), { line1: a.line1, unit: a.unit || '', postalCode: a.postalCode || '' })
        }
      })
    }
  }

  const sessions = bookings
    .map((b) => {
      const session = {
        booking: {
          _id: b._id,
          status: b.status,
          startDate: toSgtDateString(b.startDate),
          startTime: b.startTime,
          endDate: toSgtDateString(b.endDate),
          endTime: b.endTime,
          owner: b.ownerId,
          sitter: b.sitterId,
          pets: b.petIds,
          notes: b.notes || ''
        },
        items: itemsByBooking.get(String(b._id)) ?? [],
        visit: visitByBooking.get(String(b._id)) ?? null
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

  try {
    const visit = await VisitSession.create({ booking: booking._id, sitter: req.session.userId, date: today })
    if (booking.status !== 'in-progress') {
      booking.status = 'in-progress'
      await booking.save()
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
  }
  res.json(visit)
}