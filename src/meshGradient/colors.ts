import { ParametricValues, RGBA } from '../types';

/**
 * Get linear interpolation between two 8-bit color values.
 * @param t float from 0 to 1
 * @param a color value a
 * @param b color value b
 * @returns interpolated color value at t
 */
function lerpWord8(t: number, a: number, b: number): number {
  return Math.floor((1 - t) * a + t * b);
}

/**
 * Get linear interpolation between two RGBA colors.
 * @param t float from 0 to 1
 * @param color1 color value a
 * @param color2 color value b
 * @returns interpolated color value at t
 */
function lerpColor(t: number, color1: RGBA, color2: RGBA): RGBA {
  return {
    r: lerpWord8(t, color1.r, color2.r),
    g: lerpWord8(t, color1.g, color2.g),
    b: lerpWord8(t, color1.b, color2.b),
    a: 255, //lerpWord8(t, color1.a, color2.a), // Disabled alpha channel for now.
  };
}

/**
 * Perform bilinear interpolation between four colors.
 * TODO: Other color spaces than RGBA
 * @param parametricValues Colors at the corners of the patch
 * @param dx U coordinate
 * @param dy V coordinate
 * @returns interpolated color at UV coordinates
 */
export function bilinearPixelInterpolation(
  parametricValues: ParametricValues<RGBA>,
  dx: number,
  dy: number
): RGBA {
  const { northValue, southValue, eastValue, westValue } = parametricValues;

  const colorTop = lerpColor(dx, northValue, eastValue); // Interpolate top (north-east) color
  const colorBottom = lerpColor(dx, westValue, southValue); // Interpolate bottom (west-south) color

  return lerpColor(dy, colorTop, colorBottom); // Interpolate between top and bottom colors
}
