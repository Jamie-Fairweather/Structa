import type { Cardinality, Status } from "../input";
import type { PlacedArea, PlacedCard, Point, RoutedLine, Scene } from "../layout";
import {
  entry,
  nearest,
  type AreaBox,
  type AreaItem,
  type Badge,
  type Card,
  type Connector,
  type Header,
  type Legend,
  type LevelLine,
  type Line,
  type LineLabel,
  type Row,
  type StatusItem,
  type Tag,
  type TextLine,
} from "../shapes";
import { FACES, faceStyle, fontDataUrl, type FaceId } from "../text";
import type { Theme } from "../theme";
import { iconPath } from "./icons";
import { arrowhead, crowsFoot, openArrowhead, roundedRoute } from "./route";
import { el, escapeText, num, open, type Attrs } from "./svg";

/** Everything drawn: the laid-out scene, the title above it and the legend below it. */
export interface Drawing {
  readonly scene: Scene<Card, Line | Connector, AreaBox>;
  readonly header?: Header;
  readonly legend?: Legend;
}

export interface PaintOptions {
  /** Embed the font faces the text is drawn in, as @font-face rules. */
  readonly embedFonts: boolean;
}

/** What drawing needs: the theme, and every face text has been written in so far. */
interface Pen {
  readonly theme: Theme;
  readonly faces: Set<FaceId>;
}

/**
 * Turns a drawing into a passive SVG string. The title, the scene and the
 * legend are stacked top to bottom, left-aligned, with the canvas padding
 * around them all.
 */
export function paint({ scene, header, legend }: Drawing, theme: Theme, options: PaintOptions): string {
  const { canvasPadding: pad, sectionGap } = theme.sizes;
  const sceneHeight = scene.cards.length > 0 ? scene.height : undefined;
  const { tops, bottom } = stack([header?.height, sceneHeight, legend?.height], pad, sectionGap);
  const [headerTop, sceneTop, legendTop] = tops;
  const width = wholePixels(Math.max(scene.width, header?.width ?? 0, legend?.width ?? 0) + 2 * pad);
  const height = wholePixels(bottom + pad);
  // Ids carry the theme name, so a light and a dark SVG inlined in one page can't clash.
  const ids = { grid: `structa-grid-${theme.name}`, shadow: `structa-shadow-${theme.name}` };
  // Every text element is written through text(), which records its face in the pen.
  const pen: Pen = { theme, faces: new Set() };
  const origin = { x: pad, y: sceneTop ?? pad };
  const placed = new Map(scene.cards.map((p) => [p.card.id, p]));

  const routed = (l: Line | Connector, points: readonly Point[]) => ontoCards(points, placed.get(l.from)!, placed.get(l.to)!);
  const lines = scene.lines.filter((l): l is RoutedLine<Line> => l.line.kind !== "connector");
  const drawn = lines.map(({ line: l, points }) => ({ line: l, points: routed(l, points) }));
  const rooms = endRooms(drawn);
  const content = [
    ...(header ? headerText(header, { x: pad, y: headerTop! }, pen) : []),
    // Under everything else in the scene, each parent before the areas inside it.
    ...scene.areas.flatMap((a) => areaBox(a, origin, pen)),
    ...scene.cards.flatMap((p) => card(p, origin, pen, ids.shadow)),
    // Under the lines: a note's connector is an aside, not part of the flow.
    ...scene.lines.flatMap(({ line: l, points }) => (l.kind === "connector" ? connector(l, routed(l, points), origin, pen) : [])),
    ...drawn.flatMap(({ line: l, points }, i) => line(l, points, origin, pen, rooms[i]!)),
    ...areaNames(scene.areas, origin, pen),
    ...lineLabels(lines, origin, pen),
    ...(legend ? legendItems(legend, { x: pad, y: legendTop! }, pen) : []),
  ];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">`,
    ...background(width, height, theme, ids, options.embedFonts ? fontFaces(pen.faces) : []),
    ...content,
    "</svg>",
  ].join("\n") + "\n";
}

/**
 * ELK ends lines on a card's box, but what's drawn there is often inside it:
 * the band the badge overhangs is above the outline, and a diamond, a slanted
 * box or a pill don't fill their box. So each end's straight run is carried
 * on, or cut back, until it meets what's drawn: the outline, or the badge on it.
 */
