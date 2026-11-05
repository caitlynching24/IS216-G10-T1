// Demo data for showing PetSociety. Run from the server folder with:  pnpm seed:demo
// Safe to run many times: it only deletes accounts whose email starts with "demo." (and everything linked to them).
// The test seed (pnpm seed, seed.* accounts) and anyone else's data are never touched.
//
// 4 owners (most living at SMU School of Economics) and 12 sitters, with pets, walk routes, availability,
// bookings in every status, care details, sessions with walks and reports, chats, reviews, receipts and notifications.
// Some accounts have enough to fill more than one page: Claire's past bookings, receipts and Recently ended,
// Benny's requests, reviews and payments, and the 12 sitters in Search Sitters.
// Every demo account's password is Password123!

import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import connectDB from '../config/db.js'
import User from '../models/UserModel.js'
import Pet from '../models/petModel.js'
import Booking from '../models/bookingModel.js'
import CareChecklist from '../models/CareChecklist.js'
import Payment from '../models/paymentModel.js'
import Review from '../models/reviewModel.js'
import WalkRoute from '../models/walkRouteModel.js'
import Walk from '../models/walkModel.js'
import VisitSession from '../models/VisitSession.js'
import Message from '../models/Message.js'
import Notification, { notify } from '../models/notificationModel.js'
import Availability from '../models/Availability.js'
import { priceForTasks } from '../utils/servicePrices.js'
import { pathLength } from '../utils/walkGeo.js'
import { recalcSitterRating } from '../utils/ratingsCalc.js'

const PASSWORD = 'Password123!'
const DEMO_EMAIL = /^demo\.[^@]+@petsociety\.com$/
const email = (name) => `demo.${name}@petsociety.com`
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

// ---------- dates and times (Singapore) ----------

// 'YYYY-MM-DD', n days from today
const dayString = (n) => new Date(Date.now() + n * DAY_MS).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })
// Midnight in Singapore, n days from today
const midnight = (n) => new Date(`${dayString(n)}T00:00:00+08:00`)
// A time on the day n days from today: at(-2, '13:14')
const at = (n, time) => new Date(`${dayString(n)}T${time}:00+08:00`)
const weekdayOf = (n) => new Date(`${dayString(n)}T12:00:00+08:00`).getUTCDay() // 0 = Sunday
const minutesAgo = (m) => new Date(Date.now() - m * MINUTE_MS)
const yearsAgo = (y) => new Date(Date.now() - y * 365 * DAY_MS)
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

// The free half-hours from `from` to `to`, as Availability stores them (420 = 7:00 ... 1410 = 23:30)
function slotsBetween(from, to) {
  const slots = []
  for (let m = Math.max(420, toMinutes(from)); m < Math.min(1440, toMinutes(to)); m += 30) slots.push(m)
  return slots
}

// ---------- places ([lng, lat]) ----------

// SMU School of Economics, 90 Stamford Road: home for most of the owners
const SOE = [103.8489, 1.2977]
const point = (coordinates) => ({ type: 'Point', coordinates })
const PLACES = {
  bugis: [103.8559, 1.3006],
  tanjongPagar: [103.8435, 1.2764],
  tiongBahru: [103.8270, 1.2859],
  novena: [103.8437, 1.3204],
  tampines: [103.9568, 1.3496],
  clementi: [103.7649, 1.3151],
  orchard: [103.8318, 1.3048],
  angMoKio: [103.8454, 1.3691],
  marineParade: [103.9050, 1.3026],
  jurongEast: [103.7423, 1.3331],
  bishan: [103.8487, 1.3508],
  kallang: [103.8714, 1.3114],
  toaPayoh: [103.8476, 1.3343]
}
// Walk routes that start and end at SOE
const ROUTES = {
  soeLoop: [SOE, [103.8500, 1.2984], [103.8511, 1.2976], [103.8500, 1.2967], SOE],
  fortCanning: [SOE, [103.8478, 1.2970], [103.8462, 1.2955], [103.8447, 1.2949], [103.8458, 1.2968], [103.8474, 1.2981], SOE],
  stamfordGreen: [SOE, [103.8496, 1.2989], [103.8507, 1.2995], [103.8519, 1.2988], [103.8505, 1.2978], SOE]
}

// ---------- people ----------

const OWNERS = [
  {
    key: 'claire', username: 'shibamumclaire', bio: 'Economics student with a stubborn Shiba and a sleepy Ragdoll. Always looking for reliable walkers.',
    servicesNeeded: ['Dog walking', 'Grooming', 'Feeding'],
    address: { line1: '90 Stamford Road', unit: '#03-14', postalCode: '178903', location: point(SOE) },
    instructions: 'Come to the SOE lobby and call me. Hachi\'s lead and poop bags are in the blue tote by the door.'
  },
  {
    key: 'rayyan', username: 'dogdadrayyan', bio: 'Teaching assistant at SOE. Bobo is a big softie who needs a lot of exercise.',
    servicesNeeded: ['Dog walking', 'Playtime'],
    address: { line1: '90 Stamford Road', unit: '#04-08', postalCode: '178903', location: point(SOE) },
    instructions: 'Kiwi\'s cage door sticks, push it until it clicks.'
  },
  {
    key: 'meiling', username: 'meowmeiling', bio: 'Two cats, one very picky eater. I travel for conferences a lot.',
    servicesNeeded: ['Feeding', 'Cleaning', 'Feeding Medication'],
    address: { line1: '90 Stamford Road', unit: '#02-01', postalCode: '178903', location: point(SOE) },
    instructions: 'Please keep the balcony door closed, Miso likes to sneak out.'
  },
  {
    key: 'jun', username: 'bunnybossjun', bio: 'Small pets only! A rabbit and a hamster who run the house.',
    servicesNeeded: ['Feeding', 'Cleaning'],
    address: { line1: '190 Lorong 6 Toa Payoh', unit: '#11-540', postalCode: '310190', location: point(PLACES.toaPayoh) }
  }
]

