// Feature list: access control (section 1 + path P11), profile pages (section 2), navigation and home pages (section 3)
// TC-04 already covers a logged-out visitor opening My Bookings.
import { test, expect } from '@playwright/test'
import { AUTH, apiAs, newUser, seedData, SEED, expectError } from './helpers.js'

test.describe('Logged out', () => {
  // Every protected API answers 401 without a login
  const protectedApis = [
    ['get', '/api/pets'],
    ['get', '/api/notifications'],
    ['get', '/api/payments/mine'],
    ['put', '/api/users/me'],
    ['get', '/api/availability/me']
  ]
  for (const [method, path] of protectedApis) {
    test(`${method.toUpperCase()} ${path} needs a login (401)`, async ({ request }) => {
      await expectError(await request[method](path), 401, 'Please log in first.')
    })
  }

  test('an unknown API path → 404 "Not found"', async ({ request }) => {
    await expectError(await request.get('/api/does-not-exist'), 404, 'Not found')
  })

  test("an owner's profile needs a login, a sitter's profile is public", async ({ request, browser }) => {
    // setup: get the ids
    const { context, api } = await apiAs(browser, 'owner')
    const ids = await seedData(api)
    await context.close()
    // assert
    await expectError(await request.get(`/api/users/${ids.ownerId}`), 401, 'Please log in first.')
    const sitter = await request.get(`/api/users/${ids.secondSitter}`)
    expect(sitter.status()).toBe(200)
    expect(await sitter.json()).not.toHaveProperty('email') // private details are never sent
  })

  test('a bad user id → "User not found"', async ({ request }) => {
    await expectError(await request.get('/api/users/not-an-id'), 404, 'User not found')
    await expectError(await request.get('/api/users/000000000000000000000000'), 404, 'User not found')
  })

  test('a sitter profile asks a visitor to log in before booking', async ({ page, browser }) => {
    const { context, api } = await apiAs(browser, 'owner')
    const ids = await seedData(api)
    await context.close()
    await page.goto(`/users/${ids.secondSitter}`)
    await expect(page.getByRole('link', { name: 'Log in to request a booking' })).toBeVisible()
  })

  test('the menu shows Search Sitters and Log in', async ({ page }) => {
    await page.goto('/browse')
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Log in' })).toBeVisible()
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Search Sitters' })).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'My Bookings' })).toHaveCount(0)
  })

  // The router guard (client/src/router/index.js) sends logged-out visitors to /login before an owner-only page opens
  test('a logged-out visitor is sent to /login', async ({ page }) => {
    await page.goto('/owner/bookings')
    await expect(page).toHaveURL(/\/login/, { timeout: 3_000 })
  })
})

test.describe('Signed in as the owner', () => {
  test.use({ storageState: AUTH.owner })

  test('a sitter-only API → 403 "Sitters only."', async ({ page }) => {
    await expectError(await page.request.get('/api/availability/me'), 403, 'Sitters only.')
  })

  // Sitter-only pages: the router guard sends an owner back to their own home page
  test('the Transactions page is refused', async ({ page }) => {
    await page.goto('/sitter/transactions')
    await expect(page).toHaveURL(/\/home$/)
  })

  test('the Booking Requests page is refused', async ({ page }) => {
    await page.goto('/sitter/requests')
    await expect(page).toHaveURL(/\/home$/, { timeout: 3_000 })
  })

  test('the menu shows the owner pages only', async ({ page }) => {
    await page.goto('/home')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const nav = page.getByRole('navigation')
    for (const name of ['Search Sitters', 'My Bookings', 'Session', 'My Routes']) {
      await expect(nav.getByRole('link', { name })).toBeVisible()
    }
    await expect(nav.getByRole('link', { name: 'Booking Requests' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Transactions' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: /^Notifications/ })).toBeVisible() // the bell
  })
})

test.describe('Signed in as a sitter', () => {
  test.use({ storageState: AUTH.sitter })

  test('an owner-only API → 403 "Owners only."', async ({ page }) => {
    await expectError(await page.request.get('/api/pets'), 403, 'Owners only.')
  })

  // Owner-only pages: the router guard sends a sitter back to their own home page
  test('My Bookings is refused', async ({ page }) => {
    await page.goto('/owner/bookings')
    await expect(page).toHaveURL(/\/home$/)
  })

  test('the menu shows the sitter pages only', async ({ page }) => {
    await page.goto('/home')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const nav = page.getByRole('navigation')
    for (const name of ['Home', 'Session', 'Calendar', 'Booking Requests', 'Transactions']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
    }
    await expect(nav.getByRole('link', { name: 'My Bookings' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'My Routes' })).toHaveCount(0)
  })

  test('sitter home says Welcome back', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByRole('heading', { name: /Welcome back, SeedSitter/ })).toBeVisible()
  })
})

test.describe("Someone else's booking", () => {
  test('another owner gets 403, a bad id gets 404 (API)', async ({ browser }) => {
    // setup: a brand-new owner, and the id of SeedOwner's paid booking
    const owner = await apiAs(browser, 'owner')
    const ids = await seedData(owner.api)
    const stranger = await newUser(browser)
    // assert
    await expectError(await stranger.api.get(`/api/bookings/${ids.booking(SEED.paid)}`), 403, 'This booking is not yours.')
    await expectError(await stranger.api.get('/api/bookings/not-an-id'), 404, 'Booking not found.')
    await expectError(await stranger.api.get('/api/bookings/000000000000000000000000'), 404, 'Booking not found.')
    await owner.context.close()
    await stranger.context.close()
  })

  test('the Booking Detail page refuses another owner', async ({ browser }) => {
    const owner = await apiAs(browser, 'owner')
    const ids = await seedData(owner.api)
    const stranger = await newUser(browser)
    const page = await stranger.context.newPage() // a page logged in as the new owner
    await page.goto(`/bookings/${ids.booking(SEED.paid)}`)
    await expect(page.getByText('This booking is not yours.')).toBeVisible()
    await owner.context.close()
    await stranger.context.close()
  })
})
