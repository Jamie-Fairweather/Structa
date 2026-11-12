/**
 * Every theme, light (the default) first. The JSON, render() and the CLI all
 * accept exactly these. ThemeName comes from this list, and COLORS needs an
 * entry for every ThemeName, so a theme can't be left out of either.
 */
export const THEME_NAMES = ["light", "dark"] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

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
  readonly text: string;
  readonly mutedText: string;
  readonly line: string;
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
    text: "#1f2328",
    mutedText: "#59636e",
    line: "#8c959f",
  },
  dark: {
    background: "#0d1117",
    gridDot: "#6e7681",
    gridDotOpacity: 0.4,
    cardFill: "#161b22",
    cardBorder: "#30363d",
    cardShadow: "#010409",
    cardShadowOpacity: 0.5,
    text: "#e6edf3",
    mutedText: "#8b949e",
    line: "#6e7681",
  },
};

/** Sizes, radii, font sizes and spacing, shared by both themes. */
export const SIZES = {
  canvasPadding: 32,
  grid: { spacing: 18, dotRadius: 1 },
  card: { radius: 10, borderWidth: 1, shadowOffsetY: 1, shadowBlur: 3 },
  line: { width: 1.5, cornerRadius: 8, arrowLength: 9, arrowWidth: 9 },
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
