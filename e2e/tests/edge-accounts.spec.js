// Feature list section 1: Accounts (register, log in, log out, change password, landing page)
// TC-01 to TC-03 already cover a normal log in, a wrong password and a normal sign-up.
import { test, expect } from '@playwright/test'
import { AUTH, PASSWORD, newUser, expectError } from './helpers.js'

// A valid sign-up body with a new email; each test breaks one thing in it
function signUp(overrides = {}) {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  return { username: `e2e_${u}`, email: `e2e_${u}@test.com`, password: PASSWORD, confirmPassword: PASSWORD, role: 'owner', ...overrides }
}

// Sends a sign-up and returns { status, errors } (the server lists every problem in `errors`)
async function register(request, body) {
  const res = await request.post('/api/auth/register', { data: body })
  return { status: res.status(), errors: (await res.json()).errors || [] }
}

test.describe('Register: server rules (API)', () => {
  test('an empty field → "Please fill in all fields."', async ({ request }) => {
    const { status, errors } = await register(request, signUp({ email: '' }))
    expect(status).toBe(400)
    expect(errors).toEqual(['Please fill in all fields.'])
  })

  test('a role other than owner or sitter is refused', async ({ request }) => {
    const { status, errors } = await register(request, signUp({ role: 'admin' }))
    expect(status).toBe(400)
    expect(errors).toContain('Please choose a valid role.')
  })

  for (const badName of ['has space', 'has@sign']) {
    test(`username "${badName}" is refused`, async ({ request }) => {
      const { status, errors } = await register(request, signUp({ username: badName }))
      expect(status).toBe(400)
      expect(errors).toContain("Username can't contain @ or spaces.")
    })
  }

  test('a username that is taken is refused', async ({ request }) => {
    const { errors } = await register(request, signUp({ username: 'SeedOwner' }))
    expect(errors).toContain('Username is already taken.')
  })

  test('an invalid email is refused', async ({ request }) => {
    const { errors } = await register(request, signUp({ email: 'not-an-email' }))
    expect(errors).toContain('Must be a valid email.')
  })

  test('an email that is already registered is refused', async ({ request }) => {
    const { errors } = await register(request, signUp({ email: 'seed.owner@petsociety.com' }))
    expect(errors).toContain('Email is already registered.')
  })

  test('passwords that do not match are refused', async ({ request }) => {
    const { errors } = await register(request, signUp({ confirmPassword: 'Different123!' }))
    expect(errors).toContain('Passwords do not match.')
  })

  test('every broken password rule is listed', async ({ request }) => {
    const { errors } = await register(request, signUp({ password: 'abc', confirmPassword: 'abc' }))
    expect(errors).toEqual(expect.arrayContaining([
      'Password must be at least 8 characters.',
      'Password must contain an uppercase letter.',
      'Password must contain a special character (!@#$%^&*).'
    ]))
  })

  test('several problems at once are all shown together', async ({ request }) => {
    const { status, errors } = await register(request, signUp({ username: 'bad name', email: 'bad', password: 'abc', confirmPassword: 'xyz' }))
    expect(status).toBe(400)
    // username + email + mismatch + 3 password rules
    expect(errors.length).toBeGreaterThanOrEqual(6)
  })
})

