# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] — 2026-10-12

### Fixed

- **The update command stays usable when the profile name is unknown** — DSH exports `DSH_PROFILE`
  to the shells it hands the agent but not to the host process the plugin runs in, so
  `knowledge_info` reported `profile: null` and the self-help line carried a literal `<profile>`
  placeholder. Both now fall back to the shell form (`$env:DSH_PROFILE` on Windows, `"$DSH_PROFILE"`
  elsewhere), which resolves inside the very shell the agent runs the command in, plus an
  `updateCommandHint` that explains it.

## [1.1.0] — 2026-10-12

### Added

- **Self-help update path** — DSH has no plugin auto-update yet, so the plugin now teaches the
  agent how to update it: one prompt line carries the exact command for the live profile
  (`DSH_PROFILE`, never a hardcoded machine path), and `knowledge_info` reports the installed
  version, that command, the restart requirement and — on demand only — whether a newer version
  is published. The registry lookup never runs at load and fails soft: an unreadable registry
  answers `updateAvailable: null`, never a false "up to date".
- **Metadata keyword search** — `tags` (+6), `aliases` (+8) and `references` (+4) from
  `metadata.json` are indexed and scored, so a query like `LeaveRequestPage`,
  `staff_service_entries` or a real file path finds its item instead of only matching titles
  and summaries. `toStringList()` accepts an array or a `,`/`;` delimited string, so
  hand-written metadata cannot break the index.
- **Lazy body search** (+1) — document bodies are searched as a last resort, read on demand and
  cached by `mtime` (512 entries). An item that already matched on metadata never pays for a
  document read. Search results stay lean by contract: `id`, `title`, `score`, a clipped
  summary (≤400 chars) and artifact names — never file content.

### Changed

- `README.md` and `docs/INSTALL.md` lead with the paste-the-link install path and add a
  "How to update — just ask your agent" section, so no user has to memorise a command.
- The injected directive now nudges a vault search by repo/module/file name before answering
  repository-specific questions (still one line, < 300 characters).
- `knowledge_search` results carry a `score` field, and its `query` parameter description now
  names every searched field.

### Planned

- Optional client half: browse and search the vault from a DSH settings panel.
- Incremental index cache keyed on directory mtime, so repeated tool calls stop re-walking the vault.

## [1.0.0] — 2026-10-09

First public release.

### Added

- **Zero-config vault discovery** — `DSH_KNOWLEDGE_PATHS`, then `~/.gemini/antigravity-ide/knowledge`,
  `~/.antigravity-ide/knowledge`, `~/.dsh/knowledge`, `~/.codex/knowledge`, then `./knowledge`,
  `./docs/knowledge`, `./.knowledge`. `~` is expanded, duplicates are collapsed, explicit config wins.
- **Three model-facing tools** — `knowledge_search`, `knowledge_read`, `knowledge_list`, with clipped
  summaries because tool output is replayed in every later model call.
- **Safety guard** — denies `bash` / `pwsh` / `cmd` / `terminal` calls whose command matches a banned
  pattern, using the real execution contract (`exec.name` + `exec.arguments`).
- **Prompt injection** — project rules (`AGENTS.md`, `GEMINI.md`, `CLAUDE.md`) plus a one-line directive
  (~140 characters) so the model knows a vault exists without paying for its contents.
- **Supported vault layouts** — structured items (`metadata.json` + `artifacts/*.md`) and plain
  markdown trees.
- Zero-install demo (`npm run demo`) and static bundle-contract validation (`npm run validate`).

### Fixed

- `apply()` read `ctx.systemPrompt` without declaring it in `inject`; cordis throws
  `cannot get property "systemPrompt" without inject` on the property read itself, so optional
  chaining and an outer `try` could not save the entry, and the bundle failed to activate.
  The read now lives inside the `try` and both services are declared.
- The safety guard read `exec.tool` / `exec.args`. DSH hands guards an object built by
  `createExecution()` with `name` and `arguments`, so `exec.args` was always `undefined` and the
  guard silently never fired. A regression test now pins the real shape.
- A machine-specific vault path was committed in `cordis.patch.yml`; replaced by discovery.
- Discovery candidates were resolved without expanding `~`, so they never matched.

[Unreleased]: https://github.com/Babydunx1/dsh-knowledge-bridge/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/Babydunx1/dsh-knowledge-bridge/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Babydunx1/dsh-knowledge-bridge/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Babydunx1/dsh-knowledge-bridge/releases/tag/v1.0.0
