# PetSociety (IS216 G10-T1)

PetSociety connects pet owners in Singapore with trusted pet sitters. Owners find a sitter, book care for their pets, follow each visit live, and pay online. Sitters manage their calendar and requests, run each visit with a checklist, and get paid.

- **Live site:** https://is216-g10-t1.vercel.app/
- **GitHub repo:** https://github.com/ezenia22/IS216-G10-T1

## Test accounts (live site)

| Role | Username | Email | Password |
| --- | --- | --- | --- |
| Owner | caitlynnn | caitSitter@gmail.com | Testing123! |
| Sitter | kieranSitter | kieran.test.sitter@example.com | Testd0ab33ce! |

Log in with either the email or the username.

## What our app does

**Owners can:**
- Search sitters by name, distance, available dates and hours, pet type and rating, on a list and a map, or turn on "Recommended for me".
- Send a booking request: pick pets, days and hours, and care tasks (feed, walk, medicine and more). The price is worked out from the tasks.
- Confirm a booking once the sitter accepts, add care details (feeding times, food, instructions), and chat with the sitter.
- Record walking routes from home on a map, for the sitter to follow.
- Follow a visit live: the sitter's location, ticked tasks, walks, and alerts if the sitter goes off the route.
- Read the visit report (notes and photos), pay by card, and leave a review.

**Sitters can:**
- Set their available days and hours on a calendar, and sync confirmed bookings to Google Calendar.
- Accept or decline requests, and cancel with a reason.
- Start a session at the owner's home (checked by GPS), tick off tasks, do walks with live tracking, and end with a report and photos.
- See payments received on the Transactions page.

Both sides get in-app notifications (new requests, accepted, confirmed, declined, cancelled, session started, walk alerts, payment due and received).

## APIs and libraries used

| API / library | Used for |
| --- | --- |
| OpenStreetMap + Leaflet | Maps (sitter search map, live location) |
| OneMap | Singapore address lookup |
| Cloudinary | Photo uploads (pets, profiles, visit reports) |
| MapLibre + Turf.js | Walk routes, route recording, live location tracking, off-route checking |
| Google Calendar API | Calendar sync for sitters |
| Stripe (test mode) | Card payments |

## Tech stack

- **Client:** Vue 3, Vite, Vue Router, Bootstrap 5, Axios
- **Server:** Node.js, Express, MongoDB (Mongoose), express-session with connect-mongo
- **Tests:** Playwright
- **Hosting:** Vercel (client and server as two services in one project), MongoDB Atlas

## File structure

```
IS216-G10-T1/
├── vercel.json              Vercel setup: client + server services, /api routing, daily cron
├── client/                  Vue 3 + Vite frontend
│   ├── index.html
│   ├── vite.config.js       Dev server on 5173; forwards /api to the server on 5000
│   └── src/
│       ├── main.js          Entry point
│       ├── App.vue          Navbar + page outlet
│       ├── router/          Routes and the login / role guard
│       ├── views/           Pages (OwnerHome, SitterHome, BookingDetail, Session, Notifications, ...)
│       ├── components/      Reusable parts (NavBar, SessionCard, WalkMap, BookingTable, ...)
│       ├── services/        API calls (axios)
│       ├── utils/           Helpers (booking rules, GPS tracking, notifications, ...)
│       └── assets/          CSS and images
├── server/                  Express + MongoDB backend
│   ├── app.js               The Express app (used locally and on Vercel)
│   ├── server.js            Local starter: connects the database, starts background jobs, listens on 5000
│   └── src/
│       ├── config/          Database and Cloudinary setup
│       ├── models/          Mongoose schemas (User, Booking, VisitSession, Walk, Notification, ...)
│       ├── controllers/     Request handlers
│       ├── routes/          Express routers (all under /api)
│       ├── middleware/      Login checks, uploads, error handling
│       ├── utils/           Booking times, expiry, notifications, Google Calendar, ratings, ...
│       └── seed/            Demo data (seedDemo.js) and test data (e2e/)
└── e2e/                     Playwright end-to-end tests
    ├── playwright.config.js
    ├── e2eEnv.js            Test ports (5050 / 5174) and the test database name
    ├── global-setup.js      Resets the test database before every run
    └── tests/               Test files (*.spec.js) and shared helpers
```

