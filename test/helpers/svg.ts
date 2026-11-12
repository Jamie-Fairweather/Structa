import { DOMParser, type Document, type Element } from "@xmldom/xmldom";

/** Parses SVG text, failing the test on anything that isn't well-formed XML. */
export function parseSvg(svg: string): Document {
  return new DOMParser({
    onError(level, message) {
      throw new Error(`SVG is not well-formed (${level}): ${message}`);
    },
  }).parseFromString(svg, "image/svg+xml");
}

export function allElements(root: Document | Element): Element[] {
  return Array.from(root.getElementsByTagName("*"));
}

function byClass(doc: Document, className: string): Element[] {
  return allElements(doc).filter((el) => el.getAttribute("class") === className);
}

export const cards = (doc: Document): Element[] => byClass(doc, "card");
export const lines = (doc: Document): Element[] => byClass(doc, "line");

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

/** The outline box of a card: its first rect. */
export function cardBox(card: Element): Box {
  const rect = card.getElementsByTagName("rect")[0];
  if (!rect) throw new Error(`card ${card.getAttribute("data-id")} has no rect`);
  const num = (name: string) => Number(rect.getAttribute(name));
  return { x: num("x"), y: num("y"), width: num("width"), height: num("height") };
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
 * A line's stroked route and its filled arrowhead (a triangle drawn tip first):
 * the tip, and the middle of the side opposite it.
 */
export function lineGeometry(line: Element): { route: PathCommand[]; arrowTip: Point; arrowBase: Point } {
  const paths = Array.from(line.getElementsByTagName("path"));
  const route = paths.find((p) => p.getAttribute("fill") === "none");
  const arrow = paths.find((p) => p.getAttribute("fill") !== "none");
  if (!route || !arrow) throw new Error(`line ${line.getAttribute("data-id")} needs a route and an arrowhead`);
  const [tip, left, right] = parsePath(arrow.getAttribute("d")!).map((c) => c.points[0]!);
  return {
    route: parsePath(route.getAttribute("d")!),
    arrowTip: tip!,
    arrowBase: { x: (left!.x + right!.x) / 2, y: (left!.y + right!.y) / 2 },
  };
}

/** How far a point is outside a box (0 when on its outline or inside it). */
export function distanceOutside(p: Point, box: Box): number {
  const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.width));
  const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

/** How far a point is from the outline of a box (0 when exactly on it). */
export function distanceToOutline(p: Point, box: Box): number {
  const outside = distanceOutside(p, box);
  if (outside > 0) return outside;
  return Math.min(p.x - box.x, box.x + box.width - p.x, p.y - box.y, box.y + box.height - p.y);
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

export function cardById(doc: Document, id: string): Element {
  const card = cards(doc).find((c) => c.getAttribute("data-id") === id);
  if (!card) throw new Error(`no card with data-id ${id}`);
  return card;
}
