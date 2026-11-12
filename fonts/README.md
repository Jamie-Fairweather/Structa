# Fonts

Unmodified static TTFs from the official release zips, each under the SIL Open Font License 1.1 (`OFL.txt` in each folder, copied unchanged from the release).

| File | Release | Path in the release zip |
|---|---|---|
| `inter/Inter-Regular.ttf` | Inter 4.1 | `extras/ttf/Inter-Regular.ttf` |
| `inter/Inter-SemiBold.ttf` | Inter 4.1 | `extras/ttf/Inter-SemiBold.ttf` |
| `inter/Inter-Bold.ttf` | Inter 4.1 | `extras/ttf/Inter-Bold.ttf` |
| `inter/Inter-SemiBoldItalic.ttf` | Inter 4.1 | `extras/ttf/Inter-SemiBoldItalic.ttf` |
| `inter/OFL.txt` | Inter 4.1 | `LICENSE.txt` |
| `jetbrains-mono/JetBrainsMono-Regular.ttf` | JetBrains Mono 2.304 | `fonts/ttf/JetBrainsMono-Regular.ttf` |
| `jetbrains-mono/JetBrainsMono-Italic.ttf` | JetBrains Mono 2.304 | `fonts/ttf/JetBrainsMono-Italic.ttf` |
| `jetbrains-mono/OFL.txt` | JetBrains Mono 2.304 | `OFL.txt` |

Sources: https://github.com/rsms/inter/releases/tag/v4.1 and https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304.

Keep these files byte-for-byte as released. The build reads them to make the width tables (`bun run generate`), and later trims them for shipping.
