// License end to end: the real app with the gate on (ENCLAVE_REQUIRE_LICENSE=1), its own data folder,
// the live relay. Needs a real key in ENCLAVE_E2E_LICENSE_KEY (issue a short one, revoke it after).
//
//   $env:ENCLAVE_E2E_LICENSE_KEY = "ENC1-..."
//   npx --yes pnpm@12.15.0 --filter @enclave/desktop exec playwright test license

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.ENCLAVE_E2E_LICENSE_KEY ?? '';
let scratch: string;

async function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [appDir],
    env: {
      ...process.env,
      ENCLAVE_HOME: path.join(scratch, 'home'),
      ENCLAVE_TEST_USER_DATA: path.join(scratch, 'user-data'),
      AGENT_PORT: '8798',
      ENCLAVE_PHONE: '',
      ENCLAVE_REQUIRE_LICENSE: '1',
      AGENT_TOKEN: `e2e-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    },
  });
}

test.beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'enclave-lic-e2e-'));
});
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test('asks for a key, refuses a bad one, takes a good one, and remembers it', async () => {
  test.skip(!KEY, 'ENCLAVE_E2E_LICENSE_KEY is not set');
  let app = await launch();
  let page = await app.firstWindow();

  // 1. No license: the key screen, and nothing else.
  await expect(page.getByRole('heading', { name: 'Enter your license key' })).toBeVisible();
  await expect(page.getByText('Profiles', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'e2e-results/license-1-gate.png' });

  // 2. A bad key says why.
  await page.getByLabel('License key').fill('ENC1-aaaaaaaa.bbbbbbbb');
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText(/doesn't look like a license key|isn't valid/)).toBeVisible();

  // 3. A real key (checked against the live relay) opens the app.
  await page.getByLabel('License key').fill(KEY);
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your license key' })).toHaveCount(0, {
    timeout: 30_000,
  });
  const status = await page.evaluate(() => window.enclave.licenseState());
  expect(status.licensed).toBe(true);
  expect(status.lastCheck).toBeTruthy();
  await page.screenshot({ path: 'e2e-results/license-2-open.png' });

  // 4. Closed and opened again (same data folder): no key screen, the key was kept sealed.
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect
    .poll(async () => (await page.evaluate(() => window.enclave.licenseState())).licensed, {
      timeout: 30_000,
    })
    .toBe(true);
  await expect(page.getByRole('heading', { name: 'Enter your license key' })).toHaveCount(0);

  // 5. The agent starts no profile without a license; with one the request reaches the normal start.
  const start = await page.evaluate(
    async () => (await window.enclave.request('POST', '/profiles/does-not-exist/start')).status,
  );
  expect(start).not.toBe(402);
  await app.close();
});
