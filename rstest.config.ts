import { defineConfig } from '@rstest/core';

export default defineConfig({
  globals: true,
  coverage: { provider: 'istanbul', reporters: ['text', 'html'] },
  projects: [
    {
      name: 'api',
      globals: true,
      testEnvironment: 'node',
      include: ['tests/api/**/*.test.ts'],
    },
  ],
});
