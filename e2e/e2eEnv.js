// Where the tests run: their own copy of the app, on their own ports, using their own database.
// This keeps test runs away from your normal `pnpm dev` (ports 5000 / 5173) and from the demo data,
// so tests can create, cancel and reset things freely.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SERVER_PORT = 5050
export const CLIENT_PORT = 5174
export const E2E_DB = 'petsociety_e2e'

// The same database server as server/.env, but the petsociety_e2e database on it (created automatically on first use)
function e2eMongoUri() {
  const envFile = fileURLToPath(new URL('../server/.env', import.meta.url))
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('MONGO_URI='))
  if (!line) throw new Error('MONGO_URI is missing from server/.env')
  const uri = new URL(line.slice('MONGO_URI='.length).trim())
  uri.pathname = `/${E2E_DB}`
  return uri.href
}
export const E2E_MONGO_URI = e2eMongoUri()

// What the test server and the seed get on top of server/.env (dotenv never overrides these)
export const SERVER_ENV = { MONGO_URI: E2E_MONGO_URI, PORT: String(SERVER_PORT) }
