import { test, expect } from './radar-fixture';

test('updates stay hidden by default', async ({ page }) => {
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  await expect(page.getByRole('button', { name: 'Updates', exact: true })).toHaveCount(0);
});

test('administrator can unlock, approve an exact build, follow progress and reconnect after restart', async ({ page }, testInfo) => {
  let authenticated = false;
  let phase = 'idle';
  let available = false;
  let revision = 'a'.repeat(40);
  let offline = false;
  let applies = 0;
  const next = 'b'.repeat(40);
  await page.route('**/api/updates', (route) => {
    if (offline) return route.fulfill({ status: 503, json: { enabled: true, ready: false, error: 'service_unavailable' } });
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
    return route.fulfill({ json: { enabled: true, ready: true, authenticated, phase, current: { version: '0.9.0', revision }, available: authenticated && available ? { version: '0.9.0', revision: next } : null } });
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
  expect(applies).toBe(1);
  offline = true;
  await expect(dialog).toContainText('Reconnecting…', { timeout: 8000 });
  offline = false; phase = 'complete'; authenticated = false; available = false; revision = next;
  await expect(dialog).toContainText('Update installed.', { timeout: 8000 });
  await expect(dialog).toContainText('0.9.0 · bbbbbbb');
  await page.getByRole('button', { name: 'Close updates' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.settings-menu summary')).toBeFocused();
});

test('unavailable service has an explicit message and no login form', async ({ page }) => {
  await page.route('**/api/updates', (route) => route.fulfill({ status: 503, json: { enabled: true, ready: false, error: 'service_unavailable' } }));
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The update service is unavailable.');
  await expect(page.getByLabel('Administrator password', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
