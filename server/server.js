// Local starter only. On Vercel, the "server" service (vercel.json) loads app.js directly and
// the background jobs below run via the daily cron (/api/cron/daily) instead.
import mongoose from 'mongoose'
import app, { ensureDB } from './app.js'
import { recalcAllRatings, watchReviews } from './src/utils/ratingsCalc.js'
import { startExpiringBookings } from './src/utils/expireBookings.js'
import { startEndingForgottenSessions } from './src/utils/endForgottenSessions.js'

const PORT = process.env.PORT || 5000

async function start() {
  try {
    await ensureDB()
    startExpiringBookings() 
    startEndingForgottenSessions() // sessions the sitter never ended close 6 hours after their end time
    recalcAllRatings().catch((err) => console.error('Rating recalculation failed', err))
    watchReviews()
    app.listen(PORT, () => {
      console.log(`PetSociety API listening on http://localhost:${PORT}`)
      console.log('Connected to DB ✅:', mongoose.connection.name, 'on', mongoose.connection.host) // checking which collection
    })
  } catch (err) {
    console.error('Failed to start server:', err.message)
    process.exit(1)
  }
}

start()
