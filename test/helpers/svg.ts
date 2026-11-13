import { DOMParser, type Document, type Element } from "@xmldom/xmldom";
import { readTtf } from "../../scripts/lib/ttf";
import { render } from "../../src/index";

/** Parses SVG text, failing the test on anything that isn't well-formed XML. */
export function parseSvg(svg: string): Document {
  return new DOMParser({
    onError(level, message) {
      throw new Error(`SVG is not well-formed (${level}): ${message}`);
    },
  }).parseFromString(svg, "image/svg+xml");
}

/** Renders a diagram without embedded fonts, as snapshot and structural tests do, and parses the SVG. */
export async function svgDoc(input: object, theme?: "light" | "dark"): Promise<Document> {
  return parseSvg((await render(input, { embedFonts: false, ...(theme ? { theme } : {}) })).svg);
}

export function allElements(root: Document | Element): Element[] {
  return Array.from(root.getElementsByTagName("*"));
}

function byClass(doc: Document, className: string): Element[] {
  return allElements(doc).filter((el) => el.getAttribute("class") === className);
}

export const cards = (doc: Document): Element[] => byClass(doc, "card");
export const lines = (doc: Document): Element[] => byClass(doc, "line");
/** The dotted connectors joining notes to the shapes they're about. */
export const connectors = (doc: Document): Element[] => byClass(doc, "connector");

export function titleOf(el: Element): string | undefined {
  const title = Array.from(el.childNodes).find((n) => n.nodeName === "title");
  return title?.textContent ?? undefined;
}

export function textLines(el: Element): string[] {
  return Array.from(el.getElementsByTagName("text")).map((t) => t.textContent ?? "");
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectBox(rect: Element): Box {
  const num = (name: string) => Number(rect.getAttribute(name));
  return { x: num("x"), y: num("y"), width: num("width"), height: num("height") };
}

/** Elements inside `root` with the given class. */
export function byClassIn(root: Element, className: string): Element[] {
  return allElements(root).filter((el) => el.getAttribute("class") === className);
}

/** The status badge on a card or legend item: the box of its pill. */
export function badgeBox(el: Element): Box | undefined {
  const badge = byClassIn(el, "badge")[0];
  const rect = badge?.getElementsByTagName("rect")[0];
  return rect ? rectBox(rect) : undefined;
}

/** The area tag on a card or legend item: its chip's element and box. */
export function tagOf(el: Element): { tag: Element; box: Box; radius: number } | undefined {
  const tag = byClassIn(el, "tag")[0];
  const rect = tag?.getElementsByTagName("rect")[0];
  return tag && rect ? { tag, box: rectBox(rect), radius: Number(rect.getAttribute("rx") ?? 0) } : undefined;
}

/** The area tag on a card or legend item: the box of its chip. */
export function tagBox(el: Element): Box | undefined {
  return tagOf(el)?.box;
}

/** Everything a card draws on and above its border, as one box: its outline, its badge and its tag. */
export function cardExtent(card: Element): Box {
  const parts = [outlineBox(card), badgeBox(card), tagBox(card)].filter((box) => box !== undefined);
  const x = Math.min(...parts.map((b) => b.x));
  const y = Math.min(...parts.map((b) => b.y));
  return { x, y, width: Math.max(...parts.map((b) => b.x + b.width)) - x, height: Math.max(...parts.map((b) => b.y + b.height)) - y };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length ** 2));
  return Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y);
}

/** How far a point is from a path of straight runs. */
export function distanceToRoute(p: Point, points: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i]!, points[i + 1]!));
  return best;
}

/**
 * How far a point is inside a pill drawn in `box` (rounded ends of radius
 * height / 2): positive inside, 0 on its outline, negative outside.
 */
export function depthInPill(p: Point, box: Box): number {
  const r = box.height / 2;
  const cy = box.y + r;
  return r - distanceToSegment(p, { x: box.x + r, y: cy }, { x: box.x + box.width - r, y: cy });
}

