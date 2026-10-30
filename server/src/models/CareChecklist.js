import mongoose from 'mongoose'

// The care checklist an owner attaches to a booking request:
// one document per booking, holding a list of tasks (feed, walk, medication...).
// Linked to the booking by `bookingId`, so Booking itself is not changed.
// The task fields use the same names as the task model in TaskModel.js
// (category, title, petIds, dailyFrequency) so the two can be merged later.
// Must match the keys in utils/servicePrices.js (each type has a fixed price). No vague 'other' type.
// (Old checklists saved with 'other' still load fine; they are never saved again.)
export const CATEGORIES = ['feed', 'walk', 'groom', 'medication', 'clean', 'play']

// GeoJSON line, the same shape as WalkRoute.path: [[lng, lat], ...]
const lineStringSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['LineString'], required: true },
    coordinates: { type: [[Number]], required: true }
  },
  { _id: false }
)

// Walk tasks only: the route the sitter should follow.
// 'route': a COPY of one of the owner's recorded routes, taken when the booking was made,
//          so editing or deleting the route later doesn't change this booking.
// 'instructions': no route; the sitter follows the task's written instructions
//          (the walk is still tracked, but can't be checked against a route).
const walkRouteSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['route', 'instructions'], required: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'WalkRoute', default: null }, // the original route
    name: { type: String, trim: true, default: '' },
    path: { type: lineStringSchema, default: undefined },
    distanceM: { type: Number, default: 0 }
  },
  { _id: false }
)

const taskSchema = new mongoose.Schema({
  category: { type: String, enum: CATEGORIES, required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 }, // e.g. "Feed 1 cup kibble"
  petIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Pet' }], // which pets the task is for
  dailyFrequency: { type: Number, required: true, min: 1, max: 10 }, // times per day
  walkRoute: { type: walkRouteSchema, default: undefined } // walk tasks only
})

const careChecklistSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    items: [taskSchema]
  },
  { timestamps: true }
)
// because of this referencing, each checklist document contaisn the booking id its "attached " to 

export default mongoose.model('CareChecklist', careChecklistSchema, 'carechecklists')
