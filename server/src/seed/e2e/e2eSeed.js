// Test data for the Playwright end-to-end tests (e2e/), NOT the demo data (that's pnpm seed / seedDemo.js).
// The tests are written against exactly this data: the seed.* accounts (SeedOwner, SeedSitter, SecondSitter and others),
// pets Mochi and Luna, the SMU loop route, and bookings they find by their notes ("Done and paid", "Walk test", ...).
// e2e/global-setup.js runs it (pnpm seed:e2e) on the tests' own database before every test run.
// It refuses to run on any database whose name doesn't contain "e2e", so it can never touch real or demo data.
// Safe to run many times: it only deletes the seed.* accounts and everything linked to them.
import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import connectDB from '../../config/db.js'
import User from '../../models/UserModel.js'
import Pet from '../../models/petModel.js'
import Booking from '../../models/bookingModel.js'
import CareChecklist from '../../models/CareChecklist.js'
import Payment from '../../models/paymentModel.js'
import Review from '../../models/reviewModel.js'
import WalkRoute from '../../models/walkRouteModel.js'
import Walk from '../../models/walkModel.js'
import VisitSession from '../../models/VisitSession.js'
import Notification from '../../models/notificationModel.js'
import Availability from '../../models/Availability.js'
import { priceForTasks } from '../../utils/servicePrices.js'
import { pathLength } from '../../utils/walkGeo.js'
import Message from '../../models/Message.js'
import { seedSessionPage } from './e2eSessions.js'
import { recalcSitterRating } from '../../utils/ratingsCalc.js'

const SEED_PASSWORD = 'Password123!'
const SEED_TAG = '[seed]'

// Every seed account. Only these emails (and their data) are ever deleted by this script.
const EMAILS = {
  owner: 'seed.owner@petsociety.com',
  priya: 'seed.priya@petsociety.com',
  marcus: 'seed.marcus@petsociety.com',
  hannah: 'seed.hannah@petsociety.com',
  daniel: 'seed.daniel@petsociety.com',
  sitter: 'seed.sitter@petsociety.com',
  sitter2: 'seed.sitter2@petsociety.com',
  aisha: 'seed.aisha@petsociety.com',
  ben: 'seed.ben@petsociety.com',
  chloe: 'seed.chloe@petsociety.com',
  ravi: 'seed.ravi@petsociety.com'
}
const SEED_EMAILS = Object.values(EMAILS)

// ---------- dates and times (all Singapore time) ----------

const DAY_MS = 24 * 60 * 60 * 1000

// Midnight in Singapore, n days from today (negative n = in the past)
function daysFromToday(n) {
  const d = new Date(Date.now() + n * DAY_MS)
  const sgDay = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }) // e.g. "2026-10-14"
  return new Date(`${sgDay}T00:00:00+08:00`)
}

// The date `n` days from today, as a task's `days` stores it: 'YYYY-MM-DD'
const dayString = (n) => daysFromToday(n).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })

// Day of the week of `n` days from today (0 = Sunday)
const weekdayOf = (n) => new Date(`${dayString(n)}T12:00:00+08:00`).getUTCDay()

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// The free half-hours from `from` to `to` ('HH:MM'), as Availability stores them (420 = 7:00 ... 1410 = 23:30)
function slotsBetween(from, to) {
  const slots = []
  for (let m = Math.max(420, toMinutes(from)); m < Math.min(1440, toMinutes(to)); m += 30) slots.push(m)
  return slots
}

// A 2-hour slot later today (starting at least an hour from now), for a "pending today" request.
// If it is too late in the day, it uses 10:00-12:00 tomorrow instead, so the request never expires straight away.
function laterToday() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000) // Singapore clock
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
  const start = Math.max(420, Math.ceil((nowMin + 60) / 30) * 30)
  if (start + 120 <= 1440) return { day: 0, start: toHHMM(start), end: toHHMM(start + 120) }
  return { day: 1, start: '10:00', end: '12:00' }
}

// ---------- care tasks (the price comes from these) ----------

