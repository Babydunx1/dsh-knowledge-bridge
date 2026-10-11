import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/** Environment variable that lists extra vault roots, separated by `;` or `,`. */
export const KNOWLEDGE_PATHS_ENV = 'DSH_KNOWLEDGE_PATHS';

/**
 * Vault roots probed when neither the plugin config nor the environment
 * variable names one. `~` keeps the list machine-independent, so the same
 * checkout works on any Windows/macOS/Linux machine without editing files.
 */
export const DISCOVERY_CANDIDATES = [
  '~/.gemini/antigravity-ide/knowledge',
  '~/.antigravity-ide/knowledge',
  '~/.dsh/knowledge',
  '~/.codex/knowledge',
  './knowledge',
  './docs/knowledge',
  './.knowledge',
];

/**
 * Expand a leading `~` to the current user's home directory.
 *
 * @param {string} p
 * @returns {string}
 */
export function expandHome(p) {
  if (typeof p !== 'string' || p.length === 0) return '';
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Split an environment-variable style path list into individual entries.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function parsePathList(value) {
  if (typeof value !== 'string' || value.length === 0) return [];
  return value
    .split(/[;,]/)
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
    .filter((entry) => entry.length > 0);
}

/** Case-insensitive key so the same folder is never indexed twice on Windows. */
function pathKey(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * Normalizes a list of candidate directory paths.
 *
 * Precedence: explicit config -> `DSH_KNOWLEDGE_PATHS` -> {@link DISCOVERY_CANDIDATES}.
 * With no config and no env var, the known vault locations (including the
 * Antigravity `~/.gemini/antigravity-ide/knowledge` root) are probed, so a
 * fresh install indexes an existing vault with zero configuration.
 *
 * @param {string[]} paths - Raw paths from config
 * @param {string} cwd - Base directory for relative paths
 * @param {Record<string, string|undefined>} env
 * @returns {string[]} Existing absolute directory paths
 */
export function resolveKnowledgePaths(paths = [], cwd = process.cwd(), env = process.env) {
  const configured = (Array.isArray(paths) ? paths : [paths])
    .filter((p) => typeof p === 'string' && p.trim().length > 0)
    .map((p) => expandHome(p.trim()));
  const fromEnv = parsePathList(env?.[KNOWLEDGE_PATHS_ENV]);
  const candidates = configured.length > 0
    ? [...configured, ...fromEnv]
    : [...fromEnv, ...DISCOVERY_CANDIDATES];

  const result = [];
  const seen = new Set();
  for (const raw of candidates) {
    const candidate = expandHome(raw);
    const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(cwd, candidate);
    const key = pathKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!existsSync(resolved)) continue;
    try {
      if (statSync(resolved).isDirectory()) result.push(resolved);
    } catch {
      // Skip on permission or stat errors
    }
  }
  return result;
}

/**
 * Normalize a metadata field into a list of non-empty strings.
 * Accepts an array or a delimited string, so a hand-written `metadata.json` may
 * use `"tags": "leave, pos"` without breaking the index.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function toStringList(value) {
  if (value === null || value === undefined) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/[,;]/);
  return raw
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry.length > 0);
}

/** Lowercased file bodies keyed by `path:mtimeMs`, so repeated searches stay cheap. */
const bodyCache = new Map();
const BODY_CACHE_LIMIT = 512;

/**
 * Lowercased text of one document, cached until its mtime changes.
 *
 * @param {string} filePath
 * @returns {string} body text, or `''` when unreadable
 */
function readBodyText(filePath) {
  try {
    const key = `${filePath}:${statSync(filePath).mtimeMs}`;
    const cached = bodyCache.get(key);
    if (cached !== undefined) return cached;
    const text = readFileSync(filePath, 'utf8').toLowerCase();
    if (bodyCache.size >= BODY_CACHE_LIMIT) bodyCache.clear();
    bodyCache.set(key, text);
    return text;
  } catch {
    return '';
  }
}

/**
 * Lowercased body text of every artifact an item owns.
 *
 * Body matches score the least, but they are the only way to find a symbol, a
 * migration number or a component name (`LeaveRequestPage`) that lives inside a
 * document rather than in its metadata.
 *
 * @param {{path: string, artifactsDir?: string, artifacts?: string[]}} item
 * @returns {string}
 */
function itemBodyText(item) {
  const dir = item.artifactsDir ?? item.path;
  const files = Array.isArray(item.artifacts) ? item.artifacts : [];
  let text = '';
  for (const name of files) text += `${readBodyText(join(dir, name))}\n`;
  return text;
}

/**
 * Scans configured paths and builds a compact index of all knowledge items.
 * Supports both structured Antigravity-style folders (with metadata.json)
 * and generic markdown documentation directories.
 *
 * @param {string[]} rootDirs - Absolute paths of knowledge directories
 * @returns {Array<{ id: string, title: string, summary: string, path: string, artifacts: string[], sourceDir: string }>}
 */
export function buildKnowledgeIndex(rootDirs = []) {
  const index = [];
  const seenIds = new Set();

  for (const rootDir of rootDirs) {
    if (!existsSync(rootDir)) continue;

    let entries = [];
    try {
      entries = readdirSync(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(rootDir, entry.name);

      if (entry.isDirectory()) {
        const metaPath = join(fullPath, 'metadata.json');
        const artifactsDir = join(fullPath, 'artifacts');

        let title = entry.name;
        let summary = '';
        let artifacts = [];
        let tags = [];
        let references = [];
        let aliases = [];

        if (existsSync(metaPath)) {
          try {
            const raw = JSON.parse(readFileSync(metaPath, 'utf8'));
            title = raw.title || title;
            summary = raw.summary || '';
            // Keywords the author declared on purpose. They are what makes a
            // query like "LeaveRequestPage" or "migration 024" find the item.
            tags = toStringList(raw.tags);
            references = toStringList(raw.references);
            aliases = toStringList(raw.aliases);
          } catch {
            // Keep defaults if json is invalid
          }
        }

        let resolvedArtifactsDir = fullPath;
        if (existsSync(artifactsDir)) {
          resolvedArtifactsDir = artifactsDir;
          try {
            artifacts = readdirSync(artifactsDir).filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
          } catch {
            artifacts = [];
          }
        } else {
          // Look for direct markdown files in the folder
          try {
            artifacts = readdirSync(fullPath).filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
          } catch {
            artifacts = [];
          }
        }

        // If no summary was in metadata.json, try reading first lines of README or master_guide
        if (!summary && artifacts.length > 0) {
          const primer = artifacts.find((a) => a === 'master_guide.md' || a === 'README.md') || artifacts[0];
          try {
            const primerPath = existsSync(join(artifactsDir, primer))
              ? join(artifactsDir, primer)
              : join(fullPath, primer);
            const content = readFileSync(primerPath, 'utf8');
            const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
            summary = lines.slice(0, 3).join(' ').slice(0, 300);
          } catch {
            summary = `Folder containing ${artifacts.length} documentation files.`;
          }
        }

        const id = entry.name;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          index.push({
            id,
            title,
            summary,
            tags,
            references,
            aliases,
            path: fullPath,
            artifactsDir: resolvedArtifactsDir,
            artifacts,
            sourceDir: rootDir,
          });
        }
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
        // Top-level standalone doc
        const id = entry.name.replace(/\.[^.]+$/, '');
        if (!seenIds.has(id)) {
          let summary = '';
          try {
            const content = readFileSync(fullPath, 'utf8');
            const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
            summary = lines.slice(0, 3).join(' ').slice(0, 300);
          } catch {
            summary = 'Standalone documentation file.';
          }

          seenIds.add(id);
          index.push({
            id,
            title: entry.name,
            summary,
            tags: [],
            references: [],
            aliases: [],
            path: fullPath,
            artifactsDir: dirname(fullPath),
            artifacts: [entry.name],
            sourceDir: rootDir,
          });
        }
      }
    }
  }

  return index;
}

/**
 * Searches the knowledge index using keyword matching.
 *
 * Weights, highest first: title 10 · id 8 · aliases 8 · tags 6 · references 4 ·
 * summary 3 · artifact file name 2 · document body 1. Metadata keywords are what
 * the vault author declared on purpose, so they outrank a lucky word in a
 * summary; the body is searched last and lazily, and only for items that have
 * not matched on metadata yet.
 *
 * @param {Array<Object>} index - The knowledge index from buildKnowledgeIndex
 * @param {string} query - Keyword search term
 * @param {number} [maxResults=10] - Limit of items to return
 * @returns {Array<Object>} Matching knowledge items with match scores
 */
export function searchKnowledge(index = [], query = '', maxResults = 10) {
  if (!query || typeof query !== 'string') return index.slice(0, maxResults);

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return index.slice(0, maxResults);

  const scored = [];

  for (const item of index) {
    let score = 0;
    const titleLower = (item.title || '').toLowerCase();
    const idLower = (item.id || '').toLowerCase();
    const summaryLower = (item.summary || '').toLowerCase();
    const aliases = toStringList(item.aliases).map((value) => value.toLowerCase());
    const tags = toStringList(item.tags).map((value) => value.toLowerCase());
    const references = toStringList(item.references).map((value) => value.toLowerCase());
    const artifacts = Array.isArray(item.artifacts) ? item.artifacts : [];
    let bodyLower = '';

    for (const token of tokens) {
      if (titleLower.includes(token)) score += 10;
      if (idLower.includes(token)) score += 8;
      if (aliases.some((value) => value.includes(token))) score += 8;
      if (tags.some((value) => value.includes(token))) score += 6;
      if (references.some((value) => value.includes(token))) score += 4;
      if (summaryLower.includes(token)) score += 3;
      if (artifacts.some((name) => name.toLowerCase().includes(token))) score += 2;

      // Body text is the last resort and is read lazily: an item that already
      // matched on metadata never pays for a document read.
      if (score === 0) {
        if (bodyLower === '') bodyLower = itemBodyText(item);
        if (bodyLower.includes(token)) score += 1;
      }
    }

    if (score > 0) {
      scored.push({ ...item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

/**
 * Reads a knowledge document or artifact from host filesystem.
 * Handles both directory-based items (with artifacts/) and single file items.
 *
 * @param {Array<Object>} index - The knowledge index
 * @param {string} itemId - The id or title of the knowledge item
 * @param {string} [artifactName] - Optional sub-artifact name (e.g. '01_intro.md')
 * @returns {{ id: string, title: string, file: string, content: string } | { error: string }}
 */
export function readKnowledgeItem(index = [], itemId = '', artifactName = '') {
  if (!itemId) return { error: 'itemId is required' };

  const target = index.find(
    (item) =>
      item.id.toLowerCase() === itemId.toLowerCase() ||
      item.title.toLowerCase() === itemId.toLowerCase() ||
      item.id.toLowerCase().includes(itemId.toLowerCase()),
  );

  if (!target) {
    return { error: `Knowledge item not found matching '${itemId}'. Use knowledge_search to locate available items.` };
  }

  const stat = statSync(target.path);

  // If the target is a standalone file
  if (!stat.isDirectory()) {
    try {
      const content = readFileSync(target.path, 'utf8');
      return {
        id: target.id,
        title: target.title,
        file: basename(target.path),
        content,
      };
    } catch (err) {
      return { error: `Failed to read file ${target.path}: ${err.message}` };
    }
  }

  // If the target is a directory
  let filePath = '';
  const artifactsDir = join(target.path, 'artifacts');

  if (artifactName) {
    const candidate1 = join(artifactsDir, artifactName);
    const candidate2 = join(target.path, artifactName);
    if (existsSync(candidate1)) filePath = candidate1;
    else if (existsSync(candidate2)) filePath = candidate2;
  } else {
    // Default priority order: master_guide.md > README.md > first artifact
    const candidates = ['master_guide.md', 'README.md', ...(target.artifacts || [])];
    for (const c of candidates) {
      const path1 = join(artifactsDir, c);
      const path2 = join(target.path, c);
      if (existsSync(path1)) {
        filePath = path1;
        break;
      }
      if (existsSync(path2)) {
        filePath = path2;
        break;
      }
    }
  }

  if (!filePath || !existsSync(filePath)) {
    return {
      id: target.id,
      title: target.title,
      summary: target.summary,
      artifacts: target.artifacts,
      error: artifactName
        ? `Artifact '${artifactName}' not found in ${target.id}. Available: ${target.artifacts.join(', ')}`
        : `No documentation file found in ${target.id}. Available: ${target.artifacts.join(', ')}`,
    };
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    return {
      id: target.id,
      title: target.title,
      file: basename(filePath),
      availableArtifacts: target.artifacts,
      content,
    };
  } catch (err) {
    return { error: `Failed to read ${filePath}: ${err.message}` };
  }
}

/**
 * Finds and loads the first existing workspace rules file (e.g. AGENTS.md, CLAUDE.md).
 *
 * @param {string[]} candidateFiles - List of filenames or relative paths
 * @param {string} cwd - Base directory
 * @returns {{ path: string, content: string } | null}
 */
export function loadRulesFile(candidateFiles = ['AGENTS.md', 'GEMINI.md', 'CLAUDE.md'], cwd = process.cwd()) {
  for (const filename of candidateFiles) {
    const fullPath = isAbsolute(filename) ? filename : join(cwd, filename);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf8');
        return { path: fullPath, content };
      } catch {
        // Continue to next candidate
      }
    }
  }
  return null;
}

/**
 * Parse a semver-ish version into numeric segments.
 *
 * Tolerant by design: a leading `v`, a pre-release/build suffix (`-beta.1`,
 * `+sha`) and a variable number of segments are accepted. Anything that does
 * not yield at least one number returns `[]`, which callers read as "unknown"
 * rather than "oldest" — an unparseable registry answer must never be turned
 * into a false "update available".
 *
 * @param {unknown} value
 * @returns {number[]}
 */
export function parseVersion(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  const core = value.trim().replace(/^v/i, '').split(/[-+]/)[0];
  const segments = [];
  for (const segment of core.split('.')) {
    if (!/^\d+$/.test(segment)) return [];
    segments.push(Number(segment));
  }
  return segments.length > 0 ? segments : [];
}

/**
 * Compare two version strings segment by segment.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {-1 | 0 | 1} `0` when either side is unparseable.
 */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a.length === 0 || b.length === 0) return 0;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Whether `candidate` is strictly newer than `current`.
 *
 * Unknown input returns `false`, so a failed or malformed registry lookup stays
 * silent instead of nagging the user about a version that does not exist.
 *
 * @param {unknown} candidate - version reported by the registry
 * @param {unknown} current - version this copy runs
 * @returns {boolean}
 */
export function isNewerVersion(candidate, current) {
  if (parseVersion(candidate).length === 0) return false;
  if (parseVersion(current).length === 0) return false;
  return compareVersions(candidate, current) > 0;
}
