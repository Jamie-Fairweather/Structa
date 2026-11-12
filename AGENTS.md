# Structa

## Tooling

- Use **Bun** for installing and running dev tools (`bun install`, `bun run <script>`, `bunx <tool>`). Don't use npm or commit a `package-lock.json`. The shipped `structa.mjs` must still run on plain Node 20+.
- Commits and PR titles follow **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `build:`, `ci:`, `test:`, `refactor:`, …). A husky `commit-msg` hook runs commitlint locally after `bun install`, and CI checks every PR's commits and title.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
