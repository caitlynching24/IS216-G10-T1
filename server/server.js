import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import connectDB from './src/config/db.js'
import petRoutes from './src/routes/petRoutes.js'
import errorHandler from './src/middleware/errorHandler.js'

const app = express()
const PORT = process.env.PORT || 5000
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

app.use(cors({ origin: CLIENT_ORIGIN }))
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/pets', petRoutes)

// Fallback 404 for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Not found' })
})

app.use(errorHandler)

async function start() {
  try {
    await connectDB()
    app.listen(PORT, () => {
      console.log(`PetSociety API listening on http://localhost:${PORT}`)
    })
  } catch (err) {
    console.error('Failed to start server:', err.message)
    process.exit(1)
  }
}

start()
