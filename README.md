# PetSociety (IS216 Group Project)

A community platform for pet lovers. This repo is a monorepo with two apps:

- `client/` &mdash; Vue 3 + Vite + Bootstrap 5
- `server/` &mdash; Node.js + Express + MongoDB (Mongoose)

Both sides include a small working example (a `Pet` list with add/remove) so
you can confirm the stack is wired up end-to-end before building real
features on top of it.

## Prerequisites

- Node.js 18+ and npm
- A MongoDB database &mdash; either running locally, or a free
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
