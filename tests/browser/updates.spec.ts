import { test, expect } from './radar-fixture';

test('updates stay hidden by default', async ({ page }) => {
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  await expect(page.getByRole('button', { name: 'Updates', exact: true })).toHaveCount(0);
});

test('administrator can unlock, approve an exact build, follow progress and reconnect after restart', async ({ page }, testInfo) => {
  test.setTimeout(65_000);
  let authenticated = false;
  let phase = 'idle';
  let available = false;
  let revision = 'a'.repeat(40);
  let offline = false;
  let offlineRequests = 0;
  let restarting = false;
  let navigations = 0;
  page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
  let applies = 0;
  const next = 'b'.repeat(40);
  await page.route('**/api/updates', (route) => {
    if (offline) { offlineRequests++; return route.fulfill({ status: 503, json: { enabled: true, ready: false, error: 'service_unavailable' } }); }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.action === 'login') {
        if (body.password !== 'test admin password') return route.fulfill({ status: 401, json: { error: 'invalid_password' } });
        authenticated = true;
      }
      if (body.action === 'check') available = true;
      if (body.action === 'apply') {
        expect(body).toEqual({ action: 'apply', revision: next, confirm: true });
        applies++; phase = 'building';
      }
      return route.fulfill({ status: body.action === 'apply' ? 202 : 200, json: {} });
    }
    return route.fulfill({ json: { enabled: true, ready: true, authenticated, phase, restarting, current: { version: '0.9.0', revision }, available: authenticated && available ? { version: '0.9.0', revision: next } : null } });
  });
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  if (testInfo.project.name === 'mobile') await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Updates' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Administrator password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect administrator password.');
  await expect(page.getByLabel('Administrator password', { exact: true })).toHaveValue('');
  await page.getByLabel('Administrator password', { exact: true }).fill('test admin password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(dialog).toContainText('0.9.0 · bbbbbbb');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  expect(applies).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('update-confirmation.png') });
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.getByRole('button', { name: 'Install update', exact: true }).click();
  await expect(dialog).toContainText('Building new version…');
  await expect(dialog.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  expect(applies).toBe(1);
  offline = true;
  await expect(dialog).toContainText('Vector is restarting.', { timeout: 8000 });
  await expect(dialog.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  offline = false; phase = 'complete'; restarting = true; authenticated = false; available = false; revision = next;
  await expect(dialog).toContainText('0.9.0 · bbbbbbb');
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByLabel('Administrator password', { exact: true })).toBeVisible();
  expect(navigations).toBe(1);
  // Worker restart loses the admin session: reconnect silently without leaking update messages.
  const previousOfflineRequests = offlineRequests;
  offline = true;
  await expect.poll(() => offlineRequests, { timeout: 8000 }).toBeGreaterThan(previousOfflineRequests);
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  offline = false; restarting = false;
  await expect.poll(() => navigations, { timeout: 15_000 }).toBe(2);
  await expect(dialog).toHaveCount(0);
  await page.locator('.settings-menu summary').click();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  await expect(dialog).toContainText('0.9.0 · bbbbbbb');
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(applies).toBe(1);
  // The installer keeps phase=complete in its journal. Subsequent polls must not reload again.
  await page.clock.install();
  await page.clock.fastForward(15_000);
  await expect(dialog.getByRole('status')).toHaveCount(0);
  expect(navigations).toBe(2);
  await page.getByRole('button', { name: 'Close updates' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.settings-menu summary')).toBeFocused();
});

test('closing the update dialog does not stop tracking an accepted update', async ({ page }) => {
  let phase = 'building'; let navigations = 0;
  page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
  await page.route('**/api/updates', (route) => route.fulfill({ json: {
    enabled: true, ready: true, authenticated: true, phase, restarting: false,
    current: { version: '0.9.1', revision: phase === 'building' ? 'a'.repeat(40) : 'b'.repeat(40) },
  } }));
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Building new version');
  await page.getByRole('button', { name: 'Close updates', exact: true }).click();
  phase = 'complete';
  await expect.poll(() => navigations, { timeout: 15_000 }).toBe(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lost apply response is reconciled without another install and a real rollback remains an error', async ({ page }) => {
  const next = 'b'.repeat(40);
  let phase = 'idle'; let offline = false; let applies = 0;
  await page.route('**/api/updates', (route) => {
    if (route.request().method() === 'POST') {
      applies++; phase = 'building'; offline = true;
      return route.abort(); // The worker accepted the job but the web process disappeared.
    }
    if (offline) return route.fulfill({ status: 502, contentType: 'text/html', body: 'Restarting' });
    return route.fulfill({ json: { enabled: true, ready: true, authenticated: true, phase,
      error: phase === 'failed' ? 'update_failed' : null,
      current: { version: '0.9.1', revision: 'a'.repeat(40) }, available: { version: '0.9.1', revision: next } } });
  });
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await page.getByRole('button', { name: 'Install update', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Vector is restarting.');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  offline = false;
  await expect(dialog).toContainText('Building new version');
  phase = 'restoring';
  await expect(dialog).toContainText('Restoring previous installation');
  await expect(dialog.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  phase = 'failed';
  await expect(dialog.getByRole('alert')).toContainText('Update failed.');
  await expect(dialog.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
  expect(applies).toBe(1);
});

test('a prolonged restart has an honest connection warning and later recovers without a stale error', async ({ page }) => {
  let offline = false;
  await page.clock.install();
  await page.route('**/api/updates', (route) => offline
    ? route.fulfill({ status: 503, json: { enabled: true, error: 'service_unavailable' } })
    : route.fulfill({ json: { enabled: true, ready: true, authenticated: true, phase: 'building', current: { version: '0.9.1', revision: 'a'.repeat(40) } } }));
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Building new version');
  offline = true;
  await page.clock.runFor(3000);
  await expect(dialog).toContainText('Vector is restarting.');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.clock.fastForward(125_000);
  await expect(dialog.getByRole('alert')).toContainText('The update outcome is not yet known.');
  offline = false;
  await page.clock.runFor(3000);
  await expect(dialog).toContainText('Building new version');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('unavailable service shows only the installed version to a locked visitor', async ({ page }) => {
  await page.route('**/api/updates', (route) => route.fulfill({ status: 503, json: { enabled: true, ready: false, error: 'service_unavailable' } }));
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.update-builds')).toContainText('Installed');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(page.getByLabel('Administrator password', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const phase of ['idle', 'checking', 'building', 'complete', 'failed']) {
  test(`locked visitors do not see update messages in phase ${phase}`, async ({ page }) => {
    const revision = 'a'.repeat(40);
    await page.addInitScript((revision) => {
      sessionStorage.setItem('vector.updateReload', JSON.stringify({ revision, at: Date.now() }));
    }, revision);
    await page.route('**/api/updates', (route) => route.fulfill({ json: {
      enabled: true, ready: true, authenticated: false, phase, checkedAt: Date.now(),
      error: phase === 'failed' ? 'update_failed' : null,
      current: { version: '0.9.1', revision },
    } }));
    await page.goto('/');
    await page.locator('.settings-menu summary').click();
    await page.getByRole('button', { name: 'Updates', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.update-builds')).toHaveText('Installed0.9.1 · aaaaaaa');
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByLabel('Administrator password', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
  });
}

test('locking an administrator session hides its previous success message', async ({ page }) => {
  let authenticated = true;
  await page.route('**/api/updates', (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ action: 'logout' });
      authenticated = false;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: {
      enabled: true, ready: true, authenticated, phase: 'idle', checkedAt: Date.now(),
      current: { version: '0.9.1', revision: 'a'.repeat(40) },
    } });
  });
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toHaveText('Your installation is up to date.');
  await dialog.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(dialog.getByLabel('Administrator password', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});
