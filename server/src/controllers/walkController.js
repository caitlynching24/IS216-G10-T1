import mongoose from 'mongoose'
import Walk from '../models/walkModel.js'
import User from '../models/UserModel.js'
import Booking from '../models/bookingModel.js'
import CareChecklist from '../models/CareChecklist.js'
import VisitSession from '../models/VisitSession.js'
import { notify } from '../utils/notify.js'
import { HOME_RADIUS_M, isValidPath, isValidPoint, metresBetween, pathLength } from '../utils/walkGeo.js'

// The sitter's name for notification messages
const sitterName = (req) => req.session.username || 'Your sitter'

// Finds the walk and checks the logged-in sitter is the one walking it.
// Sends a 404 and returns null if not (a walk that isn't yours looks the same as one that doesn't exist).
async function loadSittersWalk(req, res) {
  const walk = await Walk.findById(req.params.id)
  if (!walk || String(walk.sitter) !== String(req.session.userId)) {
    res.status(404).json({ message: 'Walk not found.' })
    return null
  }
  return walk
}

// Ticks the walk's task off in its session (one completed-task entry, linked to this walk),
// so the session's progress and the care report include it. An ended-early walk counts too.
// The walk is already saved, so a problem here is logged rather than failing the request.
async function tickWalkTask(walk) {
  if (!walk.visit || !walk.task) return // walks from before booking integration
  try {
    await VisitSession.updateOne(
      { _id: walk.visit, status: 'active', 'completedTasks.walk': { $ne: walk._id } }, // never tick the same walk twice
      { $push: { completedTasks: { task: walk.task, title: walk.instructions || 'Walk', walk: walk._id } } }
    )
  } catch (err) {
    console.error('Could not tick off the walk task:', err.message)
  }
}

// How a walk is named in notification messages
const walkLabel = (walk) => (walk.mode === 'route' ? `the walk on "${walk.routeName}"` : 'the walk')

// The deviation that's still going on (no endedAt yet), or undefined
const currentDeviation = (walk) => walk.deviations.find((d) => !d.endedAt)

// Marks the walk as ended and saves the walked path, distance and duration
function closeWalk(walk, path, status) {
  const now = new Date()
  walk.status = status
  walk.endedAt = now
  walk.durationS = Math.round((now - walk.startedAt) / 1000)
  if (path.length >= 2) {
    walk.walkedPath = { type: 'LineString', coordinates: path }
    walk.distanceM = pathLength(path)
  }
  // a deviation still going on when the walk ends is closed at the same time
  const current = currentDeviation(walk)
  if (current) current.endedAt = now
}

// POST /api/walks   body: { visitId, taskId }
// Creates a 'ready' walk for one walk task in the sitter's active visit (today's session).
// The route is the copy saved on the booking when it was made, so the owner editing or
// deleting their route later doesn't change it. If a walk for this task is already
// ready or under way, that one is sent back instead, so the sitter can carry on with it.
export async function createWalk(req, res) {
  const { visitId, taskId } = req.body
  if (!mongoose.isValidObjectId(visitId) || !mongoose.isValidObjectId(taskId)) {
    return res.status(400).json({ message: 'Choose a walk task from your session.' })
  }

  // 1. The visit is this sitter's, and it's going on now
  const visit = await VisitSession.findOne({ _id: visitId, sitter: req.session.userId })
  if (!visit) return res.status(404).json({ message: 'Session not found.' })
  if (visit.status !== 'active') return res.status(400).json({ message: 'This session has ended.' })

  // 2. The task is a walk task on this booking's care checklist
  const booking = await Booking.findById(visit.booking)
  const checklist = await CareChecklist.findOne({ bookingId: visit.booking })
  const task = checklist?.items.id(taskId)
  if (!booking || !task || task.category !== 'walk') {
    return res.status(404).json({ message: 'Walk task not found.' })
  }

  // 3. A walk for this task already ready or under way: carry on with that one
  const unfinished = await Walk.findOne({ visit: visit._id, task: task._id, status: { $in: ['ready', 'in-progress'] } })
  if (unfinished) return res.json(unfinished)

  // 4. Not more walks than the task asks for today (an ended-early walk still counts as one)
  const done = await Walk.countDocuments({ visit: visit._id, task: task._id, status: { $in: ['completed', 'ended-early'] } })
  if (done >= task.dailyFrequency) {
    return res.status(400).json({ message: `All ${task.dailyFrequency} of today's walks for this task are done.` })
  }

  // 5. One walk at a time
  const walking = await Walk.findOne({ sitter: req.session.userId, status: 'in-progress' })
  if (walking) {
    return res.status(409).json({ message: 'Finish the walk you are on before starting another.', walkId: walking._id })
  }

  const owner = await User.findById(booking.ownerId).select('+ownerProfile.address')
  const homeCoords = owner?.ownerProfile?.address?.location?.coordinates
  if (!homeCoords) return res.status(400).json({ message: "The owner hasn't set their home address." })

  // A route walk needs the saved route. Anything else (including walk tasks from before routes
  // could be chosen) is an 'instructions' walk: tracked, but not checked against a route.
  const plan = task.walkRoute
  const hasRoute = plan?.mode === 'route' && plan.path?.coordinates?.length >= 2

  const walk = await Walk.create({
    owner: booking.ownerId,
    sitter: req.session.userId,
    booking: booking._id,
    visit: visit._id,
    task: task._id,
    mode: hasRoute ? 'route' : 'instructions',
    instructions: task.title,
    route: hasRoute ? plan.route : null,
    routeName: hasRoute ? plan.name : '',
    plannedPath: hasRoute ? plan.path : undefined,
    home: { type: 'Point', coordinates: homeCoords }
  })
  res.status(201).json(walk)
}

