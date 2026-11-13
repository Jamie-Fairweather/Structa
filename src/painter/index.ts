import type { Cardinality, Status } from "../input";
import type { PlacedArea, PlacedCard, Point, RoutedLine, Scene } from "../layout";
import {
  distanceToBox,
  entry,
  markSize,
  nearest,
  type AreaBox,
  type AreaItem,
  type Badge,
  type Card,
  type Connector,
  type EndMark,
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
import type { Sizes, Theme } from "../theme";
import { iconPath } from "./icons";
import { arrowhead, crowsFoot, diamond, lastRun, openArrowhead, roundedRoute, routeLength } from "./route";
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
  const notes = scene.lines.filter((l): l is RoutedLine<Connector> => l.line.kind === "connector");
  const aimed = aimConnectors(notes, lines, placed, theme.sizes);
  const content = [
    ...(header ? headerText(header, { x: pad, y: headerTop! }, pen) : []),
    // Under everything else in the scene, each parent before the areas inside it.
    ...scene.areas.flatMap((a) => areaBox(a, origin, pen)),
    ...scene.cards.flatMap((p) => card(p, origin, pen, ids.shadow)),
    // Under the lines: a note's connector is an aside, not part of the flow.
    ...notes.flatMap(({ line: l }, i) => connector(l, routed(l, aimed[i]!), origin, pen)),
    ...drawn.flatMap(({ points }, i) => line(lines[i]!, points, origin, pen, rooms[i]!)),
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
 * on, or cut back, until it meets what's drawn: the outline, where the card's
 * landing keeps it clear of the badge and the tag, or else, rather than run
 * across one of them, the badge or the tag.
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

/** A side of a card's box. */
type BoxSide = "top" | "bottom" | "left" | "right";

/**
 * Where each note's connector runs. ELK runs one straight from the note to
 * the shape it's about, ending it wherever it likes on each card's box, even
 * where the badge or the tag is, or right beside another line's end. So each
 * of its ends goes to the nearest point of the stretch its card's landing
 * gives lines on that side of its box, the whole of its bottom being free,
 * at least half the theme's pitch from where ELK ended every other line
 * there and from the connectors' ends placed before it; or, where no point
 * is that far from them, the point furthest from them. Each card was given
 * room for its connectors' ends as well as its lines'. A connector that
 * would still run within half the theme's clearance of any card's badge or
 * tag runs instead between the nearest points it can, at either end, where
 * its card's landing starts or stops, or a corner of its card's box, if any
 * keep it clear of them.
 */
function aimConnectors(
  connectors: readonly RoutedLine<Connector>[],
  lines: readonly RoutedLine<Line>[],
  placed: ReadonlyMap<string, PlacedCard<Card>>,
  sizes: Sizes,
): Point[][] {
  const routes = connectors.map(({ points }) => [...points]);
  // How far along each side of each card's box the ends there are, by the card's id and the side.
  const taken = new Map<string, number[]>();
  const endOn = (p: Point, at: PlacedCard<Card>) => {
    const { side, along } = sideOf(p, at);
    return { key: `${at.card.id} ${side}`, side, along };
  };
  for (const { line: l, points } of lines) {
    for (const [p, id] of [
      [points[0]!, l.from],
      [points.at(-1)!, l.to],
    ] as const) {
      const { key, along } = endOn(p, placed.get(id)!);
      taken.set(key, [...(taken.get(key) ?? []), along]);
    }
  }
  connectors.forEach(({ line: c, points }, i) => {
    for (const [end, id] of [
      ["start", c.from],
      ["end", c.to],
    ] as const) {
      const at = placed.get(id)!;
      const { key, side, along } = endOn(end === "start" ? points[0]! : points.at(-1)!, at);
      const others = taken.get(key) ?? [];
      const spot = freeSpot(along, stretch(at.card, side), others, sizes.landing.pitch / 2);
      setEnd(routes[i]!, end, onSide(at, side, spot));
      taken.set(key, [...others, spot]);
    }
  });
  const margin = sizes.landing.clearance / 2;
  const everyCard = [...placed.values()];
  return routes.map((route, i) => {
    const { line: c } = connectors[i]!;
    const cards = [placed.get(c.from)!, placed.get(c.to)!] as const;
    const clear = (start: Point, end: Point) => {
      const drawn = ontoCards([start, ...route.slice(1, -1), end], ...cards);
      return drawn.every((p, k) => k === 0 || everyCard.every((card) => nearBorderItems(drawn[k - 1]!, p, card) >= margin));
    };
    const [start, end] = [route[0]!, route.at(-1)!];
    if (clear(start, end)) return route;
    // Each pair of places the ends could go, nearest to where they are first; ties in the order listed.
    const moved = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
    const pairs = [start, ...safePlaces(cards[0])].flatMap((a) => [end, ...safePlaces(cards[1])].map((b) => [a, b] as const));
    const best = pairs
      .map((pair, k) => ({ pair, k, cost: moved(pair[0], start) + moved(pair[1], end) }))
      .sort((p, q) => p.cost - q.cost || p.k - q.k)
      .find(({ pair }) => clear(...pair));
    return best ? [best.pair[0], ...route.slice(1, -1), best.pair[1]] : route;
  });
}

/** Which side of its card's box a point on that box is on, and how far along it from the box's top or left. */
function sideOf(p: Point, { card, x, y }: PlacedCard<Card>): { side: BoxSide; along: number } {
  const sides: [BoxSide, number, number][] = [
    ["top", Math.abs(p.y - y), p.x - x],
    ["bottom", Math.abs(p.y - (y + card.height)), p.x - x],
    ["left", Math.abs(p.x - x), p.y - y],
    ["right", Math.abs(p.x - (x + card.width)), p.y - y],
  ];
  const [side, , along] = sides.reduce((best, s) => (s[1] < best[1] ? s : best));
  return { side, along };
}

/** The stretch of a side of a card's box its landing gives lines: all of its bottom, where nothing sits. */
function stretch({ landing, width }: Card, side: BoxSide): readonly [number, number] {
  if (side === "top") return [landing.left, landing.right];
  if (side === "bottom") return [0, width];
  return [landing.top, landing.bottom];
}

/**
 * Where an end ELK put `along` a side goes on the stretch of it from `from`
 * to `to`: the nearest point at least `apart` from each of `others`, the
 * ends already there, or, when there's none, the point furthest from them.
 * Ties go to the nearer to where ELK put it, then the nearer the stretch's start.
 */
function freeSpot(along: number, [from, to]: readonly [number, number], others: readonly number[], apart: number): number {
  const room = (at: number) => Math.min(Number.POSITIVE_INFINITY, ...others.map((other) => Math.abs(other - at)));
  const marks = [from, ...others.filter((other) => other >= from && other <= to).sort((a, b) => a - b), to];
  // Where ELK put it, kept on the stretch, each end of the stretch, `apart` either side of each other end, and midway between neighbours.
  const places = [
    Math.min(Math.max(along, from), to),
    from,
    to,
    ...others.flatMap((other) => [other - apart, other + apart]),
    ...marks.slice(1).map((mark, k) => (marks[k]! + mark) / 2),
  ].filter((at) => at >= from && at <= to);
  const near = (at: number) => Math.abs(at - along);
  const closer = (a: number, b: number) => near(a) < near(b) || (near(a) === near(b) && a < b);
  // Far enough, but for rounding.
  const fits = places.filter((at) => room(at) >= apart - 1e-9);
  if (fits.length > 0) return fits.reduce((best, at) => (closer(at, best) ? at : best));
  return places.reduce((best, at) => (room(at) > room(best) || (room(at) === room(best) && closer(at, best)) ? at : best));
}

/** The point `along` a side of a placed card's box. */
function onSide({ card, x, y }: PlacedCard<Card>, side: BoxSide, along: number): Point {
  if (side === "top") return { x: x + along, y };
  if (side === "bottom") return { x: x + along, y: y + card.height };
  return { x: side === "left" ? x : x + card.width, y: y + along };
}

function setEnd(route: Point[], end: "start" | "end", at: Point): void {
  route[end === "start" ? 0 : route.length - 1] = at;
}

/** Where a connector may end on a card, clear of its badge and tag: where its landing starts and stops on its top and sides, and its box's bottom corners. */
function safePlaces({ card, x, y }: PlacedCard<Card>): Point[] {
  const { left, right, top, bottom } = card.landing;
  return [
    { x: x + left, y },
    { x: x + right, y },
    { x, y: y + top },
    { x, y: y + bottom },
    { x: x + card.width, y: y + top },
    { x: x + card.width, y: y + bottom },
    { x, y: y + card.height },
    { x: x + card.width, y: y + card.height },
  ];
}

/**
 * How close the straight run from `a` to `b` comes to the badge or the tag on
 * a card: 0 where it touches one, and infinitely far when the card has neither.
 */
function nearBorderItems(a: Point, b: Point, { card, x, y }: PlacedCard<Card>): number {
  const boxes = [card.badge, card.tag].flatMap((box) => (box ? [{ x: box.x + x, y: box.y + y, width: box.width, height: box.height }] : []));
  return Math.min(Number.POSITIVE_INFINITY, ...boxes.map((box) => distanceToBox(a, b, box)));
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
 * under one layer of the see-through fill for each box it's in). Layout runs
 * no line under a name, but should one get there, it stops at the name
 * rather than cutting through it.
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
        ["d", roundedRoute(pts, sizes.line.cornerRadius, 0, 0)],
        ["fill", "none"],
        ["stroke", colors.connector],
        ["stroke-width", sizes.connector.width],
        ["stroke-dasharray", `${num(sizes.dotted.dash)} ${num(sizes.dotted.gap)}`],
      ]),
    ]),
    "</g>",
  ];
}