function ontoCards(points: readonly Point[], from: PlacedCard<Card>, to: PlacedCard<Card>): Point[] {
  const route = [...points];
  route[0] = land(points, 0, 1, from);
  route[route.length - 1] = land(points, points.length - 1, -1, to);
  return route;
}

/** Where the route's end at `end` meets its card, running on the way the route comes into it (`step` is +1 or -1). */
function land(route: readonly Point[], end: number, step: 1 | -1, { card, x, y }: PlacedCard<Card>): Point {
  const p = route[end]!;
  // The route's next distinct point, so a repeated point doesn't hide the run's direction.
  let i = end + step;
  while (route[i + step] && Math.hypot(route[i]!.x - p.x, route[i]!.y - p.y) < 1e-6) i += step;
  const q = route[i];
  if (!q) return p;
  const onCard = { x: p.x - x, y: p.y - y };
  // A slanted run, like a connector among crowded notes, can pass just outside
  // a corner of the outline. Then it ends at the nearest point of what's drawn.
  const met = entry(card, { x: q.x - x, y: q.y - y }, onCard) ?? nearest(card, onCard);
  return { x: met.x + x, y: met.y + y };
}

/** For one line, how far each of its ends is from the nearest other line end on the same side of the same card. */
interface Rooms {
  readonly from: number;
  readonly to: number;
}

/**
 * How much room each line's crow's feet have across the line: the distance
 * from each end to the nearest other relationship end on the same side of the
 * same table. Ends that share a side of a header are spread apart, but on a
 * crowded one they can be closer than a crow's foot is wide. Ends that share
 * a point, at a column's row, draw their marks there full size, one over another.
 */
function endRooms(lines: readonly { line: Line; points: readonly Point[] }[]): Rooms[] {
  const ends = lines.flatMap(({ line: l, points }) =>
    l.ends ? [{ card: l.from, at: points[0]! }, { card: l.to, at: points.at(-1)! }] : [],
  );
  const room = (card: string, at: Point | undefined) => {
    if (!at) return Number.POSITIVE_INFINITY;
    const others = ends.filter((e) => e.card === card && Math.abs(e.at.x - at.x) < 1 && Math.abs(e.at.y - at.y) >= 0.01);
    return Math.min(Number.POSITIVE_INFINITY, ...others.map((e) => Math.abs(e.at.y - at.y)));
  };
  return lines.map(({ line: l, points }) => ({ from: room(l.from, points[0]), to: room(l.to, points.at(-1)) }));
}

/** The tops of blocks of these heights, stacked `gap` apart from `top`, skipping absent ones, and where the last one ends. */
function stack(heights: readonly (number | undefined)[], top: number, gap: number) {
  let y = top;
  let bottom = top;
  const tops = heights.map((height) => {
    if (height === undefined) return undefined;
    const at = y;
    bottom = at + height;
    y = bottom + gap;
    return at;
  });
  return { tops, bottom };
}

/**
 * A <style> with one @font-face rule per face used, in the fixed face order;
 * nothing when no text is drawn. The rules name Structa's own family, not the
 * plain one, because an inlined SVG's <style> applies to the whole page.
 */
function fontFaces(used: ReadonlySet<FaceId>): string[] {
  const rules = FACES.filter(({ id }) => used.has(id)).map(
    ({ id, embeddedFamily, weight, style }) =>
      `@font-face{font-family:"${embeddedFamily}";font-style:${style};font-weight:${num(weight)};src:url("${fontDataUrl(id)}")}`,
  );
  return rules.length === 0 ? [] : [el("style", [], escapeText(rules.join("")))];
}

