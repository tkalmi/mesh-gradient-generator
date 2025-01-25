import { Color, ColorModel, ParametricValues } from '../types';

/**
 * Get linear interpolation between two numbers.
 * @param t float from 0 to 1
 * @param a value a
 * @param b value b
 * @returns interpolated value at t
 */
function lerp(t: number, a: number, b: number): number {
  return t * (b - a) + a;
}

/**
 * Get linear interpolation between two colors.
 * @param t float from 0 to 1
 * @param color1 color value a
 * @param color2 color value b
 * @returns interpolated color value at t
 */
function lerpColor(t: number, color1: Color, color2: Color): Color {
  return [
    lerp(t, color1[0], color2[0]),
    lerp(t, color1[1], color2[1]),
    lerp(t, color1[2], color2[2]),
    255, // lerpWord8(t, color1[0], color2[0]), // Disabled alpha channel for now
  ];
}

/**
 * Perform bilinear interpolation between four colors.
 * @param parametricValues Colors at the corners of the patch
 * @param dx U coordinate
 * @param dy V coordinate
 * @returns interpolated color at UV coordinates
 */
export function bilinearPixelInterpolation(
  parametricValues: ParametricValues<Color>,
  dx: number,
  dy: number
): Color {
  const { northValue, southValue, eastValue, westValue } = parametricValues;

  const colorTop = lerpColor(dx, northValue, eastValue); // Interpolate top (north-east) color
  const colorBottom = lerpColor(dx, westValue, southValue); // Interpolate bottom (west-south) color

  return lerpColor(dy, colorTop, colorBottom); // Interpolate between top and bottom colors
}

export const colorToStringFuncs: Record<ColorModel, (color: Color) => string> =
  {
    rgba: (color: Color) =>
      `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`,
    hsla: (color: Color) =>
      `hsla(${color[0]}, ${color[1]}%, ${color[2]}%, ${color[3] / 255})`,
    lcha: (color: Color) =>
      `lch(${color[0]}% ${color[1]} ${color[2]} / ${color[3]})`,
  } as const;
