# Contributing

Thanks for considering a contribution. This plugin is deliberately small, and the
rules below are what keep it that way.

## Setup

Nothing to install. Node.js 20+ and a terminal are enough:

```bash
git clone <your-fork> dsh-knowledge-bridge
cd dsh-knowledge-bridge
npm test          # unit tests + bundle contract
npm run demo      # index examples/vault and print what the agent sees
npm run validate  # static bundle-contract checks
```

> On Windows, `npm test` and `npm run demo` work in PowerShell, `cmd` and Windows Terminal.
> If the OS temp directory is read-only (a sandboxed DSH session, for example), point
> `TEMP`/`TMP` at a writable directory first — the tests create their fixtures there.

## Invariants

A pull request is rejected when it breaks one of these:

1. **No runtime dependencies.** Node.js built-ins only (`node:fs`, `node:path`, `node:os`).
   `npm run validate` checks this.
2. **Every cordis service read off `ctx` is declared in `export const inject`.**
   Reading one that is missing throws `cannot get property "X" without inject` — from the read
   itself, so `?.` and an outer `try` do not help. `npm run validate` fails on undeclared reads.
3. **Nothing machine-specific ships.** No `C:\`, `/Users/<name>/` or `/home/<name>/` in
   `index.js`, `lib/`, `cordis.patch.yml`, `package.json`, `locale/` or `scripts/demo.mjs`.
4. **Tool output stays clipped.** Whatever a tool returns is replayed in every later model call;
   returning a full vault summary is a permanent token tax.
5. **The vault never enters the prompt.** Only a one-line directive and workspace rule files may be
   injected. Content is pulled on demand.

## Adding a vault format

1. Extend `buildKnowledgeIndex()` in `lib/knowledge.js` — it must stay pure and synchronous.
2. Add a fixture to `lib/knowledge.test.js` covering the new layout.
3. Document the layout in the README (both language sections).
4. Add a matching example under `examples/vault/` so `npm run demo` shows it.

## Adding a guard rule

Banned patterns are configuration, not code: document the rule in the README and mention the
failure mode it prevents. Patterns are matched case-insensitively against the command string of
`bash` / `pwsh` / `cmd` / `terminal` calls.

## Style

- ES modules, two-space indentation, single quotes, semicolons, trailing commas.
- JSDoc on every exported function; explain *why*, not *what*.
- Comments earn their place by recording a trap that cost someone time. Keep them rare and specific.

## Commits and pull requests

Conventional-commit style subject lines are welcome (`fix(guard): read exec.arguments`).
Fill in the pull-request template: what changed, why, and how you verified it. CI runs the test
matrix on Linux and Windows across Node 20, 22 and 24 with **no install step** — keep it that way.

## Reporting bugs

Use the bug-report template. It asks for the two facts that resolve most reports:
the startup log line (`Initialized with N path(s), indexed M item(s)`) and the exact error text.
Security issues go through [SECURITY.md](SECURITY.md) instead of the public tracker.
