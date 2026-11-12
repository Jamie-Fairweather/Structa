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

/** A line's stroked route and its filled arrowhead tip. */
export function lineGeometry(line: Element): { route: PathCommand[]; arrowTip: Point } {
  const paths = Array.from(line.getElementsByTagName("path"));
  const route = paths.find((p) => p.getAttribute("fill") === "none");
  const arrow = paths.find((p) => p.getAttribute("fill") !== "none");
  if (!route || !arrow) throw new Error(`line ${line.getAttribute("data-id")} needs a route and an arrowhead`);
  return { route: parsePath(route.getAttribute("d")!), arrowTip: parsePath(arrow.getAttribute("d")!)[0]!.points[0]! };
}

/** How far a point is from the outline of a box (0 when exactly on it). */
export function distanceToOutline(p: Point, box: Box): number {
  const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.width));
  const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.height));
  const outside = Math.hypot(dx, dy);
  if (outside > 0) return outside;
  return Math.min(p.x - box.x, box.x + box.width - p.x, p.y - box.y, box.y + box.height - p.y);
}

export function cardById(doc: Document, id: string): Element {
  const card = cards(doc).find((c) => c.getAttribute("data-id") === id);
  if (!card) throw new Error(`no card with data-id ${id}`);
  return card;
}
