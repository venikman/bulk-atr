import { normalizeAuthMode } from '../../server/lib/auth.js';

describe('normalizeAuthMode', () => {
  test('trims whitespace around none mode values', () => {
    expect(normalizeAuthMode('none\n')).toBe('none');
    expect(normalizeAuthMode('  none  ')).toBe('none');
  });

  test('trims whitespace around smart-backend mode values', () => {
    expect(normalizeAuthMode('smart-backend\n')).toBe('smart-backend');
  });

  test('falls back to none for unknown values', () => {
    expect(normalizeAuthMode('')).toBe('none');
    expect(normalizeAuthMode('unexpected')).toBe('none');
    expect(normalizeAuthMode(undefined)).toBe('none');
  });
});