// GET /api/walks/:id -> one walk, for its sitter or its owner
export async function getWalk(req, res) {
  const walk = await Walk.findById(req.params.id)
  const me = String(req.session.userId)
  if (!walk || (me !== String(walk.sitter) && me !== String(walk.owner))) {
    return res.status(404).json({ message: 'Walk not found.' })
  }
  res.json(walk)
}

// POST /api/walks/:id/start   body: { location: [lng, lat] }
export async function startWalk(req, res) {
  const walk = await loadSittersWalk(req, res)
  if (!walk) return
  if (walk.status !== 'ready') return res.status(400).json({ message: 'This walk has already been started.' })

  const { location } = req.body
  if (!isValidPoint(location)) return res.status(400).json({ message: 'Your location is missing.' })
  if (metresBetween(location, walk.home.coordinates) > HOME_RADIUS_M) {
    return res.status(400).json({ message: "Start the walk at the owner's home." })
  }

  walk.status = 'in-progress'
  walk.startedAt = new Date()
  await walk.save()
  res.json(walk)
}

// POST /api/walks/:id/deviations   body: { level: 'warning' | 'notify', location: [lng, lat], distanceM }
// 'warning': the sitter has gone past the first threshold, which starts a deviation
// 'notify':  they've gone past the second threshold, so the owner is told (once per deviation)
export async function reportDeviation(req, res) {
  const walk = await loadSittersWalk(req, res)
  if (!walk) return
  if (walk.status !== 'in-progress') return res.status(400).json({ message: 'This walk is not in progress.' })
  if (walk.mode !== 'route') return res.status(400).json({ message: 'This walk has no route to go off.' })

  const { level, location, distanceM } = req.body
  if (!['warning', 'notify'].includes(level)) return res.status(400).json({ message: 'Unknown deviation level.' })
  if (!isValidPoint(location) || !Number.isFinite(distanceM)) {
    return res.status(400).json({ message: 'The location or distance is missing.' })
  }

  // carry on the current deviation, or start a new one
  let current = currentDeviation(walk)
  if (!current) {
    walk.deviations.push({ startedAt: new Date(), startLocation: location, maxDistanceM: distanceM })
    current = walk.deviations.at(-1)
  }
  current.maxDistanceM = Math.max(current.maxDistanceM, distanceM)

  const notifyOwner = level === 'notify' && !current.ownerNotifiedAt
  if (notifyOwner) current.ownerNotifiedAt = new Date()

  await walk.save()

  if (notifyOwner) {
    await notify(walk.owner, 'walk-off-route',
      `${sitterName(req)} is about ${Math.round(distanceM)} m off the route "${walk.routeName}".`, walk._id)
  }
  res.json(walk)
}

// POST /api/walks/:id/back-on-route   body: { location: [lng, lat] }
// Ends the current deviation. If the owner was told about it, they're told the sitter is back.
export async function reportBackOnRoute(req, res) {
  const walk = await loadSittersWalk(req, res)
  if (!walk) return
  if (walk.status !== 'in-progress') return res.status(400).json({ message: 'This walk is not in progress.' })
  if (walk.mode !== 'route') return res.status(400).json({ message: 'This walk has no route to go off.' })

  const current = currentDeviation(walk)
  if (!current) return res.json(walk) // nothing to end

  current.endedAt = new Date()
  if (isValidPoint(req.body.location)) current.endLocation = req.body.location
  await walk.save()

  if (current.ownerNotifiedAt) {
    await notify(walk.owner, 'walk-back-on-route',
      `${sitterName(req)} is back on the route "${walk.routeName}".`, walk._id)
  }
  res.json(walk)
}

// POST /api/walks/:id/finish   body: { path: [[lng, lat], ...] }
// Ends the walk normally. The path must end at the owner's home.
export async function finishWalk(req, res) {
  const walk = await loadSittersWalk(req, res)
  if (!walk) return
  if (walk.status !== 'in-progress') return res.status(400).json({ message: 'This walk is not in progress.' })

  const { path } = req.body
  if (!isValidPath(path)) return res.status(400).json({ message: 'The walked path is missing or invalid.' })
  if (metresBetween(path.at(-1), walk.home.coordinates) > HOME_RADIUS_M) {
    return res.status(400).json({ message: "Finish the walk at the owner's home, or end it early." })
  }

  closeWalk(walk, path, 'completed')
  await walk.save()
  await tickWalkTask(walk)
  res.json(walk)
}

// POST /api/walks/:id/end-early   body: { path: [[lng, lat], ...], reason }
// Ends the walk anywhere (e.g. an emergency). The owner is told why.
export async function endWalkEarly(req, res) {
  const walk = await loadSittersWalk(req, res)
  if (!walk) return
  if (walk.status !== 'in-progress') return res.status(400).json({ message: 'This walk is not in progress.' })

  const reason = String(req.body.reason ?? '').trim()
  if (!reason) return res.status(400).json({ message: 'Tell the owner why the walk ended early.' })
  if (reason.length > 200) return res.status(400).json({ message: 'Keep the reason under 200 characters.' })

  // the path can be empty if they stopped straight after starting
  const path = req.body.path ?? []
  if (!isValidPath(path, 0)) return res.status(400).json({ message: 'The walked path is invalid.' })

  closeWalk(walk, path, 'ended-early')
  walk.endedEarlyReason = reason
  await walk.save()
  await tickWalkTask(walk)

  await notify(walk.owner, 'walk-ended-early',
    `${sitterName(req)} ended ${walkLabel(walk)} early: ${reason}`, walk._id)
  res.json(walk)
}
