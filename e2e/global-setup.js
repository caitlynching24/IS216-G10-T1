// Runs ONCE before all the tests: reset the tests' own database (petsociety_e2e) to the test data,
// so every run starts from exactly the same state. This is what makes the tests repeatable.
// The test data is server/src/seed/e2e/e2eSeed.js, separate from the demo data (pnpm seed).
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SERVER_ENV } from './e2eEnv.js'

export default async function globalSetup() {
  // the server folder, next to this e2e folder (works with the spaces in your Windows path)
  const serverDir = fileURLToPath(new URL('../server', import.meta.url))
  execSync('pnpm seed:e2e', { cwd: serverDir, stdio: 'inherit', env: { ...process.env, ...SERVER_ENV } })
}