/** Points every half pixel along a path of straight runs, ends included. */
export function alongRuns(points: readonly Point[]): Point[] {
  const found: Point[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i]!, points[i + 1]!];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let s = 0; s <= steps; s++) found.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
  }
  return found;
}

/** Whether two boxes share any area (touching edges don't count). */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export interface Point {
  x: number;
  y: number;
}

export interface PathCommand {
  command: string;
  points: Point[];
}

/** Splits path data into commands with their (absolute) points. */
export function parsePath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  for (const match of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const numbers = (match[2]!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const points: Point[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i]!, y: numbers[i + 1]! });
    commands.push({ command: match[1]!, points });
  }
  return commands;
}

/**
 * A line's stroked route, drawn first, and its arrowhead: the tip, and the
 * middle of the side opposite it. A filled arrowhead is a triangle drawn tip
 * first; an open one, two strokes drawn from one back corner to the tip and on
 * to the other.
 */
export function lineGeometry(line: Element): { route: PathCommand[]; arrowTip: Point; arrowBase: Point } {
  const [route, arrow] = Array.from(line.getElementsByTagName("path"));
  if (!route || !arrow) throw new Error(`line ${line.getAttribute("data-id")} needs a route and an arrowhead`);
  const corners = parsePath(arrow.getAttribute("d")!).map((c) => c.points[0]!);
  const [tip, left, right] = arrow.getAttribute("fill") === "none" ? [corners[1], corners[0], corners[2]] : corners;
  return {
    route: parsePath(route.getAttribute("d")!),
    arrowTip: tip!,
    arrowBase: { x: (left!.x + right!.x) / 2, y: (left!.y + right!.y) / 2 },
  };
}

/** How long the path drawn by path data `d` is: its straight runs and its quadratic corners. */
export function pathLength(d: string): number {
  let length = 0;
  let at: Point | undefined;
  const between = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  for (const { command, points } of parsePath(d)) {
    if (command === "M") at = points[0]!;
    else if (command === "L") {
      length += between(at!, points[0]!);
      at = points[0]!;
    } else if (command === "Q") {
      const [control, end] = [points[0]!, points[1]!];
      const on = (t: number) => ({
        x: (1 - t) ** 2 * at!.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
        y: (1 - t) ** 2 * at!.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y,
      });
      for (let s = 1; s <= 64; s++) length += between(on((s - 1) / 64), on(s / 64));
      at = end;
    } else throw new Error(`can't measure path command ${command}`);
  }
  return length;
}

/** The start and end of a note's connector: its one path, with no arrowhead. */
export function connectorEnds(connector: Element): [Point, Point] {
  return pathEnds(connector.getElementsByTagName("path")[0]!);
}

/**
 * What's drawn at one end of a line: a closed triangle or diamond, drawn tip
 * first, or an open arrow, two strokes meeting at the tip in its middle.
 */
export interface EndMark {
  readonly shape: "triangle" | "diamond" | "open-arrow";
  /** The point that meets the card. */
  readonly tip: Point;
  readonly corners: readonly Point[];
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly dashed: boolean;
  readonly element: Element;
}

/** A line as drawn: its route (its first path), and the mark at each end that has one. A relationship's crow's feet aren't marks. */
export interface LineParts {
  /** The route's points: its start, the corners' control points, its end. */
  readonly route: readonly Point[];
  readonly routeElement: Element;
  readonly dashed: boolean;
  readonly start?: EndMark;
  readonly end?: EndMark;
}

