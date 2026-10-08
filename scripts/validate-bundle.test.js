import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_ROOT, formatReport, validateBundle } from './validate-bundle.js';

test('dsh-knowledge-bridge: bundle contract checks', async (t) => {
  const staging = mkdtempSync(join(tmpdir(), 'dsh-kb-bundle-'));

  t.after(() => {
    rmSync(staging, { recursive: true, force: true });
  });

  /** Copy the real bundle so a mutation can never touch the checkout. */
  const brokenCopy = () => {
    const dir = mkdtempSync(join(staging, 'copy-'));
    cpSync(DEFAULT_ROOT, dir, { recursive: true });
    return dir;
  };

  const failureNames = (result) => result.failed.map((entry) => entry.name);

  await t.test('the shipped bundle passes every check', () => {
    const result = validateBundle(DEFAULT_ROOT);
    assert.deepEqual(result.failed.map((entry) => `${entry.name}: ${entry.detail}`), []);
    assert.ok(result.checks.length >= 15, `expected at least 15 checks, got ${result.checks.length}`);
  });

  await t.test('refuses an entry that reads a service it does not inject', () => {
    const dir = brokenCopy();
    const entry = join(dir, 'index.js');
    writeFileSync(
      entry,
      readFileSync(entry, 'utf8').replace(
        "export const inject = ['tools', 'systemPrompt'];",
        "export const inject = ['tools'];",
      ),
    );
    const result = validateBundle(dir);
    assert.ok(
      failureNames(result).includes("inject declares 'systemPrompt'"),
      `expected the inject check to fail, got: ${failureNames(result).join(', ')}`,
    );
  });

  await t.test('refuses a shipped file with an absolute user path', () => {
    const dir = brokenCopy();
    const entry = join(dir, 'index.js');
    writeFileSync(entry, `${readFileSync(entry, 'utf8')}\nconst leaked = 'C:/Users/someone/vault';\n`);
    const result = validateBundle(dir);
    assert.ok(
      failureNames(result).includes('no absolute user paths in shipped files'),
      `expected the portability check to fail, got: ${failureNames(result).join(', ')}`,
    );
  });

  await t.test('refuses a manifest whose files[] entry is gone', () => {
    const dir = brokenCopy();
    unlinkSync(join(dir, 'CHANGELOG.md'));
    const result = validateBundle(dir);
    assert.ok(
      failureNames(result).includes('every files[] entry exists'),
      `expected the files[] check to fail, got: ${failureNames(result).join(', ')}`,
    );
  });

  await t.test('refuses a bundle whose patch file is missing', () => {
    const dir = brokenCopy();
    unlinkSync(join(dir, 'cordis.patch.yml'));
    const result = validateBundle(dir);
    assert.ok(failureNames(result).includes('bundle patch file exists'));
  });

  await t.test('report renders a pass/fail summary', () => {
    const report = formatReport(validateBundle(DEFAULT_ROOT));
    assert.ok(report.includes('bundle contract'));
    assert.ok(/0 failed/.test(report));
  });
});
