/// <reference types="node" />
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Comments may quote example imports (e.g. a TODO); only real code counts. */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every `from '...'` / `import('...')` / `require('...')` specifier in a file's code. */
const specifiers = (code: string) =>
  [...stripComments(code).matchAll(/(?:from\s+|import\(\s*|require\(\s*)['"]([^'"]+)['"]/g)].map(
    (m) => m[1] ?? ''
  );

describe('dependency direction (CLAUDE.md §3)', () => {
  test('nothing in src/core imports from src/features — not even types', () => {
    const offenders = sourceFiles(join(SRC, 'core')).flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter((spec) => /(^|\/)features\//.test(spec))
        .map((spec) => `${relative(SRC, file)} → ${spec}`)
    );
    expect(offenders).toEqual([]);
  });

  test('the guard actually sees imports (sanity check on the scanner)', () => {
    const files = sourceFiles(join(SRC, 'core'));
    expect(files.length).toBeGreaterThan(10);
    expect(specifiers("import type { A } from '../../features/x';\nconst b = require('../features/y');")).toEqual([
      '../../features/x',
      '../features/y',
    ]);
    expect(specifiers("/** e.g. import('../../features/z') */\n// from '../features/w'\nexport {};")).toEqual([]);
  });
});
