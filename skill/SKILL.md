---
name: structa
description: Draws class, ER, flowchart and architecture diagrams as SVG or PNG from a JSON file, with new, changed and removed parts colour-coded and cards grouped into areas. Use when a picture would explain a design or a change, such as which classes a change touches, how tables relate, how a request flows through a system, or the steps of a process.
---

# Structa

Structa turns one JSON file describing one diagram into an SVG or PNG image. It lays the diagram out itself: you say what is there and how it connects, and never where it goes.

## Running it

`structa.mjs` is the file in this skill's folder. It needs Node 20 or newer and nothing installed. Run it with `node`: Bun and Deno are untested. Give `structa.mjs` by its full path and run it from your own working folder. It finds the files beside it itself, and the files you name are relative to where you are.

```sh
node structa.mjs example architecture > diagram.json   # a working example to start from
node structa.mjs diagram.json -o diagram.png           # draw it
```

More ways to run it:

```sh
node structa.mjs diagram.json -o diagram.svg -o diagram.png   # both, from one layout
node structa.mjs diagram.json --theme dark -o diagram-dark.png
node structa.mjs diagram.json --scale 4 -o diagram-large.png
node structa.mjs diagram.json --no-embed-fonts -o diagram-plain.svg
node structa.mjs diagram.json > diagram.svg                   # no -o: the SVG goes to stdout
node structa.mjs - -o diagram.svg < diagram.json              # read the JSON from stdin
node structa.mjs schema                                       # the JSON Schema
node structa.mjs --help
```

- `-o` picks the format from the file's extension, `.svg` or `.png` in any letter case. Repeat it for more files.
- `--theme` is `light` (the default) or `dark`, and wins over the JSON's `theme`.
- `--scale` sets a PNG's pixels per SVG pixel: a whole number from 1 to 4, 2 by default.
- `--no-embed-fonts` makes a smaller SVG that relies on the viewer having the fonts. PNGs always have them.
- Write the JSON file as UTF-8. A PowerShell redirect can save UTF-16, which Structa refuses with a hint.

Exit code 0 means every file was written. 1 means bad input or a failed render: each problem is one line on stderr, with where it is and a hint, and no file is written. 2 means a mistake in the command itself.
