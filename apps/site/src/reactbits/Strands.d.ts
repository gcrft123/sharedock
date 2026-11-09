import type { CSSProperties } from "react";

/* Hand-written types for the vendored JS component (React Bits ships the "JavaScript +
 * CSS" variant as .jsx). Vite compiles Strands.jsx at runtime; TypeScript reads this. */
export interface StrandsProps {
  /** Palette cycled across the strands. Pass an empty array for the built-in spectrum. */
  colors?: string[];
  /** Number of strands woven through the animation (1–12). */
  count?: number;
  /** How quickly the strands ripple and flow. */
  speed?: number;
  /** Vertical reach of each strand. */
  amplitude?: number;
  /** Density of the curves along each strand. */
  waviness?: number;
  /** Width of each glowing strand. */
  thickness?: number;
  /** Strength of the luminous bloom around the strands. */
  glow?: number;
  /** How sharply the strands fade toward the horizontal edges. */
  taper?: number;
  /** Separation between strands. */
  spread?: number;
  /** Rotates the colors around the strands. */
  hueShift?: number;
  /** Overall brightness and energy. */
  intensity?: number;
  /** Vibrance; >1 intensifies, <1 fades toward grayscale. */
  saturation?: number;
  /** Overall transparency of the rendered strands. */
  opacity?: number;
  /** Zooms the whole effect in or out. */
  scale?: number;
  /** Renders the strands inside a refractive glass ball. */
  glass?: boolean;
  /** How strongly the glass ball bends light. */
  refraction?: number;
  /** Rainbow separation along the glass edges. */
  dispersion?: number;
  /** Size of the glass ball relative to the canvas. */
  glassSize?: number;
  /** Local edit: when true the render loop early-returns (context stays warm). */
  paused?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function Strands(props: StrandsProps): JSX.Element;