export function lineParts(line: Element): LineParts {
  const [routeElement, ...others] = Array.from(line.getElementsByTagName("path"));
  if (!routeElement) throw new Error(`line ${line.getAttribute("data-id")} has no route`);
  const route = parsePath(routeElement.getAttribute("d")!).flatMap((c) => c.points);
  const crowsFoot = (path: Element) => (path.parentNode as Element | null)?.getAttribute("class") === "end";
  const marks = others.filter((path) => !crowsFoot(path)).map((path): EndMark => {
    const commands = parsePath(path.getAttribute("d")!);
    const corners = commands.flatMap((c) => c.points);
    const closed = commands.at(-1)?.command === "Z";
    if (closed ? corners.length !== 3 && corners.length !== 4 : corners.length !== 3) {
      throw new Error(`line ${line.getAttribute("data-id")} has an end mark of no known shape: ${path.getAttribute("d")}`);
    }
    return {
      shape: !closed ? "open-arrow" : corners.length === 3 ? "triangle" : "diamond",
      tip: closed ? corners[0]! : corners[1]!,
      corners,
      fill: path.getAttribute("fill"),
      stroke: path.getAttribute("stroke"),
      dashed: path.hasAttribute("stroke-dasharray"),
      element: path,
    };
  });
  // Each mark is at the end of the route its tip is nearer.
  const near = (mark: EndMark, p: Point) => Math.hypot(mark.tip.x - p.x, mark.tip.y - p.y);
  const atStart = marks.filter((mark) => near(mark, route[0]!) < near(mark, route.at(-1)!));
  const atEnd = marks.filter((mark) => !atStart.includes(mark));
  if (atStart.length > 1 || atEnd.length > 1) throw new Error(`line ${line.getAttribute("data-id")} has more than one mark at an end`);
  return {
    route,
    routeElement,
    dashed: routeElement.hasAttribute("stroke-dasharray"),
    ...(atStart[0] ? { start: atStart[0] } : {}),
    ...(atEnd[0] ? { end: atEnd[0] } : {}),
  };
}

/**
 * Where a line starts and where it ends: the tip of the mark at each end, or
 * the end of its route where there's none. An ER relationship's route runs
 * right to its tables, its crow's feet drawn over it after.
 */
export function lineEnds(line: Element): [Point, Point] {
  if (line.getAttribute("data-kind") === "relationship") return pathEnds(line.getElementsByTagName("path")[0]!);
  const { route, start, end } = lineParts(line);
  return [start?.tip ?? route[0]!, end?.tip ?? route.at(-1)!];
}

function pathEnds(path: Element): [Point, Point] {
  const points = parsePath(path.getAttribute("d")!).flatMap((c) => c.points);
  return [points[0]!, points.at(-1)!];
}

/** How far a point is outside a box (0 when on its outline or inside it). */
export function distanceOutside(p: Point, box: Box): number {
  const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.width));
  const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

/**
 * Every way the SVG breaks the spec's passive-SVG list or uses a feature the
 * rasteriser can't draw. Empty means it passes.
 */
export function passiveSvgViolations(svg: string): string[] {
  const doc = parseSvg(svg);
  const found: string[] = [];
  const ids = new Set(allElements(doc).map((el) => el.getAttribute("id")).filter((id) => id !== null));

  for (const el of allElements(doc)) {
    if (["a", "script", "foreignObject", "image", "use", "iframe", "object", "embed"].includes(el.localName!)) {
      found.push(`forbidden element <${el.localName}>`);
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === "href" || name.endsWith(":href")) found.push(`forbidden attribute ${attr.name}`);
      if (name.startsWith("on")) found.push(`forbidden event attribute ${attr.name}`);
    }
  }

  for (const [, inner] of svg.matchAll(/url\(\s*([^)]*?)\s*\)/g)) {
    const target = inner!.replace(/^["']|["']$/g, "");
    if (target.startsWith("#")) {
      if (!ids.has(target.slice(1))) found.push(`url(${target}) points at no id in the document`);
    } else if (!target.startsWith("data:font/ttf;base64,")) {
      found.push(`url(${target.slice(0, 40)}) is not a same-document id or an embedded font`);
    }
  }
  for (const style of allElements(doc).filter((el) => el.localName === "style")) {
    const css = style.textContent ?? "";
    const outsideFontFace = css.replace(/@font-face\s*\{[^}]*\}/g, "");
    if (outsideFontFace.includes("url(")) found.push("url() in CSS outside @font-face");
  }

  for (const banned of ["@import", "var(", "color-mix", "font-synthesis", "white-space"]) {
    if (svg.includes(banned)) found.push(`uses ${banned}`);
  }
  return found;
}

