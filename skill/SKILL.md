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

Exit code 0 means success. 1 means bad input or a failed render: each problem is one line on stderr, with where it is and a hint, and no file is written. Fix every problem listed, then run it again. 2 means a mistake in the command itself.

## Choosing the type

One file is one diagram, and its `type` is the question it answers.

- `class`: classes, interfaces and enums, with their properties and methods, and how they relate: `inherits`, `implements`, `composition`, `aggregation`, `association` or `dependency`. Use it for code structure, and for which members a change adds, changes or removes.
- `er`: database tables with their columns, and the relationships between them as crow's-foot lines. A line joins the columns it names in `fromColumn` and `toColumn`, with a `fromCardinality` and a `toCardinality` such as `one` or `zero-or-many`. Use it for a schema or a migration.
- `flow`: the steps of a process, with decisions and loops. Each node has a `shape`: `start`, `end`, `step`, `decision`, `io`, `subprocess`, or a `note` joined to the step it is `about`. Use it for a procedure, how a request is handled, or a user's journey.
- `architecture`: the parts of a system and how they talk. Each card has a `kind`, such as `ui`, `api`, `service`, `queue` or `database`, or `class` for a class card among them. A line is a `call` (solid) or `async` (dashed) for messages and events. Use it for how a request flows through a system, and for a change map: which parts and classes a change touches, from a portal through an API and services to a database.

For a change that spans a system, draw an `architecture` change map of the whole, then a `class` or `er` diagram for any part that needs more detail.

## Writing the JSON

Start from your type's example, printed by `example <type>`, and change it. More examples sit in `examples/` beside `structa.mjs`: `examples/architecture-change-map.json` is a full change map with areas. The schema, printed by `schema` and saved as `structa.schema.json`, describes every field and its limits.

Every type shares the same building blocks:

```json
{
  "type": "architecture",
  "title": "Swimming pool: booking a lane online",
  "areas": [
    { "id": "web", "label": "Website" },
    { "id": "office", "label": "Back office" }
  ],
  "nodes": [
    { "id": "site", "label": "Pool website", "kind": "ui", "area": "web", "status": "changed" },
    { "id": "lanes", "label": "Lane bookings", "kind": "service", "area": "office", "status": "new", "description": "Holds a lane for an hour" },
    { "id": "printout", "label": "Weekly lane printout", "kind": "job", "area": "office", "status": "removed" },
    { "id": "db", "label": "Pool database", "kind": "database", "area": "office", "status": "unchanged" }
  ],
  "edges": [
    { "from": "site", "to": "lanes", "label": "book a lane", "status": "new", "emphasis": true },
    { "from": "lanes", "to": "db", "label": "save booking", "status": "new" },
    { "from": "printout", "to": "db", "label": "read bookings", "status": "removed" }
  ]
}
```

- Each node has an `id`, unique across nodes and edges, and a `label`, the name shown. It may have a `description`, an `area` and a `status`.
- Each edge joins the node ids in `from` and `to`, and may have a `label`, a `status` and `"emphasis": true`.
- The top level may have a `title` and `description`, drawn at the top-left.
- Unknown fields are errors, so a typo never changes the picture quietly.
- Text is plain and on one line: no Markdown, HTML, links, tabs or line breaks. Use Latin letters, digits and common symbols such as → … • ≤ ≥ ×. Other scripts and emoji are refused, with the character named. Long text wraps by itself.

## Showing a change honestly

When the diagram shows how things are, leave `status` out everywhere. When it shows a change, give each card, row (a method, property, enum value or column) and line the status that is true of it:

- `new`: the change adds it.
- `changed`: it stays, but the change alters it. A card whose rows change is `changed`.
- `removed`: the change takes it away. Keep removed parts in the picture: Structa draws them faded and struck through, so the reader sees what goes.
- `unchanged`: the change leaves it alone, and it is there for context.

Include an unchanged part only when the change needs it to make sense, such as the caller of a changed service or the table a new foreign key points to. Leave the rest out, and count the rows you leave out of a card with `more`, which draws a muted "… 12 more" row.

Rows in a `new` or `removed` card take the card's status, so leave theirs out. A card whose rows have a status needs one of its own, usually `changed`, and an `unchanged` card holds only unchanged rows. Structa refuses a diagram that breaks these rules, so the picture never contradicts itself.

Lines show their status by colour alone. Mark the main path through a busy diagram with `"emphasis": true`, which draws it thicker. The legend at the bottom lists the statuses and areas used, and `"legend": false` leaves it out.

## Areas

Use `areas` when cards belong to parts of a system or to teams: an admin portal, an API and a database, or who does each step of a process. Declare each area once in `areas`, with an `id` and a short `label`, and put cards in it with `area`. An area can sit inside another through `parent`, at most 4 levels deep. Every area needs a card in it, directly or in an area inside it. Lines join cards, never areas.

- By default each card shows its area's name as a small tag on its border. The layout then follows the connections alone, which keeps it tidiest. Use this for busy change maps, and when many lines cross between areas.
- `"groupAreas": true` draws a box round each area's cards instead, nested as the areas are. Use it when the grouping is the point, such as a portal, an API and a database that should read as blocks, or loose swimlanes in a flowchart.

## Reading order and direction

Structa places every card. You steer it two ways:

- List `nodes` in reading order: first where a reader starts, such as the caller, the first step or a parent class, then what follows. The order gently guides the layout, and the connections still win.
- `direction` is `down` or `right`. ER diagrams run `right` by default, the others `down`. Class diagrams put parents before their children either way.

## Keeping labels short

Short labels keep cards small and the layout tidy.

- A card's `label` is a name of a few words. Put the detail in its `description`, one sentence drawn under the label.
- A line's `label` is a few words, such as "book a lane" or "POST /bookings".
- A row's `text` can be a real signature, such as "cancel(id: BookingId): void". Long rows wrap, and nothing is ever cut off.

## Limits

| What | At most |
| --- | --- |
| cards, in `nodes` | 500 |
| lines, in `edges` | 1000 |
| areas, in `areas` | 100 |
| rows in one card: `properties`, `methods` and `values` together, or `columns` | 100 |
| a diagram's `title`, or a card's `label` | 100 characters |
| a `description` | 300 characters |
| an area's `label` | 40 characters |
| a line's `label` | 60 characters |
| a class line's end counts, `fromLabel` and `toLabel` | 20 characters |
| a row's `text` | 200 characters |
| a column's `name` or `type`, or the `fromColumn` and `toColumn` that name one | 100 characters |

A diagram that hits a limit is too big to read. Split it: draw an overview of the whole, then one diagram for each part that needs detail, such as one per area. Leave dull rows out and count them with `more`. If a PNG would be too large to draw, Structa says so: lower `--scale`, draw an SVG, or split the diagram.