## How to set up

### Prerequisites

- Node.js 18 or newer
- pnpm (`npm install -g pnpm`). npm also works for the client and server.
- A MongoDB database. A free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster works.
- For the full feature set: Cloudinary, Stripe (test mode) and Google Cloud (Calendar API) accounts.

### 1. Get the code

```bash
git clone https://github.com/ezenia22/IS216-G10-T1.git
cd IS216-G10-T1
```

### 2. Install dependencies

```bash
cd server && pnpm install
cd ../client && pnpm install
cd ../e2e && pnpm install      # only needed to run the tests
```

### 3. Create `server/.env`

`.env` files are git-ignored, so create this one yourself:

```
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/petsociety
PORT=5000
SESSION_SECRET=<any long random string>
CLIENT_ORIGIN=http://localhost:5173

# Photo uploads
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Google Calendar sync
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5000/api/google/callback

# Payments (use a sk_test_ key)
STRIPE_SECRET_KEY=
```

Only `MONGO_URI` and `SESSION_SECRET` are needed to start the app. Without the others, photo uploads, calendar sync and payments won't work.

The client needs no `.env` for local use: in development, Vite forwards every `/api` request to `http://localhost:5000`.

### 4. (Optional) Load demo data

```bash
cd server
pnpm seed
```

This adds 4 owners and 12 sitters with full booking histories to the database in `MONGO_URI`. It only replaces `demo.*` accounts. All demo accounts use the password `Password123!`, for example `demo.claire@petsociety.com` (owner) and `demo.benny@petsociety.com` (sitter).

## How to run

Open two terminals.

**Terminal 1: server**

```bash
cd server
pnpm dev          # or: pnpm start
```

The API runs on http://localhost:5000. Check http://localhost:5000/api/health, which should answer `{"status":"ok"}`.

**Terminal 2: client**

```bash
cd client
pnpm dev
```

Open http://localhost:5173. Register a new account, or log in with a demo account.

### Deployment (Vercel)

The live site runs both apps in one Vercel project using Vercel Services (see `vercel.json`): `/api/*` goes to the server and everything else to the client. The project's Framework setting is "Services", and the same variables as `server/.env` are set in the Vercel project, plus `CRON_SECRET`, with `CLIENT_ORIGIN` and `GOOGLE_REDIRECT_URI` pointing to the live URL. Background jobs (expiring old requests, ending forgotten sessions, recalculating ratings) run once a day through the cron at `/api/cron/daily`. Each push to `main` deploys automatically.

## How to test

### Automated tests (Playwright)

**Setup (once):**

```bash
cd e2e
pnpm install
pnpm exec playwright install chromium
```

`server/.env` must have `MONGO_URI` (and `STRIPE_SECRET_KEY` for the payment test).

**Run:**

```bash
cd e2e
pnpm test         # runs every test
pnpm test:ui      # opens Playwright's UI to run tests one by one
pnpm report       # opens the HTML report of the last run
```

**What a run does:**

- It never touches your own data. It uses a separate database, `petsociety_e2e`, on the same server as `MONGO_URI`.
- Before every run, `global-setup.js` runs `pnpm seed:e2e`, which resets that database to fixed test data (`server/src/seed/e2e/`).
- It starts its own server on port 5050 and client on port 5174, so your normal `pnpm dev` on 5000 / 5173 can keep running. Nothing else may be using 5050 or 5174.
- Tests run one at a time, because they share one database.
- The whole suite (183 tests, desktop Chrome plus an iPhone 6-sized screen) takes about 2 minutes. Keep the computer awake while it runs.

Test accounts in the test database (password `Password123!`): `seed.owner@petsociety.com`, `seed.sitter@petsociety.com`, `seed.sitter2@petsociety.com`.

### Main test cases

