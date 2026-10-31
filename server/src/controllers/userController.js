import mongoose from 'mongoose'
import User, { services } from '../models/UserModel.js'
import Pet from '../models/petModel.js'
import Review from '../models/reviewModel.js'
import Booking from '../models/bookingModel.js'

import { uploadImage, deleteImage } from '../config/cloudinary.js'
import { computeBadges } from '../utils/sitterBadges.js'

const PUBLIC_FIELDS =
  'username bio profilePicture role createdAt ' +
  'ownerProfile.servicesNeeded ownerProfile.instructions ' +
  'sitterProfile.experienceStart sitterProfile.petTypes ' +
  'sitterProfile.services sitterProfile.serviceArea sitterProfile.ratingAvg sitterProfile.ratingCount ' +
  'sitterProfile.gallery'

const MAX_GALLERY = 5

export async function getAllUsers(req, res){
   try {
        const users = await User.find()
        res.json(users)
    } catch (error) {
        console.log(error)
        return res.status(500).json({ message: 'Error in loading user profiles' });
    }
}
export async function getPublicProfile(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'User not found' })
  }
  const user = await User.findById(req.params.id).select(PUBLIC_FIELDS)
  if (!user) return res.status(404).json({ message: 'User not found' })

  if (user.role === 'owner' && !req.session.userId) {
    return res.status(401).json({ message: 'Please log in first.' })
  }
  res.json(user)
}

export async function getUserPets(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'User not found' })
  }
  const owner = await User.findById(req.params.id).select('role')
  if (!owner || owner.role !== 'owner') {
    return res.status(404).json({ message: 'User not found' })
  }
  const pets = await Pet.find({ owner: req.params.id }).sort({ createdAt: -1 })
  res.json(pets)
}

export async function getUserReviews(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'User not found' })
  }
  const reviews = await Review.find({ sitter: req.params.id })
    .populate('owner', 'username profilePicture')
    .sort({ _id: -1 })
  res.json(reviews)
}

export async function getReviewsGiven(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'User not found' })
  }
  const reviews = await Review.find({ owner: req.params.id })
    .populate('sitter', 'username profilePicture')
    .sort({ _id: -1 })
  res.json(reviews)
}

// location helpers
function validCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= 1.1 && lat <= 1.5 && lng >= 103.5 && lng <= 104.1
    // sg coordinates ^ 
}

function parseAddress(input) {
  if (!input || typeof input !== 'object') {
    return { error: 'Invalid address.' }
  }
  const line1 = String(input.line1 ?? '').trim()
  const postalCode = String(input.postalCode ?? '').trim()
  const lat = Number(input.lat)
  const lng = Number(input.lng)

  if (!line1 || !/^\d{6}$/.test(postalCode)) {
    return { error: 'Please choose an address from the suggestions.' }
  }
  if (!validCoords(lat, lng)) {
    return { error: 'That address is not in Singapore.' }
  }
  return {
    address: {
      line1,
      unit: String(input.unit ?? '').trim().slice(0, 20),
      postalCode,
      location: { type: 'Point', coordinates: [lng, lat] }
    }
  }
}

export async function updateMyProfile(req, res) {
  const username = req.body.username?.trim()
  const bio = req.body.bio ?? ''

  if (!username) {
    return res.status(400).json({ message: 'Username is required.' })
  }
  if (/[@\s]/.test(username)) {
    return res.status(400).json({ message: "Username can't contain @ or spaces." })
  }

  const updates = { username, bio }

  // address: owners and sitters both save one, stored privately
  if ('address' in req.body) {
    const isOwner = req.session.role === 'owner'
    const key = isOwner ? 'ownerProfile.address' : 'sitterProfile.address'

    if (req.body.address === null) {
      updates[key] = null
      if (!isOwner) {
        updates['sitterProfile.serviceArea.location'] = null
      }
    } else {
      const parsed = parseAddress(req.body.address)
      if (parsed.error) {
        return res.status(400).json({ message: parsed.error })
      }
      if (!isOwner) {
        parsed.address.unit = ''
      }
      updates[key] = parsed.address

      if (!isOwner) {
        // public point: rounded to 2 decimals (about 1 km) so it can't identify a home
        const [lng, lat] = parsed.address.location.coordinates
        updates['sitterProfile.serviceArea.location'] = {
          type: 'Point',
          coordinates: [Math.round(lng * 100) / 100, Math.round(lat * 100) / 100]
        }
      }
    }
  }

  // Owners: the services their pets need (only values from the allowed list are kept)
  if (req.session.role === 'owner' && Array.isArray(req.body.servicesNeeded)) {
    updates['ownerProfile.servicesNeeded'] = req.body.servicesNeeded.filter((s) => services.includes(s))
  }
  if (req.session.role === 'owner' && typeof req.body.instructions === 'string') {
    updates['ownerProfile.instructions'] = req.body.instructions.trim().slice(0, 300)
  }

  if (req.session.role === 'sitter' && req.body.sitterProfile) {
    const sp = req.body.sitterProfile
    let start = null
    if (sp.experienceStart) {
      start = new Date(`${sp.experienceStart}-01`)
      if (Number.isNaN(start.getTime())) {
        return res.status(400).json({ message: 'Invalid experience date.' })
      }
    }

    updates['sitterProfile.experienceStart'] = start
    updates['sitterProfile.petTypes'] = sp.petTypes || []
    updates['sitterProfile.services'] = sp.services || []
    updates['sitterProfile.serviceArea.label'] = String(sp.serviceArea ?? '').trim()
  }

  try {
    const user = await User.findByIdAndUpdate(req.session.userId, updates, {
      new: true,
      runValidators: true
      }).select('+ownerProfile.address +ownerProfile.instructions +sitterProfile.address')

    req.session.username = user.username
    res.json(user)
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Username is already taken.' })
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: Object.values(err.errors)[0].message })
    }
    throw err
  }
}

