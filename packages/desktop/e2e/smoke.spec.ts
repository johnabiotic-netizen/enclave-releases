// UI smoke test (Stage 5, task J): the main flow in the real app, against the real agent and
// Docker. It runs a separate Enclave (its own data folders and port, phone access off), so the
// owner's profiles and a running Enclave are never touched. Needs Docker, the browser image and
// TEST_PROXY in the repo's .env. Takes about two minutes.
//
//   npx --yes pnpm@12.15.0 build
//   npx --yes pnpm@12.15.0 --filter @enclave/desktop test:e2e

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = `Smoke test ${Date.now().toString(36)}`;

let app: ElectronApplication;
let page: Page;
let scratch: string;

test.beforeAll(async () => {
  scratch = mkdtempSync(path.join(tmpdir(), 'enclave-e2e-'));
  app = await electron.launch({
    args: [appDir],
    env: {
      ...process.env,
      ENCLAVE_HOME: path.join(scratch, 'home'),
      ENCLAVE_TEST_USER_DATA: path.join(scratch, 'user-data'),
      AGENT_PORT: '8797',
      ENCLAVE_PHONE: '',
      // A fresh token for this run's own agent (the repo .env would not override these).
      AGENT_TOKEN: `e2e-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  // Leave nothing behind, even after a failure: delete the test profile through the app's API.
  await page
    ?.evaluate(async (name) => {
      const list = (await window.enclave.request('GET', '/profiles')).body as {
        id: string;
        name: string;
      }[];
      for (const p of list.filter((x) => x.name === name)) {
        await window.enclave.request('POST', `/profiles/${p.id}/stop`);
        await window.enclave.request('DELETE', `/profiles/${p.id}?confirm=true`);
      }
    }, NAME)
    .catch(() => {});
  // The app stops its agent and quits; its files are free once the process has ended.
  const closed = app?.waitForEvent('close').catch(() => {});
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await closed;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

test('create, start, view, stop and delete a profile', async () => {
  test.setTimeout(240_000);

  // An empty Enclave invites the first profile.
  await expect(page.getByText('No profiles yet. Create your first sealed profile')).toBeVisible({
    timeout: 60_000,
  });

  // Create: name, test proxy, Check, device, review.
  await page.getByRole('button', { name: 'Create profile' }).click();
  await page.getByLabel('Name').fill(NAME);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/Use the built in test proxy/).check();
  await page.getByRole('button', { name: 'Check proxy' }).click();
  await expect(page.getByText('Proxy works')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Auto', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/time zone, language and location will match/)).toBeVisible();
  await page.getByRole('button', { name: 'Create profile' }).click();

  // Back on the dashboard with the new profile selected, stopped.
  const tile = page.locator('.tile', { hasText: NAME });
  await expect(tile).toBeVisible({ timeout: 120_000 });
  await expect(tile.locator('.tile-state')).toHaveText('Stopped');
  await expect(page.getByRole('complementary', { name: `${NAME} details` })).toBeVisible();

  // Start: the seam goes amber, then green.
  await tile.getByRole('button', { name: 'Start' }).click();
  await expect(tile).toHaveClass(/seam-busy/);
  await expect(tile.locator('.tile-state')).toHaveText('Running', { timeout: 120_000 });
  await expect(tile).toHaveClass(/seam-running/);

  // View: the stream plays.
  await tile.getByRole('button', { name: 'Open' }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const v = document.querySelector<HTMLVideoElement>('.stream video');
          return v && !v.paused ? v.videoWidth : 0;
        }),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Back to profiles' }).click();

  // Stop from the tile's menu.
  await tile.getByRole('button', { name: `More for ${NAME}` }).click();
  await page.getByRole('menuitem', { name: 'Stop' }).click();
  await expect(tile.locator('.tile-state')).toHaveText('Stopped', { timeout: 60_000 });

  // Delete asks first, then the profile is gone.
  await tile.getByRole('button', { name: `More for ${NAME}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog', { name: `Delete ${NAME}?` })).toBeVisible();
  await page.getByRole('button', { name: 'Delete profile' }).click();
  await expect(tile).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('No profiles yet.')).toBeVisible();
});
