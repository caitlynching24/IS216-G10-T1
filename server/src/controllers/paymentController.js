import Stripe from 'stripe'
import Payment from '../models/paymentModel.js'
import Booking from '../models/bookingModel.js'
import { notifyPayment } from '../models/notificationModel.js'

// Where Stripe sends the owner back to after paying (our Vue app)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

// The Stripe connection is made the first time it's needed,
// so the server still starts even if the key hasn't been added to .env yet.
let stripe = null
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const err = new Error('Payments are not set up yet: STRIPE_SECRET_KEY is missing from server/.env')
    err.status = 500
    throw err
  }
  if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  return stripe
}

async function markBookingPaidAndNotify(bookingId) {
  const booking = await Booking.findById(bookingId)
  if (!booking) return

  if (booking.status !== 'paid') {
    booking.status = 'paid'
    await booking.save()
  }

  try {
    await notifyPayment(booking, true)
  } catch (err) {
    // Payment is already confirmed by Stripe; a notification failure must not undo it.
    console.error('Could not create payment-received notifications:', err.message)
  }
}

// POST /api/payments/checkout   body: { bookingId }
// The owner pays AFTER the sitter has finished, so only 'completed' bookings can be paid.
// Creates a Stripe Checkout page for this booking and sends back its { url }.
export const createCheckout = async (req, res) => {
  const booking = await Booking.findById(req.body.bookingId).populate('sitterId', 'username')
  if (!booking) {
    return res.status(404).json({ message: 'Booking not found' })
  }
  if (String(booking.ownerId) !== String(req.session.userId)) {
    return res.status(403).json({ message: 'This booking is not yours' })
  }
  if (booking.status !== 'completed') {
    return res.status(400).json({ message: `You can only pay once the sitter has completed the booking. This one is ${booking.status}.` })
  }

  // Our own receipt, 'pending' until Stripe confirms the money went through
  const payment = await Payment.create({
    bookingId: booking._id,
    ownerId: booking.ownerId,
    sitterId: booking.sitterId._id,
    amount: booking.totalPrice,
    status: 'pending'
  })

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    // No payment_method_types here: Stripe now picks the payment methods (cards, PayNow...)
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'sgd',
          unit_amount: Math.round(booking.totalPrice * 100), // Stripe counts in cents: $12.50 -> 1250
          product_data: { name: `PetSociety booking with ${booking.sitterId.username}` }
        }
      }
    ],
    metadata: { bookingId: String(booking._id), paymentId: String(payment._id) },
    // {CHECKOUT_SESSION_ID} is filled in by Stripe, so we can check the payment when the owner comes back
    success_url: `${CLIENT_ORIGIN}/bookings/${booking._id}/pay?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${CLIENT_ORIGIN}/bookings/${booking._id}/pay?cancelled=${payment._id}`
  })

  payment.stripeSessionId = session.id
  await payment.save()

  res.json({ url: session.url })
}

// POST /api/payments/confirm   body: { sessionId }
// When Stripe sends the owner back, ask Stripe whether the money really went through.
export const confirmCheckout = async (req, res) => {
  const { sessionId } = req.body
  if (!sessionId) {
    return res.status(400).json({ message: 'Missing payment session.' })
  }

  const payment = await Payment.findOne({ stripeSessionId: sessionId, ownerId: req.session.userId })
  if (!payment) {
    return res.status(404).json({ message: 'Payment not found' })
  }
  if (payment.status === 'successful') {
    await markBookingPaidAndNotify(payment.bookingId)
    return res.json({ message: 'Payment successful', payment }) // already confirmed (e.g. the page was refreshed)
  }

  const session = await getStripe().checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent.latest_charge']
  })
  if (session.payment_status !== 'paid') {
    return res.status(402).json({ message: 'The payment has not gone through yet.' })
  }

  // Save how they paid. For a card: the brand + last 4 digits (never the full number).
  // For other methods (e.g. PayNow) there is no card, so we just save the method's name.
  const details = session.payment_intent?.latest_charge?.payment_method_details
  payment.status = 'successful'
  payment.method = details?.card?.brand || details?.type || 'card'
  payment.cardLast4 = details?.card?.last4 || ''
  await payment.save()

  await markBookingPaidAndNotify(payment.bookingId)

  res.json({ message: 'Payment successful', payment })
}

// POST /api/payments/:id/cancel
// The owner left Stripe's page without paying, so this attempt is marked as rejected.
export const cancelCheckout = async (req, res) => {
  const payment = await Payment.findOne({ _id: req.params.id, ownerId: req.session.userId })
  if (!payment) {
    return res.status(404).json({ message: 'Payment not found' })
  }
  if (payment.status === 'pending') {
    payment.status = 'rejected'
    await payment.save()

    try {
      const booking = await Booking.findById(payment.bookingId).select('ownerId totalPrice')
      if (booking) await notifyPayment(booking, false)
    } catch (err) {
      // A notification failure must not prevent the cancellation from completing.
      console.error('Could not create payment-failed notification:', err.message)
    }
  }
  res.json(payment)
}

// GET /api/payments/mine -> my finished payment attempts, newest first
// (sitter: payments made to me, owner: payments I made)
export const getMyPayments = async (req, res) => {
  const field = req.session.role === 'sitter' ? 'sitterId' : 'ownerId'
  const payments = await Payment.find({ [field]: req.session.userId, status: { $ne: 'pending' } })
    .populate({
      path: 'bookingId',
      select: 'startDate endDate startTime endTime petIds',
      populate: { path: 'petIds', select: 'name' }
    })
    .populate('ownerId', 'username')
    .populate('sitterId', 'username')
    .sort({ createdAt: -1 })

  res.json(payments)
}