function background(
  width: number,
  height: number,
  theme: Theme,
  ids: { grid: string; shadow: string },
  fonts: readonly string[],
): string[] {
  const { colors, sizes } = theme;
  const { spacing, dotRadius } = sizes.grid;
  return [
    "<defs>",
    ...fonts,
    el(
      "pattern",
      [["id", ids.grid], ["width", spacing], ["height", spacing], ["patternUnits", "userSpaceOnUse"]],
      el("circle", [
        ["cx", spacing / 2],
        ["cy", spacing / 2],
        ["r", dotRadius],
        ["fill", colors.gridDot],
        ["fill-opacity", colors.gridDotOpacity],
      ]),
    ),
    el(
      "filter",
      [["id", ids.shadow], ["x", "-20%"], ["y", "-30%"], ["width", "140%"], ["height", "170%"]],
      el("feDropShadow", [
        ["dx", 0],
        ["dy", sizes.card.shadowOffsetY],
        ["stdDeviation", sizes.card.shadowBlur],
        ["flood-color", colors.cardShadow],
        ["flood-opacity", colors.cardShadowOpacity],
      ]),
    ),
    "</defs>",
    el("rect", [["width", width], ["height", height], ["fill", colors.background]]),
    el("rect", [["width", width], ["height", height], ["fill", `url(#${ids.grid})`]]),
  ];
}

function headerText(header: Header, at: Point, pen: Pen): string[] {
  const part = (name: string, texts: readonly TextLine[]) =>
    texts.length === 0
      ? []
      : [open("g", [["class", name]]), ...texts.flatMap((t) => text(t, at.x, at.y, pen.theme.colors[t.color], pen)), "</g>"];
  return [...part("title", header.title), ...part("description", header.description)];
}

function legendItems(legend: Legend, at: Point, pen: Pen): string[] {
  return [
    open("g", [["class", "legend"]]),
    ...legend.items.flatMap((item) => (item.kind === "status" ? statusItem(item, at, pen) : areaItem(item, at, pen))),
    "</g>",
  ];
}

/** A status in the legend: a short line in its line colour, then its badge. */
function statusItem(item: StatusItem, at: Point, pen: Pen): string[] {
  return [
    open("g", [["class", "legend-item"], ...statusAttr(item.status)]),
    el("line", [
      ["class", "swatch"],
      ["x1", at.x + item.swatch.x1],
      ["y1", at.y + item.swatch.y],
      ["x2", at.x + item.swatch.x2],
      ["y2", at.y + item.swatch.y],
      ["stroke", lineColour(item.status, pen.theme)],
      ["stroke-width", pen.theme.sizes.line.width],
      ["stroke-linecap", "round"],
    ]),
    ...badge(item.badge, at.x, at.y, pen),
    "</g>",
  ];
}

/** An area in the legend: its tag, as its cards show it. */
function areaItem(item: AreaItem, at: Point, pen: Pen): string[] {
  return [open("g", [["class", "legend-item"], ["data-area", item.tag.area]]), ...tag(item.tag, at.x, at.y, pen), "</g>"];
}

/**
 * An area's box, offset by `at`: every box in the same see-through fill, so
 * one inside another comes out stronger, with a thin border. Its name is
 * drawn later, over the lines.
 */
function areaBox({ area, x, y, width, height }: PlacedArea<AreaBox>, at: Point, pen: Pen): string[] {
  const { colors, sizes } = pen.theme;
  return [
    open("g", [["class", "area"], ["data-area", area.id], ...(area.parent === undefined ? [] : ([["data-parent", area.parent]] as const))]),
    el("title", [], escapeText(area.tooltip)),
    el("rect", [
      ["class", "area-box"],
      ["x", x + at.x],
      ["y", y + at.y],
      ["width", width],
      ["height", height],
      ["rx", sizes.area.radius],
      ["fill", colors.areaFill],
      ["fill-opacity", colors.areaFillOpacity],
      ["stroke", colors.areaBorder],
      ["stroke-width", sizes.area.borderWidth],
    ]),
    "</g>",
  ];
}

/**
 * Each area's name at the top-left of its box, offset by `at`, over the
 * lines: behind it, a patch of exactly the colour its box shows (the canvas
 * under one layer of the see-through fill for each box it's in), so a line
 * running under the name stops at it rather than cutting through it.
 */
