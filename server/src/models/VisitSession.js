import mongoose from 'mongoose'
const { ObjectId } = mongoose.Schema.Types

const completedTaskSchema = new mongoose.Schema({
  task: { 
    type: ObjectId, 
    required: true 
},        
  title: { 
    type: String, 
    required: true 
},         
  at: {
    type: Date,
    default: Date.now
},
  // walk tasks only: the tracked walk that ticked this task (path, distance, time, off-route stats)
  walk: {
    type: ObjectId,
    ref: 'Walk',
    default: null
}
})

const photoSchema = new mongoose.Schema(
  { 
    url: String, 
    publicId: String 
},
  { _id: false }
)

const visitSessionSchema = new mongoose.Schema(
  {
    booking: { 
        type: ObjectId, 
        ref: 'Booking', 
        required: true },
    sitter: { 
        type: ObjectId, 
        ref: 'User', 
        required: true },
    date: { 
        type: String, 
        required: true 
    },       
    status: { 
        type: String, 
        enum: ['active', 'completed'], 
        default: 'active' 
    },
    startedAt: { 
        type: Date, 
        default: Date.now 
    },
    endedAt: { 
        type: Date 
    },
    completedTasks: [completedTaskSchema],
    report: {
      notes: { 
        type: String, 
        trim: true, 
        maxlength: 2000, 
        default: '' },
      photos: { 
        type: [photoSchema], 
        default: [] 
    }
    }
    // to add : route for live-tracking part
  },
  { timestamps: true }
)

visitSessionSchema.index({ booking: 1, date: 1 }, { unique: true }) 

export default mongoose.model('VisitSession', visitSessionSchema, 'visitsessions')