// Seed realistic profile reviews for the deployed kieranSitter demo account.
// Run from server/ with: pnpm seed:kieran-reviews
// It is safe to rerun: only the dedicated seed.kieran-review-* accounts and
// their bookings, pets, and reviews are replaced.

import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import connectDB from '../config/db.js'
import User from '../models/UserModel.js'
import Pet from '../models/petModel.js'
import Booking from '../models/bookingModel.js'
import Review from '../models/reviewModel.js'
import { recalcSitterRating } from '../utils/ratingsCalc.js'

const SITTER = { username: 'kieranSitter', email: 'kieran.test.sitter@example.com' }
const OWNER_EMAIL = /^seed\.kieran-review-\d+@petsociety\.com$/
const PASSWORD = 'Password123!'
const DAY_MS = 24 * 60 * 60 * 1000

const dayString = (daysAgo) => new Date(Date.now() - daysAgo * DAY_MS)
  .toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })
const midnight = (daysAgo) => new Date(`${dayString(daysAgo)}T00:00:00+08:00`)

const feedback = [
  {
    username: 'reviewer_caitlyn', pet: 'London', species: 'Dog', breed: 'Maltese', rating: 5,
    comment: 'Kieran was wonderful with London. I received thoughtful updates and came home to a very happy pup.', daysAgo: 4
  },
  {
    username: 'reviewer_jamie', pet: 'Milo', species: 'Dog', breed: 'Cavapoo', rating: 5,
    comment: 'Reliable, attentive and easy to communicate with. Milo warmed up to Kieran immediately.', daysAgo: 12
  },
  {
    username: 'reviewer_nora', pet: 'Nori', species: 'Cat', breed: 'Domestic Shorthair', rating: 5,
    comment: 'Great care and clear updates throughout the visit. Nori was relaxed and well looked after.', daysAgo: 21
  },
  {
    username: 'reviewer_rachel', pet: 'Biscuit', species: 'Dog', breed: 'Miniature Schnauzer', rating: 5,
    comment: 'Very caring sitter and punctual for every visit. We would happily book Kieran again.', daysAgo: 31
  }
]

async function removePreviousSeed() {
  const owners = await User.find({ email: OWNER_EMAIL }).select('_id')
  const ownerIds = owners.map((owner) => owner._id)
  if (!ownerIds.length) return

  const bookings = await Booking.find({ ownerId: { $in: ownerIds } }).select('_id')
  const bookingIds = bookings.map((booking) => booking._id)
  await Review.deleteMany({ booking: { $in: bookingIds } })
  await Booking.deleteMany({ _id: { $in: bookingIds } })
  await Pet.deleteMany({ owner: { $in: ownerIds } })
  await User.deleteMany({ _id: { $in: ownerIds } })
}

async function seed() {
  await connectDB()
  const sitter = await User.findOne({ $or: [{ username: SITTER.username }, { email: SITTER.email }] })
  if (!sitter || sitter.role !== 'sitter') {
    throw new Error(`Could not find sitter account ${SITTER.username}.`)
  }

  await removePreviousSeed()
  const password = await bcrypt.hash(PASSWORD, 10)

  for (let index = 0; index < feedback.length; index += 1) {
    const item = feedback[index]
    const owner = await User.create({
      username: item.username,
      email: `seed.kieran-review-${index + 1}@petsociety.com`,
      password,
      role: 'owner',
      ownerProfile: { servicesNeeded: ['Dog walking', 'Feeding'] }
    })
    const pet = await Pet.create({
      owner: owner._id,
      name: item.pet,
      species: item.species,
      breed: item.breed,
      ageMonths: 30
    })
    const date = midnight(item.daysAgo)
    const booking = await Booking.create({
      ownerId: owner._id,
      sitterId: sitter._id,
      petIds: [pet._id],
      startDate: date,
      endDate: date,
      startTime: '10:00',
      endTime: '12:00',
      dayTimes: [{ date: dayString(item.daysAgo), startTime: '10:00', endTime: '12:00' }],
      notes: 'Completed demo visit.',
      totalPrice: 20,
      status: 'paid'
    })
    const review = await Review.create({
      booking: booking._id,
      sitter: sitter._id,
      owner: owner._id,
      rating: item.rating,
      comment: item.comment
    })
    // Keep the review dates plausible in the profile's newest-first list.
    await Review.collection.updateOne({ _id: review._id }, { $set: { createdAt: new Date(date.getTime() + DAY_MS) } })
  }

  await recalcSitterRating(sitter._id)
  const updated = await User.findById(sitter._id).select('username sitterProfile.ratingAvg sitterProfile.ratingCount')
  console.log(`Seeded ${feedback.length} reviews for ${updated.username}: ${updated.sitterProfile.ratingAvg}/5 from ${updated.sitterProfile.ratingCount} ratings.`)
}

seed()
  .catch((error) => {
    console.error('Kieran review seed failed:', error.message)
    process.exitCode = 1
  })
  .finally(() => mongoose.disconnect())
