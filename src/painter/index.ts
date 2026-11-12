import type { PlacedCard, RoutedLine, Scene } from "../layout";
import type { Card, CardText, Line } from "../shapes";
import { FACES, faceStyle, fontDataUrl, type FaceId } from "../text";
import type { Theme } from "../theme";
import { arrowhead, roundedRoute } from "./route";
import { el, escapeText, num, open, type Attrs } from "./svg";

export interface PaintOptions {
  /** Embed the font faces the text is drawn in, as @font-face rules. */
  readonly embedFonts: boolean;
}

/** Turns a positioned scene into a passive SVG string. */
export function paint(scene: Scene<Card, Line>, theme: Theme, options: PaintOptions): string {
  const pad = theme.sizes.canvasPadding;
  const width = wholePixels(scene.width + 2 * pad);
  const height = wholePixels(scene.height + 2 * pad);
  // Ids carry the theme name, so a light and a dark SVG inlined in one page can't clash.
  const ids = { grid: `structa-grid-${theme.name}`, shadow: `structa-shadow-${theme.name}` };
  // Every text element is written through text(), which records its face here.
  const faces = new Set<FaceId>();
  const text = (t: CardText, x: number, y: number) => {
    faces.add(t.face);
    return textElement(t, x, y, theme);
  };

  const content = [
    ...scene.cards.flatMap((placed) => card(placed, pad, theme, ids.shadow, text)),
    ...scene.lines.flatMap((routed) => line(routed, pad, theme)),
  ];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">`,
    ...background(width, height, theme, ids, options.embedFonts ? fontFaces(faces) : []),
    ...content,
    "</svg>",
  ].join("\n") + "\n";
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

type TextWriter = (t: CardText, x: number, y: number) => string;

/** One line of text, its position relative to (x, y). */
function textElement(t: CardText, x: number, y: number, theme: Theme): string {
  const face = faceStyle(t.face);
  const attrs: Attrs = [
    ["x", x + t.x],
    ["y", y + t.y],
    ["font-family", face.fontFamily],
    ["font-size", t.size],
    ["font-weight", face.weight],
    ...(face.style === "italic" ? ([["font-style", "italic"]] as const) : []),
    ["fill", theme.colors[t.color]],
    ...(t.anchor === "middle" ? ([["text-anchor", "middle"]] as const) : []),
  ];
  return el("text", attrs, escapeText(t.text));
}

function card(
  { card, x: cardX, y: cardY }: PlacedCard<Card>,
  pad: number,
  theme: Theme,
  shadowId: string,
  text: TextWriter,
): string[] {
  const { colors, sizes } = theme;
  const x = cardX + pad;
  const y = cardY + pad;
  const texts = card.texts.map((t) => text(t, x, y));
  return [
    open("g", [["class", "card"], ["data-id", card.id], ["data-kind", card.kind]]),
    el("title", [], escapeText(card.tooltip)),
    el("rect", [
      ["x", x],
      ["y", y],
      ["width", card.width],
      ["height", card.height],
      ["rx", sizes.card.radius],
      ["fill", colors.cardFill],
      ["stroke", colors.cardBorder],
      ["stroke-width", sizes.card.borderWidth],
      ["filter", `url(#${shadowId})`],
    ]),
    ...texts,
    "</g>",
  ];
}

function line({ line, points }: RoutedLine<Line>, pad: number, theme: Theme): string[] {
  const { colors, sizes } = theme;
  const pts = points.map((p) => ({ x: p.x + pad, y: p.y + pad }));
  const { width, cornerRadius, arrowLength, arrowWidth } = sizes.line;
  return [
    open("g", [["class", "line"], ["data-id", line.id], ["data-kind", line.kind], ["data-from", line.from], ["data-to", line.to]]),
    el("title", [], escapeText(line.tooltip)),
    el("path", [
      ["d", roundedRoute(pts, cornerRadius, arrowLength)],
      ["fill", "none"],
      ["stroke", colors.line],
      ["stroke-width", width],
      ["stroke-linejoin", "round"],
    ]),
    el("path", [["d", arrowhead(pts, arrowLength, arrowWidth)], ["fill", colors.line]]),
    "</g>",
  ];
}

/** Rounds a canvas size up to whole pixels, ignoring floating-point noise. */
function wholePixels(value: number): number {
  return Math.ceil(Math.round(value * 100) / 100);
}
