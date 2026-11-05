# PetSociety (IS216 Group Project)

A community platform for pet lovers. This repo is a monorepo with two apps:

- `client/` - Vue 3 + Vite + Bootstrap 5
- `server/` - Node.js + Express + MongoDB (Mongoose)

Both sides include a small working example (a `Pet` list with add/remove) so
you can confirm the stack is wired up end-to-end before building real
features on top of it.

## Prerequisites

- Node.js 18+ and npm
- A MongoDB database - either running locally, or a free
  [MongoDB Atlas](https://www.mongodb.com/atlas) cluster

## Getting started

### 1. Server

```bash
cd server
npm install
cp .env.example .env   # then edit .env with your MONGO_URI
npm run dev
```

The API starts on `http://localhost:5000`. Check `http://localhost:5000/api/health`
to confirm it's up, and `http://localhost:5000/api/pets` for the pets endpoint.

### 2. Client

In a second terminal:

```bash
cd client
npm install
npm run dev
```

The app starts on `http://localhost:5173`. During development, requests to
`/api/*` are proxied to the server automatically (see `client/vite.config.js`),
so you don't need to set `VITE_API_URL` unless you're building for production.

## Project structure

```
IS216-G10-T1/
├── client/                  Vue 3 + Vite + Bootstrap frontend
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.js          App entry point, mounts Vue + Bootstrap
│       ├── App.vue          Root component (NavBar + router-view)
│       ├── router/          Vue Router routes
│       ├── views/           Page-level components (Home, Pets)
│       ├── components/      Reusable components (NavBar, PetCard)
│       ├── services/        API client (axios)
│       └── assets/          Global CSS
│
└── server/                  Express + MongoDB backend
    ├── server.js            App entry point
    └── src/
        ├── config/          Database connection
        ├── models/          Mongoose schemas (Pet)
        ├── controllers/     Route handler logic
        ├── routes/          Express routers
        └── middleware/      Error handling helpers
```

## API reference (Pet example)

| Method | Route            | Description       |
| ------ | ---------------- | ------------------ |
| GET    | `/api/pets`      | List all pets      |
| GET    | `/api/pets/:id`  | Get one pet         |
| POST   | `/api/pets`      | Create a pet        |
| PUT    | `/api/pets/:id`  | Update a pet         |
| DELETE | `/api/pets/:id`  | Delete a pet          |

## Notes

- `.env` files are git-ignored on both sides &mdash; never commit real database
  credentials. Copy the `.env.example` file and fill in your own values locally.
- This starter is intentionally minimal so the team can build actual
  PetSociety features (auth, adoption listings, etc.) on top of a working
  foundation.

## Testing (End-to-End, Playwright)

### Setup (once)
1. Make sure `server/.env` has `MONGO_URI` (and `STRIPE_SECRET_KEY` for the payment test).
2. `cd e2e && pnpm install && pnpm exec playwright install chromium`

### Run
```bash
cd e2e
pnpm playwright test            # resets the test database, starts its own client + server, runs all tests
pnpm exec playwright show-report
```

The tests never touch your own data. They use their own database, `petsociety_e2e` (on the same server as `MONGO_URI`, created automatically), and start their own copy of the app on ports 5050 (server) and 5174 (client), so your normal `pnpm dev` on 5000 / 5173 can keep running. Before each run, `pnpm seed:e2e` resets that database to the test data in `server/src/seed/e2e/` (see `e2e/e2eEnv.js`).

### Test accounts (in the test database only, password `Password123!`)
- Owner: seed.owner@petsociety.com
- Sitter: seed.sitter@petsociety.com
- Sitter 2: seed.sitter2@petsociety.com

### Demo data (for showing the app)
`cd server && pnpm seed` (or `pnpm seed:demo`) creates 4 owners and 12 sitters with full histories, for demos, in the database in `server/.env`. It only replaces `demo.*` accounts. Password `Password123!`.
- Owner: demo.claire@petsociety.com (shibamumclaire), the fullest account, with enough bookings, receipts and reports to fill more than one page
- Sitter: demo.benny@petsociety.com (petbuddybenny), with 7 new requests, 6 reviews and a session in progress today
- Other owners: demo.rayyan, demo.meiling, demo.jun; other sitters: demo.priya, demo.wei, demo.carmen, demo.faiz, demo.lucas, demo.wendy, demo.bala, demo.tiffany, demo.kai, demo.sara, demo.harith (all @petsociety.com)

### Test cases
| ID | Journey | File |
|---|---|---|
| TC-01 | Valid login → Home | tests/auth.spec.js |
| … | … | … |

Notes: tests run one at a time (shared database). The Stripe test stops at the redirect to Stripe Checkout (test mode, no real money).