const FEED_TWICE = { category: 'feed', title: 'Feed 1 cup kibble', dailyFrequency: 2 }
const FEED_ONCE = { category: 'feed', title: 'Top up the dry food and water', dailyFrequency: 1 }
const FEED_PELLETS = { category: 'feed', title: 'Pellets and fresh hay', dailyFrequency: 2 }
const FEED_SEEDS = { category: 'feed', title: 'Seed mix and a slice of apple', dailyFrequency: 1 }
const GROOM_ONCE = { category: 'groom', title: 'Brush fur', dailyFrequency: 1 }
const WIPE_PAWS = { category: 'groom', title: 'Wipe paws after going out', dailyFrequency: 1 }
const MEDS_ONCE = { category: 'medication', title: 'Half a tablet with food', dailyFrequency: 1 }
const EYE_DROPS = { category: 'medication', title: 'Eye drops', dailyFrequency: 2 }
const INSULIN = { category: 'medication', title: 'Insulin injection after meals', dailyFrequency: 2 }
const CLEAN_ONCE = { category: 'clean', title: 'Scoop the litter tray', dailyFrequency: 1 }
const WASH_BOWLS = { category: 'clean', title: 'Wash the food and water bowls', dailyFrequency: 1 }
const CLEAN_CAGE = { category: 'clean', title: 'Change the cage lining', dailyFrequency: 1 }
const PLAY_ONCE = { category: 'play', title: 'Play with the feather toy', dailyFrequency: 1 }
const PLAY_FETCH = { category: 'play', title: 'Play fetch in the living room', dailyFrequency: 1 }
const PLAY_OUT = { category: 'play', title: 'Out-of-cage time (supervised)', dailyFrequency: 1 }
const WALK_FREE = { category: 'walk', title: 'Walk around the block', dailyFrequency: 2, walkRoute: { mode: 'instructions' } }
const WALK_PARK = { category: 'walk', title: 'Long walk at the park connector', dailyFrequency: 1, walkRoute: { mode: 'instructions' } }

// ---------- places ([lng, lat]) ----------

// The first owner's home: SMU (81 Victoria Street)
const SMU_HOME = [103.8500, 1.2965]
// A small loop around SMU that starts and ends at the home, for testing walks
const SMU_LOOP = [SMU_HOME, [103.8508, 1.2972], [103.8500, 1.2980], [103.8492, 1.2973], SMU_HOME]
const PLACES = {
  bugis: [103.8559, 1.3006],
  tiongBahru: [103.8270, 1.2859],
  tampines: [103.9568, 1.3496],
  jurongEast: [103.7423, 1.3331],
  toaPayoh: [103.8476, 1.3343],
  angMoKio: [103.8454, 1.3691]
}
const point = (coordinates) => ({ type: 'Point', coordinates })

// ---------- availability ----------

// How many days back and ahead the seed sitters have availability saved
const AVAILABLE_PAST = 45
const AVAILABLE_AHEAD = 30

// Each sitter's usual week: weekday (0 = Sunday) -> [from, to] hours, or null = not available that day
const FULL = ['07:00', '24:00']
const WEEK = {
  sitter: () => FULL,
  sitter2: () => FULL,
  aisha: (wd) => (wd === 0 || wd === 6 ? ['09:00', '18:00'] : ['07:00', '22:00']),
  ben: (wd) => (wd === 3 ? null : wd === 0 || wd === 6 ? FULL : ['17:00', '24:00']),
  chloe: (wd) => (wd === 0 ? null : ['08:00', '20:00']),
  ravi: (wd) => (wd === 0 || wd === 6 ? null : ['10:00', '18:00'])
}

// ---------- bookings ----------

// One booking from `day` days from today, lasting `length` days (1 = a single day).
// opts:
//   hours: [start, end] for every day, or one [start, end] per day for different hours each day
//   length: number of days (default 1)
//   tasks: the care checklist (a task is for all the booking's pets unless it lists its own `pets`)
//   cancelledBy / cancelReason: only for cancelled bookings
//   review: { rating, comment } left by the owner (completed / paid only)
//   payment: 'successful' | 'rejected' (a receipt on the Transactions page)
// Price = each task's fixed price × times a day × its days.
function makeBooking(owner, sitter, pets, day, status, notes, opts) {
  const length = opts.length ?? 1
  const perDay = Array.isArray(opts.hours[0]) ? opts.hours : Array.from({ length }, () => opts.hours)
  const dayTimes = perDay.map(([s, e], i) => ({ date: dayString(day + i), startTime: s, endTime: e }))
  const tasks = opts.tasks
  return {
    booking: {
      ownerId: owner._id,
      sitterId: sitter._id,
      petIds: pets.map((p) => p._id),
      startDate: daysFromToday(day),
      endDate: daysFromToday(day + length - 1),
      startTime: dayTimes[0].startTime,
      endTime: dayTimes[length - 1].endTime,
      dayTimes,
      notes: `${SEED_TAG} ${notes}`,
      totalPrice: priceForTasks(tasks, length),
      status,
      ...(status === 'cancelled' ? { cancelledBy: opts.cancelledBy, cancelReason: opts.cancelReason } : {})
    },
    tasks: tasks.map(({ pets: taskPets, ...t }) => ({ ...t, petIds: (taskPets ?? pets).map((p) => p._id) })),
    review: opts.review,
    payment: opts.payment
  }
}

// Bookings that hold the sitter's time (the sitter's availability is widened to cover these)
const HOLDS_TIME = ['pending', 'accepted', 'confirmed', 'in-progress', 'completed', 'paid']

