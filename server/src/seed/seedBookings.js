// Run from the server folder with:  pnpm seed
// Safe to run many times: it only deletes the fake data it created itself.

import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import connectDB from '../config/db.js'
import User from '../models/UserModel.js'
import Pet from '../models/petModel.js'
import Booking from '../models/bookingModel.js'
import CareChecklist from '../models/CareChecklist.js'
import Payment from '../models/paymentModel.js'
import WalkRoute from '../models/walkRouteModel.js'
import Walk from '../models/walkModel.js'
import VisitSession from '../models/VisitSession.js'
import Notification from '../models/notificationModel.js'
import { bookingPrice } from '../utils/servicePrices.js'
import { pathLength } from '../utils/walkGeo.js'

const SEED_OWNER_EMAIL = 'seed.owner@petsociety.com'
const SEED_SITTER_EMAIL = 'seed.sitter@petsociety.com'
const SEED_SITTER2_EMAIL = 'seed.sitter2@petsociety.com'
const SEED_EMAILS = [SEED_OWNER_EMAIL, SEED_SITTER_EMAIL, SEED_SITTER2_EMAIL]
const SEED_PASSWORD = 'Password123!'
const SEED_TAG = '[seed]'

// Midnight in Singapore, n days from today (negative n = in the past)
function daysFromToday(n) {
  const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000)
  const sgDay = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }) // e.g. "2026-10-14"
  return new Date(`${sgDay}T00:00:00+08:00`)
}

// Some ready-made care tasks (the price comes from these)
const WALK_TWICE = { category: 'walk', title: 'Walk around the block', dailyFrequency: 2 }
const FEED_TWICE = { category: 'feed', title: 'Feed 1 cup kibble', dailyFrequency: 2 }
const GROOM_ONCE = { category: 'groom', title: 'Brush fur', dailyFrequency: 1 }
const MEDS_ONCE = { category: 'medication', title: 'Half a tablet with food', dailyFrequency: 1 }
const CLEAN_ONCE = { category: 'clean', title: 'Scoop the litter tray', dailyFrequency: 1 }
const PLAY_ONCE = { category: 'play', title: 'Play with the feather toy', dailyFrequency: 1 }

// The owner's home: SMU (81 Victoria Street), [lng, lat]
const SMU_HOME = [103.8500, 1.2965]
// A small loop around SMU that starts and ends at the home, for testing walks
const SMU_LOOP = [SMU_HOME, [103.8508, 1.2972], [103.8500, 1.2980], [103.8492, 1.2973], SMU_HOME]

// One booking from `day` days from today, lasting `length` days (1 = a single day), from startTime to endTime.
// Price = each task's fixed price × times a day × days (+ $60 a night if overnight).
function makeBooking(owner, sitter, pets, day, startTime, endTime, status, notes, tasks, length = 1, overnight = false) {
  return {
    booking: {
      ownerId: owner._id,
      sitterId: sitter._id,
      petIds: pets.map((p) => p._id),
      startDate: daysFromToday(day),
      endDate: daysFromToday(day + length - 1),
      startTime,
      endTime,
      notes: `${SEED_TAG} ${notes}`,
      overnight,
      totalPrice: bookingPrice(tasks, length, overnight),
      status
    },
    tasks: tasks.map((t) => ({ ...t, petIds: pets.map((p) => p._id) }))
  }
}

async function clearOldSeed() {
  const oldUsers = await User.find({ email: { $in: SEED_EMAILS } })
  const oldIds = oldUsers.map((u) => u._id)
  const oldBookings = await Booking.find({ $or: [{ ownerId: { $in: oldIds } }, { sitterId: { $in: oldIds } }] })
  const oldBookingIds = oldBookings.map((b) => b._id)

  await Payment.deleteMany({ $or: [{ ownerId: { $in: oldIds } }, { sitterId: { $in: oldIds } }] })
  await Notification.deleteMany({ recipient: { $in: oldIds } })
  await Walk.deleteMany({ $or: [{ owner: { $in: oldIds } }, { sitter: { $in: oldIds } }] })
  await WalkRoute.deleteMany({ owner: { $in: oldIds } })
  await VisitSession.deleteMany({ booking: { $in: oldBookingIds } })
  await CareChecklist.deleteMany({ bookingId: { $in: oldBookingIds } })
  await Booking.deleteMany({ _id: { $in: oldBookingIds } })
  await Pet.deleteMany({ owner: { $in: oldIds } })
  await User.deleteMany({ _id: { $in: oldIds } })
}

