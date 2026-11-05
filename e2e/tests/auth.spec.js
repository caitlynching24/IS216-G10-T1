import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('TC-01 logs in with valid credentials', async ({ page }) => {
    // setup
    await page.goto('/login')
    // actions
    await page.getByPlaceholder('Email/Username').fill('seed.owner@petsociety.com')
    await page.getByPlaceholder('Password', { exact: true }).fill('Password123!')
    await page.getByRole('button', { name: 'Log In' }).click()
    // assert
    await expect(page).toHaveURL(/\/home/)
  })

  test('TC-02 shows an error for a wrong password', async ({ page }) => {
    // setup
    await page.goto('/login')
    // actions
    await page.getByPlaceholder('Email/Username').fill('seed.owner@petsociety.com')
    await page.getByPlaceholder('Password', { exact: true }).fill('WrongPass1!')
    await page.getByRole('button', { name: 'Log In' }).click()
    // assert: the server's message is shown and we are still on the login page
    await expect(page.getByText('Invalid login details.')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('TC-03 registers a new owner account', async ({ page }) => {
    // setup: a new email every run (Date.now() is different each time), so the test can run again and again
    const unique = Date.now()
    await page.goto('/register?role=owner')
    // actions
    await page.getByPlaceholder('Username').fill(`e2e_owner_${unique}`)
    await page.getByPlaceholder('Email').fill(`e2e_${unique}@test.com`)
    await page.getByPlaceholder('Password', { exact: true }).fill('Password123!')
    await page.getByPlaceholder('Confirm password').fill('Password123!')
    await page.getByRole('button', { name: 'Sign up' }).click()
    // assert: signing up logs you in and goes to Home
    await expect(page).toHaveURL(/\/home/)
  })

  test('TC-04 a logged-out visitor cannot see My Bookings', async ({ page }) => {
    // setup + actions: go straight to an owner-only page without logging in
    await page.goto('/owner/bookings')
    // assert: the router sends them to log in first (and remembers where they were going), so no bookings show
    await expect(page).toHaveURL(/\/login\?redirect=\/owner\/bookings/)
    await expect(page.getByRole('link', { name: 'Pay now' })).toHaveCount(0)
  })
})