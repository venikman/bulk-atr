import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testsDir, '../..');

describe('operator surface', () => {
  test('keeps a repo-local just binary and removes package script workflows', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
      engines?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(packageJson.devDependencies?.['just-install']).toBeDefined();
    expect(packageJson.engines?.node).toBe('24.x');
    expect(Object.keys(packageJson.scripts ?? {})).toHaveLength(0);
  });

  test('defines the preferred just command surface', () => {
    const justfilePath = join(repoRoot, 'justfile');

    expect(existsSync(justfilePath)).toBe(true);

    const justfile = readFileSync(justfilePath, 'utf8');

    for (const recipe of ['build:', 'test:', 'check:', 'start:', 'deploy-prod:']) {
      expect(justfile).toContain(recipe);
    }

    for (const recipe of ['deploy:', 'dev-prod:', 'vercel-build:']) {
      expect(justfile).not.toContain(recipe);
    }

    expect(justfile).not.toContain('npm run');
    expect(justfile).toContain('npx tsc --project tsconfig.server.json');
    expect(justfile).toContain('npx rstest --project api');
    expect(justfile).toContain(
      'npx biome check . && npx tsc --noEmit && npx tsc --project tsconfig.server.json --noEmit',
    );
    expect(justfile).toMatch(
      /start:\n(?: {2}.+\n)* {2}vercel pull --yes --environment=production\n(?: {2}.+\n)* {2}sh -ac 'set -a; \. \.vercel\/\.env\.production\.local; set \+a; exec vercel dev --yes'/,
    );
    expect(justfile).toMatch(
      /deploy-prod:\n(?: {2}.+\n)* {2}just test\n(?: {2}.+\n)* {2}vercel pull --yes --environment=production\n(?: {2}.+\n)* {2}vercel build --prod\n(?: {2}.+\n)* {2}vercel deploy --prebuilt --prod -y/,
    );
  });
});
