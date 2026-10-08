## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem this solves. -->

## Checklist

- [ ] `npm test` passes locally (unit tests + bundle contract)
- [ ] `npm run validate` reports `0 failed`
- [ ] Every cordis service read off `ctx` is declared in `export const inject`
- [ ] No absolute user paths were added to a shipped file (`index.js`, `lib/`, `cordis.patch.yml`, `package.json`, `locale/`, `scripts/demo.mjs`)
- [ ] New tool output is clipped — tool results are replayed in every later model call
- [ ] README / CHANGELOG updated when behaviour or configuration changed
- [ ] No vault contents, credentials, or personal paths in the diff

## How it was verified

<!-- Commands you ran, and what you observed. -->