// Each sitter's usual week: weekday (0 = Sunday) -> [from, to], or null = not available
const FULL = ['07:00', '24:00']
const SITTERS = [
  { key: 'benny', username: 'petbuddybenny', years: 5, area: 'Bugis', at: PLACES.bugis, radiusKm: 10,
    services: ['Dog walking', 'Feeding', 'Grooming', 'Playtime', 'Cleaning', 'Feeding Medication'], petTypes: ['Dog', 'Cat', 'Rabbit'],
    bio: 'Full-time sitter five minutes from SMU. Shibas, Ragdolls and rabbits are my specialty.', week: () => FULL },
  { key: 'priya', username: 'pawsitivepriya', years: 7, area: 'Tanjong Pagar', at: PLACES.tanjongPagar, radiusKm: 8,
    services: ['Feeding', 'Feeding Medication', 'Cleaning', 'Grooming'], petTypes: ['Cat', 'Dog'],
    bio: 'Former vet technician. Calm with nervous cats and confident with eye drops and tablets.',
    week: (wd) => (wd === 0 || wd === 6 ? ['09:00', '18:00'] : ['07:00', '22:00']) },
  { key: 'wei', username: 'walkieswithwei', years: 2, area: 'Tiong Bahru', at: PLACES.tiongBahru, radiusKm: 6,
    services: ['Dog walking', 'Playtime'], petTypes: ['Dog'],
    bio: 'Runner and dog lover. I know every park connector between Tiong Bahru and the CBD.',
    week: (wd) => (wd === 0 || wd === 6 ? FULL : ['17:00', '24:00']) },
  { key: 'carmen', username: 'catnapcarmen', years: 3, area: 'Novena', at: PLACES.novena, radiusKm: 8,
    services: ['Feeding', 'Cleaning', 'Playtime', 'Grooming'], petTypes: ['Cat'],
    bio: 'Cats only, and proud of it. I bring my own wand toys.', week: (wd) => (wd === 0 ? null : ['08:00', '20:00']) },
  { key: 'faiz', username: 'furryfriendfaiz', years: 4, area: 'Tampines', at: PLACES.tampines, radiusKm: 15,
    services: ['Dog walking', 'Feeding', 'Cleaning', 'Playtime', 'Feeding Medication'], petTypes: ['Dog', 'Cat', 'Rabbit', 'Hamster'],
    bio: 'Happy to travel across the island. Big dogs and small pets alike.', week: () => FULL },
  { key: 'lucas', username: 'leashlifelucas', years: 1, area: 'Clementi', at: PLACES.clementi, radiusKm: 7,
    services: ['Dog walking', 'Feeding'], petTypes: ['Dog'],
    bio: 'NUS student, free most afternoons. Energetic dogs welcome.', week: (wd) => (wd === 3 ? null : ['12:00', '22:00']) },
  { key: 'wendy', username: 'whiskerwendy', years: 6, area: 'Orchard', at: PLACES.orchard, radiusKm: 9,
    services: ['Grooming', 'Feeding', 'Playtime'], petTypes: ['Cat', 'Dog'],
    bio: 'Trained groomer. Long-haired cats get the full spa treatment.', week: (wd) => (wd === 1 ? null : ['09:00', '21:00']) },
  { key: 'bala', username: 'barkbuddybala', years: 3, area: 'Ang Mo Kio', at: PLACES.angMoKio, radiusKm: 12,
    services: ['Dog walking', 'Playtime', 'Feeding'], petTypes: ['Dog'],
    bio: 'Grew up with three retrievers. Long walks are my favourite part of the day.', week: () => FULL },
  { key: 'tiffany', username: 'tailwagtiffany', years: 2, area: 'Marine Parade', at: PLACES.marineParade, radiusKm: 10,
    services: ['Feeding', 'Playtime', 'Cleaning'], petTypes: ['Dog', 'Cat'],
    bio: 'Work from home, so I can pop by in the middle of the day.', week: (wd) => (wd === 0 || wd === 6 ? null : ['10:00', '19:00']) },
  { key: 'kai', username: 'critterkeeperkai', years: 5, area: 'Jurong East', at: PLACES.jurongEast, radiusKm: 20,
    services: ['Feeding', 'Cleaning', 'Feeding Medication'], petTypes: ['Rabbit', 'Hamster', 'Bird'],
    bio: 'Small animals and birds. I keep two rabbits and a cockatiel of my own.', week: () => FULL },
  { key: 'sara', username: 'snugglesitsara', years: 8, area: 'Bishan', at: PLACES.bishan, radiusKm: 10,
    services: ['Feeding Medication', 'Feeding', 'Cleaning'], petTypes: ['Cat', 'Dog'],
    bio: 'Senior pets and pets on medication are my calling. Patient, gentle and on time.',
    week: (wd) => (wd === 0 ? ['10:00', '16:00'] : ['07:00', '21:00']) },
  { key: 'harith', username: 'happytrailsharith', years: 0.2, area: 'Kallang', at: PLACES.kallang, radiusKm: 6,
    services: ['Dog walking'], petTypes: ['Dog'],
    bio: 'New to PetSociety! I walk my neighbour\'s dogs every morning.', week: (wd) => (wd === 0 || wd === 6 ? ['07:00', '12:00'] : null) }
]

// ---------- clearing the old demo ----------

async function clearDemo() {
  const users = await User.find({ email: DEMO_EMAIL })
  const ids = users.map((u) => u._id)
  const bookingIds = (await Booking.find({ $or: [{ ownerId: { $in: ids } }, { sitterId: { $in: ids } }] })).map((b) => b._id)
  await Review.deleteMany({ $or: [{ owner: { $in: ids } }, { sitter: { $in: ids } }, { booking: { $in: bookingIds } }] })
  await Payment.deleteMany({ $or: [{ ownerId: { $in: ids } }, { sitterId: { $in: ids } }] })
  await Notification.deleteMany({ recipient: { $in: ids } })
  await Walk.deleteMany({ $or: [{ owner: { $in: ids } }, { sitter: { $in: ids } }] })
  await Message.deleteMany({ booking: { $in: bookingIds } })
  await VisitSession.deleteMany({ booking: { $in: bookingIds } })
  await CareChecklist.deleteMany({ bookingId: { $in: bookingIds } })
  await Booking.deleteMany({ _id: { $in: bookingIds } })
  await Availability.deleteMany({ sitterId: { $in: ids } })
  await WalkRoute.deleteMany({ owner: { $in: ids } })
  await Pet.deleteMany({ owner: { $in: ids } })
  await User.deleteMany({ _id: { $in: ids } })
  return { users: ids.length, bookings: bookingIds.length }
}

