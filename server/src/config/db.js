import mongoose from 'mongoose'

export async function connectDB() {
  const uri = process.env.MONGO_URI

  if (!uri) {
    throw new Error('MONGO_URI is not set. Copy server/.env.example to server/.env and fill it in.')
  }

  mongoose.set('strictQuery', true)

  await mongoose.connect(uri)
  console.log(`MongoDB connected: ${mongoose.connection.host}`)
}

export default connectDB
