import mongoose from 'mongoose'
const { ObjectId } = mongoose.Schema.Types

// One walk by a sitter, for one walk task in a visit.
// It moves through: 'ready' -> 'in-progress' -> 'completed' (or 'ended-early')
export const WALK_STATUSES = ['ready', 'in-progress', 'completed', 'ended-early']
// 'route': along one of the owner's recorded routes, checked for going off route
// 'instructions': no route, the sitter follows the task's written instructions (tracked, but not checked)
export const WALK_MODES = ['route', 'instructions']

// GeoJSON line, the same shape as WalkRoute.path: [[lng, lat], ...]
const lineStringSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['LineString'], required: true },
    coordinates: { type: [[Number]], required: true }
  },
  { _id: false }
)

// GeoJSON point, the same shape as the owner's home in UserModel: [lng, lat]
const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }
  },
  { _id: false }
)

// One stretch of time the sitter spent off the route
const deviationSchema = new mongoose.Schema({
  startedAt: { type: Date, required: true },        // when the sitter first passed the warning distance
  startLocation: { type: [Number], default: undefined }, // [lng, lat] where it started
  maxDistanceM: { type: Number, default: 0 },        // furthest the sitter got from the route
  ownerNotifiedAt: { type: Date, default: null },    // set if they went far enough for the owner to be told
  endedAt: { type: Date, default: null },            // when they got back on the route (or the walk ended)
  endLocation: { type: [Number], default: undefined }
})

const walkSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true, index: true },
    sitter: { type: ObjectId, ref: 'User', required: true, index: true },

    // What the walk belongs to (walks made before booking integration have null here)
    booking: { type: ObjectId, ref: 'Booking', default: null },
    visit: { type: ObjectId, ref: 'VisitSession', default: null },
    task: { type: ObjectId, default: null },          // the walk task in the booking's care checklist

    mode: { type: String, enum: WALK_MODES, default: 'route' },
    instructions: { type: String, default: '' },      // the walk task's text, e.g. "30 min around the park"

    // A COPY of the route and home at the time the walk was created,
    // so editing or deleting the route later doesn't change past walks.
    // 'instructions' walks have no route, so these stay empty.
    route: { type: ObjectId, ref: 'WalkRoute', default: null },
    routeName: { type: String, default: '' },
    plannedPath: { type: lineStringSchema, default: undefined },
    home: { type: pointSchema, required: true },

    status: { type: String, enum: WALK_STATUSES, default: 'ready' },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endedEarlyReason: { type: String, trim: true, maxlength: 200, default: '' },

    // Filled in when the walk ends
    walkedPath: { type: lineStringSchema, default: null },
    distanceM: { type: Number, default: 0 },
    durationS: { type: Number, default: 0 },

    deviations: { type: [deviationSchema], default: [] }
  },
  { timestamps: true }
)

const Walk = mongoose.model('Walk', walkSchema, 'walks')

export default Walk
