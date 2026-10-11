import { readFileSync } from 'node:fs';

import {
  resolveKnowledgePaths,
  buildKnowledgeIndex,
  searchKnowledge,
  readKnowledgeItem,
  loadRulesFile,
  isNewerVersion,
} from './lib/knowledge.js';

/**
 * Default destructive command patterns to guard against.
 */
const DEFAULT_BANNED_PATTERNS = [
  'git\\s+reset\\s+--hard',
  'git\\s+clean\\s+-fd',
  'git\\s+restore\\s+\\.',
  'rm\\s+-rf\\s+/(?!tmp)',
];

/** Package name used for the registry lookup and the update command. */
export const PACKAGE_NAME = 'dsh-knowledge-bridge';

/**
 * Version this copy runs, read from its own manifest.
 *
 * Resolution is relative to this module, so it works for a git/tarball install,
 * an npm install and a `link:` development checkout alike. A failure yields
 * `'0.0.0'`, which makes any registry answer look newer; `isNewerVersion()`
 * still refuses unparseable input, so the worst case is a spurious hint rather
 * than a crash.
 */
export const OWN_VERSION = (() => {
  try {
    const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** The active DSH profile, as exported by a profile-launched Harness. */
export function activeProfile(env = process.env) {
  const name = env?.DSH_PROFILE;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

/**
 * The exact command that updates this plugin in the active profile.
 *
 * DSH has no plugin auto-update yet, and users are not expected to know this
 * command — the agent reads it from the self-help prompt section or from
 * `knowledge_info` and runs it on the user's behalf.
 */
export function updateCommandFor(profile) {
  return `dsh plugin --profile ${profile || '<profile>'} update ${PACKAGE_NAME}`;
}

/**
 * Look up the latest version published on an npm-compatible registry.
 *
 * This runs only when `knowledge_info` is called with the registry check on —
 * never at load — so plugin startup stays offline. Every failure is returned as
 * data in `registryCheck`, never thrown, because a version hint must never
 * break a session.
 *
 * @param {string} packageName
 * @param {string} registryUrl - registry base, e.g. `https://registry.npmjs.org`
 * @param {number} timeoutMs
 * @returns {Promise<{ latestVersion: string | null, registryCheck: string }>}
 */
export async function fetchLatestVersion(packageName, registryUrl, timeoutMs) {
  const base = String(registryUrl || DEFAULT_CONFIG.registryUrl).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/${encodeURIComponent(packageName)}/latest`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { latestVersion: null, registryCheck: `http ${response.status}` };
    }
    const body = await response.json();
    return {
      latestVersion: typeof body?.version === 'string' ? body.version : null,
      registryCheck: 'ok',
    };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return {
      latestVersion: null,
      registryCheck: aborted ? 'timeout' : `error: ${error?.message ?? error}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cordis plugin inject declaration — the complete list of services this plugin
 * reads off `ctx`. Cordis proxies every context: reading a service that is not
 * listed here throws `cannot get property "<name>" without inject`, and neither
 * optional chaining nor an outer try/catch can prevent that read from throwing.
 */
export const inject = ['tools', 'systemPrompt'];

/**
 * Default configuration values.
 *
 * `knowledgePaths` is intentionally empty: with no configured root the plugin
 * probes `DSH_KNOWLEDGE_PATHS`, then the well-known vault locations (including
 * `~/.gemini/antigravity-ide/knowledge`), then `./knowledge` / `./docs/knowledge`.
 * A fresh checkout therefore indexes an existing vault with zero configuration.
 *
 * `updateHint` adds one self-help line to the prompt so the agent knows the exact
 * update command for this machine (DSH has no plugin auto-update yet).
 * `registryUrl` / `registryTimeoutMs` only affect an explicit `knowledge_info`
 * registry lookup; nothing contacts the network at load.
 */
export const DEFAULT_CONFIG = {
  knowledgePaths: [],
  rulesPaths: ['AGENTS.md', 'GEMINI.md', 'CLAUDE.md'],
  autoInjectRules: true,
  enableSafetyGuard: true,
  bannedPatterns: DEFAULT_BANNED_PATTERNS,
  updateHint: true,
  registryUrl: 'https://registry.npmjs.org',
  registryTimeoutMs: 2500,
};


/**
 * Helper to define tools compatible with DSH Tool registry.
 * Uses official defineTool if @deepseek-ai/dsh-tools is available at runtime,
 * otherwise constructs a standard compliant tool definition.
 *
 * @param {Object} options
 * @returns {Object}
 */
function createTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters || {},
    output: options.output || {
      schema: { type: 'object' },
      render: (_args, value) => [
        {
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        },
      ],
    },
    execute: options.execute,
  };
}

/**
 * Tool results are replayed in every later model call, so shipping a full
 * metadata summary (up to ~2,500 chars x 50 items) is a permanent token tax.
 * Knowledge discovery needs an index, not the vault: clip and let the model
 * pull the full text through `knowledge_read`.
 *
 * @param {unknown} text
 * @param {number} max
 * @returns {string}
 */
function clip(text, max = 200) {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Shell tool names whose command line the safety guard inspects. */
const SAFETY_GUARDED_TOOLS = new Set(['bash', 'pwsh', 'cmd', 'terminal']);

/**
 * Host entry point for dsh-knowledge-bridge.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis Host context
 * @param {Object} [config] - User configuration passed from cordis.patch.yml
 */
export function apply(ctx, config = {}) {
  const mergedConfig = {
    knowledgePaths: Array.isArray(config.knowledgePaths)
      ? config.knowledgePaths
      : config.knowledgePaths
        ? [config.knowledgePaths]
        : DEFAULT_CONFIG.knowledgePaths,
    rulesPaths: Array.isArray(config.rulesPaths)
      ? config.rulesPaths
      : config.rulesPaths
        ? [config.rulesPaths]
        : DEFAULT_CONFIG.rulesPaths,
    autoInjectRules: config.autoInjectRules ?? DEFAULT_CONFIG.autoInjectRules,
    enableSafetyGuard: config.enableSafetyGuard ?? DEFAULT_CONFIG.enableSafetyGuard,
    bannedPatterns: config.bannedPatterns || DEFAULT_CONFIG.bannedPatterns,
    updateHint: config.updateHint ?? DEFAULT_CONFIG.updateHint,
    registryUrl: config.registryUrl || DEFAULT_CONFIG.registryUrl,
    registryTimeoutMs: Number.isFinite(config.registryTimeoutMs)
      ? config.registryTimeoutMs
      : DEFAULT_CONFIG.registryTimeoutMs,
  };

  const cwd = process.cwd();

  // 1. Resolve knowledge paths & build initial index
  const resolvedPaths = resolveKnowledgePaths(mergedConfig.knowledgePaths, cwd);
  let knowledgeIndex = buildKnowledgeIndex(resolvedPaths);

  try {
    ctx.logger?.info?.(
      `[knowledge-bridge] Initialized with ${resolvedPaths.length} path(s), indexed ${knowledgeIndex.length} item(s)`,
    );
  } catch {}

  // Refresh index helper
  const refreshIndex = () => {
    const paths = resolveKnowledgePaths(mergedConfig.knowledgePaths, cwd);
    knowledgeIndex = buildKnowledgeIndex(paths);
    return knowledgeIndex;
  };

  // 2. Register Model-Facing Tools
  if (ctx.tools?.register) {
    // Tool: knowledge_search
    ctx.tools.register(
      createTool({
        name: 'knowledge_search',
        description:
          'Search the knowledge base for relevant architectural decisions, domain guides, and documentation using keyword search. Returns titles plus clipped summaries — call knowledge_read for full text.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Keywords searched across titles, ids, tags, aliases, references, summaries, artifact names and document bodies (e.g. "reconciliation", "LeaveRequestPage", "migration 024")',
            },
            max_results: {
              type: 'integer',
              description: 'Maximum number of items to return (default: 8)',
            },
          },
          required: ['query'],
        },
        execute: async (args) => {
          refreshIndex();
          const results = searchKnowledge(knowledgeIndex, args.query, args.max_results || 8);
          return {
            query: args.query,
            totalFound: results.length,
            // Lean by contract: ids, titles, scores and clipped summaries only.
            // Dumping document bodies here would be a permanent token tax.
            results: results.map((r) => ({
              id: r.id,
              title: r.title,
              score: r.score,
              summary: clip(r.summary, 400),
              artifacts: r.artifacts,
            })),
          };
        },
      }),
    );

    // Tool: knowledge_read
    ctx.tools.register(
      createTool({
        name: 'knowledge_read',
        description:
          'Read the full content of a specific knowledge item or artifact directly from the host filesystem, completely bypassing sandbox access restrictions.',
        parameters: {
          type: 'object',
          properties: {
            item_id: {
              type: 'string',
              description: 'Knowledge item ID or folder name (e.g. "posttracker_engine")',
            },
            artifact: {
              type: 'string',
              description:
                'Optional specific markdown filename (e.g. "master_guide.md", "01_watchdog.md"). If omitted, defaults to master_guide or main document.',
            },
          },
          required: ['item_id'],
        },
        execute: async (args) => {
          refreshIndex();
          const res = readKnowledgeItem(knowledgeIndex, args.item_id, args.artifact);
          if (res.error) {
            return { success: false, error: res.error, availableArtifacts: res.artifacts || [] };
          }
          return {
            success: true,
            id: res.id,
            title: res.title,
            file: res.file,
            content: res.content,
          };
        },
      }),
    );

    // Tool: knowledge_list
    ctx.tools.register(
      createTool({
        name: 'knowledge_list',
        description:
          'List knowledge item IDs, titles, artifact counts and a one-line preview. Use it to see what exists, knowledge_search to find something specific, and knowledge_read for full text.',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: async () => {
          refreshIndex();
          return {
            totalItems: knowledgeIndex.length,
            items: knowledgeIndex.map((i) => ({
              id: i.id,
              title: i.title,
              summary: clip(i.summary, 120),
              artifactsCount: i.artifacts.length,
            })),
          };
        },
      }),
    );
    // Tool: knowledge_info — self-help for updating this plugin.
    // DSH has no plugin auto-update yet and users are not expected to know the
    // CLI, so the agent needs the exact command for THIS profile. It is derived
    // from the live environment (DSH_PROFILE), never hardcoded to a machine.
    ctx.tools.register(
      createTool({
        name: 'knowledge_info',
        description:
          'Report the installed knowledge-bridge version, the exact command that updates it in this profile, and whether a newer version is published. Call it before telling a user how to update or enable it, and after an update to confirm which version is loaded.',
        parameters: {
          type: 'object',
          properties: {
            check_registry: {
              type: 'boolean',
              description:
                'Look up the latest published version on the npm registry (default: true). Pass false to answer entirely offline.',
            },
          },
        },
        execute: async (args = {}) => {
          const profile = activeProfile();
          const info = {
            plugin: PACKAGE_NAME,
            installedVersion: OWN_VERSION,
            profile,
            updateCommand: updateCommandFor(profile),
            afterUpdate:
              'Restart DeepSeek Harness to load the new module generation; toggling the plugin off/on does not re-import it.',
            knowledgeItems: knowledgeIndex.length,
            vaultPaths: resolveKnowledgePaths(mergedConfig.knowledgePaths, cwd),
            registryUrl: mergedConfig.registryUrl,
            registryCheck: 'skipped',
            latestVersion: null,
            updateAvailable: null,
          };
          if (args?.check_registry === false) return info;

          const looked = await fetchLatestVersion(
            PACKAGE_NAME,
            mergedConfig.registryUrl,
            mergedConfig.registryTimeoutMs,
          );
          info.registryCheck = looked.registryCheck;
          info.latestVersion = looked.latestVersion;
          // `null` (not false) when the registry could not be read: unknown is
          // not the same answer as up to date.
          info.updateAvailable = looked.latestVersion
            ? isNewerVersion(looked.latestVersion, OWN_VERSION)
            : null;
          return info;
        },
      }),
    );
  }

  // 3. Safety Guard Registration
  if (mergedConfig.enableSafetyGuard && typeof ctx.tools?.guard === 'function') {
    ctx.tools.guard((exec) => {
      // Contract of the object DSH hands to a guard (see dsh-tools
      // `createExecution`): { token, callId, rootCallId, name, signal, agent?,
      // parent?, schema?, arguments }. There is no `tool` and no `args` field —
      // reading `exec.args` silently yields undefined and the guard never fires.
      if (!SAFETY_GUARDED_TOOLS.has(exec.name)) return;
      const args = exec.arguments ?? {};
      const cmd = String(args.command ?? args.cmd ?? args.script ?? '');
      for (const pattern of mergedConfig.bannedPatterns) {
        if (new RegExp(pattern, 'i').test(cmd)) {
          return (
            `[BLOCKED BY DSH-KNOWLEDGE-BRIDGE SAFETY POLICY]: Destructive command '${cmd.slice(0, 80)}' ` +
            `matched safety rule (${pattern}). Unilateral destructive actions are strictly forbidden without explicit user confirmation.`
          );
        }
      }
    });
    ctx.logger?.info?.('[knowledge-bridge] Safety guard active for destructive terminal commands');
  }

  // 4. Automatic Rules & Knowledge Injection into System Prompt
  // The read of `ctx.systemPrompt` must happen INSIDE the try: the cordis service
  // gate throws on the property access itself, so `ctx.systemPrompt?.section`
  // in an if-condition (or any read outside a try) fails the whole entry.
  if (mergedConfig.autoInjectRules) {
    try {
      const sp = ctx.systemPrompt;
      if (sp && typeof sp.section === 'function') {
        const rules = loadRulesFile(mergedConfig.rulesPaths, cwd);
        if (rules) {
          sp.section({
            name: 'knowledge-bridge:rules',
            order: 650,
            text: `\n### Active Project Rules (${rules.path}):\n${rules.content}\n`,
          });
          ctx.logger?.info?.(`[knowledge-bridge] Injected project rules from ${rules.path}`);
        }

        // Ultra-lean on-demand directive: a static prefix line is cheap (and
        // prompt-cacheable), dumping the index would not be.
        if (knowledgeIndex.length > 0) {
          sp.section({
            name: 'knowledge-bridge:directive',
            order: 660,
            text:
              `\n### Knowledge Base:\n` +
              `${knowledgeIndex.length} host knowledge items available. ` +
              `Search it (repo, module or file name) before answering repository-specific questions; ` +
              `use \`knowledge_search\` and \`knowledge_read\` for detail.\n`,
          });
        }

        // Self-help line: DSH ships no plugin auto-update, so the agent — not
        // the user — needs the exact command for this machine. One line, and it
        // travels with the prompt the agent already reads.
        if (mergedConfig.updateHint) {
          sp.section({
            name: 'knowledge-bridge:self-help',
            order: 661,
            text:
              `\n### Knowledge Bridge v${OWN_VERSION} — self-help:\n` +
              `Update with \`${updateCommandFor(activeProfile())}\` then restart DeepSeek Harness; ` +
              `\`knowledge_info\` reports the installed vs published version.\n`,
          });
        }
      }
    } catch (error) {
      // Never swallow silently: a failure here means a missing/renamed inject entry
      // or a throwing prompt section, which is a real bug worth seeing in the log.
      try {
        ctx.logger?.warn?.(
          `[knowledge-bridge] system prompt injection skipped: ${error?.message ?? error}`,
        );
      } catch {}
    }
  }
}
