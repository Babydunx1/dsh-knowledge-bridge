import {
  resolveKnowledgePaths,
  buildKnowledgeIndex,
  searchKnowledge,
  readKnowledgeItem,
  loadRulesFile,
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
 */
export const DEFAULT_CONFIG = {
  knowledgePaths: [],
  rulesPaths: ['AGENTS.md', 'GEMINI.md', 'CLAUDE.md'],
  autoInjectRules: true,
  enableSafetyGuard: true,
  bannedPatterns: DEFAULT_BANNED_PATTERNS,
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
              description: 'Keywords to search across titles, summaries, and tags (e.g. "reconciliation", "auth", "adspower")',
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
            results: results.map((r) => ({
              id: r.id,
              title: r.title,
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
              `Use \`knowledge_search\` / \`knowledge_read\` only for repository-specific questions.\n`,
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