/**
 * A line along `points`, offset by `at`: its route, the mark at each end
 * that has one, or its crow's feet, narrower where `rooms` says another end
 * is close, and the counts beside its ends where ELK put them. Its middle
 * label is drawn later, over all the lines.
 */
function line({ line, sourceLabel, targetLabel }: RoutedLine<Line>, points: readonly Point[], at: Point, pen: Pen, rooms: Rooms): string[] {
  const { sizes } = pen.theme;
  const pts = points.map((p) => ({ x: p.x + at.x, y: p.y + at.y }));
  const endText = (end: "from" | "to", label: LineLabel | undefined, where: Point | undefined) =>
    label && where
      ? [
          open("g", [["class", "end-label"], ["data-end", end]]),
          ...label.texts.flatMap((t) => text(t, where.x + at.x, where.y + at.y, pen.theme.colors[t.color], pen)),
          "</g>",
        ]
      : [];
  const colour = lineColour(line.status, pen.theme);
  const width = line.emphasis ? sizes.line.emphasisWidth : sizes.line.width;
  // Each mark points along the route into its card: the one at `from` along the route run backwards.
  const backwards = [...pts].reverse();
  const from = line.marks.from && fitted(line.marks.from, backwards, sizes);
  const to = line.marks.to && fitted(line.marks.to, pts, sizes);
  // Dashed shows an async, implements or dependency line, dotted a relationship the database doesn't enforce.
  const dashes = line.pattern === "solid" ? undefined : sizes[line.pattern];
  // A dashed line into a triangle is dashed from the triangle back, with a whole dash at it, so lines
  // that join under one triangle dash alike along the stretch they share.
  const offset = (() => {
    if (!dashes || to?.mark !== "hollow-triangle") return undefined;
    const length = routeLength(pts, sizes.line.cornerRadius, routeGap(from), routeGap(to));
    const period = dashes.dash + dashes.gap;
    return (((dashes.dash - length) % period) + period) % period;
  })();
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
        // The route stops where the mark at each end needs it to.
        ["d", roundedRoute(pts, sizes.line.cornerRadius, routeGap(from), routeGap(to))],
        ["fill", "none"],
        ["stroke", colour],
        ["stroke-width", width],
        ["stroke-linejoin", "round"],
        ...(dashes ? ([["stroke-dasharray", `${num(dashes.dash)} ${num(dashes.gap)}`]] as const) : []),
        ...(offset === undefined ? [] : ([["stroke-dashoffset", offset]] as const)),
      ]),
      ...(from ? [endMark(from, backwards, colour, width, pen.theme)] : []),
      ...(to ? [endMark(to, pts, colour, width, pen.theme)] : []),
      ...(line.ends
        ? [
            ...lineEnd(pts, "from", line.ends.from, rooms.from, colour, width, pen),
            ...lineEnd(pts, "to", line.ends.to, rooms.to, colour, width, pen),
          ]
        : []),
      ...endText("from", line.fromLabel, sourceLabel),
      ...endText("to", line.toLabel, targetLabel),
    ]),
    "</g>",
  ];
}

