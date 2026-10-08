# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x | ✅ |

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Report it privately through
GitHub's *Report a vulnerability* tab (Security → Advisories) on this repository, or by email to
the maintainer listed in `package.json`.

Include: affected version, platform, a minimal reproduction, and the impact you believe it has.
Expect an acknowledgement within 72 hours and a fix or mitigation plan within 14 days.

## What counts as a security issue here

This plugin runs **inside the host process**, with the host process's filesystem permissions. That
makes the following security-relevant, not cosmetic:

- **Guard bypass.** Any command that matches a configured banned pattern but still reaches the
  disk. The guard is monotonic by design: a denial must not be overridable by another plugin.
- **Unexpected file access.** The plugin is meant to read configured vault roots and workspace
  rule files. Reading or returning anything else (credential stores, browser profiles, SSH keys,
  environment dumps) is a vulnerability, including through a crafted `metadata.json` or a symlink
  that escapes a vault root.
- **Prompt injection through vault content.** A document that can make the agent silently exfiltrate
  data or run commands — for example by hiding instructions in a summary that a tool returns.
- **Path traversal** in `knowledge_read` / `knowledge_list` item ids or artifact names.

## What is out of scope

- Sandbox configuration of DeepSeek Harness itself.
- Commands a user explicitly and knowingly runs outside the agent.
- Contents of a vault that the user configured and that the agent then reports back — the vault is
  trusted input by design; treat its contents as you would your own notes.

## Hardening advice for users

- Keep vault roots narrow; do not point `DSH_KNOWLEDGE_PATHS` at a home directory.
- Keep the guard enabled (`enableSafetyGuard: true`) and add patterns for destructive commands
  specific to your stack.
- Review `bannedPatterns` after upgrading: a new release may add rules, and a rule that is too
  broad will block legitimate work.
