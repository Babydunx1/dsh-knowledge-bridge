#!/usr/bin/env node
/**
 * Static bundle-contract checks for dsh-knowledge-bridge.
 *
 * These are the rules that decide whether DSH can load this package at all, plus
 * the two mistakes that cost us real debugging time:
 *   1. a cordis service read off `ctx` without being declared in `inject`
 *      (fails the entry with `cannot get property "X" without inject`), and
 *   2. an absolute user path baked into a shipped file (breaks every other machine).
 *
 * No dependencies, no install, no execution of the plugin: it reads files only.
 *
 *   node scripts/validate-bundle.js [bundleRoot]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Package root of this checkout. */
export const DEFAULT_ROOT = resolve(HERE, '..');

/** Files that ship to users and therefore must stay machine-independent. */
const SHIPPED_FILES = [
  'index.js',
  'lib/knowledge.js',
  'cordis.patch.yml',
  'package.json',
  'locale/en.json',
  'locale/th.json',
  'scripts/demo.mjs',
];

/** `ctx.*` reads that are context properties, not injected services. */
const CONTEXT_PROPERTIES = new Set(['logger']);

const readText = (file) => readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(readText(file));

/** Absolute paths that only exist on their author's machine. */
const MACHINE_PATH_PATTERNS = [
  /(^|[^A-Za-z])[A-Za-z]:[\\/]/,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/home\/[A-Za-z0-9._-]+\//,
];

/**
 * Run every contract check against one bundle directory.
 *
 * @param {string} [root] - bundle root; defaults to this checkout
 * @returns {{ root: string, checks: Array<{name: string, ok: boolean, detail: string}>, failed: Array<object> }}
 */
export function validateBundle(root = DEFAULT_ROOT) {
  const checks = [];
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });
  };
  const exists = (rel) => existsSync(join(root, rel));

  // ---- manifest -----------------------------------------------------------
  let pkg = null;
  try {
    pkg = readJson(join(root, 'package.json'));
    check('package.json parses', true);
  } catch (error) {
    check('package.json parses', false, error.message);
  }

  const patchRel = pkg?.dsh?.bundle?.patch;
  if (pkg) {
    check('type is "module"', pkg.type === 'module', `type=${pkg.type}`);
    check('exports["."] points at index.js', pkg.exports?.['.'] === './index.js', `exports["."]=${pkg.exports?.['.']}`);
    check('dsh.bundle.patch is declared', typeof patchRel === 'string', `patch=${patchRel}`);
    check('bundle patch file exists', Boolean(patchRel) && exists(patchRel), String(patchRel));
    check('no runtime dependencies', Object.keys(pkg.dependencies ?? {}).length === 0, Object.keys(pkg.dependencies ?? {}).join(', '));
    check('license is MIT', pkg.license === 'MIT', String(pkg.license));
    check('LICENSE file exists', exists('LICENSE'));
    check('README.md exists', exists('README.md'));
    check('engines.node is declared', typeof pkg.engines?.node === 'string', String(pkg.engines?.node));
    check('scripts.test is declared', typeof pkg.scripts?.test === 'string', String(pkg.scripts?.test));

    const listed = Array.isArray(pkg.files) ? pkg.files : [];
    const missing = listed.filter((rel) => !exists(rel));
    check('every files[] entry exists', missing.length === 0, missing.join(', '));
  }

  // ---- host entry ---------------------------------------------------------
  if (!exists('index.js')) {
    check('index.js exists', false);
  } else {
    const source = readText(join(root, 'index.js'));
    check('index.js declares apply()', /export\s+(?:async\s+)?function\s+apply\s*\(/.test(source));

    const injectMatch = source.match(/export\s+const\s+inject\s*=\s*\[([^\]]*)\]/);
    check('index.js exports an inject[] array', Boolean(injectMatch));
    if (injectMatch) {
      const services = injectMatch[1]
        .split(',')
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      check("inject declares 'tools'", services.includes('tools'), services.join(', '));
      check("inject declares 'systemPrompt'", services.includes('systemPrompt'), services.join(', '));

      const reads = new Set([...source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]));
      const undeclared = [...reads].filter((name) => !CONTEXT_PROPERTIES.has(name) && !services.includes(name));
      check('no undeclared ctx service reads', undeclared.length === 0, undeclared.join(', '));
    }
  }

  // ---- bundle patch -------------------------------------------------------
  if (patchRel && exists(join(root, patchRel))) {
    const yml = readText(join(root, patchRel));
    check('patch contains an insert row', /^\s*-\s*insert:/m.test(yml));
    const names = [pkg?.name, pkg?.name?.replace(/^dsh-/, '')].filter(Boolean);
    check(
      'patch entry uses the package name',
      names.some((name) => new RegExp(`name:\\s*["']?${name}["']?`).test(yml)),
      `expected one of: ${names.join(', ')}`,
    );
  }

  // ---- portability --------------------------------------------------------
  const offenders = [];
  for (const rel of SHIPPED_FILES) {
    if (!exists(rel)) continue;
    const text = readText(join(root, rel));
    for (const pattern of MACHINE_PATH_PATTERNS) {
      if (pattern.test(text)) {
        offenders.push(rel);
        break;
      }
    }
  }
  check('no absolute user paths in shipped files', offenders.length === 0, offenders.join(', '));

  // ---- locale -------------------------------------------------------------
  for (const lang of ['en', 'th']) {
    const rel = join('locale', `${lang}.json`);
    if (!exists(rel)) {
      check(`locale/${lang}.json exists`, false);
      continue;
    }
    try {
      const locale = readJson(join(root, rel));
      check(`locale/${lang}.json has meta.title`, typeof locale.meta?.title === 'string' && locale.meta.title.length > 0);
    } catch (error) {
      check(`locale/${lang}.json parses`, false, error.message);
    }
  }

  // ---- no stray files -----------------------------------------------------
  const strayTemp = readdirSync(root).filter((name) => name.startsWith('.tmp') || name.endsWith('.orig') || name.endsWith('.rej'));
  check('no stray temp/merge files at the root', strayTemp.length === 0, strayTemp.join(', '));

  return { root, checks, failed: checks.filter((entry) => !entry.ok) };
}

/**
 * Render a validation result for the terminal.
 *
 * @param {{root: string, checks: Array<{name: string, ok: boolean, detail: string}>, failed: Array<object>}} result
 * @returns {string}
 */
export function formatReport(result) {
  const lines = [
    '',
    '  dsh-knowledge-bridge · bundle contract',
    `  root: ${result.root}`,
    '  ───────────────────────────────────────────────────────────',
  ];
  for (const entry of result.checks) {
    lines.push(`  ${entry.ok ? '✓' : '✗'} ${entry.name}${entry.detail && !entry.ok ? `  — ${entry.detail}` : ''}`);
  }
  lines.push('  ───────────────────────────────────────────────────────────');
  lines.push(`  ${result.checks.length - result.failed.length} passed · ${result.failed.length} failed`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const target = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT;
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    process.stderr.write(`not a directory: ${target}\n`);
    process.exit(2);
  }
  const result = validateBundle(target);
  process.stdout.write(formatReport(result));
  process.exit(result.failed.length === 0 ? 0 : 1);
}
