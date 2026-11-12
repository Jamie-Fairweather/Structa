import type { Scene } from "../layout";
import type { Card } from "../shapes";
import { faceStyle } from "../text";
import type { Theme } from "../theme";
import { el, escapeText, num, open } from "./svg";

/** Turns a positioned scene into a passive SVG string. */
export function paint(scene: Scene<Card>, theme: Theme): string {
  const { colors, sizes } = theme;
  const pad = sizes.canvasPadding;
  const width = wholePixels(scene.width + 2 * pad);
  const height = wholePixels(scene.height + 2 * pad);
  // Ids carry the theme name, so a light and a dark SVG inlined in one page can't clash.
  const gridId = `structa-grid-${theme.name}`;
  const shadowId = `structa-shadow-${theme.name}`;
  const { spacing, dotRadius } = sizes.grid;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">`,
    "<defs>",
    el(
      "pattern",
      [["id", gridId], ["width", spacing], ["height", spacing], ["patternUnits", "userSpaceOnUse"]],
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
      [["id", shadowId], ["x", "-20%"], ["y", "-30%"], ["width", "140%"], ["height", "170%"]],
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
    el("rect", [["width", width], ["height", height], ["fill", `url(#${gridId})`]]),
  ];

  for (const { card, x: cardX, y: cardY } of scene.cards) {
    const x = cardX + pad;
    const y = cardY + pad;
    parts.push(
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
    );
    for (const t of card.texts) {
      const face = faceStyle(t.face);
      parts.push(
        el(
          "text",
          [
            ["x", x + t.x],
            ["y", y + t.y],
            ["font-family", face.fontFamily],
            ["font-size", t.size],
            ["font-weight", face.weight],
            ...(face.style === "italic" ? ([["font-style", "italic"]] as const) : []),
            ["fill", colors[t.color]],
            ...(t.anchor === "middle" ? ([["text-anchor", "middle"]] as const) : []),
          ],
          escapeText(t.text),
        ),
      );
    }
    parts.push("</g>");
  }

  parts.push("</svg>");
  return parts.join("\n") + "\n";
}

/** Rounds a canvas size up to whole pixels, ignoring floating-point noise. */
function wholePixels(value: number): number {
  return Math.ceil(Math.round(value * 100) / 100);
}
