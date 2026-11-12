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
  readonly cardBorder: string;
  readonly cardShadow: string;
  readonly cardShadowOpacity: number;
  /** The thin lines between a card's sections. */
  readonly divider: string;
  readonly text: string;
  readonly mutedText: string;
  /** Lines with no status, and unchanged lines. */
  readonly line: string;
  /** How strongly removed cards, rows and lines are drawn. */
  readonly fadedOpacity: number;
  readonly status: { readonly [status in Status]: StatusColors };
}

const COLORS: { readonly [name in ThemeName]: ThemeColors } = {
  light: {
    background: "#f4f5f7",
    gridDot: "#8c959f",
    gridDotOpacity: 0.5,
    cardFill: "#ffffff",
    cardBorder: "#d1d9e0",
    cardShadow: "#1f2328",
    cardShadowOpacity: 0.1,
    divider: "#d1d9e0",
    text: "#1f2328",
    mutedText: "#59636e",
    line: "#8c959f",
    fadedOpacity: 0.55,
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
    cardBorder: "#30363d",
    cardShadow: "#010409",
    cardShadowOpacity: 0.5,
    divider: "#30363d",
    text: "#e6edf3",
    mutedText: "#8b949e",
    line: "#6e7681",
    fadedOpacity: 0.5,
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
  /** Each legend item: a short sample of the status's line colour, then its badge. */
  legend: { swatchLength: 20, swatchGap: 6, itemGap: 20 },
  /** A line through struck-out text, `rise` font sizes above the baseline. */
  strike: { width: 1.25, rise: 0.3 },
  line: { width: 1.5, emphasisWidth: 3, cornerRadius: 8, arrowLength: 9, arrowWidth: 9 },
  /** A line's label: text in a pill bordered in the line's colour, wrapped to `maxWidth`. */
  lineLabel: { fontSize: 12, lineHeight: 16, paddingX: 8, paddingY: 2, maxWidth: 180, borderWidth: 1 },
  /** Class cards: one standard width, the name centred at the top, then each section of rows under a divider. */
  classCard: { width: 360, paddingX: 14, paddingY: 12, nameSize: 15, nameLineHeight: 20, sectionPaddingY: 6 },
  /** A card's rows, such as class members. A row's tint is inset from the card's sides by `tintInset`. */
  row: { fontSize: 12, lineHeight: 18, paddingY: 3, tintInset: 6, tintRadius: 4 },
  step: {
    fontSize: 14,
    lineHeight: 20,
    paddingX: 16,
    paddingY: 12,
    minWidth: 120,
    maxWidth: 240,
    minHeight: 44,
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