// The sitter's saved days: their usual week, plus the hours of any booking they have, so no booking sits on a closed day
function availabilityFor(key, sitter, plan) {
  const docs = []
  for (let n = -AVAILABLE_PAST; n < AVAILABLE_AHEAD; n++) {
    const date = dayString(n)
    const usual = WEEK[key](weekdayOf(n))
    const slots = new Set(usual ? slotsBetween(...usual) : [])
    for (const p of plan) {
      if (!p.booking.sitterId.equals(sitter._id) || !HOLDS_TIME.includes(p.booking.status)) continue
      const dt = p.booking.dayTimes.find((d) => d.date === date)
      if (dt) slotsBetween(dt.startTime, dt.endTime).forEach((s) => slots.add(s))
    }
    const sorted = [...slots].sort((a, b) => a - b)
    docs.push({ sitterId: sitter._id, date: daysFromToday(n), status: sorted.length ? 'available' : 'blocked', slots: sorted })
  }
  return docs
}

// ---------- clearing the old seed ----------

async function clearOldSeed() {
  const oldUsers = await User.find({ email: { $in: SEED_EMAILS } })
  const oldIds = oldUsers.map((u) => u._id)
  const oldBookings = await Booking.find({ $or: [{ ownerId: { $in: oldIds } }, { sitterId: { $in: oldIds } }] })
  const oldBookingIds = oldBookings.map((b) => b._id)

  await Review.deleteMany({ $or: [{ owner: { $in: oldIds } }, { sitter: { $in: oldIds } }, { booking: { $in: oldBookingIds } }] })
  await Payment.deleteMany({ $or: [{ ownerId: { $in: oldIds } }, { sitterId: { $in: oldIds } }] })
  await Notification.deleteMany({ recipient: { $in: oldIds } })
  await Walk.deleteMany({ $or: [{ owner: { $in: oldIds } }, { sitter: { $in: oldIds } }] })
  await Message.deleteMany({ booking: { $in: oldBookingIds } })
  await Review.deleteMany({ booking: { $in: oldBookingIds } })
  await Availability.deleteMany({ sitterId: { $in: oldIds } })
  await WalkRoute.deleteMany({ owner: { $in: oldIds } })
  await VisitSession.deleteMany({ booking: { $in: oldBookingIds } })
  await CareChecklist.deleteMany({ bookingId: { $in: oldBookingIds } })
  await Booking.deleteMany({ _id: { $in: oldBookingIds } })
  await Pet.deleteMany({ owner: { $in: oldIds } })
  await User.deleteMany({ _id: { $in: oldIds } })
  return { users: oldIds.length, bookings: oldBookingIds.length }
}

// ---------- the seed ----------