async function seed() {
  await connectDB()
  await clearOldSeed()

  const password = await bcrypt.hash(SEED_PASSWORD, 10)

  // The owner needs grooming + dog walking, so both sitters can be recommended (each matches one)
  const owner = await User.create({
    username: 'SeedOwner', email: SEED_OWNER_EMAIL, password, role: 'owner',
    ownerProfile: {
      servicesNeeded: ['Grooming', 'Dog walking'],
      address: { line1: '81 Victoria Street', postalCode: '188065', location: { type: 'Point', coordinates: SMU_HOME } }
    }
  })
  const sitter = await User.create({
    username: 'SeedSitter', email: SEED_SITTER_EMAIL, password, role: 'sitter',
    sitterProfile: { services: ['Grooming', 'Feeding'], petTypes: ['Dog', 'Cat'] }
  })
  const sitter2 = await User.create({
    username: 'SecondSitter', email: SEED_SITTER2_EMAIL, password, role: 'sitter',
    sitterProfile: { services: ['Dog walking', 'Playtime'], petTypes: ['Dog'] }
  })

  const mochi = await Pet.create({ owner: owner._id, name: 'Mochi', species: 'Dog', breed: 'Shiba Inu', ageMonths: 36, description: 'Friendly, loves walks' })
  const luna = await Pet.create({ owner: owner._id, name: 'Luna', species: 'Cat', breed: 'British Shorthair', ageMonths: 24, description: 'Shy at first' })

  // A recorded route for the owner (shows on My Routes), and the two kinds of walk task that use it
  const smuLoop = await WalkRoute.create({
    owner: owner._id, name: 'SMU loop', path: { type: 'LineString', coordinates: SMU_LOOP }, distanceM: pathLength(SMU_LOOP)
  })
  const WALK_ROUTE = {
    category: 'walk', title: 'Walk the SMU loop on the lead', dailyFrequency: 2,
    walkRoute: { mode: 'route', route: smuLoop._id, name: smuLoop.name, path: smuLoop.path, distanceM: smuLoop.distanceM }
  }
  const WALK_INSTRUCTIONS = {
    category: 'walk', title: 'Free walk: 15 minutes, anywhere quiet', dailyFrequency: 1,
    walkRoute: { mode: 'instructions' }
  }

  // Flow: pending -> accepted (sitter) -> confirmed (owner) -> in-progress -> completed (owner pays now) -> paid
  const plan = [
    // 3 days with an overnight stay (2 nights): tasks × 3 days + $60 × 2 nights
    makeBooking(owner, sitter, [mochi], 20, '09:00', '17:00', 'pending', 'Away for the weekend, please stay over', [WALK_TWICE, FEED_TWICE], 3, true),
    makeBooking(owner, sitter2, [mochi], 22, '08:00', '12:00', 'pending', 'Morning walks', [WALK_TWICE]),
    makeBooking(owner, sitter, [luna], 14, '10:00', '14:00', 'pending', 'Afternoon with Luna', [FEED_TWICE, CLEAN_ONCE, PLAY_ONCE]),
    makeBooking(owner, sitter, [mochi, luna], 5, '09:00', '18:00', 'confirmed', 'Starts in 5 days', [FEED_TWICE, WALK_TWICE]),
    makeBooking(owner, sitter, [mochi], 2, '08:00', '12:00', 'accepted', 'Morning walk, waiting for the owner to confirm', [WALK_TWICE]),
    makeBooking(owner, sitter2, [luna], -1, '09:00', '12:00', 'expired', 'Owner did not confirm in time', [FEED_TWICE]),
    makeBooking(owner, sitter, [luna], 0, '08:00', '20:00', 'in-progress', 'Session happening today', [FEED_TWICE, MEDS_ONCE]),
    // For testing walks: today, confirmed, so SeedSitter can start the session and press Start walk
    makeBooking(owner, sitter, [mochi], 0, '20:00', '24:00', 'confirmed', 'Walk test: start the session, then Start walk at SMU', [WALK_ROUTE, WALK_INSTRUCTIONS, FEED_TWICE]),
    makeBooking(owner, sitter, [mochi], -3, '10:00', '16:00', 'completed', 'Done, waiting for payment', [WALK_TWICE, GROOM_ONCE]),
    makeBooking(owner, sitter, [mochi], -10, '09:00', '17:00', 'paid', 'Done and paid', [WALK_TWICE, FEED_TWICE]),
    makeBooking(owner, sitter, [luna], -5, '10:00', '12:00', 'declined', 'Sitter was not free', [FEED_TWICE])
  ]

  const bookings = await Booking.insertMany(plan.map((p) => p.booking))
  // Each booking's care checklist, linked by bookingId (same order as `plan`)
  await CareChecklist.insertMany(bookings.map((b, i) => ({ bookingId: b._id, items: plan[i].tasks })))

  // Receipts for the Transactions page:
  // 1) the paid booking was paid successfully
  // 2) the completed booking has one attempt where the owner left Stripe without paying
  const paid = bookings.find((b) => b.status === 'paid')
  const unpaid = bookings.find((b) => b.status === 'completed')
  await Payment.insertMany([
    { bookingId: paid._id, ownerId: owner._id, sitterId: sitter._id, amount: paid.totalPrice, method: 'visa', cardLast4: '4242', status: 'successful' },
    { bookingId: unpaid._id, ownerId: owner._id, sitterId: sitter._id, amount: unpaid.totalPrice, status: 'rejected' }
  ])

  console.log('Seed done ✅')
  console.log(`Owner    login: ${SEED_OWNER_EMAIL} / ${SEED_PASSWORD}`)
  console.log(`Sitter   login: ${SEED_SITTER_EMAIL} / ${SEED_PASSWORD}`)
  console.log(`Sitter 2 login: ${SEED_SITTER2_EMAIL} / ${SEED_PASSWORD}`)
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message)
    process.exitCode = 1
  })
  .finally(() => mongoose.disconnect())