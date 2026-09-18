import mongoose from 'mongoose'

const petSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    species: { type: String, required: true, trim: true },
    breed: { type: String, trim: true },
    age: { type: Number, min: 0 },
    description: { type: String, trim: true }
  },
  { timestamps: true }
)

export default mongoose.model('Pet', petSchema)
