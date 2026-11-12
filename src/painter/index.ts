import type { Status } from "../input";
import type { PlacedCard, RoutedLine, Scene } from "../layout";
import type { Badge, Card, Line, TextLine } from "../shapes";
import { faceStyle } from "../text";
import type { Theme } from "../theme";
import { arrowhead, roundedRoute } from "./route";
import { el, escapeText, num, open, type Attrs } from "./svg";

/** Turns a positioned scene into a passive SVG string. */
export function paint(scene: Scene<Card, Line>, theme: Theme): string {
  const pad = theme.sizes.canvasPadding;
  const width = wholePixels(scene.width + 2 * pad);
  const height = wholePixels(scene.height + 2 * pad);
  // Ids carry the theme name, so a light and a dark SVG inlined in one page can't clash.
  const ids = { grid: `structa-grid-${theme.name}`, shadow: `structa-shadow-${theme.name}` };

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">`,
    ...background(width, height, theme, ids),
    ...scene.cards.flatMap((placed) => card(placed, pad, theme, ids.shadow)),
    ...scene.lines.flatMap((routed) => line(routed, pad, theme)),
    "</svg>",
  ].join("\n") + "\n";
}

function background(width: number, height: number, theme: Theme, ids: { grid: string; shadow: string }): string[] {
  const { colors, sizes } = theme;
  const { spacing, dotRadius } = sizes.grid;
  return [
    "<defs>",
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

function card({ card, x: cardX, y: cardY }: PlacedCard<Card>, pad: number, theme: Theme, shadowId: string): string[] {
  const { colors, sizes } = theme;
  const x = cardX + pad;
  const y = cardY + pad;
  const { outline } = card;
  return [
    open("g", [["class", "card"], ["data-id", card.id], ["data-kind", card.kind], ...statusAttr(card.status)]),
    el("title", [], escapeText(card.tooltip)),
    ...fadedIf(card.status === "removed", theme, [
      el("rect", [
        ["x", x + outline.x],
        ["y", y + outline.y],
        ["width", outline.width],
        ["height", outline.height],
        ["rx", sizes.card.radius],
        ["fill", colors.cardFill],
        ["stroke", card.status ? colors.status[card.status].stroke : colors.cardBorder],
        ["stroke-width", card.status ? sizes.card.statusBorderWidth : sizes.card.borderWidth],
        ["filter", `url(#${shadowId})`],
      ]),
      ...card.texts.flatMap((t) => text(t, x, y, colors[t.color], theme)),
    ]),
    // The badge stays at full strength, so a removed card's REMOVED reads clearly.
    ...(card.badge ? badge(card.badge, x, y, theme) : []),
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

/** One line of text offset by (x, y), and the line through it when it's struck out. */
function text(t: Omit<TextLine, "color">, x: number, y: number, fill: string, theme: Theme): string[] {
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
  const drawn = el("text", attrs, escapeText(t.text));
  if (!t.strike) return [drawn];
  const { x1, x2, y: strikeY } = t.strike;
  return [
    drawn,
    el("line", [
      ["class", "strike"],
      ["x1", x + x1],
      ["y1", y + strikeY],
      ["x2", x + x2],
      ["y2", y + strikeY],
      ["stroke", fill],
      ["stroke-width", theme.sizes.strike.width],
    ]),
  ];
}

/**
 * A status badge offset by (x, y). An opaque backing in the card colour keeps
 * the border it sits on from showing through a see-through fill.
 */
function badge(b: Badge, x: number, y: number, theme: Theme): string[] {
  const { colors, sizes } = theme;
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
    ...text(b.word, x, y, look.badgeText, theme),
    "</g>",
  ];
}

function line({ line, points }: RoutedLine<Line>, pad: number, theme: Theme): string[] {
  const { colors, sizes } = theme;
  const pts = points.map((p) => ({ x: p.x + pad, y: p.y + pad }));
  const { cornerRadius, arrowLength, arrowWidth } = sizes.line;
  const colour = lineColour(line.status, theme);
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
    ...fadedIf(line.status === "removed", theme, [
      el("path", [
        ["d", roundedRoute(pts, cornerRadius, arrowLength)],
        ["fill", "none"],
        ["stroke", colour],
        ["stroke-width", line.emphasis ? sizes.line.emphasisWidth : sizes.line.width],
        ["stroke-linejoin", "round"],
      ]),
      el("path", [["d", arrowhead(pts, arrowLength, arrowWidth)], ["fill", colour]]),
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