test.describe('Register: the page', () => {
  test('password rules update as you type, and Sign up stays off until they pass', async ({ page }) => {
    // setup
    await page.goto('/register')
    const rules = page.getByRole('list', { name: 'Password requirements' })
    const signUpButton = page.getByRole('button', { name: 'Sign up' })
    // actions + assert: a weak password
    await page.getByPlaceholder('Password', { exact: true }).fill('abc')
    await expect(rules).toContainText('○ At least 8 characters')
    await expect(signUpButton).toBeDisabled()
    // a strong one
    await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD)
    await expect(rules).toContainText('✓ At least 8 characters')
    await expect(rules).toContainText('✓ One uppercase letter')
    await expect(rules).toContainText('✓ One special character')
    await expect(signUpButton).toBeEnabled()
  })

  test('the page stops passwords that do not match', async ({ page }) => {
    await page.goto('/register')
    await page.getByPlaceholder('Username').fill(`e2e_${Date.now()}`)
    await page.getByPlaceholder('Email').fill(`e2e_${Date.now()}@test.com`)
    await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD)
    await page.getByPlaceholder('Confirm password').fill('Different123!')
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.getByRole('alert')).toContainText('Passwords do not match.')
  })

  test('server problems are all listed on the page', async ({ page }) => {
    await page.goto('/register')
    await page.getByPlaceholder('Username').fill('SeedOwner')
    await page.getByPlaceholder('Email').fill('seed.owner@petsociety.com')
    await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD)
    await page.getByPlaceholder('Confirm password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign up' }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Email is already registered.')
    await expect(alert).toContainText('Username is already taken.')
    await expect(page).toHaveURL(/\/register/)
  })
})

test.describe('Log in and log out', () => {
  test('an empty box → "Please fill in both boxes." (API)', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { emailOrUser: '', password: '' } })
    await expectError(res, 400, 'Please fill in both boxes.')
  })

  test('an unknown user gets the same message as a wrong password (API)', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { emailOrUser: 'nobody_here', password: PASSWORD } })
    await expectError(res, 401, 'Invalid login details.')
  })

  test('you can log in with your username instead of your email', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('Email/Username').fill('SeedOwner')
    await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page).toHaveURL(/\/home/)
  })

  test('the login cookie lasts 7 days', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('Email/Username').fill('SeedOwner')
    await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page).toHaveURL(/\/home/)
    const cookie = (await page.context().cookies()).find((c) => c.name === 'connect.sid')
    const daysLeft = (cookie.expires * 1000 - Date.now()) / (24 * 60 * 60 * 1000)
    expect(daysLeft).toBeGreaterThan(6.9)
    expect(daysLeft).toBeLessThan(7.1)
  })

  test('Log out ends the session', async ({ page }) => {
    // setup: log in here (NOT with a saved login: logging out would break the saved one for other tests)
    await page.goto('/login')
    await page.getByPlaceholder('Email/Username').fill('seed.sitter2@petsociety.com')
    await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page).toHaveURL(/\/home/)
    // actions
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('button', { name: 'Log out' }).click()
    // assert: back on the landing page, and the server no longer knows us
    await expect(page.getByRole('heading', { name: 'Trusted sitters for the pets you love' })).toBeVisible()
    const me = await page.request.get('/api/auth/me')
    expect(me.status()).toBe(401)
  })
})

test.describe('Change password (API, on a new user so the seed passwords never change)', () => {
  test('every rule, then a real change', async ({ browser }) => {
    // setup
    const user = await newUser(browser)
    const change = (data) => user.api.put('/api/auth/password', { data })

    // actions + assert: each rule
    await expectError(await change({ currentPassword: '', newPassword: '' }), 400, 'Please fill in both passwords.')
    await expectError(await change({ currentPassword: 'Wrong123!', newPassword: 'Another123!' }), 400, 'Your current password is incorrect.')
    await expectError(await change({ currentPassword: PASSWORD, newPassword: PASSWORD }), 400, 'Your new password must be different from the current one.')
    await expectError(await change({ currentPassword: PASSWORD, newPassword: 'short' }), 400, 'Password must be at least 8 characters.')

    // a real change, then log in with the new password
    const ok = await change({ currentPassword: PASSWORD, newPassword: 'Changed123!' })
    expect(ok.status()).toBe(200)
    const login = await user.api.post('/api/auth/login', { data: { emailOrUser: user.email, password: 'Changed123!' } })
    expect(login.status()).toBe(200)

    await user.context.close()
  })
})

test.describe('Landing page', () => {
  test('logged out: shows the landing page with Log in', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Trusted sitters for the pets you love' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible()
  })

  test.describe('logged in', () => {
    test.use({ storageState: AUTH.owner })
    test('opening / goes straight to /home', async ({ page }) => {
      await page.goto('/')
      await expect(page).toHaveURL(/\/home/)
    })
  })
})
