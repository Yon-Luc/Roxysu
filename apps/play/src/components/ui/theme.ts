import type { StyleDesc } from "@gpuix/react";

/** Mirror of the host `BoxShadow` shape (not re-exported from the package root). */
export interface BoxShadow {
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadRadius: number;
  color: string;
}

/**
 * Token-based theme system for the component library.
 *
 * Every value here is a plain GPUIX style primitive (a CSS colour string,
 * a pixel number, or a {@link BoxShadow}). There is no CSS, Tailwind, or
 * class layer — components read these tokens directly.
 */

export const colors = {
  background: "#0c0e12",
  foreground: "#e8eef7",

  card: "#151922",
  cardForeground: "#e8eef7",

  popover: "#151922",
  popoverForeground: "#e8eef7",

  primary: "#7dd3fc",
  primaryForeground: "#0c0e12",

  secondary: "#1d2330",
  secondaryForeground: "#e8eef7",

  muted: "#1d2330",
  mutedForeground: "#8b95a8",

  accent: "#1d2330",
  accentForeground: "#e8eef7",

  destructive: "#ef4444",
  destructiveForeground: "#fafafa",

  success: "#6ee7b7",
  successForeground: "#0c0e12",

  border: "#252b36",
  input: "#252b36",

  ring: "#7dd3fc",
} as const;

export const radius = {
  none: 0,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
} as const;

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const typography = {
  fontSizes: {
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 20,
    "2xl": 24,
    "3xl": 30,
  },
  fontWeights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
  },
} as const;

export const shadows = {
  sm: {
    offsetX: 0,
    offsetY: 1,
    blurRadius: 2,
    spreadRadius: 0,
    color: "rgba(0,0,0,0.4)",
  } satisfies BoxShadow,
  md: {
    offsetX: 0,
    offsetY: 4,
    blurRadius: 12,
    spreadRadius: 0,
    color: "rgba(0,0,0,0.45)",
  } satisfies BoxShadow,
  lg: {
    offsetX: 0,
    offsetY: 12,
    blurRadius: 32,
    spreadRadius: 0,
    color: "rgba(0,0,0,0.55)",
  } satisfies BoxShadow,
  focus: {
    offsetX: 0,
    offsetY: 0,
    blurRadius: 0,
    spreadRadius: 2,
    color: colors.ring,
  } satisfies BoxShadow,
} as const;

export const theme = {
  colors,
  radius,
  spacing,
  typography,
  shadows,
} as const;

export type Theme = typeof theme;
export type ColorToken = keyof typeof colors;
export type RadiusToken = keyof typeof radius;
export type SpacingToken = keyof typeof spacing;
