# Structa

## Tooling

- Use **Bun** for installing and running dev tools (`bun install`, `bun run <script>`, `bunx <tool>`). Don't use npm or commit a `package-lock.json`. The shipped `structa.mjs` must still run on plain Node 20+.
- Commits and PR titles follow **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `build:`, `ci:`, `test:`, `refactor:`, …). A husky `commit-msg` hook runs commitlint locally after `bun install`, and CI checks every PR's commits and title.

## Development

- Run tests with `bun run test` (add a file path to run one file). It runs Vitest under Node, the shipped runtime; Bun's own `bun test` is a different runner.
- `bun run typecheck` and `bun run test` first regenerate the font width tables into `generated/` (gitignored) from the TTFs in `fonts/`. Run `bun run generate` before anything else that imports `src/text`.
- Tests sit at two seams only: `render()` (JSON in, SVG/PNG out) and the built skill folder run with `node`. Snapshot and structural tests render with `embedFonts: false`. ELK is the one library a test may fake, at `src/layout/elk.ts`, the only module that loads it.
- Every file in `examples/` is a snapshot fixture. After an output change you intend, run `bun run test -u` and look at each changed `.svg` under `test/__snapshots__/` before committing.
- `src/` has one folder per module in the spec (`input`, `text`, `shapes`, `layout`, `theme`, `painter`) plus `render.ts`. Grow these modules rather than adding parallel ones.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