const NUMERIC_ATTRIBUTES = new Set([
  "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "d", "points", "viewBox",
  "stroke-width", "font-size", "font-weight", "dx", "dy", "stdDeviation", "opacity", "fill-opacity",
  "stroke-opacity", "flood-opacity",
]);

/** Numbers that don't look like the one formatter's output: at most 2 decimals, no -0, no exponent. */
export function badlyFormattedNumbers(svg: string): string[] {
  const found: string[] = [];
  for (const el of allElements(parseSvg(svg))) {
    for (const attr of Array.from(el.attributes)) {
      if (!NUMERIC_ATTRIBUTES.has(attr.name)) continue;
      for (const [token] of attr.value.matchAll(/-?[\d.]+(?:e[+-]?\d+)?/gi)) {
        if (!/^-?(0|[1-9]\d*)(\.\d?[1-9])?$/.test(token) || token === "-0") {
          found.push(`${el.localName} ${attr.name}="${attr.value.slice(0, 60)}" has ${token}`);
        }
      }
    }
  }
  return found;
}

/** A face as "family weight style", e.g. "Structa Inter 600 normal". */
export type FaceName = string;

export interface FontFaceRule {
  readonly face: FaceName;
  /** The rule's `src` value, exactly as written. */
  readonly src: string;
}

/** The @font-face rules in the SVG's <style> elements, in order. */
export function fontFaceRules(doc: Document): FontFaceRule[] {
  const css = allElements(doc)
    .filter((el) => el.localName === "style")
    .map((el) => el.textContent ?? "")
    .join("\n");
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
    const declarations = new Map<string, string>();
    // A value runs to the next ";" outside url(...) and quotes: the data URL itself contains one.
    for (const [, name, value] of body!.matchAll(/([a-z-]+)\s*:\s*((?:url\([^)]*\)|"[^"]*"|[^;])+?)\s*(?:;|$)/g)) {
      declarations.set(name!, value!);
    }
    const family = (declarations.get("font-family") ?? "").replace(/^"(.*)"$/, "$1");
    return {
      face: `${family} ${declarations.get("font-weight")} ${declarations.get("font-style")}`,
      src: declarations.get("src") ?? "",
    };
  });
}

/**
 * The box each <text> is drawn in: as wide as its characters' advances in the
 * face the SVG embeds for it, from the face's ascender to its descender. The
 * SVG must have been rendered with its fonts embedded.
 */