| ID | What it checks | File |
| --- | --- | --- |
| TC-01 | Log in with valid details and land on Home | `auth.spec.js` |
| TC-02 | Wrong password shows "Invalid login details." | `auth.spec.js` |
| TC-03 | Register a new owner account | `auth.spec.js` |
| TC-04 | A logged-out visitor is sent to the login page from My Bookings | `auth.spec.js` |
| TC-05 | Owner searches for a sitter and opens the booking form | `owner-bookings.spec.js` |
| TC-06 | An empty booking request is blocked | `owner-bookings.spec.js` |
| TC-07 | Owner sends a valid booking request at the right price | `owner-bookings.spec.js` |
| TC-08 | Sitter accepts a pending request | `sitter-requests.spec.js` |
| TC-09 | Sitter declines a pending request | `sitter-requests.spec.js` |
| TC-10 | Owner confirms a booking the sitter accepted | `owner-bookings.spec.js` |
| TC-11 | Pay now opens Stripe Checkout (test mode) | `payment.spec.js` |
| TC-12 | "Recommended for me" shows sitters that suit the owner's pets | `owner-bookings.spec.js` |
| TC-13 | Sitter sees payments received, filtered to Successful | `sitter-requests.spec.js` |
| TC-14 | Owner is notified when the sitter accepts | `notifications.spec.js` |
| TC-15 | On a phone, My Bookings tabs become a dropdown | `responsive.spec.js` |

### Edge-case tests

| File | What it covers |
| --- | --- |
| `edge-access.spec.js` | Login required (401), owner-only and sitter-only pages and APIs (403), menus per role, other people's bookings |
| `edge-accounts.spec.js` | Sign-up rules, password checklist, log in by username, 7-day login cookie, log out, change password, landing page |
| `edge-availability.spec.js` | Sitter calendar rules: invalid or past dates, hours outside 7 am to 12 am, one bad day stops the whole save |
| `edge-booking-create.spec.js` | Booking form checks, every server rule for a request, sitter availability and clashes, server-side pricing, several days with different hours |
| `edge-booking-lifecycle.spec.js` | Accept, decline, confirm, withdraw and cancel rules, double-booking a pet, expired requests |
| `edge-care-details.spec.js` | Care details only on confirmed bookings, field limits, locked once a session starts |
| `edge-chat.spec.js` | Chat message limits, who can read and send, read-only after payment |
| `edge-notifications.spec.js` | Notification rules, mark all as read, empty state, request-sent copy |
| `edge-payments-reviews.spec.js` | Pay only when completed, no paying twice, cancelled-at-Stripe page, review rules and rating update |
| `edge-profiles-pets.spec.js` | Profile and address rules, badges, pet rules, photo type and size limits |
| `edge-search.spec.js` | Name search, no private data in the sitter list, logged-out browsing, new-owner hints |
| `edge-sessions-walks.spec.js` | A full session: start at home (GPS check), tasks, walks, ending with a report, payment due, starting away from home with a note |
| `edge-walk-routes.spec.js` | Recording routes: name, points, must start and end at home, other owners can't see them |

### Manual test on the live site

Use the test accounts above at https://is216-g10-t1.vercel.app/. Use two browsers (or one normal and one private window) to be logged in as both at once.

1. **Owner:** log in as `caitlynnn`. Search for `kieranSitter` on Home, open the profile and press Request Booking. Pick a pet, a day and hours the sitter is free, add a care task, and send.
2. **Sitter:** log in as `kieranSitter`. Open Booking Requests and accept the request. The owner gets a notification.
3. **Owner:** confirm the booking under My Bookings → To confirm, and fill in the care details.
4. **Sitter:** on the booking's day, open Session and start it at the owner's address. The owner gets "Session started". Tick the tasks, then end the session with a short note.
5. **Owner:** open My Bookings → To pay, press Pay now, and pay with Stripe's test card `4242 4242 4242 4242` (any future expiry date and any CVC). Then leave a review.

The live site uses Stripe in test mode, so no real money is charged.
