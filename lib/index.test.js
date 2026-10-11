import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { apply, activeProfile, updateCommandFor, PROFILE_UNKNOWN_HINT } from '../index.js';

test('dsh-knowledge-bridge: Host apply() lifecycle & mock harness test', async (t) => {
  const tempBase = mkdtempSync(join(tmpdir(), 'dsh-apply-test-'));

  t.after(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  const kbDir = join(tempBase, 'knowledge');
  mkdirSync(kbDir, { recursive: true });

  const itemDir = join(kbDir, 'autolab_core');
  mkdirSync(join(itemDir, 'artifacts'), { recursive: true });
  writeFileSync(
    join(itemDir, 'metadata.json'),
    JSON.stringify({
      title: 'AutoLab Core Architecture',
      summary: 'Main orchestrator for Premiere Pro CEP and video automation.',
    }),
  );
  writeFileSync(
    join(itemDir, 'artifacts', 'master_guide.md'),
    '# AutoLab Core\n\nCentral hub for all CEP modules.',
  );

  const rulesPath = join(tempBase, 'AGENTS.md');
  writeFileSync(rulesPath, '# AutoLab Agent Safety Contract\n\nNo unilateral edits.');

  // Mock Cordis Context
  const registeredTools = [];
  let registeredGuard = null;
  const registeredSections = [];

  const mockCtx = {
    logger: {
      info: () => {},
      warn: () => {},
    },
    tools: {
      register: (tool) => {
        registeredTools.push(tool);
      },
      guard: (guardFn) => {
        registeredGuard = guardFn;
      },
    },
    systemPrompt: {
      section: (sec) => {
        registeredSections.push(sec);
      },
    },
  };

  // Run apply with custom config
  apply(mockCtx, {
    knowledgePaths: [kbDir],
    rulesPaths: [rulesPath],
    autoInjectRules: true,
    enableSafetyGuard: true,
  });

  await t.test('registers all 4 model-facing tools', () => {
    assert.equal(registeredTools.length, 4);
    const names = registeredTools.map((t) => t.name);
    assert.ok(names.includes('knowledge_search'));
    assert.ok(names.includes('knowledge_read'));
    assert.ok(names.includes('knowledge_list'));
    assert.ok(names.includes('knowledge_info'));
  });

  await t.test('knowledge_search tool execution returns matching results', async () => {
    const searchTool = registeredTools.find((t) => t.name === 'knowledge_search');
    const result = await searchTool.execute({ query: 'autolab orchestrator' });
    assert.equal(result.totalFound, 1);
    assert.equal(result.results[0].id, 'autolab_core');
  });

  await t.test('knowledge_read tool execution reads content from host', async () => {
    const readTool = registeredTools.find((t) => t.name === 'knowledge_read');
    const result = await readTool.execute({ item_id: 'autolab_core' });
    assert.equal(result.success, true);
    assert.equal(result.file, 'master_guide.md');
    assert.ok(result.content.includes('Central hub for all CEP modules.'));
  });

  await t.test('safety guard blocks destructive git commands and allows safe commands', () => {
    assert.ok(registeredGuard, 'Guard must be registered');

    // Real contract: DSH hands the guard the execution object built by
    // dsh-tools `createExecution()` -> { name, arguments, signal, ... }.
    // It has NO `tool` and NO `args` field.
    const blocked = registeredGuard({
      name: 'bash',
      arguments: { command: 'git reset --hard HEAD~1' },
    });
    assert.ok(typeof blocked === 'string');
    assert.ok(blocked.includes('BLOCKED BY DSH-KNOWLEDGE-BRIDGE SAFETY POLICY'));

    // Safe command should return undefined (allowed)
    const allowed = registeredGuard({
      name: 'bash',
      arguments: { command: 'git status' },
    });
    assert.equal(allowed, undefined);

    // A non-shell tool must pass through untouched.
    assert.equal(registeredGuard({ name: 'read', arguments: { file_path: 'x' } }), undefined);

    // Regression lock: the legacy { tool, args } shape must NOT match, because
    // that is exactly the mock drift that hid this bug before.
    const legacyShape = registeredGuard({
      tool: 'bash',
      args: { command: 'git reset --hard HEAD~1' },
    });
    assert.equal(legacyShape, undefined, 'guard must read exec.name/exec.arguments, not exec.tool/exec.args');
  });

  await t.test('injects rules and lean on-demand directive into system prompt sections', () => {
    assert.ok(registeredSections.length >= 2);
    const rulesSec = registeredSections.find((s) => s.name === 'knowledge-bridge:rules');
    assert.ok(rulesSec);
    assert.ok(rulesSec.text.includes('No unilateral edits.'));

    const directiveSec = registeredSections.find((s) => s.name === 'knowledge-bridge:directive');
    assert.ok(directiveSec);
    assert.ok(directiveSec.text.includes('knowledge_search'));
    assert.ok(directiveSec.text.includes('Search it'), 'directive must nudge a search before answering');
    assert.ok(directiveSec.text.length < 300, 'directive must stay a one-liner, not grow into an index dump');
  });

  await t.test('tool payloads stay clipped so a list call cannot flood the context', async () => {
    const listTool = registeredTools.find((tool) => tool.name === 'knowledge_list');
    const listed = await listTool.execute({});
    assert.equal(listed.totalItems, 1);
    assert.ok(listed.items[0].summary.length <= 120, 'knowledge_list must clip summaries');

    const searchTool = registeredTools.find((tool) => tool.name === 'knowledge_search');
    const found = await searchTool.execute({ query: 'autolab orchestrator' });
    assert.ok(found.results.length >= 1);
    for (const hit of found.results) {
      assert.ok(hit.summary.length <= 400, 'knowledge_search must clip summaries');
      assert.equal(typeof hit.score, 'number', 'results must carry a score');
      // Hard rule: search never returns document bodies, whatever the match was.
      assert.ok(!('content' in hit), 'knowledge_search must never return file content');
      assert.ok(!('body' in hit), 'knowledge_search must never return document bodies');
      assert.ok(JSON.stringify(hit).length < 1200, 'one hit must stay small');
    }
  });

  await t.test('guard covers every shell tool and the cmd/script argument fallbacks', () => {
    assert.ok(typeof registeredGuard({ name: 'cmd', arguments: { script: 'rm -rf /' } }) === 'string');
    assert.ok(typeof registeredGuard({ name: 'terminal', arguments: { cmd: 'git clean -fd' } }) === 'string');
    assert.equal(registeredGuard({ name: 'pwsh', arguments: { command: 'echo hello' } }), undefined);
    assert.equal(registeredGuard({ name: 'pwsh', arguments: {} }), undefined, 'missing command must not throw');
  });

  await t.test('knowledge_read reports an unknown item instead of throwing', async () => {
    const readTool = registeredTools.find((tool) => tool.name === 'knowledge_read');
    const missing = await readTool.execute({ item_id: 'does_not_exist' });
    assert.equal(missing.success, false);
    assert.ok(typeof missing.error === 'string' && missing.error.length > 0);
    assert.ok(Array.isArray(missing.availableArtifacts));
  });

  await t.test('knowledge_info answers offline with the live update command', async () => {
    const infoTool = registeredTools.find((tool) => tool.name === 'knowledge_info');
    const info = await infoTool.execute({ check_registry: false });
    assert.equal(info.plugin, 'dsh-knowledge-bridge');
    assert.ok(/^\d+\.\d+\.\d+/.test(info.installedVersion), 'installedVersion must come from the manifest');
    assert.ok(info.updateCommand.startsWith('dsh plugin --profile '));
    assert.ok(info.updateCommand.endsWith('update dsh-knowledge-bridge'));
    assert.equal(info.registryCheck, 'skipped');
    assert.equal(info.latestVersion, null);
    assert.equal(info.updateAvailable, null);
    assert.ok(info.afterUpdate.includes('Restart'), 'the agent must be told a restart is required');
    assert.ok(Array.isArray(info.vaultPaths) && info.vaultPaths.length === 1);
  });

  await t.test('knowledge_info reports a newer published version', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ version: '99.0.0' }) };
    };
    try {
      const infoTool = registeredTools.find((tool) => tool.name === 'knowledge_info');
      const info = await infoTool.execute({});
      assert.equal(info.registryCheck, 'ok');
      assert.equal(info.latestVersion, '99.0.0');
      assert.equal(info.updateAvailable, true);
      assert.ok(calls[0].includes('/dsh-knowledge-bridge/latest'), 'must query the package latest endpoint');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('knowledge_info stays silent when the registry cannot be read', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    try {
      const infoTool = registeredTools.find((tool) => tool.name === 'knowledge_info');
      const info = await infoTool.execute({});
      assert.ok(info.registryCheck.startsWith('error:'));
      assert.equal(
        info.updateAvailable,
        null,
        'an unreadable registry must not be reported as "up to date"',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('self-help section teaches the agent the update command', () => {
    const helpSection = registeredSections.find((section) => section.name === 'knowledge-bridge:self-help');
    assert.ok(helpSection, 'updateHint defaults to true, so the section must be registered');
    assert.ok(helpSection.text.includes('dsh plugin --profile'));
    assert.ok(helpSection.text.includes('restart DeepSeek Harness'));
    assert.ok(helpSection.text.includes('knowledge_info'));
    assert.ok(helpSection.text.length < 320, 'self-help must stay a couple of lines');
  });

  await t.test('update command is literal with a profile and shell-resolved without one', () => {
    // Known profile: the command is literal, so the agent never has to guess.
    assert.equal(
      updateCommandFor('desktop', 'win32'),
      'dsh plugin --profile desktop update dsh-knowledge-bridge',
    );
    assert.equal(
      updateCommandFor('desktop', 'darwin'),
      'dsh plugin --profile desktop update dsh-knowledge-bridge',
    );

    // Unknown profile: phrased for the DSH shell, whose variable syntax follows
    // the platform the host runs on. The host process itself never sees
    // DSH_PROFILE, so a literal name is simply not available there.
    assert.equal(
      updateCommandFor(null, 'win32'),
      'dsh plugin --profile $env:DSH_PROFILE update dsh-knowledge-bridge',
    );
    assert.equal(
      updateCommandFor(null, 'linux'),
      'dsh plugin --profile "$DSH_PROFILE" update dsh-knowledge-bridge',
    );
    assert.ok(!updateCommandFor(null, 'win32').includes('<profile>'), 'never emit a placeholder');
    assert.ok(PROFILE_UNKNOWN_HINT.includes('DSH shell'));
  });

  await t.test('activeProfile reads DSH_PROFILE and rejects blanks', () => {
    assert.equal(activeProfile({ DSH_PROFILE: 'desktop' }), 'desktop');
    assert.equal(activeProfile({ DSH_PROFILE: '  tui  ' }), 'tui');
    assert.equal(activeProfile({ DSH_PROFILE: '   ' }), null);
    assert.equal(activeProfile({}), null);
    // An explicit null means "no environment at all" — while `undefined` is the
    // default-parameter path that deliberately reads the real process env.
    assert.equal(activeProfile(null), null);
    assert.equal(activeProfile({ DSH_PROFILE: 42 }), null, 'a non-string value is ignored');
  });

  await t.test('knowledge_info falls back to the shell form when the profile is unknown', async () => {
    const originalProfile = process.env.DSH_PROFILE;
    const sections = [];
    const tools = [];
    delete process.env.DSH_PROFILE;
    try {
      apply(
        {
          logger: { info: () => {}, warn: () => {} },
          tools: { register: (tool) => tools.push(tool), guard: () => {} },
          systemPrompt: { section: (section) => sections.push(section) },
        },
        { knowledgePaths: [kbDir], rulesPaths: [rulesPath] },
      );
      const infoTool = tools.find((tool) => tool.name === 'knowledge_info');
      const info = await infoTool.execute({ check_registry: false });

      assert.equal(info.profile, null);
      assert.ok(info.updateCommand.includes('DSH_PROFILE'), 'must fall back to the shell variable');
      assert.equal(info.updateCommandHint, PROFILE_UNKNOWN_HINT);

      const helpSection = sections.find((section) => section.name === 'knowledge-bridge:self-help');
      assert.ok(helpSection.text.includes('DSH_PROFILE resolves inside the DSH shell'));
      assert.ok(helpSection.text.length < 320, 'the fallback must not bloat the prompt line');
    } finally {
      if (originalProfile !== undefined) process.env.DSH_PROFILE = originalProfile;
    }
  });

  await t.test('autoInjectRules: false leaves the system prompt untouched', () => {
    const sections = [];
    apply(
      {
        logger: { info: () => {}, warn: () => {} },
        tools: { register: () => {}, guard: () => {} },
        systemPrompt: { section: (section) => sections.push(section) },
      },
      { knowledgePaths: [kbDir], rulesPaths: [rulesPath], autoInjectRules: false },
    );
    assert.equal(sections.length, 0);
  });

  await t.test('enableSafetyGuard: false registers no guard', () => {
    let seen = null;
    apply(
      {
        logger: { info: () => {}, warn: () => {} },
        tools: { register: () => {}, guard: (fn) => { seen = fn; } },
        systemPrompt: { section: () => {} },
      },
      { knowledgePaths: [kbDir], enableSafetyGuard: false },
    );
    assert.equal(seen, null);
  });
});
