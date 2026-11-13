import type { Status } from "../input";

/**
 * Every theme, light (the default) first. The JSON, render() and the CLI all
 * accept exactly these. ThemeName comes from this list, and COLORS needs an
 * entry for every ThemeName, so a theme can't be left out of either.
 */
export const THEME_NAMES = ["light", "dark"] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

/** How one status looks: GitHub Primer colours. */
export interface StatusColors {
  /** Card borders, lines and their label pills. */
  readonly stroke: string;
  readonly badgeFill: string;
  /** The dark theme lays its badge fill over the card colour at reduced strength. */
  readonly badgeFillOpacity: number;
  readonly badgeText: string;
}

/**
 * Every colour token. Both themes are typed with this one interface, so a
 * token can't be added to one theme and forgotten in the other.
 */
export interface ThemeColors {
  readonly background: string;
  readonly gridDot: string;
  readonly gridDotOpacity: number;
  readonly cardFill: string;
  /** Notes: an aside, filled apart from the cards. */
  readonly noteFill: string;
  readonly cardBorder: string;
  readonly cardShadow: string;
  readonly cardShadowOpacity: number;
  /** The thin lines between a card's sections. */
  readonly divider: string;
  readonly text: string;
  readonly mutedText: string;
  /** A component card's icon. */
  readonly icon: string;
  /** Lines with no status, and unchanged lines. */
  readonly line: string;
  /** A note's dotted line to the shape it's about. */
  readonly connector: string;
  /** How strongly removed cards, rows and lines are drawn. */
  readonly fadedOpacity: number;
  /** How strongly a row with a status is tinted with its badge's fill: less than the badge itself. */
  readonly rowTintOpacity: number;
  /** A card's area tag, and the legend's chips for areas: neutral, as areas have no colours. */
  readonly tagFill: string;
  readonly tagBorder: string;
  readonly tagText: string;
  /**
   * Every area box: one see-through neutral fill, so a box inside another
   * comes out stronger without a colour of its own, and a thin border.
   */
  readonly areaFill: string;
  readonly areaFillOpacity: number;
  readonly areaBorder: string;
  /** The area's name at the top-left of its box. */
  readonly areaName: string;
  readonly status: { readonly [status in Status]: StatusColors };
}

const COLORS: { readonly [name in ThemeName]: ThemeColors } = {
  light: {
    background: "#f4f5f7",
    gridDot: "#8c959f",
    gridDotOpacity: 0.5,
    cardFill: "#ffffff",
    noteFill: "#f6f8fa",
    cardBorder: "#d1d9e0",
    cardShadow: "#1f2328",
    cardShadowOpacity: 0.1,
    divider: "#d1d9e0",
    text: "#1f2328",
    mutedText: "#59636e",
    icon: "#59636e",
    line: "#8c959f",
    connector: "#8c959f",
    fadedOpacity: 0.55,
    rowTintOpacity: 0.45,
    tagFill: "#f6f8fa",
    tagBorder: "#d1d9e0",
    tagText: "#59636e",
    areaFill: "#818b98",
    areaFillOpacity: 0.08,
    areaBorder: "#d1d9e0",
    areaName: "#59636e",
    status: {
      new: { stroke: "#1f883d", badgeFill: "#b9f0c4", badgeFillOpacity: 1, badgeText: "#116329" },
      changed: { stroke: "#bf8700", badgeFill: "#fae17d", badgeFillOpacity: 1, badgeText: "#7d4e00" },
      removed: { stroke: "#cf222e", badgeFill: "#ffcecb", badgeFillOpacity: 1, badgeText: "#a40e26" },
      unchanged: { stroke: "#8c959f", badgeFill: "#eaeef2", badgeFillOpacity: 1, badgeText: "#59636e" },
    },
  },
  dark: {
    background: "#0d1117",
    gridDot: "#6e7681",
    gridDotOpacity: 0.4,
    cardFill: "#161b22",
    noteFill: "#0d1117",
    cardBorder: "#30363d",
    cardShadow: "#010409",
    cardShadowOpacity: 0.5,
    divider: "#30363d",
    text: "#e6edf3",
    mutedText: "#8b949e",
    icon: "#8b949e",
    line: "#6e7681",
    connector: "#6e7681",
    fadedOpacity: 0.5,
    rowTintOpacity: 0.12,
    tagFill: "#21262d",
    tagBorder: "#3d444d",
    tagText: "#8b949e",
    areaFill: "#8b949e",
    areaFillOpacity: 0.07,
    areaBorder: "#30363d",
    areaName: "#8b949e",
    status: {
      new: { stroke: "#3fb950", badgeFill: "#3fb950", badgeFillOpacity: 0.25, badgeText: "#56d364" },
      changed: { stroke: "#d29922", badgeFill: "#d29922", badgeFillOpacity: 0.25, badgeText: "#e3b341" },
      removed: { stroke: "#f85149", badgeFill: "#f85149", badgeFillOpacity: 0.25, badgeText: "#ff7b72" },
      unchanged: { stroke: "#6e7681", badgeFill: "#6e7681", badgeFillOpacity: 0.25, badgeText: "#8b949e" },
    },
  },
};