export async function updateMyPicture(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'Please choose an image.' })
  }

  const result = await uploadImage(req.file.buffer, {
    folder: 'petsociety/profiles',
    public_id: String(req.session.userId),
    overwrite: true,
    invalidate: true,
    transformation: [{ width: 600, height: 600, crop: 'fill', gravity: 'auto' }]
  })

  const user = await User.findByIdAndUpdate(
    req.session.userId,
    { 'profilePicture.url': result.secure_url, 'profilePicture.publicId': result.public_id },
    { new: true }
  ).select('-password +ownerProfile.address')

  res.json(user)
}

export async function removeMyPicture(req, res) {
  const current = await User.findById(req.session.userId).select('profilePicture')
  await deleteImage(current?.profilePicture?.publicId)

  const user = await User.findByIdAndUpdate(
    req.session.userId,
    { 'profilePicture.url': '', 'profilePicture.publicId': '' },
    { new: true }
  ).select('-password +ownerProfile.address')

  res.json(user)
}

export async function addGalleryPhotos(req, res) {
  const files = req.files ?? []
  if (files.length === 0) {
    return res.status(400).json({ message: 'Please choose at least one photo.' })
  }

  const user = await User.findById(req.session.userId).select('+ownerProfile.address +sitterProfile.address')
  const saved = user.sitterProfile.gallery.length
  if (saved + files.length > MAX_GALLERY) {
    return res.status(400).json({ message: `You can have up to ${MAX_GALLERY} photos, and you already have ${saved}.` })
  }

  const uploaded = []
  try {
    for (const file of files) {
      const r = await uploadImage(file.buffer, {
        folder: 'petsociety/gallery',
        transformation: [{ width: 1400, height: 1400, crop: 'limit' }]
      })
      uploaded.push({ url: r.secure_url, publicId: r.public_id })
    }
    user.sitterProfile.gallery.push(...uploaded)
    await user.save()
  } catch (err) {
    for (const p of uploaded) {
      await deleteImage(p.publicId)       
    }
    throw err
  }
  res.json(user)
}

export async function removeGalleryPhoto(req, res) {
  if (!mongoose.isValidObjectId(req.params.photoId)) {
    return res.status(404).json({ message: 'Photo not found.' })
  }
  const user = await User.findById(req.session.userId).select('+ownerProfile.address +sitterProfile.address')
  const photo = user.sitterProfile.gallery.id(req.params.photoId)
  if (!photo) {
    return res.status(404).json({ message: 'Photo not found.' })
  }

  const publicId = photo.publicId
  user.sitterProfile.gallery.pull(photo._id)
  await user.save()
  await deleteImage(publicId)           
  res.json(user)
}

export async function getUserBadges(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'User not found' })
  }
  const user = await User.findById(req.params.id).select(
    'role sitterProfile.experienceStart sitterProfile.ratingAvg sitterProfile.ratingCount'
  )
  if (!user || user.role !== 'sitter') {
    return res.json([])
  }
  res.json(await computeBadges(user))
}

export async function getOwnerStats(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'User not found' })
  }
  const filter = { ownerId: req.params.id, status: 'completed' }
  const [completedBookings, sitters] = await Promise.all([
    Booking.countDocuments(filter),
    Booking.distinct('sitterId', filter)
  ])
  res.json({ completedBookings, sittersBooked: sitters.length })
}