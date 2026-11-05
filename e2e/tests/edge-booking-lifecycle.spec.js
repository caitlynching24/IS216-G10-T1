// Feature list section 5: accept / decline / confirm / withdraw / cancel, plus paths P3 (declined), P4 (expired), P5 (cancellation).
// TC-08 (accept), TC-09 (decline) and TC-10 (confirm) cover the normal button presses.
//
// Each test makes its OWN fresh booking requests (days 16–19) and cleans them up, so the seeded requests other tests use are never touched.
import { test, expect } from '@playwright/test'
import { apiAs, seedData, SEED, day, bookingBody, createBooking, cleanUp, expectError } from './helpers.js'

let owner, sitter, sitter2, ids

// One logged-in API client per user for the whole file
test.beforeAll(async ({ browser }) => {
  owner = await apiAs(browser, 'owner')
  sitter = await apiAs(browser, 'sitter')
  sitter2 = await apiAs(browser, 'sitter2')
  ids = await seedData(owner.api)
})
test.afterAll(async () => {
  await owner.context.close()
  await sitter.context.close()
  await sitter2.context.close()
})

const setStatus = (who, id, status) => who.api.patch(`/api/bookings/${id}/status`, { data: { status } })
const confirm = (who, id) => who.api.patch(`/api/bookings/${id}/confirm`)
const cancel = (who, id, reason) => who.api.patch(`/api/bookings/${id}/cancel`, { data: { reason } })

test.describe('Accept and decline (sitter)', () => {
  test('only a pending request can be accepted; only pending or accepted can be declined', async () => {
    const paid = ids.booking(SEED.paid) // SeedSitter's paid booking
    await expectError(await setStatus(sitter, paid, 'accepted'), 400, 'Only pending bookings can be accepted. This one is paid.')
    await expectError(await setStatus(sitter, paid, 'declined'), 400, 'Only pending or accepted bookings can be declined. This one is paid.')
  })

  test('an owner cannot accept, and the status must be accepted or declined', async () => {
    const id = await createBooking(owner.api, bookingBody(ids, { startDate: day(16), endDate: day(16) }))
    await expectError(await setStatus(owner, id, 'accepted'), 403, 'Only sitters can accept or decline bookings')
    await expectError(await setStatus(sitter2, id, 'maybe'), 400, "Status must be 'accepted' or 'declined'")
    await expectError(await setStatus(sitter, id, 'accepted'), 403, 'This booking is not yours') // a different sitter
    await cleanUp(owner.api, id)
  })

  test('accepting a request that overlaps one you already accepted → 409', async () => {
    // setup: two requests to SecondSitter on day 16: 9am–12pm (Mochi) and 10–11am (Luna)
    const first = await createBooking(owner.api, bookingBody(ids, { startDate: day(16), endDate: day(16) }))
    const second = await createBooking(owner.api, bookingBody(ids, { startDate: day(16), endDate: day(16), petIds: [ids.luna], startTime: '10:00', endTime: '11:00' }))
    // actions + assert
    expect((await setStatus(sitter2, first, 'accepted')).status()).toBe(200)
    await expectError(await setStatus(sitter2, second, 'accepted'), 409, "so you can't accept this overlapping request.")
    await cleanUp(owner.api, first, second)
  })

  test('P3: a declined request shows as declined for the owner', async () => {
    const id = await createBooking(owner.api, bookingBody(ids, { startDate: day(19), endDate: day(19), startTime: '15:00', endTime: '16:00' }))
    expect((await setStatus(sitter2, id, 'declined')).status()).toBe(200)
    const booking = await (await owner.api.get(`/api/bookings/${id}`)).json()
    expect(booking.status).toBe('declined')
  })

  test('declining a request you already accepted is allowed (until the owner confirms)', async () => {
    const id = await createBooking(owner.api, bookingBody(ids, { startDate: day(19), endDate: day(19), startTime: '17:00', endTime: '18:00' }))
    expect((await setStatus(sitter2, id, 'accepted')).status()).toBe(200)
    expect((await setStatus(sitter2, id, 'declined')).status()).toBe(200)
  })
})

