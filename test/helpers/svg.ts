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

export function cardById(doc: Document, id: string): Element {
  const card = cards(doc).find((c) => c.getAttribute("data-id") === id);
  if (!card) throw new Error(`no card with data-id ${id}`);
  return card;
}
