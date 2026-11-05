// Seed data for the Session page: today's sessions in different states, and finished bookings with care reports
// for "Recently ended" and the visit report window. Part of the e2e test data: called by e2eSeed.js (pnpm seed:e2e), which also clears it.
import Booking from '../../models/bookingModel.js'
import CareChecklist from '../../models/CareChecklist.js'
import VisitSession from '../../models/VisitSession.js'
import Walk from '../../models/walkModel.js'
import Message from '../../models/Message.js'
import Review from '../../models/reviewModel.js'
import Payment from '../../models/paymentModel.js'
import { recalcSitterRating } from '../../utils/ratingsCalc.js'
import { pathLength } from '../../utils/walkGeo.js'

const PHOTO = (text) => ({ url: `https://placehold.co/600x600/png?text=${encodeURIComponent(text)}` })
const MINUTE_MS = 60 * 1000

// `h` comes from seedBookings.js: { makeBooking, dayString, SMU_HOME, SMU_LOOP } and the ready-made tasks
export async function seedSessionPage({ owner, sitter, sitter2, mochi, luna, smuLoop }, h) {
  // A time on the day `n` days from today, in Singapore: at(-2, '13:14')
  const at = (n, time) => new Date(`${h.dayString(n)}T${time}:00+08:00`)
  const home = { type: 'Point', coordinates: h.SMU_HOME }

  // Creates a booking and its checklist. Returns the booking, and its tasks by title (so sessions can tick them).
  async function book(...args) {
    const plan = h.makeBooking(...args)
    const booking = await Booking.create(plan.booking)
    const list = await CareChecklist.create({ bookingId: booking._id, items: plan.tasks, detailsSavedAt: new Date() })
    return { booking, task: (title) => list.items.find((t) => t.title === title) }
  }

  // One finished walk, with the tick it gives its task. `deviations`: [[minutesIn, minutesOff, maxM, notified]]
  async function walk(b, visit, task, n, start, end, { mode = 'route', deviations = [], endedEarlyReason = '' } = {}) {
    const startedAt = at(n, start)
    const w = await Walk.create({
      owner: owner._id, sitter: visit.sitter, booking: b.booking._id, visit: visit._id, task: task._id,
      mode, instructions: task.title, home,
      ...(mode === 'route' ? { route: smuLoop._id, routeName: smuLoop.name, plannedPath: smuLoop.path } : {}),
      status: endedEarlyReason ? 'ended-early' : 'completed', endedEarlyReason,
      startedAt, endedAt: at(n, end),
      walkedPath: { type: 'LineString', coordinates: h.SMU_LOOP }, distanceM: pathLength(h.SMU_LOOP),
      durationS: (at(n, end) - startedAt) / 1000,
      deviations: deviations.map(([inM, offM, maxM, notified]) => {
        const s = new Date(startedAt.getTime() + inM * MINUTE_MS)
        return { startedAt: s, endedAt: new Date(s.getTime() + offM * MINUTE_MS), maxDistanceM: maxM, ownerNotifiedAt: notified ? s : null }
      })
    })
    // a walk that ended early still counts, so its task is ticked too
    visit.completedTasks.push({ task: task._id, title: task.title, at: at(n, end), walk: w._id })
    await visit.save()
    return w
  }

  // One day's session. ticks: [[taskTitle, 'HH:MM'], ...]
  async function session(b, who, n, start, end, { ticks = [], notes = '', photos = [], startCheck, autoEnded = false, active = false } = {}) {
    return VisitSession.create({
      booking: b.booking._id, sitter: who._id, date: h.dayString(n),
      status: active ? 'active' : 'completed',
      startedAt: typeof start === 'string' ? at(n, start) : start,
      endedAt: active ? undefined : at(n, end),
      startCheck, autoEnded, home: h.SMU_HOME,
      completedTasks: ticks.map(([title, time]) => ({ task: b.task(title)._id, title, at: at(n, time) })),
      report: active ? undefined : { notes: autoEnded ? "The sitter didn't submit a report." : notes, photos }
    })
  }

  const chat = (b, lines) => Message.insertMany(lines.map(([from, text]) => ({ booking: b.booking._id, sender: from._id, text })))
  const review = (b, who, rating, comment) => Review.create({ booking: b.booking._id, sitter: who._id, owner: owner._id, rating, comment })
  const paidFor = (b, who) => Payment.create({ bookingId: b.booking._id, ownerId: owner._id, sitterId: who._id, amount: b.booking.totalPrice, method: 'visa', cardLast4: '4242', status: 'successful' })

  const HEART = { category: 'medication', title: 'Heart tablet', dailyFrequency: 2, pets: [mochi], details: { medicationName: 'Vetmedin', dosage: '2.5 mg', withFood: true } }
  const FETCH = { category: 'play', title: 'Fetch in the yard', dailyFrequency: 3, pets: [mochi] }
  const MEALS = { category: 'feed', title: 'Meals', dailyFrequency: 1, details: { food: 'Royal Canin', amount: 1, unit: 'cup' } }
  const WALK = { ...h.WALK_ROUTE, title: 'Evening walk', dailyFrequency: 1 }

  // ---- Recently ended: 7 finished bookings, so the list has 2 pages ----

  // 1. Four days, both pets, the second day skipped. Has every kind of warning. Not reviewed (closes in about 29 days).
  const r1 = await book(owner, sitter, [mochi, luna], -4, '09:00', '20:00', 'completed', 'Long weekend, both pets', [
    MEALS, HEART, FETCH, WALK, { ...h.CLEAN_ONCE, pets: [luna] }
  ], 4, [['09:00', '12:00'], ['09:00', '12:00'], ['13:00', '18:00'], ['16:00', '20:00']])
  const d1 = await session(r1, sitter, -4, '09:01', '11:52', {
    ticks: [['Meals', '09:10'], ['Heart tablet', '09:20'], ['Heart tablet', '11:30'], ['Fetch in the yard', '09:40'], ['Fetch in the yard', '10:50'], ['Fetch in the yard', '11:20'], ['Scoop the litter tray', '09:15']],
    notes: 'Both ate well. Mochi pulled a bit on the lead at the start of the walk, then settled.\nLuna hid under the bed for the first hour.',
    photos: [PHOTO('Mochi'), PHOTO('Luna')]
  })
  await walk(r1, d1, r1.task('Evening walk'), -4, '10:00', '10:35')
  const d3 = await session(r1, sitter, -2, '13:14', '18:12', {
    ticks: [['Meals', '13:30'], ['Heart tablet', '13:35'], ['Fetch in the yard', '14:10'], ['Scoop the litter tray', '13:40']],
    notes: 'Missed the second heart tablet, sorry. Mochi would not take it.',
    photos: [PHOTO('Walk')],
    startCheck: { reason: 'out-of-range', distanceM: 220, note: 'GPS is weak in the lift lobby', at: at(-2, '13:14') }
  })
  await walk(r1, d3, r1.task('Evening walk'), -2, '16:30', '17:05', { deviations: [[8, 4, 70, true], [20, 6, 62, true], [28, 2, 40, false]] })
  const d4 = await session(r1, sitter, -1, '16:02', '20:00', { ticks: [['Meals', '16:20']], autoEnded: true })
  await walk(r1, d4, r1.task('Evening walk'), -1, '17:00', '17:12', { endedEarlyReason: 'Heavy rain' })
  await chat(r1, [[owner, 'Luna might hide, that is normal'], [sitter, 'No problem, I will leave her be'], [sitter, 'All done for today!']])

  // 2. One day, ended 17 days ago: the review closes in about 13 days (a yellow chip). No chat.
  const r2 = await book(owner, sitter2, [mochi], -17, '08:00', '12:00', 'completed', 'Morning walk', [{ ...h.WALK_INSTRUCTIONS, title: 'Free walk' }, h.FEED_ONCE])
  const s2 = await session(r2, sitter2, -17, '08:03', '11:40', { ticks: [['Top up the dry food and water', '08:10']], notes: 'Lovely walk by the river.' })
  await walk(r2, s2, r2.task('Free walk'), -17, '09:00', '09:30', { mode: 'instructions' })

  // 3. Two days, paid and reviewed
  const r3 = await book(owner, sitter, [luna], -6, '10:00', '14:00', 'paid', 'Luna while we are away', [h.FEED_TWICE, h.CLEAN_ONCE, h.EYE_DROPS], 2)
  for (const n of [-6, -5]) {
    await session(r3, sitter, n, '10:02', '13:50', {
      ticks: [['Feed 1 cup kibble', '10:10'], ['Feed 1 cup kibble', '13:30'], ['Scoop the litter tray', '10:20'], ['Eye drops', '10:25'], ['Eye drops', '13:40']],
      notes: 'Luna was relaxed today.'
    })
  }
  await chat(r3, [[owner, 'Thank you!'], [sitter, 'Anytime']])
  await review(r3, sitter, 5, 'Luna was relaxed when we got home. Would book again.')
  await paidFor(r3, sitter)

  // 4. Early morning, paid and reviewed
  const r4 = await book(owner, sitter2, [mochi], -8, '07:00', '09:00', 'paid', 'Early walk', [WALK, h.WIPE_PAWS])
  const s4 = await session(r4, sitter2, -8, '07:00', '08:55', { ticks: [['Wipe paws after going out', '08:40']], notes: 'Quick walk before the rain.' })
  await walk(r4, s4, r4.task('Evening walk'), -8, '07:10', '08:30')
  await review(r4, sitter2, 4, 'Good walk, a bit short.')
  await paidFor(r4, sitter2)

  // 5. Both pets, waiting for payment, not reviewed
  const r5 = await book(owner, sitter, [mochi, luna], -11, '09:00', '17:00', 'completed', 'Day visit', [MEALS, h.PLAY_ONCE])
  const s5 = await session(r5, sitter, -11, '09:05', '16:40', { ticks: [['Meals', '09:20']], notes: 'Played with the feather toy, both were tired out.' })
  // the location records the care report shows: left home without a walk, the app closed for a while, location blocked briefly
  s5.awayEpisodes = [{ startedAt: at(-11, '12:30'), endedAt: at(-11, '12:58'), maxDistanceM: 380 }]
  s5.locationGaps = [
    { startedAt: at(-11, '15:05'), endedAt: at(-11, '15:30'), reason: 'stopped', resumedAtHome: true },
    { startedAt: at(-11, '10:00'), endedAt: at(-11, '10:12'), reason: 'blocked', resumedAtHome: true }
  ]
  await s5.save()
  await chat(r5, [[sitter, 'Running 5 minutes late, sorry']])

  // 6. Evening, paid and reviewed
  const r6 = await book(owner, sitter2, [luna], -14, '18:00', '21:00', 'paid', 'Evening feed', [h.FEED_ONCE, h.CLEAN_ONCE])
  await session(r6, sitter2, -14, '18:20', '21:00', { ticks: [['Top up the dry food and water', '18:30'], ['Scoop the litter tray', '18:40']], notes: 'All fine.' })
  await review(r6, sitter2, 3, 'Fine, but arrived late.')
  await paidFor(r6, sitter2)

  // 7. Ended 25 days ago: the review closes in about 5 days
  const r7 = await book(owner, sitter, [mochi], -25, '09:00', '11:00', 'paid', 'Short visit', [h.FEED_ONCE, h.GROOM_ONCE])
  await session(r7, sitter, -25, '09:00', '10:45', { ticks: [['Top up the dry food and water', '09:05'], ['Brush fur', '09:30']], notes: 'Brushed Mochi on the balcony.' })
  await paidFor(r7, sitter)

  // ---- Today ----

  // Last day of three, in progress, with a walk under way and a start-check note (SecondSitter)
  const t1 = await book(owner, sitter2, [mochi, luna], -2, '07:00', '24:00', 'in-progress', 'Three days, today is the last', [
    MEALS, HEART, WALK, { ...h.CLEAN_ONCE, pets: [luna] }
  ], 3)
  for (const n of [-2, -1]) {
    await session(t1, sitter2, n, '07:05', '21:30', {
      ticks: [['Meals', '08:00'], ['Heart tablet', '08:05'], ['Heart tablet', '19:00'], ['Scoop the litter tray', '08:10']],
      notes: 'All good today.'
    })
  }
  const now = Date.now()
  const live = await session(t1, sitter2, 0, new Date(now - 2 * 60 * MINUTE_MS), null, {
    active: true,
    startCheck: { reason: 'out-of-range', distanceM: 140, note: 'Waiting at the lobby, the lift is slow', at: new Date(now - 2 * 60 * MINUTE_MS) }
  })
  live.completedTasks.push({ task: t1.task('Meals')._id, title: 'Meals', at: new Date(now - 100 * MINUTE_MS) })
  live.completedTasks.push({ task: t1.task('Heart tablet')._id, title: 'Heart tablet', at: new Date(now - 95 * MINUTE_MS) })
  live.lastLocation = { coordinates: h.SMU_LOOP[2], accuracy: 12, at: new Date(now) }
  await live.save()
  await Walk.create({
    owner: owner._id, sitter: sitter2._id, booking: t1.booking._id, visit: live._id, task: t1.task('Evening walk')._id,
    mode: 'route', route: smuLoop._id, routeName: smuLoop.name, plannedPath: smuLoop.path, home, instructions: 'Evening walk',
    status: 'in-progress', startedAt: new Date(now - 12 * MINUTE_MS), liveDistanceM: 600
  })
  await chat(t1, [[sitter2, 'On our walk now']])

  // Day 2 of 3, today's session already finished: the owner can open "View report" (SeedSitter)
  const t2 = await book(owner, sitter, [mochi], -1, '09:00', '12:00', 'in-progress', 'Mornings for three days', [h.FEED_TWICE, h.PLAY_FETCH], 3)
  await session(t2, sitter, -1, '09:02', '11:45', { ticks: [['Feed 1 cup kibble', '09:10'], ['Feed 1 cup kibble', '11:30'], ['Play fetch in the living room', '10:00']], notes: 'Good morning.' })
  await session(t2, sitter, 0, '09:02', '11:40', { ticks: [['Feed 1 cup kibble', '09:10'], ['Play fetch in the living room', '10:00']], notes: 'Mochi skipped her second meal.' })

  await recalcSitterRating(sitter._id)
  await recalcSitterRating(sitter2._id)
}