test.describe('Confirm (owner)', () => {
  test('only an accepted booking can be confirmed, and only by its owner', async () => {
    const id = await createBooking(owner.api, bookingBody(ids, { startDate: day(17), endDate: day(17) }))
    await expectError(await confirm(owner, id), 400, 'Only bookings the sitter has accepted can be confirmed. This one is pending.')
    await expectError(await confirm(sitter2, id), 403, 'Only owners can confirm bookings')
    await cleanUp(owner.api, id)
  })

  test('the same pet cannot be confirmed twice at the same time, but a different pet can', async () => {
    // setup: Mochi with SecondSitter 9am–12pm on day 18, confirmed
    const mochiA = await createBooking(owner.api, bookingBody(ids, { startDate: day(18), endDate: day(18) }))
    expect((await setStatus(sitter2, mochiA, 'accepted')).status()).toBe(200)
    expect((await confirm(owner, mochiA)).status()).toBe(200)

    // Mochi again with SeedSitter 10–11am the same day → 409
    const mochiB = await createBooking(owner.api, bookingBody(ids, { sitterId: ids.seedSitter, startDate: day(18), endDate: day(18), startTime: '10:00', endTime: '11:00' }))
    expect((await setStatus(sitter, mochiB, 'accepted')).status()).toBe(200)
    await expectError(await confirm(owner, mochiB), 409, 'Cancel that one first.')
    await cleanUp(owner.api, mochiB)

    // Luna with SeedSitter at the same time → fine
    const luna = await createBooking(owner.api, bookingBody(ids, { sitterId: ids.seedSitter, petIds: [ids.luna], startDate: day(18), endDate: day(18), startTime: '10:00', endTime: '11:00' }))
    expect((await setStatus(sitter, luna, 'accepted')).status()).toBe(200)
    expect((await confirm(owner, luna)).status()).toBe(200)

    await cleanUp(owner.api, mochiA, luna)
  })
})

test.describe('Withdraw and cancel (P5)', () => {
  test('a reason is required, and at most 300 characters', async () => {
    const id = await createBooking(owner.api, bookingBody(ids, { startDate: day(19), endDate: day(19) }))
    await expectError(await cancel(owner, id, '   '), 400, 'Please give a reason for cancelling.')
    await expectError(await cancel(owner, id, 'x'.repeat(301)), 400, 'The reason can be at most 300 characters.')
    // a real withdraw
    const res = await cancel(owner, id, 'Plans changed')
    expect(res.status()).toBe(200)
    const booking = await res.json()
    expect(booking.status).toBe('cancelled')
    expect(booking.cancelledBy).toBe('owner')
    expect(booking.cancelReason).toBe('Plans changed')
  })

  test('paid, completed and in-progress bookings cannot be cancelled', async () => {
    await expectError(await cancel(owner, ids.booking(SEED.paid), 'Changed my mind'), 400, 'This one is paid.')
    await expectError(await cancel(owner, ids.booking(SEED.completed), 'Changed my mind'), 400, 'This one is completed.')
  })

  test('another user cannot cancel your booking', async () => {
    await expectError(await cancel(sitter2, ids.booking(SEED.paid), 'Not mine'), 403, 'This booking is not yours.')
  })

  test('the sitter cancels a confirmed booking: the owner sees who cancelled and why', async ({ browser }) => {
    // setup: a confirmed booking with SecondSitter on day 19, 1–2pm
    const id = await createBooking(owner.api, bookingBody(ids, { startDate: day(19), endDate: day(19), startTime: '13:00', endTime: '14:00' }))
    expect((await setStatus(sitter2, id, 'accepted')).status()).toBe(200)
    expect((await confirm(owner, id)).status()).toBe(200)
    // actions
    const res = await cancel(sitter2, id, 'I am unwell that day')
    expect(res.status()).toBe(200)
    expect((await res.json()).cancelledBy).toBe('sitter')
    // assert on the owner's Booking Detail page: the cancelled banner shows the reason
    const page = await owner.context.newPage()
    await page.goto(`/bookings/${id}`)
    await expect(page.getByText('The sitter cancelled this booking.')).toBeVisible()
    await expect(page.getByText('I am unwell that day')).toBeVisible()
    await page.close()
  })
})

test.describe('Expired requests (P4)', () => {
  // The expiry job runs every 5 minutes, which is too slow to wait for in a test,
  // so this checks the result using the seed's already-expired booking.
  test('an expired booking shows as Expired', async () => {
    const page = await owner.context.newPage()
    await page.goto(`/bookings/${ids.booking(SEED.expired)}`)
    await expect(page.getByText('This booking is no longer valid: its start time has passed.')).toBeVisible()
    await page.close()
  })
})