/** Sizes, radii, font sizes and spacing, shared by both themes. */
export const SIZES = {
  canvasPadding: 32,
  /** Space between the title, the diagram and the legend. */
  sectionGap: 24,
  grid: { spacing: 18, dotRadius: 1 },
  /** The title and description at the top-left, wrapped to `maxWidth`, `gap` apart. */
  header: { titleSize: 18, titleLineHeight: 24, descriptionSize: 13, descriptionLineHeight: 18, gap: 4, maxWidth: 640 },
  card: { radius: 10, borderWidth: 1, statusBorderWidth: 1.5, shadowOffsetY: 1, shadowBlur: 3 },
  /** The status badge: a pill centred on the card's top border, `inset` from its right-hand end. */
  badge: { fontSize: 10, height: 16, paddingX: 6, inset: 12, borderWidth: 1 },
  /**
   * The area tag: the area's name in a chip centred on the card's top border,
   * the badge's inset from its left-hand end and as tall as the badge, at
   * least `gap` from the badge. Its corners are less round than the badge's.
   */
  tag: { fontSize: 10, height: 16, paddingX: 6, radius: 4, gap: 8, borderWidth: 1 },
  /**
   * An area box: its cards and the areas inside it `padding` in from its
   * sides and bottom, and below its name. The name sits `nameTop` below the
   * box's top, `padding` in from its left, with `nameGap` under it. Behind
   * it, `nameMargin` wider each side, it covers whatever runs under it.
   */
  area: { radius: 12, padding: 16, nameSize: 12, nameLineHeight: 16, nameTop: 8, nameGap: 8, nameMargin: 3, borderWidth: 1 },
  /**
   * Each legend item: a short sample of the status's line colour, then its
   * badge; or an area's tag. Items run in rows `itemGap` apart, the rows
   * `rowGap` apart.
   */
  legend: { swatchLength: 20, swatchGap: 6, itemGap: 20, rowGap: 8 },
  /** A line through struck-out text, `rise` font sizes above the baseline. */
  strike: { width: 1.25, rise: 0.3 },
  /** A line under underlined text, such as a static class member, `drop` font sizes below the baseline. */
  underline: { width: 1, drop: 0.15 },
  line: { width: 1.5, emphasisWidth: 3, cornerRadius: 8, arrowLength: 9, arrowWidth: 9 },
  /** Dashed lines, such as async ones: dashes `dash` px long, `gap` px apart. */
  dashed: { dash: 6, gap: 4 },
  /** A note's connector: thinner than a line, in `dash` px dots `gap` px apart. */
  connector: { width: 1, dash: 2, gap: 3 },
  /** A line's label: text in a pill bordered in the line's colour, wrapped to `maxWidth`. */
  lineLabel: { fontSize: 12, lineHeight: 16, paddingX: 8, paddingY: 2, maxWidth: 180, borderWidth: 1 },
  /**
   * Class cards: one standard width, any stereotype line, the name and the
   * description centred at the top, then each section of rows under a divider.
   */
  classCard: {
    width: 360,
    paddingX: 14,
    paddingY: 12,
    stereotypeSize: 12,
    stereotypeLineHeight: 16,
    nameSize: 15,
    nameLineHeight: 20,
    descriptionSize: 12,
    descriptionLineHeight: 16,
    descriptionGap: 2,
    sectionPaddingY: 6,
  },
  /**
   * A card's rows, such as class members. A row with a status is tinted, inset
   * `tintInset` from the card's sides and `tintGap` apart from the next row's
   * tint, with its badge `badgeGap` after its text.
   */
  row: { fontSize: 12, lineHeight: 18, paddingY: 4, tintInset: 6, tintGap: 2, tintRadius: 4, badgeGap: 8 },
  /** The label of every flowchart shape but a note. */
  shapeText: { fontSize: 14, lineHeight: 20 },
  /** A shape's or note's description: muted text under its label, `gap` below it. */
  shapeDescription: { fontSize: 12, lineHeight: 16, gap: 2 },
  /*
   * Each flowchart shape below wraps its text to fit `maxWidth`, with the
   * padding round it, and sizes to the text between `minWidth` and `maxWidth`.
   */
  step: { paddingX: 16, paddingY: 12, minWidth: 120, maxWidth: 240, minHeight: 44 },
  /** Start and end: a pill. Its ends are rounded up to `maxRadius`, so many lines of text don't need huge ends. */
  terminal: { paddingX: 20, paddingY: 12, minWidth: 100, maxWidth: 240, minHeight: 44, maxRadius: 32 },
  /** A diamond `aspect` times as wide as tall round its padded text, which wraps at half `maxWidth`. */
  decision: { paddingX: 8, paddingY: 4, minWidth: 120, maxWidth: 280, minHeight: 64, aspect: 2 },
  /** A box leaning right: its top edge sits `slant` px right of its bottom edge. */
  io: { paddingX: 16, paddingY: 12, minWidth: 120, maxWidth: 260, minHeight: 44, slant: 14 },
  /** A box with an upright bar `barInset` px inside each side; the text sits between the bars. */
  subprocess: { paddingX: 14, paddingY: 12, minWidth: 140, maxWidth: 260, minHeight: 44, barInset: 10, radius: 4 },
  /** An aside: its label smaller and lighter than a shape's, its bottom-right corner folded over by `fold` px. */
  note: { fontSize: 13, lineHeight: 18, paddingX: 12, paddingY: 10, minWidth: 100, maxWidth: 220, minHeight: 38, fold: 10 },
  /**
   * An architecture diagram's component card, sized to its text between
   * `minWidth` and `maxWidth`. At its top, its icon, `size` px square and
   * drawn in lines `strokeWidth` wide, then `gap` after it its kind word, in a
   * muted line; then its label `labelGap` under that, and any description
   * `gap` under the label, each centred.
   */
  component: {
    paddingX: 16,
    paddingY: 12,
    minWidth: 140,
    maxWidth: 260,
    icon: { size: 14, gap: 5, strokeWidth: 1.25 },
    kindWord: { fontSize: 11, lineHeight: 16 },
    label: { fontSize: 14, lineHeight: 20 },
    labelGap: 2,
    description: { fontSize: 12, lineHeight: 16, gap: 2 },
  },
} as const;

export type Sizes = typeof SIZES;

export interface Theme {
  readonly name: ThemeName;
  readonly colors: ThemeColors;
  readonly sizes: Sizes;
}

export function getTheme(name: ThemeName): Theme {
  return { name, colors: COLORS[name], sizes: SIZES };
}