function areaNames(areas: readonly PlacedArea<AreaBox>[], at: Point, pen: Pen): string[] {
  if (areas.length === 0) return [];
  const { colors } = pen.theme;
  // Each parent comes before the areas inside it, so its colour is known first.
  const shown = new Map<string, Rgb>();
  const names = areas.flatMap(({ area, x: boxX, y: boxY }) => {
    const under = area.parent === undefined ? rgb(colors.background) : shown.get(area.parent)!;
    const colour = over(under, rgb(colors.areaFill), colors.areaFillOpacity);
    shown.set(area.id, colour);
    const x = boxX + at.x;
    const y = boxY + at.y;
    const { nameBox } = area;
    return [
      open("g", [["class", "area-name"], ["data-area", area.id]]),
      el("rect", [["x", x + nameBox.x], ["y", y + nameBox.y], ["width", nameBox.width], ["height", nameBox.height], ["fill", hex(colour)]]),
      ...text(area.name, x, y, colors.areaName, pen),
      "</g>",
    ];
  });
  return [open("g", [["class", "area-names"]]), ...names, "</g>"];
}

/** A colour's red, green and blue, from 0 to 255, unrounded. */
type Rgb = readonly number[];

/** A theme colour written as #rrggbb. */
function rgb(colour: string): Rgb {
  const value = Number.parseInt(colour.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** `top` laid over `under` at `opacity`. */
function over(under: Rgb, top: Rgb, opacity: number): Rgb {
  return under.map((part, i) => part * (1 - opacity) + top[i]! * opacity);
}

/** A colour as #rrggbb, each part rounded to the nearest whole number. */
function hex(colour: Rgb): string {
  return `#${colour.map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
}

function card({ card, x: cardX, y: cardY }: PlacedCard<Card>, at: Point, pen: Pen, shadowId: string): string[] {
  const { colors, sizes } = pen.theme;
  const x = cardX + at.x;
  const y = cardY + at.y;
  const { outline } = card;
  const borderWidth = card.status ? sizes.card.statusBorderWidth : sizes.card.borderWidth;
  const stroke: Attrs = [
    ["stroke", card.status ? colors.status[card.status].stroke : colors.cardBorder],
    ["stroke-width", borderWidth],
  ];
  const look: Attrs = [["fill", colors[card.fill]], ...stroke, ["filter", `url(#${shadowId})`]];
  const box = { x, y };
  return [
    open("g", [
      ["class", "card"],
      ["data-id", card.id],
      ["data-kind", card.kind],
      ...statusAttr(card.status),
      ...(card.area === undefined ? [] : ([["data-area", card.area]] as const)),
    ]),
    el("title", [], escapeText(card.tooltip)),
    ...fadedIf(card.status === "removed", pen.theme, [
      outline.kind === "rounded"
        ? el("rect", [
            ["class", "outline"],
            ["x", x + outline.x],
            ["y", y + outline.y],
            ["width", outline.width],
            ["height", outline.height],
            ["rx", outline.radius],
            ...look,
          ])
        : el("path", [["class", "outline"], ["d", `${runs(outline.points, box)} Z`], ...look, ["stroke-linejoin", "round"]]),
      ...(card.marks.length === 0
        ? []
        : [el("path", [["class", "marks"], ["d", card.marks.map((mark) => runs(mark, box)).join(" ")], ["fill", "none"], ...stroke])]),
      // Each divider stops at the inside of the border, so it never paints over a status colour.
      ...card.dividers.map((dividerY) =>
        el("line", [
          ["class", "divider"],
          ["x1", x + outline.x + borderWidth / 2],
          ["y1", y + dividerY],
          ["x2", x + outline.x + outline.width - borderWidth / 2],
          ["y2", y + dividerY],
          ["stroke", colors.divider],
          ["stroke-width", sizes.card.borderWidth],
        ]),
      ),
      ...(card.icon
        ? [
            el("path", [
              ["class", "icon"],
              ["d", iconPath(card.icon.name, x + card.icon.x, y + card.icon.y, card.icon.size)],
              ["fill", "none"],
              ["stroke", colors.icon],
              ["stroke-width", sizes.component.icon.strokeWidth],
              ["stroke-linecap", "round"],
              ["stroke-linejoin", "round"],
            ]),
          ]
        : []),
      ...card.texts.flatMap((t) => text(t, x, y, colors[t.color], pen)),
      ...(card.more ? [open("g", [["class", "more"]]), ...text(card.more, x, y, colors[card.more.color], pen), "</g>"] : []),
    ]),
    // Rows fade themselves, so a removed card's rows aren't faded twice.
    ...card.rows.flatMap((r) => row(r, x, y, pen)),
    // The badge and the tag stay at full strength, so a removed card's REMOVED and its area read clearly.
    ...(card.badge ? badge(card.badge, x, y, pen) : []),
    ...(card.tag ? tag(card.tag, x, y, pen) : []),
    "</g>",
  ];
}

/** An area's tag offset by (x, y): its name in a neutral chip, opaque so the border it sits on doesn't show through. */
function tag(t: Tag, x: number, y: number, pen: Pen): string[] {
  const { colors, sizes } = pen.theme;
  return [
    open("g", [["class", "tag"], ["data-area", t.area]]),
    el("rect", [
      ["x", x + t.x],
      ["y", y + t.y],
      ["width", t.width],
      ["height", t.height],
      ["rx", t.radius],
      ["fill", colors.tagFill],
      ["stroke", colors.tagBorder],
      ["stroke-width", sizes.tag.borderWidth],
    ]),
    ...text(t.word, x, y, colors.tagText, pen),
    "</g>",
  ];
}

/** Path data for straight runs through `points`, offset by `at`. */
function runs(points: readonly Point[], at: Point): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x + at.x)} ${num(p.y + at.y)}`).join(" ");
}

/**
 * One row of a card offset by (x, y), with its own tooltip and data
 * attributes. A row with a status is tinted with its badge's fill and has its
 * badge; a removed row is faded, all but its badge.
 */
function row(r: Row, x: number, y: number, pen: Pen): string[] {
  const { colors, sizes } = pen.theme;
  const tint = r.status
    ? [
        el("rect", [
          ["x", x + r.box.x],
          ["y", y + r.box.y],
          ["width", r.box.width],
          ["height", r.box.height],
          ["rx", sizes.row.tintRadius],
          ["fill", colors.status[r.status].badgeFill],
          ["fill-opacity", colors.rowTintOpacity],
        ]),
      ]
    : [];
  const symbol = r.symbol ? [open("g", [["class", "symbol"]]), ...text(r.symbol, x, y, colors[r.symbol.color], pen), "</g>"] : [];
  return [
    open("g", [["class", "row"], ["data-id", r.id], ["data-kind", r.kind], ...statusAttr(r.status)]),
    el("title", [], escapeText(r.tooltip)),
    ...fadedIf(r.status === "removed", pen.theme, [...tint, ...symbol, ...r.texts.flatMap((t) => text(t, x, y, colors[t.color], pen))]),
    ...(r.badge ? badge(r.badge, x, y, pen) : []),
    "</g>",
  ];
}

function statusAttr(status: Status | undefined): Attrs {
  return status === undefined ? [] : [["data-status", status]];
}

/** Removed parts are drawn faded: wrapped in a see-through group. */
function fadedIf(removed: boolean, theme: Theme, parts: string[]): string[] {
  if (!removed) return parts;
  return [open("g", [["class", "faded"], ["opacity", theme.colors.fadedOpacity]]), ...parts, "</g>"];
}

/** One line of text offset by (x, y), with the lines under and through it when it has them. Records its face. */
function text(t: Omit<TextLine, "color">, x: number, y: number, fill: string, pen: Pen): string[] {
  pen.faces.add(t.face);
  const face = faceStyle(t.face);
  const attrs: Attrs = [
    ["x", x + t.x],
    ["y", y + t.y],
    ["font-family", face.fontFamily],
    ["font-size", t.size],
    ["font-weight", face.weight],
    ...(face.style === "italic" ? ([["font-style", "italic"]] as const) : []),
    ["fill", fill],
    ...(t.anchor === "middle" ? ([["text-anchor", "middle"]] as const) : []),
  ];
  const { sizes } = pen.theme;
  const level = (name: string, { x1, x2, y: lineY }: LevelLine, width: number) =>
    el("line", [
      ["class", name],
      ["x1", x + x1],
      ["y1", y + lineY],
      ["x2", x + x2],
      ["y2", y + lineY],
      ["stroke", fill],
      ["stroke-width", width],
    ]);
  return [
    el("text", attrs, escapeText(t.text)),
    ...(t.underline ? [level("underline", t.underline, sizes.underline.width)] : []),
    ...(t.strike ? [level("strike", t.strike, sizes.strike.width)] : []),
  ];
}

/**
 * A status badge offset by (x, y). An opaque backing in the card colour keeps
 * the border it sits on from showing through a see-through fill.
 */
function badge(b: Badge, x: number, y: number, pen: Pen): string[] {
  const { colors, sizes } = pen.theme;
  const look = colors.status[b.status];
  const box: Attrs = [["x", x + b.x], ["y", y + b.y], ["width", b.width], ["height", b.height], ["rx", b.height / 2]];
  return [
    open("g", [["class", "badge"]]),
    el("rect", [...box, ["fill", colors.cardFill]]),
    el("rect", [
      ...box,
      ["fill", look.badgeFill],
      ...(look.badgeFillOpacity === 1 ? [] : ([["fill-opacity", look.badgeFillOpacity]] as const)),
      ["stroke", look.stroke],
      ["stroke-width", sizes.badge.borderWidth],
    ]),
    ...text(b.word, x, y, look.badgeText, pen),
    "</g>",
  ];
}

/** A note's connector: a thin dotted line in the connector colour, with no arrowhead. */
function connector(c: Connector, points: readonly Point[], at: Point, pen: Pen): string[] {
  const { colors, sizes } = pen.theme;
  const pts = points.map((p) => ({ x: p.x + at.x, y: p.y + at.y }));
  return [
    open("g", [["class", "connector"], ["data-kind", "note"], ["data-from", c.from], ["data-to", c.to]]),
    el("title", [], escapeText(c.tooltip)),
    ...fadedIf(c.faded, pen.theme, [
      el("path", [
        ["d", roundedRoute(pts, sizes.line.cornerRadius, 0)],
        ["fill", "none"],
        ["stroke", colors.connector],
        ["stroke-width", sizes.connector.width],
        ["stroke-dasharray", `${num(sizes.dotted.dash)} ${num(sizes.dotted.gap)}`],
      ]),
    ]),
    "</g>",
  ];
}

function line(line: Line, points: readonly Point[], at: Point, pen: Pen, rooms: Rooms): string[] {
  const { sizes } = pen.theme;
  const pts = points.map((p) => ({ x: p.x + at.x, y: p.y + at.y }));
  const { cornerRadius, arrowLength } = sizes.line;
  const colour = lineColour(line.status, pen.theme);
  const width = line.emphasis ? sizes.line.emphasisWidth : sizes.line.width;
  // Dashed shows an async line, dotted a relationship the database doesn't enforce.
  const dashes = line.pattern === "solid" ? undefined : sizes[line.pattern];
  return [
    open("g", [
      ["class", "line"],
      ["data-id", line.id],
      ["data-kind", line.kind],
      ["data-from", line.from],
      ["data-to", line.to],
      ...statusAttr(line.status),
    ]),
    el("title", [], escapeText(line.tooltip)),
    ...fadedIf(line.status === "removed", pen.theme, [
      el("path", [
        // A line with a filled arrowhead stops short of its end, where the arrowhead's tip is;
        // an open arrowhead has nothing inside it, so the line runs on to its tip.
        ["d", roundedRoute(pts, cornerRadius, line.arrow === "filled" ? arrowLength : 0)],
        ["fill", "none"],
        ["stroke", colour],
        ["stroke-width", width],
        ["stroke-linejoin", "round"],
        ...(dashes ? ([["stroke-dasharray", `${num(dashes.dash)} ${num(dashes.gap)}`]] as const) : []),
      ]),
      ...lineHead(line.arrow, pts, colour, width, pen.theme),
      ...(line.ends
        ? [
            ...lineEnd(pts, "from", line.ends.from, rooms.from, colour, width, pen),
            ...lineEnd(pts, "to", line.ends.to, rooms.to, colour, width, pen),
          ]
        : []),
    ]),
    "</g>",
  ];
}

/** What's drawn where a line meets its `to` card: a filled arrowhead, or an open one in the line's width, solid whatever its pattern. */
function lineHead(arrow: Line["arrow"], points: readonly Point[], colour: string, width: number, theme: Theme): string[] {
  const { arrowLength, arrowWidth } = theme.sizes.line;
  switch (arrow) {
    case "filled":
      return [el("path", [["d", arrowhead(points, arrowLength, arrowWidth)], ["fill", colour]])];
    case "open":
      return [
        el("path", [
          ["d", openArrowhead(points, arrowLength, arrowWidth)],
          ["fill", "none"],
          ["stroke", colour],
          ["stroke-width", width],
          ["stroke-linecap", "round"],
          ["stroke-linejoin", "round"],
        ]),
      ];
    case "none":
      return [];
  }
}

/**
 * A relationship's crow's-foot end, drawn solid whatever the line's pattern,
 * and narrower when another line ends less than `room` px beside it. Its
 * circle, for zero, is hollow: filled with the canvas colour, so the line
 * doesn't show through it.
 */
function lineEnd(
  points: readonly Point[],
  end: "from" | "to",
  cardinality: Cardinality,
  room: number,
  colour: string,
  width: number,
  pen: Pen,
): string[] {
  const { d, circle } = crowsFoot(points, end === "from" ? "start" : "end", cardinality, pen.theme.sizes.crowsFoot, room);
  const stroke: Attrs = [["stroke", colour], ["stroke-width", width]];
  return [
    open("g", [["class", "end"], ["data-end", end], ["data-cardinality", cardinality]]),
    el("path", [["d", d], ["fill", "none"], ...stroke, ["stroke-linejoin", "round"]]),
    ...(circle
      ? [el("circle", [["cx", circle.centre.x], ["cy", circle.centre.y], ["r", circle.radius], ["fill", pen.theme.colors.background], ...stroke])]
      : []),
    "</g>",
  ];
}

/**
 * Every line's label pill, in one layer drawn after all the lines, so a pill
 * covers whatever runs under it: its own line, or another line ELK routed
 * across it (it does that with loops nested on one card).
 */
function lineLabels(lines: readonly RoutedLine<Line>[], at: Point, pen: Pen): string[] {
  const pills = lines.flatMap(({ line, label }) =>
    line.label && label ? [pill(line, line.label, { x: label.x + at.x, y: label.y + at.y }, pen)] : [],
  );
  return pills.length === 0 ? [] : [open("g", [["class", "line-labels"]]), ...pills.flat(), "</g>"];
}

/**
 * A line's label with its top-left corner at `at`: a rounded pill bordered in
 * the line's colour, showing the line's tooltip. A removed line's pill is
 * faded, over an opaque backing in the canvas colour so the lines it covers
 * don't show through.
 */
function pill(line: Line, label: LineLabel, at: Point, pen: Pen): string[] {
  const { colors, sizes } = pen.theme;
  const single = sizes.lineLabel.lineHeight + 2 * sizes.lineLabel.paddingY;
  const removed = line.status === "removed";
  // Fully round on one line; a wrapped label keeps the same corners.
  const box: Attrs = [["x", at.x], ["y", at.y], ["width", label.width], ["height", label.height], ["rx", Math.min(label.height, single) / 2]];
  return [
    open("g", [["class", "line-label"], ["data-line", line.id]]),
    el("title", [], escapeText(line.tooltip)),
    ...(removed ? [el("rect", [...box, ["fill", colors.background]])] : []),
    ...fadedIf(removed, pen.theme, [
      el("rect", [
        ...box,
        ["fill", colors.cardFill],
        ["stroke", lineColour(line.status, pen.theme)],
        ["stroke-width", sizes.lineLabel.borderWidth],
      ]),
      ...label.texts.flatMap((t) => text(t, at.x, at.y, colors[t.color], pen)),
    ]),
    "</g>",
  ];
}

/** A line's status shows by colour only. Unchanged lines look like lines with no status. */
function lineColour(status: Status | undefined, theme: Theme): string {
  return status === undefined || status === "unchanged" ? theme.colors.line : theme.colors.status[status].stroke;
}

/** Rounds a canvas size up to whole pixels, ignoring floating-point noise. */
function wholePixels(value: number): number {
  return Math.ceil(Math.round(value * 100) / 100);
}
