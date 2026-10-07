import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { defaultThemeMode, normalizeThemeMode, parseThemeMode, resolveTheme, themeBootstrapScript, themeModes, themes } from '../src/theme.ts';

test('offers two resolved themes and an automatic preference by default', () => {
  assert.deepEqual(themes, ['dark', 'light']);
  assert.deepEqual(themeModes, ['dark', 'light', 'auto']);
  assert.equal(defaultThemeMode, 'auto');
  for (const mode of themeModes) assert.equal(parseThemeMode(mode), mode);
  for (const value of [null, undefined, {}, 'unknown', 'constructor', '__proto__']) {
    assert.equal(parseThemeMode(value), 'auto');
    assert.equal(normalizeThemeMode(value), undefined);
  }
});

test('migrates old interface themes without interpreting retired map styles', () => {
  for (const value of ['vector', 'midnight', 'radar', 'amber']) assert.equal(parseThemeMode(value), 'dark');
  assert.equal(parseThemeMode('daylight'), 'light');
  assert.equal(parseThemeMode('contrast'), 'auto');
  assert.equal(parseThemeMode('standard'), 'auto');
});

test('automatic follows the device while explicit choices override it', () => {
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  for (const theme of themes) for (const prefersDark of [true, false]) assert.equal(resolveTheme(theme, prefersDark), theme);
});

test('first-paint bootstrap agrees with migration and tolerates unavailable storage', () => {
  for (const value of [undefined, 'dark', 'light', 'auto', 'daylight', 'midnight', 'constructor']) {
    for (const prefersDark of [true, false]) {
      const dataset: Record<string, string> = {};
      runInNewContext(themeBootstrapScript, {
        localStorage: { getItem: () => value },
        matchMedia: () => ({ matches: prefersDark }),
        document: { documentElement: { dataset } },
      });
      assert.equal(dataset.theme, resolveTheme(parseThemeMode(value), prefersDark));
      assert.equal(dataset.themeMode, parseThemeMode(value));
    }
  }
  const dataset: Record<string, string> = {};
  runInNewContext(themeBootstrapScript, {
    localStorage: { getItem: () => { throw new Error('blocked'); } },
    matchMedia: () => ({ matches: false }),
    document: { documentElement: { dataset } },
  });
  assert.deepEqual(dataset, { theme: 'light', themeMode: 'auto' });
});
