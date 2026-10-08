#!/usr/bin/env node
/**
 * Zero-install demo: index a vault and print exactly what the agent would see.
 *
 *   node scripts/demo.mjs                  # auto-discovery (env var -> ~ -> ./)
 *   node scripts/demo.mjs examples/vault   # one or more explicit folders
 *   node scripts/demo.mjs --query watchdog # change the sample search
 *
 * Uses the same engine the host plugin uses, so what you see here is what the
 * agent gets. Nothing is written and no command is executed.
 */
import { resolve } from 'node:path';

import { DEFAULT_CONFIG } from '../index.js';
import {
  KNOWLEDGE_PATHS_ENV,
  buildKnowledgeIndex,
  resolveKnowledgePaths,
  searchKnowledge,
} from '../lib/knowledge.js';

const argv = process.argv.slice(2);
let query = 'architecture';
const explicit = [];
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === '--query') {
    query = argv[index + 1] ?? query;
    index += 1;
    continue;
  }
  explicit.push(argv[index]);
}

const roots = explicit.length > 0
  ? resolveKnowledgePaths(explicit.map((p) => resolve(p)))
  : resolveKnowledgePaths([], process.cwd());

const line = (text = '') => process.stdout.write(`${text}\n`);
const clip = (text, max) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
};

line('');
line('  dsh-knowledge-bridge · demo');
line('  ───────────────────────────────────────────────────────────');
line('');

if (roots.length === 0) {
  line('  ⚠  no vault found.');
  line(`     set ${KNOWLEDGE_PATHS_ENV}=<folder> or pass a folder:`);
  line('     node scripts/demo.mjs examples/vault');
  line('');
  process.exit(1);
}

line('  1 · discover');
for (const root of roots) line(`      ✓ ${root}`);
line(`      source: ${explicit.length > 0 ? 'command line' : `auto-discovery (${KNOWLEDGE_PATHS_ENV} → ~ → ./)`}`);
line('');

const index = buildKnowledgeIndex(roots);
const artifacts = index.reduce((total, item) => total + item.artifacts.length, 0);
line('  2 · index');
line(`      ${index.length} item(s) · ${artifacts} artifact(s)`);
index.forEach((item, position) => {
  const branch = position === index.length - 1 ? '└─' : '├─';
  line(`      ${branch} ${item.id}  ·  ${item.artifacts.length} artifact(s)`);
  line(`      ${position === index.length - 1 ? '   ' : '│ '}    ${clip(item.title, 68)}`);
  const preview = clip(item.summary, 96);
  if (preview.length > 0) line(`      ${position === index.length - 1 ? '   ' : '│ '}    ${preview}`);
});
line('');

const hits = searchKnowledge(index, query, 3);
line(`  3 · search("${query}")  →  ${hits.length} hit(s)`);
for (const hit of hits) {
  line(`      • ${hit.id}  [score ${hit.score}]`);
  line(`        ${clip(hit.summary, 110)}`);
  if (hit.artifacts.length > 0) line(`        artifacts: ${hit.artifacts.slice(0, 4).join(', ')}${hit.artifacts.length > 4 ? ', …' : ''}`);
}
if (hits.length === 0) line('      (no keyword match — try --query <word>)');
line('');

line('  4 · guard (patterns are matched against the command string)');
const samples = [
  'git reset --hard HEAD~1',
  'git clean -fd',
  'git status',
  'rm -rf /',
  'rm -rf ./build',
];
for (const sample of samples) {
  const rule = DEFAULT_CONFIG.bannedPatterns.find((pattern) => new RegExp(pattern, 'i').test(sample));
  line(`      ${rule ? '⛔ BLOCKED' : '✅ allowed'}  ${sample}`);
  if (rule) line(`                  matched /${rule}/`);
}
line('');
line(`  5 · prompt cost  1 directive section · ${DEFAULT_CONFIG.rulesPaths.join(', ')} when present`);
line('      item bodies are never injected — they are pulled on demand.');
line('');