/** A mark at a line's end, `length` along the line and `width` across it. */
interface FittedMark {
  readonly mark: EndMark;
  readonly length: number;
  readonly width: number;
}

/**
 * The mark at the end of `points`, at its theme size, or smaller in
 * proportion where the line's last straight run is shorter: a mark never
 * runs past the line's bend, as on a tight loop from a card to itself.
 */
function fitted(mark: EndMark, points: readonly Point[], sizes: Sizes): FittedMark {
  const { length, width } = markSize(mark, sizes);
  const scale = Math.min(1, lastRun(points) / length);
  return { mark, length: length * scale, width: width * scale };
}

/**
 * How far short of its end a line's route stops for the mark there: at the
 * base of a triangle or the far corner of a diamond, so it never runs
 * through a hollow one, and right up to the tip of an open arrow.
 */
function routeGap(mark: FittedMark | undefined): number {
  return mark === undefined || mark.mark === "open-arrow" ? 0 : mark.length;
}

/**
 * The mark at the last point of `points`, pointing along their last run,
 * solid whatever the line's pattern. A filled arrowhead is filled with the
 * line's colour; the others are outlined in it, as thick as the line, and a
 * hollow one is filled opaque.
 */
function endMark({ mark, length, width: across }: FittedMark, points: readonly Point[], colour: string, width: number, theme: Theme): string {
  const outlined: Attrs = [["stroke", colour], ["stroke-width", width], ["stroke-linejoin", "round"]];
  switch (mark) {
    case "arrow":
      return el("path", [["d", arrowhead(points, length, across)], ["fill", colour]]);
    case "open-arrow":
      return el("path", [
        ["d", openArrowhead(points, length, across)],
        ["fill", "none"],
        ["stroke", colour],
        ["stroke-width", width],
        ["stroke-linecap", "round"],
        ["stroke-linejoin", "round"],
      ]);
    case "hollow-triangle":
      return el("path", [["d", arrowhead(points, length, across)], ["fill", theme.colors.lineEndFill], ...outlined]);
    case "filled-diamond":
    case "hollow-diamond": {
      const fill = mark === "filled-diamond" ? colour : theme.colors.lineEndFill;
      return el("path", [["d", diamond(points, length, across)], ["fill", fill], ...outlined]);
    }
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
