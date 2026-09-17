import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTheme, parseTheme, themes } from '../src/theme.ts';

test('offers five stable interface themes', () => {
  assert.deepEqual(themes, ['vector', 'midnight', 'radar', 'amber', 'daylight']);
});

test('accepts known themes and safely falls back to Vector', () => {
  for (const theme of themes) assert.equal(parseTheme(theme), theme);
  assert.equal(parseTheme('unknown'), defaultTheme);
  assert.equal(parseTheme(null), defaultTheme);
});