// ---------- the demo ----------

async function seed() {
  await connectDB()
  const cleared = await clearDemo()
  console.log(`Removed the old demo: ${cleared.users} users, ${cleared.bookings} bookings (and their data)`)

  const password = await bcrypt.hash(PASSWORD, 10)

  // ----- people -----
  const o = {}
  for (const x of OWNERS) {
    o[x.key] = await User.create({
      username: x.username, email: email(x.key), password, role: 'owner', bio: x.bio,
      ownerProfile: { servicesNeeded: x.servicesNeeded, address: x.address, instructions: x.instructions }
    })
  }
  const s = {}
  for (const x of SITTERS) {
    s[x.key] = await User.create({
      username: x.username, email: email(x.key), password, role: 'sitter', bio: x.bio,
      sitterProfile: {
        experienceStart: yearsAgo(x.years), services: x.services, petTypes: x.petTypes,
        serviceArea: { label: `${x.area}, Singapore`, radiusKm: x.radiusKm, location: point(x.at) }
      }
    })
  }

  // When each account joined: Search shows a "New sitter" badge for accounts under 3 days old, so only Harith is new
  const joined = { claire: 300, rayyan: 200, meiling: 420, jun: 90, harith: 2 }
  for (const [key, user] of [...Object.entries(o), ...Object.entries(s)]) {
    const daysAgo = joined[key] ?? Math.round(Math.min(SITTERS.find((x) => x.key === key)?.years ?? 1, 3) * 365)
    // (straight to the collection: Mongoose won't change createdAt once it's set)
    await User.collection.updateOne({ _id: user._id }, { $set: { createdAt: new Date(Date.now() - daysAgo * DAY_MS) } })
  }

  // ----- pets -----
  const pet = (owner, name, species, breed, ageMonths, description) => Pet.create({ owner: owner._id, name, species, breed, ageMonths, description })
  const hachi = await pet(o.claire, 'Hachi', 'Dog', 'Shiba Inu', 42, 'Stubborn on walks, sweet at home. Pulls towards other dogs.')
  const kaya = await pet(o.claire, 'Kaya', 'Cat', 'Ragdoll', 30, 'Sleeps all day, eats like a horse.')
  const bobo = await pet(o.rayyan, 'Bobo', 'Dog', 'Golden Retriever', 24, 'Big, friendly and always hungry.')
  const kiwi = await pet(o.rayyan, 'Kiwi', 'Bird', 'Budgerigar', 18, 'Chatty in the mornings.')
  const tofu = await pet(o.meiling, 'Tofu', 'Cat', 'Scottish Fold', 72, 'Senior, has a sensitive tummy.')
  const miso = await pet(o.meiling, 'Miso', 'Cat', 'Domestic Shorthair', 20, 'Escape artist, watch the doors.')
  const pudding = await pet(o.jun, 'Pudding', 'Rabbit', 'Holland Lop', 16, 'Chews cables, keep them out of reach.')
  const dumpling = await pet(o.jun, 'Dumpling', 'Hamster', 'Syrian', 9, 'Awake at night, sleeps in the day.')

  // ----- walk routes (My Routes) -----
  const route = (owner, name, coords) => WalkRoute.create({ owner: owner._id, name, path: { type: 'LineString', coordinates: coords }, distanceM: pathLength(coords) })
  const soeLoop = await route(o.claire, 'SOE loop', ROUTES.soeLoop)
  const fortCanning = await route(o.claire, 'Fort Canning park', ROUTES.fortCanning)
  const stamfordGreen = await route(o.rayyan, 'Stamford Green loop', ROUTES.stamfordGreen)
  const routeOf = (r) => ({ mode: 'route', route: r._id, name: r.name, path: r.path, distanceM: r.distanceM })

  // ----- care tasks (the price comes from these; `pets` limits a task to some of the booking's pets) -----
  const T = {
    hachiWalk: { category: 'walk', title: 'Walk Hachi on the SOE loop', dailyFrequency: 1, pets: [hachi], walkRoute: routeOf(soeLoop),
      details: { times: ['08:00'], instructions: 'Use the harness, not the collar. He tries to eat things on Stamford Road.' } },
    hachiPark: { category: 'walk', title: 'Long walk at Fort Canning', dailyFrequency: 1, pets: [hachi], walkRoute: routeOf(fortCanning),
      details: { times: ['17:30'], instructions: 'Let him sniff around the spice garden, he loves it.' } },
    hachiFeed: { category: 'feed', title: 'Hachi\'s breakfast and dinner', dailyFrequency: 2, pets: [hachi],
      details: { times: ['08:30', '18:30'], food: 'salmon kibble', amount: 1, unit: 'cup' } },
    kayaFeed: { category: 'feed', title: 'Kaya\'s wet food', dailyFrequency: 2, pets: [kaya],
      details: { times: ['09:00', '19:00'], food: 'chicken pate', amount: 1, unit: 'can', instructions: 'Mash it a little, she won\'t eat big chunks.' } },
    kayaBrush: { category: 'groom', title: 'Brush Kaya\'s coat', dailyFrequency: 1, pets: [kaya],
      details: { instructions: 'Slicker brush is in the bathroom drawer. Go gently around the tummy.' } },
    kayaDrops: { category: 'medication', title: 'Kaya\'s eye drops', dailyFrequency: 2, pets: [kaya],
      details: { times: ['09:00', '19:00'], medicationName: 'Tobrex', dosage: '1 drop each eye', withFood: false } },
    litter: { category: 'clean', title: 'Scoop the litter tray', dailyFrequency: 1, pets: [kaya], details: { instructions: 'Bags under the sink.' } },
    playHachi: { category: 'play', title: 'Tug of war with Hachi', dailyFrequency: 1, pets: [hachi] },
    boboWalk: { category: 'walk', title: 'Walk Bobo around Stamford Green', dailyFrequency: 2, pets: [bobo], walkRoute: routeOf(stamfordGreen),
      details: { times: ['07:30', '18:00'], instructions: 'He loves the water fountain, let him have a drink.' } },
    boboFeed: { category: 'feed', title: 'Feed Bobo', dailyFrequency: 2, pets: [bobo], details: { food: 'lamb kibble', amount: 2, unit: 'cup' } },
    boboPlay: { category: 'play', title: 'Fetch with Bobo', dailyFrequency: 1, pets: [bobo] },
    kiwiFeed: { category: 'feed', title: 'Kiwi\'s seed mix', dailyFrequency: 1, pets: [kiwi], details: { food: 'seed mix', amount: 1, unit: 'scoop' } },
    catsFeed: { category: 'feed', title: 'Feed Tofu and Miso', dailyFrequency: 2, details: { times: ['08:00', '20:00'], food: 'renal diet kibble', amount: 0.5, unit: 'cup' } },
    tofuMeds: { category: 'medication', title: 'Tofu\'s tummy tablet', dailyFrequency: 1, pets: [tofu],
      details: { times: ['08:00'], medicationName: 'Famotidine', dosage: 'Half a tablet', withFood: true, instructions: 'Hide it in a treat.' } },
    tofuMedsNoDetails: { category: 'medication', title: 'Tofu\'s tummy tablet', dailyFrequency: 1, pets: [tofu] },
    catsLitter: { category: 'clean', title: 'Clean both litter trays', dailyFrequency: 1 },
    catsPlay: { category: 'play', title: 'Wand toy time', dailyFrequency: 1 },
    puddingFeed: { category: 'feed', title: 'Pellets and fresh hay', dailyFrequency: 2, pets: [pudding], details: { food: 'timothy hay pellets', amount: 0.25, unit: 'cup' } },
    dumplingFeed: { category: 'feed', title: 'Top up Dumpling\'s seeds', dailyFrequency: 1, pets: [dumpling] },
    cage: { category: 'clean', title: 'Change the cage lining', dailyFrequency: 1 },
    puddingPlay: { category: 'play', title: 'Out-of-cage time (supervised)', dailyFrequency: 1, pets: [pudding] }
  }

  // ----- bookings -----
  // One booking from `day` days from today. opts: hours ([from, to] every day, or one per day), length, tasks,
  // review, payment ('successful' | 'rejected'), cancelledBy / cancelReason, noDetails (leave out the care details).
  const plan = []
  function book(owner, sitter, pets, day, status, notes, opts) {
    const length = opts.length ?? 1
    const perDay = Array.isArray(opts.hours[0]) ? opts.hours : Array.from({ length }, () => opts.hours)
    const dayTimes = perDay.map(([from, to], i) => ({ date: dayString(day + i), startTime: from, endTime: to }))
    const p = {
      booking: {
        ownerId: owner._id, sitterId: sitter._id, petIds: pets.map((x) => x._id),
        startDate: midnight(day), endDate: midnight(day + length - 1),
        startTime: dayTimes[0].startTime, endTime: dayTimes[length - 1].endTime, dayTimes,
        notes, totalPrice: priceForTasks(opts.tasks, length), status,
        ...(status === 'cancelled' ? { cancelledBy: opts.cancelledBy, cancelReason: opts.cancelReason } : {})
      },
      tasks: opts.tasks.map(({ pets: only, details, ...t }) => ({
        ...t, petIds: (only ?? pets).map((x) => x._id), ...(details && !opts.noDetails ? { details } : {})
      })),
      opts
    }
    plan.push(p)
    return p
  }

  // Claire (Hachi and Kaya): the fullest account
  const claireLong = book(o.claire, s.benny, [hachi, kaya], -4, 'paid', 'Away for a long weekend in KL.', {
    length: 3, hours: [['07:00', '21:00'], ['07:00', '21:00'], ['07:00', '20:00']],
    tasks: [T.hachiWalk, T.hachiPark, T.hachiFeed, T.kayaFeed, T.litter], review: [5, 'Benny sent photos every day and Hachi came back happy and tired. Booking again!'], payment: 'successful'
  })
  const claireP2 = book(o.claire, s.benny, [hachi], -7, 'paid', 'Exam day, back late.', { hours: ['08:00', '19:00'], tasks: [T.hachiWalk, T.hachiFeed, T.playHachi], review: [5, 'Always on time and Hachi adores him.'], payment: 'successful' })
  const claireP3 = book(o.claire, s.priya, [kaya], -9, 'paid', 'Kaya has an eye infection, needs drops twice a day.', { hours: ['08:30', '19:30'], tasks: [T.kayaDrops, T.kayaFeed, T.litter], review: [5, 'Priya handled the eye drops like a pro. Kaya didn\'t even fuss.'], payment: 'successful' })
  const claireP4 = book(o.claire, s.wei, [hachi], -12, 'paid', 'Evening walk only.', { hours: ['17:00', '19:00'], tasks: [T.hachiPark], review: [4, 'Good walk, but it was cut short by the rain.'], payment: 'successful' })
  const claireP5 = book(o.claire, s.benny, [hachi, kaya], -15, 'paid', 'Two days while I\'m at a case competition.', { length: 2, hours: ['07:00', '20:00'], tasks: [T.hachiWalk, T.hachiFeed, T.kayaFeed, T.kayaBrush], review: [4, 'Great care. The second day\'s report was missing though.'], payment: 'successful' })
  const claireP6 = book(o.claire, s.carmen, [kaya], -18, 'paid', 'Just Kaya this time.', { hours: ['10:00', '13:00'], tasks: [T.kayaFeed, T.kayaBrush, T.litter], payment: 'successful' })
  book(o.claire, s.benny, [hachi], -40, 'paid', 'First time trying PetSociety!', { hours: ['09:00', '12:00'], tasks: [T.hachiWalk, T.hachiFeed], review: [5, 'So glad I found Benny.'], payment: 'successful' })
  const claireC1 = book(o.claire, s.benny, [hachi], -5, 'completed', 'Dinner and an evening walk.', { hours: ['18:00', '21:00'], tasks: [T.hachiPark, T.hachiFeed] })
  const claireC2 = book(o.claire, s.wendy, [kaya], -6, 'completed', 'Full grooming for Kaya.', { hours: ['11:00', '14:00'], tasks: [T.kayaBrush, T.kayaFeed], payment: 'rejected' })
  const claireToday = book(o.claire, s.benny, [hachi, kaya], -1, 'in-progress', 'Three days while I\'m on a study trip.', { length: 3, hours: FULL, tasks: [T.hachiWalk, T.hachiPark, T.hachiFeed, T.kayaFeed, T.kayaDrops, T.litter] })
  book(o.claire, s.priya, [kaya], 0, 'confirmed', 'Evening drops for Kaya.', { hours: ['19:00', '21:00'], tasks: [T.kayaDrops, T.kayaFeed] })
  book(o.claire, s.wei, [hachi], 3, 'confirmed', 'Saturday long walk.', { hours: ['08:00', '11:00'], tasks: [T.hachiPark, T.playHachi] })
  book(o.claire, s.benny, [hachi, kaya], 8, 'confirmed', 'Recess week trip to Penang.', { length: 3, hours: FULL, tasks: [T.hachiWalk, T.hachiFeed, T.kayaFeed, T.litter], noDetails: true })
  book(o.claire, s.faiz, [kaya], 5, 'confirmed', 'Midday check-in.', { hours: ['12:00', '14:00'], tasks: [T.kayaFeed, T.litter] })
  book(o.claire, s.sara, [kaya], 12, 'accepted', 'Kaya\'s eye drops while I\'m away.', { hours: ['08:00', '20:00'], tasks: [T.kayaDrops, T.kayaFeed] })
  book(o.claire, s.wendy, [kaya], 14, 'accepted', 'Monthly grooming.', { hours: ['10:00', '12:00'], tasks: [T.kayaBrush] })
  book(o.claire, s.benny, [hachi], 16, 'pending', 'Morning walk before my exam.', { hours: ['07:00', '10:00'], tasks: [T.hachiWalk, T.hachiFeed] })
  book(o.claire, s.benny, [hachi, kaya], 24, 'pending', 'Weekend away.', { length: 2, hours: ['08:00', '20:00'], tasks: [T.hachiWalk, T.hachiFeed, T.kayaFeed] })
  book(o.claire, s.lucas, [hachi], 18, 'pending', 'Trying a new walker.', { hours: ['15:00', '17:00'], tasks: [T.hachiPark] })
  book(o.claire, s.bala, [hachi], 20, 'pending', 'Long walk please.', { hours: ['16:00', '19:00'], tasks: [T.hachiPark, T.playHachi] })
  book(o.claire, s.carmen, [kaya], 6, 'declined', 'Feeding while I\'m at a camp.', { hours: ['09:00', '11:00'], tasks: [T.kayaFeed] })
  book(o.claire, s.priya, [kaya], 2, 'cancelled', 'Eye check follow-up.', { hours: ['10:00', '12:00'], tasks: [T.kayaDrops], cancelledBy: 'owner', cancelReason: 'Plans changed, I\'ll be home after all.' })
  book(o.claire, s.harith, [hachi], 4, 'cancelled', 'Early walk.', { hours: ['07:00', '08:00'], tasks: [T.hachiWalk], cancelledBy: 'sitter', cancelReason: 'Sorry, I\'m down with a fever this week.' })
  book(o.claire, s.tiffany, [kaya], -2, 'expired', 'Lunchtime feed.', { hours: ['12:00', '13:00'], tasks: [T.kayaFeed] })

  // Rayyan (Bobo and Kiwi)
  const rayyanP = book(o.rayyan, s.benny, [bobo], -20, 'paid', 'Conference day.', { hours: ['07:00', '19:00'], tasks: [T.boboWalk, T.boboFeed], review: [5, 'Bobo was exhausted in the best way.'], payment: 'successful' })
  const rayyanP2 = book(o.rayyan, s.wei, [bobo], -25, 'paid', 'Weekend runs.', { hours: ['08:00', '12:00'], tasks: [T.boboWalk, T.boboPlay], review: [4, 'Good energy, Bobo loved the run.'], payment: 'successful' })
  const rayyanC = book(o.rayyan, s.lucas, [bobo, kiwi], -2, 'completed', 'Full day at a workshop.', { hours: ['12:00', '20:00'], tasks: [T.boboWalk, T.boboFeed, T.kiwiFeed] })
  book(o.rayyan, s.bala, [bobo], 0, 'confirmed', 'Evening walk today.', { hours: ['18:00', '20:00'], tasks: [T.boboWalk, T.boboPlay] })
  book(o.rayyan, s.benny, [bobo], 11, 'pending', 'Morning walk.', { hours: ['07:00', '09:00'], tasks: [T.boboWalk] })
  book(o.rayyan, s.benny, [bobo, kiwi], 12, 'pending', 'Day trip to Sentosa.', { hours: ['09:00', '18:00'], tasks: [T.boboWalk, T.boboFeed, T.kiwiFeed] })
  book(o.rayyan, s.faiz, [bobo], 9, 'accepted', 'Grading marathon.', { hours: ['13:00', '17:00'], tasks: [T.boboWalk, T.boboPlay] })

  // Meiling (Tofu and Miso)
  const meilingToday = book(o.meiling, s.carmen, [tofu, miso], -1, 'in-progress', 'Mornings while I\'m at a conference.', { length: 3, hours: ['09:00', '12:00'], tasks: [T.catsFeed, T.tofuMeds, T.catsLitter, T.catsPlay] })
  const meilingP = book(o.meiling, s.sara, [tofu, miso], -10, 'paid', 'Tofu\'s new tablets.', { hours: ['08:00', '10:00'], tasks: [T.catsFeed, T.tofuMeds, T.catsLitter], review: [5, 'Sara is the only sitter Tofu trusts.'], payment: 'successful' })
  const meilingP2 = book(o.meiling, s.priya, [tofu, miso], -22, 'paid', 'Weekend away.', { length: 2, hours: ['09:00', '18:00'], tasks: [T.catsFeed, T.catsLitter, T.catsPlay], review: [4, 'Lovely, the cats were relaxed.'], payment: 'successful' })
  const meilingP3 = book(o.meiling, s.benny, [miso], -27, 'paid', 'Miso only, Tofu was at the vet.', { hours: ['10:00', '12:00'], tasks: [T.catsFeed, T.catsPlay], review: [5, 'Kept the balcony door shut, thank you!'], payment: 'successful' })
  book(o.meiling, s.benny, [tofu, miso], 13, 'pending', 'Long weekend.', { length: 2, hours: ['09:00', '19:00'], tasks: [T.catsFeed, T.tofuMeds, T.catsLitter] })
  book(o.meiling, s.benny, [tofu, miso], 15, 'pending', 'Lunch check-in.', { hours: ['12:00', '14:00'], tasks: [T.catsFeed] })
  book(o.meiling, s.sara, [tofu], 7, 'confirmed', 'Tablet and dinner.', { hours: ['19:00', '21:00'], tasks: [T.tofuMedsNoDetails, T.catsFeed], noDetails: true })

  // Jun (Pudding and Dumpling)
  const junP = book(o.jun, s.kai, [pudding, dumpling], -6, 'paid', 'Quick trip to Malacca.', { length: 2, hours: ['09:00', '19:00'], tasks: [T.puddingFeed, T.dumplingFeed, T.cage, T.puddingPlay], review: [5, 'Kai knows small animals so well.'], payment: 'successful' })
  book(o.jun, s.faiz, [pudding], -35, 'paid', 'Hay and cuddles.', { hours: ['10:00', '12:00'], tasks: [T.puddingFeed, T.puddingPlay], review: [4, 'Friendly and careful.'], payment: 'successful' })
  book(o.jun, s.kai, [pudding, dumpling], 2, 'confirmed', 'Back-to-back meetings.', { hours: ['11:00', '15:00'], tasks: [T.puddingFeed, T.dumplingFeed, T.cage] })
  book(o.jun, s.faiz, [dumpling], 10, 'pending', 'Evening feed.', { hours: ['19:00', '21:00'], tasks: [T.dumplingFeed] })
  book(o.jun, s.benny, [pudding], 17, 'pending', 'Pudding\'s playtime.', { hours: ['16:00', '18:00'], tasks: [T.puddingPlay, T.puddingFeed] })

  const bookings = await Booking.insertMany(plan.map((p) => p.booking))
  const lists = await CareChecklist.insertMany(bookings.map((b, i) => ({
    bookingId: b._id, items: plan[i].tasks, detailsSavedAt: plan[i].tasks.some((t) => t.details) ? new Date() : null
  })))
  plan.forEach((p, i) => {
    p.doc = bookings[i]
    p.task = (title) => lists[i].items.find((t) => t.title === title)
  })

  // ----- receipts, reviews -----
  await Payment.insertMany(plan.filter((p) => p.opts.payment).map((p) => ({
    bookingId: p.doc._id, ownerId: p.doc.ownerId, sitterId: p.doc.sitterId, amount: p.doc.totalPrice,
    ...(p.opts.payment === 'successful' ? { method: ['visa', 'mastercard'][p.doc.totalPrice % 2], cardLast4: '4242' } : {}),
    status: p.opts.payment
  })))
  await Review.insertMany(plan.filter((p) => p.opts.review).map((p) => ({
    booking: p.doc._id, sitter: p.doc.sitterId, owner: p.doc.ownerId, rating: p.opts.review[0], comment: p.opts.review[1]
  })))

  // ----- sitters' availability: their usual week, widened to cover their bookings -----
  const HOLDS_TIME = ['pending', 'accepted', 'confirmed', 'in-progress', 'completed', 'paid']
  const days = []
  for (const x of SITTERS) {
    for (let n = -45; n < 30; n++) {
      const date = dayString(n)
      const usual = x.week(weekdayOf(n))
      const slots = new Set(usual ? slotsBetween(...usual) : [])
      for (const p of plan) {
        if (!p.doc.sitterId.equals(s[x.key]._id) || !HOLDS_TIME.includes(p.doc.status)) continue
        const dt = p.doc.dayTimes.find((d) => d.date === date)
        if (dt) slotsBetween(dt.startTime, dt.endTime).forEach((m) => slots.add(m))
      }
      const sorted = [...slots].sort((a, b) => a - b)
      days.push({ sitterId: s[x.key]._id, date: midnight(n), status: sorted.length ? 'available' : 'blocked', slots: sorted })
    }
  }
  await Availability.insertMany(days)

  // ----- sessions, walks and reports -----
  const PHOTO = (text) => ({ url: `https://placehold.co/600x600/png?text=${encodeURIComponent(text)}` })

  // One day's session. ticks: [[taskTitle, 'HH:MM'], ...], or 'all' to tick every due time spread through the day
  async function session(p, n, start, end, { ticks = 'all', notes = '', photos = [], startCheck, autoEnded = false, active = false, away, gaps } = {}) {
    const date = dayString(n)
    const items = lists[plan.indexOf(p)].items.filter((t) => !t.days?.length || t.days.includes(date))
    const startAt = typeof start === 'string' ? at(n, start) : start
    const tickList = ticks === 'all'
      ? items.filter((t) => t.category !== 'walk').flatMap((t) => Array.from({ length: t.dailyFrequency }, (_, k) => [t.title, null, k]))
      : ticks
    const spread = (k, i) => new Date(startAt.getTime() + (15 + i * 20 + k * 120) * MINUTE_MS)
    return VisitSession.create({
      booking: p.doc._id, sitter: p.doc.sitterId, date, status: active ? 'active' : 'completed',
      startedAt: startAt, endedAt: active ? undefined : at(n, end), startCheck, autoEnded, home: SOE,
      completedTasks: tickList.map(([title, time, k = 0], i) => ({ task: p.task(title)._id, title, at: time ? at(n, time) : spread(k, i) })),
      report: active ? undefined : { notes: autoEnded ? "The sitter didn't submit a report." : notes, photos },
      awayEpisodes: away ?? [], locationGaps: gaps ?? []
    })
  }

  // One finished walk on a route task, with the tick it gives. deviations: [[minutesIn, minutesOff, maxM, notified]]
  async function walk(p, visit, title, n, start, end, { deviations = [], endedEarlyReason = '' } = {}) {
    const task = p.task(title)
    const startedAt = at(n, start)
    const path = task.walkRoute?.path?.coordinates ?? ROUTES.soeLoop
    const w = await Walk.create({
      owner: p.doc.ownerId, sitter: p.doc.sitterId, booking: p.doc._id, visit: visit._id, task: task._id,
      mode: task.walkRoute?.mode ?? 'instructions', instructions: task.title, ownerNotes: task.details?.instructions ?? '', home: point(SOE),
      ...(task.walkRoute?.mode === 'route' ? { route: task.walkRoute.route, routeName: task.walkRoute.name, plannedPath: task.walkRoute.path } : {}),
      status: endedEarlyReason ? 'ended-early' : 'completed', endedEarlyReason, startedAt, endedAt: at(n, end),
      walkedPath: { type: 'LineString', coordinates: path }, distanceM: pathLength(path), durationS: (at(n, end) - startedAt) / 1000,
      deviations: deviations.map(([inM, offM, maxM, notified]) => {
        const from = new Date(startedAt.getTime() + inM * MINUTE_MS)
        return { startedAt: from, endedAt: new Date(from.getTime() + offM * MINUTE_MS), maxDistanceM: maxM, ownerNotifiedAt: notified ? from : null }
      })
    })
    visit.completedTasks.push({ task: task._id, title: task.title, at: at(n, end), walk: w._id })
    await visit.save()
  }

  // Claire's long weekend: three full days, one with an off-route moment
  let v = await session(claireLong, -4, '07:05', '20:40', { notes: 'Hachi was a star on both walks. Kaya ate everything and napped on your bed.', photos: [PHOTO('Hachi'), PHOTO('Kaya napping')] })
  await walk(claireLong, v, 'Walk Hachi on the SOE loop', -4, '08:00', '08:25')
  await walk(claireLong, v, 'Long walk at Fort Canning', -4, '17:30', '18:15')
  v = await session(claireLong, -3, '07:02', '20:50', { notes: 'Rainy morning, so a shorter walk. Big zoomies in the evening!', photos: [PHOTO('Zoomies')] })
  await walk(claireLong, v, 'Walk Hachi on the SOE loop', -3, '08:05', '08:20')
  await walk(claireLong, v, 'Long walk at Fort Canning', -3, '17:40', '18:30', { deviations: [[12, 5, 72, true], [30, 2, 38, false]] })
  v = await session(claireLong, -2, '07:10', '19:55', { notes: 'All done. Hachi\'s food is running low, about two days left.' })
  await walk(claireLong, v, 'Walk Hachi on the SOE loop', -2, '08:00', '08:30')
  await walk(claireLong, v, 'Long walk at Fort Canning', -2, '17:30', '18:10')

  v = await session(claireP2, -7, '08:02', '18:40', { notes: 'Tug of war champion. He won every round.', photos: [PHOTO('Hachi tug')] })
  await walk(claireP2, v, 'Walk Hachi on the SOE loop', -7, '08:10', '08:35')
  await session(claireP3, -9, '08:30', '19:20', { notes: 'Drops given at 9am and 7pm. Her left eye looks less red already.', photos: [PHOTO('Kaya eye')] })
  v = await session(claireP4, -12, '17:00', '18:20', { notes: 'Caught in a downpour, so we came back early. Towelled him dry.' })
  await walk(claireP4, v, 'Long walk at Fort Canning', -12, '17:20', '17:45', { endedEarlyReason: 'Heavy rain' })
  v = await session(claireP5, -15, '07:00', '19:50', { notes: 'Brushed Kaya for 15 minutes, lots of fur!' })
  await walk(claireP5, v, 'Walk Hachi on the SOE loop', -15, '08:00', '08:30')
  v = await session(claireP5, -14, '07:20', '20:00', { ticks: [['Hachi\'s breakfast and dinner', '08:30'], ['Kaya\'s wet food', '09:00']], autoEnded: true })
  await walk(claireP5, v, 'Walk Hachi on the SOE loop', -14, '08:00', '08:25')
  await session(claireP6, -18, '10:05', '12:50', { notes: 'Kaya let me brush her whole back this time.' })
  // a finished day that left home without a walk, and closed the app for a while
  v = await session(claireC1, -5, '18:04', '21:05', {
    ticks: [['Hachi\'s breakfast and dinner', '18:30']], notes: 'Popped out to buy more food for Hachi, back in 20 minutes.',
    away: [{ startedAt: at(-5, '19:10'), endedAt: at(-5, '19:31'), maxDistanceM: 420 }],
    gaps: [{ startedAt: at(-5, '20:00'), endedAt: at(-5, '20:18'), reason: 'stopped', resumedAtHome: true }]
  })
  await walk(claireC1, v, 'Long walk at Fort Canning', -5, '18:40', '19:05')
  await session(claireC2, -6, '11:10', '13:40', { notes: 'Full brush and a trim around the paws. She looks fluffy!', photos: [PHOTO('Fluffy Kaya')] })

  // Claire today: day 2 of 3 with Benny, in progress with a walk under way and a start-check note
  v = await session(claireToday, -1, '07:10', '21:30', { notes: 'Settled in well on day one.' })
  await walk(claireToday, v, 'Walk Hachi on the SOE loop', -1, '08:00', '08:28')
  await walk(claireToday, v, 'Long walk at Fort Canning', -1, '17:30', '18:12')
  // started about 2.5 hours before the seed runs, but not before the booked 7 am (unless the seed runs before then)
  const liveStart = new Date(Math.min(Date.now() - 5 * MINUTE_MS, Math.max(Date.now() - 150 * MINUTE_MS, at(0, '07:05').getTime())))
  const live = await session(claireToday, 0, liveStart, null, {
    active: true, ticks: [],
    startCheck: { reason: 'out-of-range', distanceM: 160, note: 'Waiting at the SOE lobby, security is checking my pass', at: liveStart }
  })
  live.completedTasks.push(
    { task: claireToday.task('Hachi\'s breakfast and dinner')._id, title: 'Hachi\'s breakfast and dinner', at: minutesAgo(120) },
    { task: claireToday.task('Kaya\'s wet food')._id, title: 'Kaya\'s wet food', at: minutesAgo(115) },
    { task: claireToday.task('Kaya\'s eye drops')._id, title: 'Kaya\'s eye drops', at: minutesAgo(110) }
  )
  live.lastLocation = { coordinates: ROUTES.soeLoop[2], accuracy: 12, at: new Date() }
  await live.save()
  await Walk.create({
    owner: o.claire._id, sitter: s.benny._id, booking: claireToday.doc._id, visit: live._id, task: claireToday.task('Walk Hachi on the SOE loop')._id,
    mode: 'route', route: soeLoop._id, routeName: soeLoop.name, plannedPath: soeLoop.path, home: point(SOE), instructions: 'Walk Hachi on the SOE loop',
    status: 'in-progress', startedAt: minutesAgo(14), liveDistanceM: 650
  })

  // Meiling today: day 2 of 3 with Carmen, today's session already done (the owner can View report)
  await session(meilingToday, -1, '09:02', '11:45', { notes: 'Tofu took his tablet in a treat. Miso tried to escape twice!' })
  await session(meilingToday, 0, '09:05', '11:40', { ticks: [['Feed Tofu and Miso', '09:15'], ['Tofu\'s tummy tablet', '09:20'], ['Clean both litter trays', '10:00']], notes: 'Skipped wand toy time, Tofu wasn\'t feeling playful.' })

  // Other finished visits
  v = await session(rayyanP, -20, '07:00', '18:50', { notes: 'Bobo drank from every fountain on the loop.', photos: [PHOTO('Bobo')] })
  await walk(rayyanP, v, 'Walk Bobo around Stamford Green', -20, '07:30', '08:10')
  await walk(rayyanP, v, 'Walk Bobo around Stamford Green', -20, '18:00', '18:35')
  v = await session(rayyanP2, -25, '08:00', '11:50', { notes: 'Two laps and lots of fetch.' })
  await walk(rayyanP2, v, 'Walk Bobo around Stamford Green', -25, '08:10', '08:50')
  await walk(rayyanP2, v, 'Walk Bobo around Stamford Green', -25, '10:30', '11:00')
  v = await session(rayyanC, -2, '12:05', '20:10', { notes: 'Kiwi sang the whole afternoon. Bobo had a good long walk.', startCheck: { reason: 'no-location', note: 'My phone\'s GPS isn\'t working today', at: at(-2, '12:05') } })
  await walk(rayyanC, v, 'Walk Bobo around Stamford Green', -2, '12:30', '13:10')
  await session(meilingP, -10, '08:00', '09:55', { notes: 'Tofu ate everything and took his tablet.' })
  await session(meilingP2, -22, '09:00', '17:30', { notes: 'Quiet day. Both cats napped in the sun.' })
  await session(meilingP2, -21, '09:10', '17:45', { notes: 'Played with the wand toy for 20 minutes.' })
  await session(meilingP3, -27, '10:00', '11:55', { notes: 'Miso was very cuddly today.' })
  await session(junP, -6, '09:00', '18:30', { notes: 'Pudding had a good run around the living room.', photos: [PHOTO('Pudding')] })
  await session(junP, -5, '09:15', '18:45', { notes: 'Fresh lining in both cages.' })

  // ----- chats -----
  const chat = (p, lines) => Message.insertMany(lines.map(([who, text], i) => ({
    booking: p.doc._id, sender: who._id, text, createdAt: new Date(Date.now() - (lines.length - i) * 37 * MINUTE_MS)
  })))
  await chat(claireToday, [[o.claire, 'Hi Benny! Kaya\'s eye drops are in the fridge door.'], [s.benny, 'Got it, thanks! Heading out for the morning walk now.'], [s.benny, 'Hachi found a pigeon. We are fine.'], [o.claire, 'Haha, classic Hachi']])
  await chat(claireLong, [[o.claire, 'Thanks so much for this weekend!'], [s.benny, 'My pleasure, he\'s a good boy.']])
  await chat(claireC1, [[s.benny, 'Running to the pet shop for more kibble, back soon.'], [o.claire, 'Thank you! I\'ll pay you back.']])
  await chat(rayyanC, [[o.rayyan, 'How is Bobo doing?'], [s.lucas, 'Great, he just finished his walk.']])
  await chat(meilingToday, [[s.carmen, 'Tofu took his tablet!'], [o.meiling, 'Amazing, thank you Carmen']])

  // ----- notifications -----
  await notify(o.claire._id, 'booking-accepted', `${s.sara.username} accepted your booking request.`, { booking: plan.find((p) => p.doc.sitterId.equals(s.sara._id) && p.doc.status === 'accepted').doc._id })
  await notify(o.claire._id, 'booking-declined', `${s.carmen.username} declined your booking request.`, { booking: plan.find((p) => p.doc.status === 'declined').doc._id })
  await notify(o.claire._id, 'booking-cancelled', `${s.harith.username} cancelled your booking: "Sorry, I'm down with a fever this week."`, { booking: plan.find((p) => p.doc.cancelledBy === 'sitter').doc._id })
  await notify(o.claire._id, 'session-unverified', 'The sitter started without a location check: "Waiting at the SOE lobby, security is checking my pass"', { booking: claireToday.doc._id })
  for (const p of plan.filter((x) => x.doc.sitterId.equals(s.benny._id) && x.doc.status === 'pending').slice(0, 4)) {
    const owner = OWNERS.find((x) => o[x.key]._id.equals(p.doc.ownerId))
    await notify(s.benny._id, 'booking-requested', `${owner.username} sent you a booking request.`, { booking: p.doc._id })
  }

  // ----- star ratings -----
  for (const x of SITTERS) await recalcSitterRating(s[x.key]._id)

  const counts = {}
  for (const b of bookings) counts[b.status] = (counts[b.status] ?? 0) + 1
  console.log(`Demo done ✅  ${OWNERS.length} owners, ${SITTERS.length} sitters, ${bookings.length} bookings:`, counts)
  console.log(`Password for every demo account: ${PASSWORD}`)
  console.log(`Main owner:  ${email('claire')} (${OWNERS[0].username})`)
  console.log(`Main sitter: ${email('benny')} (${SITTERS[0].username})`)
}

seed()
  .catch((err) => {
    console.error('Demo seed failed:', err.message)
    process.exitCode = 1
  })
  .finally(() => mongoose.disconnect())
