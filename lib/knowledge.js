import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, basename } from 'node:path';

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

        if (existsSync(metaPath)) {
          try {
            const raw = JSON.parse(readFileSync(metaPath, 'utf8'));
            title = raw.title || title;
            summary = raw.summary || '';
          } catch {
            // Keep defaults if json is invalid
          }
        }

        if (existsSync(artifactsDir)) {
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
            path: fullPath,
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
            path: fullPath,
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
 * Searches the knowledge index using keyword matching against id, title, and summary.
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

    for (const token of tokens) {
      if (titleLower.includes(token)) score += 10;
      if (idLower.includes(token)) score += 8;
      if (summaryLower.includes(token)) score += 3;
      if (item.artifacts.some((a) => a.toLowerCase().includes(token))) score += 2;
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
