## What changed

## Why

## How it was tested
- [ ] `npm test` passes
- [ ] New generator / preset: every option builds watertight (see AGENTS.md)
- [ ] UI change: `node scripts/ui-smoke.mjs` passes (needs Playwright)
- [ ] Installer change: `sudo bash scripts/test-pi-install.sh` passes

## Checklist
- [ ] No invented dimensions (unmeasured sizes stay empty, datasheet values in `verify`)
- [ ] Printers stay view only (no control endpoints)
- [ ] No secrets, personal data or addresses in the diff
- [ ] Docs and CHANGELOG.md updated