export function drawnTextBoxes(doc: Document): Map<Element, Box> {
  const fonts = new Map(
    fontFaceRules(doc).map((rule) => [rule.face, readTtf(Buffer.from(/base64,([^"')]+)/.exec(rule.src)![1]!, "base64"))]),
  );
  const boxes = new Map<Element, Box>();
  for (const text of allElements(doc).filter((el) => el.localName === "text")) {
    const family = (text.getAttribute("font-family") ?? "").split(",")[0]!.trim();
    const face = `${family} ${text.getAttribute("font-weight") ?? "400"} ${text.getAttribute("font-style") ?? "normal"}`;
    const font = fonts.get(face);
    if (!font) throw new Error(`no embedded font for ${face}`);
    const size = Number(text.getAttribute("font-size"));
    const scale = size / font.unitsPerEm;
    const width = [...(text.textContent ?? "")].reduce((sum, ch) => sum + (font.advance(ch.codePointAt(0)!) ?? font.missingAdvance), 0) * scale;
    const x = Number(text.getAttribute("x")) - (text.getAttribute("text-anchor") === "middle" ? width / 2 : 0);
    const baseline = Number(text.getAttribute("y"));
    boxes.set(text, { x, y: baseline - font.ascender * scale, width, height: (font.ascender - font.descender) * scale });
  }
  return boxes;
}

/** Each face the SVG's text is drawn in, once, in order of first use. */
export function textFaces(doc: Document): FaceName[] {
  const faces = allElements(doc)
    .filter((el) => el.localName === "text")
    .map((text) => {
      const family = (text.getAttribute("font-family") ?? "").split(",")[0]!.trim().replace(/^"(.*)"$/, "$1");
      return `${family} ${text.getAttribute("font-weight") ?? "400"} ${text.getAttribute("font-style") ?? "normal"}`;
    });
  return [...new Set(faces)];
}

/** A card's drawn outline: the element with class "outline". */
export function outlineOf(card: Element): Element {
  const outline = byClassIn(card, "outline")[0];
  if (!outline) throw new Error(`card ${card.getAttribute("data-id")} has no outline`);
  return outline;
}

/** The corners of a closed outline drawn as a path of straight runs (M, L, …, Z). */
export function polygonOf(path: Element): Point[] {
  const commands = parsePath(path.getAttribute("d") ?? "");
  if (commands.at(-1)?.command !== "Z" || commands.some((c) => !["M", "L", "Z"].includes(c.command))) {
    throw new Error(`not a closed path of straight runs: ${path.getAttribute("d")}`);
  }
  return commands.flatMap((c) => c.points);
}

/** The bounding box of some points. */
export function boundsOf(points: readonly Point[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** The bounding box of a card's outline, whatever its shape. */
export function outlineBox(card: Element): Box {
  const outline = outlineOf(card);
  return outline.localName === "rect" ? rectBox(outline) : boundsOf(polygonOf(outline));
}

/**
 * How far a point is from a card's drawn outline, whatever its shape: a
 * rounded rect (a pill when its corners are half its height) or a closed
 * path of straight runs.
 */
export function distanceToShape(p: Point, card: Element): number {
  const outline = outlineOf(card);
  if (outline.localName === "rect") return Math.abs(roundedRectDepth(p, rectBox(outline), Number(outline.getAttribute("rx") ?? 0)));
  const corners = polygonOf(outline);
  return Math.min(...corners.map((a, i) => distanceToSegment(p, a, corners[(i + 1) % corners.length]!)));
}

/** How far a point is from what's drawn of a card: its outline, whatever its shape, or the badge or tag sitting on it. */
export function distanceToDrawn(p: Point, card: Element): number {
  const badge = badgeBox(card);
  const tag = tagOf(card);
  return Math.min(
    distanceToShape(p, card),
    badge ? Math.abs(depthInPill(p, badge)) : Infinity,
    tag ? Math.abs(roundedRectDepth(p, tag.box, tag.radius)) : Infinity,
  );
}

/** How far a point is inside a card's tag: positive inside, 0 on its outline, negative outside. */
export function depthInTag(p: Point, card: Element): number {
  const tag = tagOf(card);
  if (!tag) throw new Error(`card ${card.getAttribute("data-id")} has no tag`);
  return roundedRectDepth(p, tag.box, tag.radius);
}

/** How far a point is inside a card's drawn outline: positive inside, 0 on it, negative outside. */
export function depthInShape(p: Point, card: Element): number {
  const outline = outlineOf(card);
  if (outline.localName === "rect") return roundedRectDepth(p, rectBox(outline), Number(outline.getAttribute("rx") ?? 0));
  const corners = polygonOf(outline);
  const distance = Math.min(...corners.map((a, i) => distanceToSegment(p, a, corners[(i + 1) % corners.length]!)));
  // Inside a convex polygon, the point is on the same side of every edge.
  const sides = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  });
  const inside = sides.every((s) => s >= 0) || sides.every((s) => s <= 0);
  return inside ? distance : -distance;
}

/** How far a point is inside a rounded rect: positive inside, 0 on its outline, negative outside. */
function roundedRectDepth(p: Point, box: Box, radius: number): number {
  const r = Math.min(radius, box.width / 2, box.height / 2);
  const qx = Math.abs(p.x - (box.x + box.width / 2)) - (box.width / 2 - r);
  const qy = Math.abs(p.y - (box.y + box.height / 2)) - (box.height / 2 - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  return r - outside;
}

export function cardById(doc: Document, id: string): Element {
  const card = cards(doc).find((c) => c.getAttribute("data-id") === id);
  if (!card) throw new Error(`no card with data-id ${id}`);
  return card;
}