async function seed() {
  await connectDB()
  const dbName = mongoose.connection.db.databaseName
  if (!dbName.includes('e2e')) {
    throw new Error(`Refusing to run the e2e test seed on "${dbName}": it only runs on the tests' own database (e.g. petsociety_e2e)`)
  }
  const cleared = await clearOldSeed()
  console.log(`Removed the old seed: ${cleared.users} users, ${cleared.bookings} bookings (and their data)`)

  const password = await bcrypt.hash(SEED_PASSWORD, 10)
  const years = (n) => new Date(Date.now() - n * 365 * DAY_MS)

  // ----- owners -----
  // Search Sitters recommends sitters that offer the services an owner needs (servicesNeeded).
  const owner = await User.create({
    username: 'SeedOwner', email: EMAILS.owner, password, role: 'owner',
    bio: 'SMU student with a Shiba and a very shy cat.',
    ownerProfile: {
      servicesNeeded: ['Grooming', 'Dog walking'],
      address: { line1: '81 Victoria Street', postalCode: '188065', location: point(SMU_HOME) },
      instructions: 'Ring the bell twice. The spare key is with the security desk.'
    }
  })
  const priya = await User.create({
    username: 'Priya Nair', email: EMAILS.priya, password, role: 'owner',
    bio: 'Nurse on shift work, so I often need someone for the long days.',
    ownerProfile: {
      servicesNeeded: ['Feeding', 'Dog walking', 'Cleaning'],
      address: { line1: '201 Tampines Street 21', unit: '#08-112', postalCode: '520201', location: point(PLACES.tampines) },
      instructions: 'Biscuit pulls on the lead near other dogs.'
    }
  })
  const marcus = await User.create({
    username: 'Marcus Lim', email: EMAILS.marcus, password, role: 'owner',
    bio: 'Big dog, small rabbit, busy job.',
    ownerProfile: {
      servicesNeeded: ['Dog walking', 'Playtime', 'Feeding'],
      address: { line1: '135 Jurong East Street 13', unit: '#04-301', postalCode: '600135', location: point(PLACES.jurongEast) }
    }
  })
  const hannah = await User.create({
    username: 'Hannah Goh', email: EMAILS.hannah, password, role: 'owner',
    bio: 'Retired teacher. Milo is diabetic, so medication matters a lot to me.',
    ownerProfile: {
      servicesNeeded: ['Feeding Medication', 'Feeding', 'Cleaning'],
      address: { line1: '190 Lorong 6 Toa Payoh', unit: '#11-540', postalCode: '310190', location: point(PLACES.toaPayoh) },
      instructions: 'Please keep the windows closed, Sunny can fly out.'
    }
  })
  const daniel = await User.create({
    username: 'Daniel Wong', email: EMAILS.daniel, password, role: 'owner',
    bio: 'First-time dog owner.',
    ownerProfile: {
      servicesNeeded: ['Dog walking', 'Grooming'],
      address: { line1: '406 Ang Mo Kio Avenue 10', unit: '#06-1205', postalCode: '560406', location: point(PLACES.angMoKio) }
    }
  })

  // ----- sitters -----
  // Search Sitters only lists sitters with a service area, services and pet types.
  // There are no per-sitter rates: every task has a fixed price (utils/servicePrices.js).
  const sitter = await User.create({
    username: 'SeedSitter', email: EMAILS.sitter, password, role: 'sitter',
    bio: 'Full-time sitter in Bugis. Happy with dogs and cats, big or small.',
    sitterProfile: {
      experienceStart: years(3),
      services: ['Grooming', 'Feeding', 'Dog walking', 'Feeding Medication', 'Cleaning'],
      petTypes: ['Dog', 'Cat'],
      serviceArea: { label: 'Bugis, Singapore', radiusKm: 10, location: point(PLACES.bugis) }
    }
  })
  const sitter2 = await User.create({
    username: 'SecondSitter', email: EMAILS.sitter2, password, role: 'sitter',
    bio: 'Dog walker around Tiong Bahru and the Alexandra park connector.',
    sitterProfile: {
      experienceStart: years(1.5),
      services: ['Dog walking', 'Playtime', 'Cat walking'],
      petTypes: ['Dog'],
      serviceArea: { label: 'Tiong Bahru, Singapore', radiusKm: 5, location: point(PLACES.tiongBahru) }
    }
  })
  const aisha = await User.create({
    username: 'Aisha Rahman', email: EMAILS.aisha, password, role: 'sitter',
    bio: 'Vet nurse for 6 years. Calm with nervous cats and small animals, and confident with medication.',
    sitterProfile: {
      experienceStart: years(6),
      services: ['Feeding', 'Grooming', 'Feeding Medication', 'Cleaning', 'Playtime', 'Dog walking'],
      petTypes: ['Cat', 'Dog', 'Rabbit', 'Hamster'],
      serviceArea: { label: 'Tampines, Singapore', radiusKm: 12, location: point(PLACES.tampines) }
    }
  })
  const ben = await User.create({
    username: 'Ben Teo', email: EMAILS.ben, password, role: 'sitter',
    bio: 'Uni student who loves big dogs. Free on weekday evenings and all weekend.',
    sitterProfile: {
      experienceStart: years(2),
      services: ['Dog walking', 'Playtime', 'Feeding'],
      petTypes: ['Dog'],
      serviceArea: { label: 'Jurong East, Singapore', radiusKm: 8, location: point(PLACES.jurongEast) }
    }
  })
  const chloe = await User.create({
    username: 'Chloe Ng', email: EMAILS.chloe, password, role: 'sitter',
    bio: 'I keep two cockatiels myself. Birds, cats and senior pets are my favourite.',
    sitterProfile: {
      experienceStart: years(4),
      services: ['Feeding', 'Feeding Medication', 'Cleaning', 'Playtime'],
      petTypes: ['Bird', 'Cat', 'Dog'],
      serviceArea: { label: 'Toa Payoh, Singapore', radiusKm: 10, location: point(PLACES.toaPayoh) }
    }
  })
  const ravi = await User.create({
    username: 'Ravi Kumar', email: EMAILS.ravi, password, role: 'sitter',
    bio: 'New to Pet Society! Grew up with dogs and hamsters.',
    sitterProfile: {
      experienceStart: new Date(Date.now() - 30 * DAY_MS),
      services: ['Feeding', 'Dog walking', 'Playtime', 'Grooming'],
      petTypes: ['Dog', 'Cat', 'Hamster'],
      serviceArea: { label: 'Ang Mo Kio, Singapore', radiusKm: 6, location: point(PLACES.angMoKio) }
    }
  })
  const sitterKeys = { sitter, sitter2, aisha, ben, chloe, ravi }

  // ----- pets -----
  const pet = (o, name, species, breed, ageMonths, description) => Pet.create({ owner: o._id, name, species, breed, ageMonths, description })
  const mochi = await pet(owner, 'Mochi', 'Dog', 'Shiba Inu', 36, 'Friendly, loves walks')
  const luna = await pet(owner, 'Luna', 'Cat', 'British Shorthair', 24, 'Shy at first')
  const biscuit = await pet(priya, 'Biscuit', 'Dog', 'Golden Retriever', 18, 'Very energetic, pulls on the lead')
  const kopi = await pet(priya, 'Kopi', 'Cat', 'Domestic Shorthair', 60, 'Independent, will hide under the bed')
  const rex = await pet(marcus, 'Rex', 'Dog', 'German Shepherd', 60, 'Big but gentle, needs a long walk every day')
  const pebble = await pet(marcus, 'Pebble', 'Rabbit', 'Holland Lop', 14, 'Chews cables, keep them out of reach')
  const sunny = await pet(hannah, 'Sunny', 'Bird', 'Cockatiel', 48, 'Whistles a lot, loves head scratches')
  const milo = await pet(hannah, 'Milo', 'Cat', 'Ragdoll', 120, 'Senior and diabetic, needs insulin twice a day')
  const coco = await pet(daniel, 'Coco', 'Dog', 'Toy Poodle', 10, 'Puppy, still learning to walk on the lead')
  const nugget = await pet(daniel, 'Nugget', 'Hamster', 'Syrian', 8, 'Sleeps in the day, awake at night')

  // A recorded route for the first owner (shows on My Routes), and the two kinds of walk task that use it
  const smuLoop = await WalkRoute.create({
    owner: owner._id, name: 'SMU loop', path: { type: 'LineString', coordinates: SMU_LOOP }, distanceM: pathLength(SMU_LOOP)
  })
  const WALK_ROUTE = {
    category: 'walk', title: 'Walk the SMU loop on the lead', dailyFrequency: 2, pets: [mochi],
    walkRoute: { mode: 'route', route: smuLoop._id, name: smuLoop.name, path: smuLoop.path, distanceM: smuLoop.distanceM }
  }
  const WALK_INSTRUCTIONS = {
    category: 'walk', title: 'Free walk: 15 minutes, anywhere quiet', dailyFrequency: 1, pets: [mochi],
    walkRoute: { mode: 'instructions' }
  }

  const soon = laterToday()

  // Flow: pending -> accepted (sitter) -> confirmed (owner) -> in-progress -> completed (owner pays now) -> paid
  // Also: declined (sitter said no), cancelled (called off before it started, with a reason), expired (never confirmed).
  // Pending / accepted bookings are always in the future: the server turns them 'expired' once their start time passes.
  // Hours are always inside 7:00 to 24:00, in half-hour steps.
  const plan = [
    // ===== SeedOwner (Mochi the dog, Luna the cat) =====
    // 3 days, with a task on one day only, and different hours each day: 10am–12am, all day (7am–12am), 7am–9am
    makeBooking(owner, sitter, [mochi], 20, 'pending', 'Away for the weekend', {
      length: 3, hours: [['10:00', '24:00'], ['07:00', '24:00'], ['07:00', '09:00']],
      tasks: [WALK_ROUTE, FEED_TWICE, PLAY_FETCH, WASH_BOWLS, { ...GROOM_ONCE, days: [dayString(22)] }]
    }),
    makeBooking(owner, sitter2, [mochi], 22, 'pending', 'Morning walks', {
      hours: ['08:00', '12:00'], tasks: [WALK_ROUTE, FEED_ONCE, PLAY_FETCH, WIPE_PAWS]
    }),
    makeBooking(owner, sitter, [luna], 14, 'pending', 'Afternoon with Luna', {
      hours: ['10:00', '14:00'], tasks: [FEED_TWICE, CLEAN_ONCE, PLAY_ONCE, EYE_DROPS]
    }),
    // Both pets, 3 days, nail clip on the last day. No care details yet, so the booking asks for them
    makeBooking(owner, sitter, [mochi, luna], 5, 'confirmed', 'Starts in 5 days, nail clip on the last day', {
      length: 3, hours: ['09:00', '18:00'],
      tasks: [
        FEED_TWICE, WALK_ROUTE, { ...CLEAN_ONCE, pets: [luna] }, { ...PLAY_ONCE, pets: [luna] }, { ...MEDS_ONCE, pets: [mochi] },
        { ...GROOM_ONCE, title: 'Clip nails', pets: [mochi], days: [dayString(7)] }
      ]
    }),
    makeBooking(owner, sitter, [mochi], 2, 'accepted', 'Morning walk, waiting for the owner to confirm', {
      hours: ['08:00', '12:00'], tasks: [WALK_ROUTE, FEED_ONCE, GROOM_ONCE, WASH_BOWLS]
    }),
    makeBooking(owner, sitter, [mochi, luna], 9, 'cancelled', 'Long weekend away', {
      length: 2, hours: [['18:00', '24:00'], ['07:00', '20:00']], tasks: [FEED_TWICE, WALK_ROUTE, { ...CLEAN_ONCE, pets: [luna] }],
      cancelledBy: 'owner', cancelReason: 'Our trip got moved to next month, sorry!'
    }),
    makeBooking(owner, sitter2, [luna], -1, 'expired', 'Owner did not confirm in time', {
      hours: ['09:00', '12:00'], tasks: [FEED_TWICE, CLEAN_ONCE, PLAY_ONCE]
    }),
    makeBooking(owner, sitter, [luna], 0, 'in-progress', 'Session happening today', {
      hours: ['08:00', '20:00'],
      tasks: [
        { ...FEED_TWICE, details: { times: ['09:00', '18:00'], food: 'wet food', amount: 1, unit: 'can' } },
        { ...MEDS_ONCE, details: { medicationName: 'Joint supplement', dosage: 'Half a tablet', withFood: true } },
        { ...CLEAN_ONCE, details: { instructions: 'The scoop and bags are under the sink.' } },
        PLAY_ONCE, GROOM_ONCE
      ]
    }),
    // For testing walks: today, confirmed, so SeedSitter can start the session and press Start walk
    // (it also has care details, and a medication task without any, to show every kind of checklist row)
    makeBooking(owner, sitter, [mochi], 0, 'confirmed', 'Walk test: start the session, then Start walk at SMU', {
      hours: ['20:00', '24:00'],
      tasks: [
        { ...WALK_ROUTE, details: { times: ['20:30', '22:00'], instructions: 'The leash is on the hook by the door.\nPlease avoid the dog park.' } },
        WALK_INSTRUCTIONS,
        { ...FEED_TWICE, details: { times: ['20:15', '23:00'], food: 'kibble', amount: 1, unit: 'cup', instructions: 'The food is in the top cupboard. Please top up the water too.' } },
        { ...MEDS_ONCE, title: 'Heartworm tablet', details: {
          medicationName: 'Heartworm chewable', dosage: '1 tablet', withFood: true, instructions: 'Hide it in a treat.',
          referencePhotos: [{ url: 'https://placehold.co/600x400/png?text=Heartworm+tablets', caption: 'The blue box in the top drawer' }]
        } },
        EYE_DROPS, WASH_BOWLS, PLAY_FETCH, WIPE_PAWS
      ]
    }),
    makeBooking(owner, sitter, [mochi], -3, 'completed', 'Done, waiting for payment', {
      hours: ['10:00', '16:00'], tasks: [WALK_ROUTE, GROOM_ONCE, FEED_ONCE, PLAY_FETCH], payment: 'rejected'
    }),
    makeBooking(owner, sitter, [mochi], -10, 'paid', 'Done and paid', {
      hours: ['09:00', '17:00'], tasks: [WALK_INSTRUCTIONS, FEED_TWICE, WIPE_PAWS, WASH_BOWLS], payment: 'successful',
      review: { rating: 5, comment: 'Mochi came back tired and happy. Sent lots of photos too!' }
    }),
    makeBooking(owner, sitter, [luna], -5, 'declined', 'Sitter was not free', {
      hours: ['10:00', '12:00'], tasks: [FEED_ONCE, CLEAN_ONCE, GROOM_ONCE]
    }),
    makeBooking(owner, aisha, [luna], -21, 'paid', 'Eye drops while I was at a conference', {
      length: 2, hours: [['07:00', '12:00'], ['14:00', '22:00']], tasks: [FEED_TWICE, EYE_DROPS, CLEAN_ONCE], payment: 'successful',
      review: { rating: 5, comment: 'Aisha got the eye drops in without any fuss. Luna even let her brush her.' }
    }),

    // ===== Priya Nair (Biscuit the dog, Kopi the cat) =====
    makeBooking(priya, aisha, [biscuit, kopi], -30, 'paid', 'Covering my night shifts', {
      length: 4, hours: [['16:00', '24:00'], ['07:00', '24:00'], ['07:00', '24:00'], ['07:00', '10:00']],
      tasks: [FEED_TWICE, { ...WALK_FREE, pets: [biscuit] }, { ...CLEAN_ONCE, pets: [kopi] }, WASH_BOWLS], payment: 'successful',
      review: { rating: 5, comment: 'Four days and both pets were spoilt. Biscuit is better on the lead now too.' }
    }),
    makeBooking(priya, aisha, [kopi], -6, 'completed', 'Kopi only this time', {
      length: 2, hours: ['09:00', '13:00'], tasks: [FEED_ONCE, CLEAN_ONCE, PLAY_ONCE],
      review: { rating: 4, comment: 'Lovely as always. Kopi hid the whole first day, but Aisha was patient.' }
    }),
    makeBooking(priya, aisha, [biscuit, kopi], 3, 'confirmed', 'Back-to-back shifts this week', {
      length: 4, hours: [['07:00', '22:00'], ['09:00', '12:00'], ['18:00', '24:00'], ['07:00', '21:00']],
      tasks: [
        FEED_TWICE, { ...WALK_FREE, pets: [biscuit] }, { ...CLEAN_ONCE, pets: [kopi] },
        { ...GROOM_ONCE, title: 'Bath and blow-dry', pets: [biscuit], days: [dayString(6)] }
      ]
    }),
    makeBooking(priya, chloe, [kopi], soon.day, 'pending', 'Last-minute: stuck at the hospital, can someone feed Kopi?', {
      hours: [soon.start, soon.end], tasks: [FEED_ONCE, CLEAN_ONCE]
    }),
    makeBooking(priya, aisha, [biscuit], 12, 'cancelled', 'Day trip to JB', {
      hours: ['07:00', '19:00'], tasks: [{ ...WALK_FREE, pets: [biscuit] }, FEED_TWICE, PLAY_FETCH],
      cancelledBy: 'sitter', cancelReason: 'I have to go for a family wedding that day, so sorry Priya!'
    }),
    makeBooking(priya, ben, [biscuit], -2, 'declined', 'Evening walk', {
      hours: ['18:00', '20:00'], tasks: [{ ...WALK_PARK, pets: [biscuit] }]
    }),

    // ===== Marcus Lim (Rex the dog, Pebble the rabbit) =====
    makeBooking(marcus, ben, [rex], -40, 'paid', 'Weekend walks while I am in KL', {
      length: 2, hours: ['08:00', '20:00'], tasks: [WALK_PARK, FEED_TWICE], payment: 'successful',
      review: { rating: 3, comment: 'Rex was walked and fed, but the updates were a bit slow.' }
    }),
    makeBooking(marcus, ben, [rex, pebble], -14, 'paid', 'Both pets for the day', {
      hours: ['10:00', '22:00'],
      tasks: [{ ...WALK_PARK, pets: [rex] }, { ...FEED_TWICE, pets: [rex] }, { ...FEED_PELLETS, pets: [pebble] }, { ...PLAY_OUT, pets: [pebble] }],
      payment: 'successful',
      review: { rating: 4, comment: 'Much better this time, sent a video of Rex at the park.' }
    }),
    makeBooking(marcus, ben, [rex], 0, 'in-progress', 'Today, long day at the office', {
      hours: ['07:00', '24:00'], tasks: [WALK_PARK, { ...WALK_FREE, title: 'Short toilet walk before bed', dailyFrequency: 1 }, FEED_TWICE, PLAY_FETCH]
    }),
    makeBooking(marcus, ben, [rex], 4, 'accepted', 'Evening walk after work', {
      hours: ['18:00', '21:00'], tasks: [WALK_PARK, FEED_ONCE]
    }),
    makeBooking(marcus, ravi, [pebble], 8, 'pending', 'Pebble while I am at a wedding', {
      length: 2, hours: [['10:00', '18:00'], ['10:00', '14:00']], tasks: [FEED_PELLETS, CLEAN_CAGE, PLAY_OUT]
    }),
    makeBooking(marcus, ben, [rex], -4, 'cancelled', 'Saturday walk', {
      hours: ['09:00', '12:00'], tasks: [WALK_PARK],
      cancelledBy: 'owner', cancelReason: 'Rex hurt his paw, the vet says no walks for a week.'
    }),

    // ===== Hannah Goh (Sunny the cockatiel, Milo the cat) =====
    makeBooking(hannah, chloe, [sunny, milo], -9, 'paid', 'Visiting my sister in Penang', {
      length: 3, hours: [['12:00', '20:00'], ['08:00', '20:00'], ['08:00', '14:00']],
      tasks: [
        { ...INSULIN, pets: [milo], details: { medicationName: 'Caninsulin', dosage: '2 units', withFood: true, times: ['08:30', '19:30'] } },
        { ...FEED_TWICE, title: 'Feed half a pouch', pets: [milo] }, { ...FEED_SEEDS, pets: [sunny] },
        { ...CLEAN_CAGE, pets: [sunny] }, { ...CLEAN_ONCE, pets: [milo] }
      ],
      payment: 'successful',
      review: { rating: 5, comment: 'Chloe was so careful with the insulin. I could actually relax on holiday.' }
    }),
    makeBooking(hannah, chloe, [milo], -1, 'completed', 'Insulin while I was at a check-up', {
      hours: ['08:00', '20:00'], tasks: [{ ...INSULIN, pets: [milo] }, FEED_TWICE, CLEAN_ONCE]
    }),
    makeBooking(hannah, chloe, [sunny, milo], 1, 'confirmed', 'Two days at my daughter\'s place', {
      length: 2, hours: [['08:00', '20:00'], ['08:00', '12:00']],
      tasks: [
        { ...INSULIN, pets: [milo], details: { medicationName: 'Caninsulin', dosage: '2 units', withFood: true, times: ['08:30', '19:30'], instructions: 'The pen is in the fridge door.' } },
        { ...FEED_TWICE, pets: [milo] }, { ...FEED_SEEDS, pets: [sunny] }, { ...PLAY_OUT, title: 'Let Sunny out to fly (windows shut!)', pets: [sunny] }
      ]
    }),
    makeBooking(hannah, aisha, [milo], 10, 'pending', 'Backup sitter for Milo', {
      hours: ['09:00', '18:00'], tasks: [{ ...INSULIN, pets: [milo] }, FEED_TWICE, GROOM_ONCE]
    }),
    makeBooking(hannah, chloe, [sunny], -3, 'expired', 'Morning seeds and cage', {
      hours: ['09:00', '11:00'], tasks: [FEED_SEEDS, CLEAN_CAGE]
    }),
    makeBooking(hannah, chloe, [sunny], 0, 'cancelled', 'Today: cage clean', {
      hours: ['14:00', '16:00'], tasks: [CLEAN_CAGE, FEED_SEEDS],
      cancelledBy: 'sitter', cancelReason: 'Family emergency, I can\'t make it today. Really sorry!'
    }),

    // ===== Daniel Wong (Coco the puppy, Nugget the hamster) =====
    makeBooking(daniel, sitter, [coco], -7, 'paid', 'Puppy-sitting for the day', {
      hours: ['09:00', '18:00'], tasks: [{ ...WALK_FREE, dailyFrequency: 3 }, FEED_TWICE, PLAY_FETCH], payment: 'successful',
      review: { rating: 5, comment: 'Coco learned to sit for treats. Amazing!' }
    }),
    makeBooking(daniel, sitter2, [coco], -2, 'completed', 'Afternoon walks', {
      hours: ['14:00', '18:00'], tasks: [WALK_FREE, WIPE_PAWS],
      review: { rating: 2, comment: 'Coco came back very muddy and the paws were not wiped.' }
    }),
    makeBooking(daniel, sitter2, [coco], 15, 'accepted', 'Walks while I am at a work event', {
      hours: ['17:00', '23:00'], tasks: [WALK_FREE, FEED_ONCE, PLAY_FETCH]
    }),
    makeBooking(daniel, ravi, [coco, nugget], 6, 'pending', 'Both pets for a weekend', {
      length: 2, hours: [['10:00', '18:00'], ['10:00', '18:00']],
      tasks: [{ ...FEED_TWICE, pets: [coco] }, { ...FEED_SEEDS, pets: [nugget] }, { ...CLEAN_CAGE, pets: [nugget] }, { ...WALK_FREE, pets: [coco] }]
    }),
    makeBooking(daniel, ravi, [nugget], 18, 'cancelled', 'Nugget\'s cage clean', {
      hours: ['16:00', '17:00'], tasks: [CLEAN_CAGE],
      cancelledBy: 'owner', cancelReason: 'My parents will be home after all.'
    })
  ]

  // Each sitter's saved days (their usual week plus their booked hours)
  await Availability.insertMany(Object.entries(sitterKeys).flatMap(([key, s]) => availabilityFor(key, s, plan)))

  const bookings = await Booking.insertMany(plan.map((p) => p.booking))
  // Each booking's care checklist, linked by bookingId (same order as `plan`)
  await CareChecklist.insertMany(bookings.map((b, i) => ({
    bookingId: b._id,
    items: plan[i].tasks,
    detailsSavedAt: plan[i].tasks.some((t) => t.details) ? new Date() : null
  })))

  // Receipts for the Transactions page (a 'rejected' one = the owner left Stripe without paying)
  await Payment.insertMany(bookings.flatMap((b, i) => {
    const status = plan[i].payment
    if (!status) return []
    return [{
      bookingId: b._id, ownerId: b.ownerId, sitterId: b.sitterId, amount: b.totalPrice, status,
      ...(status === 'successful' ? { method: 'visa', cardLast4: '4242' } : {})
    }]
  }))

  // Reviews (only on completed / paid bookings), then each sitter's ★ average and count
  await Review.insertMany(bookings.flatMap((b, i) => {
    const r = plan[i].review
    return r ? [{ booking: b._id, sitter: b.sitterId, owner: b.ownerId, rating: r.rating, comment: r.comment }] : []
  }))
  for (const s of Object.values(sitterKeys)) await recalcSitterRating(s._id)

  const counts = {}
  for (const b of bookings) counts[b.status] = (counts[b.status] ?? 0) + 1

  // The Session page: today's sessions in different states, and finished bookings with care reports (e2eSessions.js).
  // e2eSessions.js lists a booking's hours and tasks as plain arguments; this passes them on as makeBooking's opts.
  const bookFor = (o, s, pets, day, start, end, status, notes, tasks, length = 1, hoursByDay = null) =>
    makeBooking(o, s, pets, day, status, notes, { hours: hoursByDay ?? [start, end], length, tasks })
  await seedSessionPage({ owner, sitter, sitter2, mochi, luna, smuLoop }, {
    makeBooking: bookFor, dayString, SMU_HOME, SMU_LOOP, WALK_ROUTE, WALK_INSTRUCTIONS,
    FEED_TWICE, FEED_ONCE, GROOM_ONCE, WIPE_PAWS, EYE_DROPS, CLEAN_ONCE, PLAY_ONCE, PLAY_FETCH
  })

  console.log('Seed done ✅')
  console.log(`${bookings.length} bookings:`, counts)
  console.log(`Every seed account uses the password ${SEED_PASSWORD}`)
  for (const [key, email] of Object.entries(EMAILS)) console.log(`  ${key.padEnd(8)} ${email}`)
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message)
    process.exitCode = 1
  })
  .finally(() => mongoose.disconnect())
