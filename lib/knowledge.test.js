import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

import {
  resolveKnowledgePaths,
  buildKnowledgeIndex,
  searchKnowledge,
  readKnowledgeItem,
  loadRulesFile,
  expandHome,
  parsePathList,
  toStringList,
  DISCOVERY_CANDIDATES,
  KNOWLEDGE_PATHS_ENV,
} from './knowledge.js';

test('dsh-knowledge-bridge: knowledge engine test suite', async (t) => {
  const tempBase = mkdtempSync(join(tmpdir(), 'dsh-kb-test-'));

  t.after(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  // Setup mock knowledge structure
  const kbDir = join(tempBase, 'knowledge');
  mkdirSync(kbDir, { recursive: true });

  // 1. Structured item (Antigravity-style)
  const item1Dir = join(kbDir, 'posttracker_engine');
  const artifacts1Dir = join(item1Dir, 'artifacts');
  mkdirSync(artifacts1Dir, { recursive: true });

  writeFileSync(
    join(item1Dir, 'metadata.json'),
    JSON.stringify({
      title: 'PostTracker Dual-Leg Reconciliation Engine',
      summary: 'Architecture for Facebook post tracking, watchdog timer, and watchdog reconciliation.',
      tags: ['facebook', 'posttracker', 'reconciliation'],
      references: ['functions/trackPost.js', 'config/fb_error_radar'],
      aliases: ['ตัวนับโพสต์', 'ghost ticket killer'],
    }),
  );

  writeFileSync(
    join(artifacts1Dir, 'master_guide.md'),
    '# Master Guide\n\nComplete architecture overview of PostTracker.',
  );
  writeFileSync(
    join(artifacts1Dir, '01_watchdog.md'),
    '# Watchdog Timer\n\n12-second timeout reconciliation loop handled by WatchdogSweeper.',
  );

  // 2. Simple doc folder (generic open-source style)
  const item2Dir = join(kbDir, 'payment_gateway');
  mkdirSync(item2Dir, { recursive: true });
  writeFileSync(
    join(item2Dir, 'README.md'),
    '# Stripe Payment Integration\n\nHandles subscription checkout and webhooks.',
  );

  // 3. Standalone markdown file
  writeFileSync(
    join(kbDir, 'deploy-guide.md'),
    '# Deployment Guide\n\nSteps to deploy the server to production.',
  );

  // 4. Mock rules file
  writeFileSync(
    join(tempBase, 'AGENTS.md'),
    '# Agent Safety Rules\n\nStrict prohibition on unilateral changes without user consultation.',
  );

  await t.test('resolveKnowledgePaths filters non-existent paths', () => {
    const paths = resolveKnowledgePaths([kbDir, join(tempBase, 'non-existent')], tempBase);
    assert.equal(paths.length, 1);
    assert.equal(paths[0], kbDir);
  });

  await t.test('buildKnowledgeIndex indexes structured folders, generic folders, and standalone files', () => {
    const index = buildKnowledgeIndex([kbDir]);
    assert.equal(index.length, 3);

    const postTracker = index.find((i) => i.id === 'posttracker_engine');
    assert.ok(postTracker);
    assert.equal(postTracker.title, 'PostTracker Dual-Leg Reconciliation Engine');
    assert.ok(postTracker.summary.includes('watchdog'));
    assert.equal(postTracker.artifacts.length, 2);

    const payment = index.find((i) => i.id === 'payment_gateway');
    assert.ok(payment);
    assert.ok(payment.summary.includes('Stripe Payment'));

    const deploy = index.find((i) => i.id === 'deploy-guide');
    assert.ok(deploy);
    assert.ok(deploy.summary.includes('Deployment Guide'));
  });

  await t.test('searchKnowledge ranks keyword matches accurately', () => {
    const index = buildKnowledgeIndex([kbDir]);

    const results = searchKnowledge(index, 'watchdog reconciliation');
    assert.ok(results.length > 0);
    assert.equal(results[0].id, 'posttracker_engine');

    const paymentResults = searchKnowledge(index, 'stripe payment');
    assert.ok(paymentResults.length > 0);
    assert.equal(paymentResults[0].id, 'payment_gateway');

    const emptyResults = searchKnowledge(index, 'quantum spaceship');
    assert.equal(emptyResults.length, 0);
  });

  await t.test('index carries the metadata keywords the vault author declared', () => {
    const index = buildKnowledgeIndex([kbDir]);
    const item = index.find((entry) => entry.id === 'posttracker_engine');

    assert.deepEqual(item.tags, ['facebook', 'posttracker', 'reconciliation']);
    assert.deepEqual(item.references, ['functions/trackPost.js', 'config/fb_error_radar']);
    assert.deepEqual(item.aliases, ['ตัวนับโพสต์', 'ghost ticket killer']);

    // A delimited string is accepted too, so hand-written metadata cannot break the index.
    assert.deepEqual(toStringList('leave, pos; payroll'), ['leave', 'pos', 'payroll']);
    assert.deepEqual(toStringList(undefined), []);
  });

  await t.test('aliases, tags and references each find an item the way the author intended', () => {
    const index = buildKnowledgeIndex([kbDir]);

    const byAlias = searchKnowledge(index, 'ghost ticket killer');
    assert.equal(byAlias[0]?.id, 'posttracker_engine');
    assert.ok(byAlias[0].score >= 8, 'alias match must score at least 8');

    const byReference = searchKnowledge(index, 'functions/trackPost.js');
    assert.equal(byReference[0]?.id, 'posttracker_engine');
    assert.ok(byReference[0].score >= 4, 'reference match must score at least 4');

    const byTag = searchKnowledge(index, 'facebook');
    assert.equal(byTag[0]?.id, 'posttracker_engine');
    assert.ok(byTag[0].score >= 6, 'tag match must score at least 6');

    // Thai alias works as-is: no synonym table, the author declares the words.
    const byThaiAlias = searchKnowledge(index, 'ตัวนับโพสต์');
    assert.equal(byThaiAlias[0]?.id, 'posttracker_engine');
  });

  await t.test('body search finds a symbol that exists only inside a document', () => {
    const index = buildKnowledgeIndex([kbDir]);

    // "WatchdogSweeper" appears in 01_watchdog.md and nowhere in any metadata.
    const results = searchKnowledge(index, 'WatchdogSweeper');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'posttracker_engine');
    assert.equal(results[0].score, 1, 'a body-only match scores exactly 1');
  });

  await t.test('metadata matches outrank body matches and never pay for a document read', () => {
    const index = buildKnowledgeIndex([kbDir]);
    const ranked = searchKnowledge(index, 'watchdog');

    assert.equal(ranked[0].id, 'posttracker_engine');
    assert.ok(ranked[0].score > 1, 'title/summary/artifact match must beat a body match');
  });

  await t.test('readKnowledgeItem reads default master_guide and specific artifacts', () => {
    const index = buildKnowledgeIndex([kbDir]);

    // Read default (master_guide.md)
    const readDefault = readKnowledgeItem(index, 'posttracker_engine');
    assert.ok(!readDefault.error);
    assert.equal(readDefault.file, 'master_guide.md');
    assert.ok(readDefault.content.includes('Complete architecture overview'));

    // Read specific artifact
    const readArtifact = readKnowledgeItem(index, 'posttracker_engine', '01_watchdog.md');
    assert.ok(!readArtifact.error);
    assert.equal(readArtifact.file, '01_watchdog.md');
    assert.ok(readArtifact.content.includes('12-second timeout'));

    // Read standalone file
    const readStandalone = readKnowledgeItem(index, 'deploy-guide');
    assert.ok(!readStandalone.error);
    assert.ok(readStandalone.content.includes('Steps to deploy'));

    // Non-existent item
    const missing = readKnowledgeItem(index, 'unknown_id');
    assert.ok(missing.error);
  });

  await t.test('loadRulesFile discovers candidate rules file', () => {
    const rules = loadRulesFile(['AGENTS.md', 'CLAUDE.md'], tempBase);
    assert.ok(rules);
    assert.ok(rules.content.includes('Agent Safety Rules'));
  });

  await t.test('expandHome and parsePathList normalize user input', () => {
    assert.equal(expandHome('~'), homedir());
    assert.equal(expandHome('~/vault'), join(homedir(), 'vault'));
    assert.equal(expandHome('/absolute/vault'), '/absolute/vault');
    assert.equal(expandHome(''), '');
    assert.deepEqual(parsePathList('a;b,c'), ['a', 'b', 'c']);
    assert.deepEqual(parsePathList('"quoted path"; b'), ['quoted path', 'b']);
    assert.deepEqual(parsePathList(undefined), []);
  });

  await t.test('zero-config discovery finds the vault through the environment variable', () => {
    // No config paths at all -> the env var must be probed before the built-in
    // candidates (a developer machine may also have a real vault in ~/...).
    const found = resolveKnowledgePaths([], tempBase, { [KNOWLEDGE_PATHS_ENV]: kbDir });
    assert.equal(found[0], kbDir, 'env var root must outrank the built-in candidates');
    assert.ok(found.includes(kbDir));

    // Multiple roots, `;` separated, non-existent entries dropped.
    const both = resolveKnowledgePaths([], tempBase, {
      [KNOWLEDGE_PATHS_ENV]: `${join(tempBase, 'nope')};${kbDir}`,
    });
    assert.equal(both[0], kbDir);
  });

  await t.test('explicit config wins and still combines with the environment variable', () => {
    const extra = join(tempBase, 'extra-vault');
    mkdirSync(extra, { recursive: true });

    const withoutEnv = resolveKnowledgePaths([kbDir], tempBase, {});
    assert.deepEqual(withoutEnv, [kbDir]);

    const withEnv = resolveKnowledgePaths([kbDir], tempBase, { [KNOWLEDGE_PATHS_ENV]: extra });
    assert.deepEqual(withEnv, [kbDir, extra]);

    // Duplicates are collapsed case-insensitively on Windows.
    const deduped = resolveKnowledgePaths([kbDir, kbDir], tempBase, {});
    assert.deepEqual(deduped, [kbDir]);
  });

  await t.test('discovery candidates are machine-independent (no hardcoded user paths)', () => {
    for (const candidate of DISCOVERY_CANDIDATES) {
      assert.ok(
        candidate.startsWith('~') || candidate.startsWith('./'),
        `candidate must be home-relative or cwd-relative: ${candidate}`,
      );
      assert.ok(!/^[A-Za-z]:/.test(candidate), `candidate must not hardcode a drive: ${candidate}`);
    }
  });
});
