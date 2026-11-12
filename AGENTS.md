# Structa

## Tooling

- Use **Bun** for installing and running dev tools (`bun install`, `bun run <script>`, `bunx <tool>`). Don't use npm or commit a `package-lock.json`. The shipped `structa.mjs` must still run on plain Node 20+.
- Commits and PR titles follow **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `build:`, `ci:`, `test:`, `refactor:`, …). A husky `commit-msg` hook runs commitlint locally after `bun install`, and CI checks every PR's commits and title.

## Development

- Run tests with `bun run test` (add a file path to run one file). It runs Vitest under Node, the shipped runtime; Bun's own `bun test` is a different runner.
- `bun run typecheck`, `bun run test` and `bun run build` first run `bun run generate`. It trims the TTFs in `fonts/` with harfbuzzjs (dev-only) into `generated/fonts/` (gitignored), then reads the width tables and the embedded fonts' data URLs from those trimmed files into `generated/`. Run `bun run generate` before anything else that imports `src/text`.
- Tests sit at two seams only: `render()` (JSON in, SVG/PNG out) and the built skill folder run with `node`. Snapshot and structural tests render with `embedFonts: false`. ELK is the one library a test may fake, at `src/layout/elk.ts`, the only module that loads it.
- Skill-folder tests get their own fresh build from `buildSkillForTest()` in `test/helpers/skill.ts`, which builds inside a temporary `"type": "module"` project and runs `node structa.mjs` from another folder. `bun run build` writes `dist/structa/` and fails when the packaging checks in `scripts/lib/skill.ts` do. It writes `structa.schema.json` by running the built `structa.mjs schema` with the `node` on your PATH, so it needs Node 20+ installed. Those checks are tested through the build: `buildChangedProject()` builds a changed copy of the project and returns the build's error. When the build starts reading a new file or folder, add it to `BUILD_INPUTS` there.
- Upgrading elkjs means updating `PUBLISHED_ELK` in `scripts/lib/skill.ts` too: the new version and the SHA-256 of `lib/elk.bundled.js` in its published npm package. Never patch or override elkjs.
- Every file in `examples/` is a snapshot fixture, in light and dark, and the folder ships in the skill folder. `examples/<type>.json` is what `structa example <type>` prints, so every diagram type needs one. After an output change you intend, run `bun run test -u` and look at each changed `.svg` (and `structa.schema.json`) under `test/__snapshots__/` before committing.
- `bun run gallery` builds the skill folder, then writes `dist/gallery/index.html`: every example drawn by the built `structa.mjs`, light and dark side by side. Open that file in a browser (the script prints its `file://` link) to check the look by eye, such as after a snapshot change.
- JSON fields, their limits and the font faces each text field is drawn in live in `src/input/definitions.ts`. The validator and the JSON Schema are both generated from it.
- `src/` has one folder per module in the spec (`input`, `text`, `shapes`, `layout`, `theme`, `painter`, `raster`) plus `render.ts`, the command line in `cli.ts`, and `structa.ts`, the built file's entry point. Grow these modules rather than adding parallel ones.
- The skill folder ships a `licenses/` folder, and `structa.mjs` starts with a banner naming the parts embedded in it and their licences. The build copies Structa's `LICENSE`, elkjs's own `LICENSE.md`, each font's `OFL.txt`, and the Apache-2.0 and MPL-2.0 texts, which no package carries, from this repo's `licenses/` (unchanged from apache.org and mozilla.org). It writes the source notes for elkjs and resvg-wasm with their installed versions. A missing or wrong licence file, banner or resvg legal comment fails the build. Shipping a new third-party part means adding its licence in `licenceFiles()` in `scripts/lib/skill.ts`, to the banner and to `RELEASE_LICENSE`.
- `bun run release` builds the skill folder, then writes `dist/structa.zip` (the folder under `structa/`, its licence expression in the zip's comment, the same bytes every time) and `dist/release-notes.md`. Pushing a `v*` tag runs `.github/workflows/release.yml`: the test workflow, then `bun run release`, then it attaches the zip to the tag's GitHub Release. Never commit `dist/` or `generated/`: CI fails on any committed file that `.gitignore` ignores.
- `src/raster` draws PNGs with `@resvg/resvg-wasm`, the only module that loads its wasm. The build embeds that wasm in `structa.mjs`, brotli-compressed, and bundles resvg's glue after its legal comment. Upgrading resvg-wasm is a deliberate change: re-check the PNG tests and the skill-folder tests that name its version.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
