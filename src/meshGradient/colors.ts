import { Color, ColorModel, ParametricValues } from '../types';

/**
 * Get linear interpolation between two 8-bit color values.
 * @param t float from 0 to 1
 * @param a color value a
 * @param b color value b
 * @returns interpolated color value at t
 */
function lerpWord8(t: number, a: number, b: number): number {
  return Math.floor(t * (b - a) + a);
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
    lerpWord8(t, color1[0], color2[0]),
    lerpWord8(t, color1[1], color2[1]),
    lerpWord8(t, color1[2], color2[2]),
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

const refX = 0.95047; // D65 reference white
const refY = 1.0; // D65 reference white
const refZ = 1.08883; // D65 reference white
/**
 * Precomputed divisions. I haven't benchmarked whether precomputing divisions
 * makes an actual positive impact, but it shouldn't hurt either.
 */
const div116 = 1 / 116;
const div30 = 1 / 30;
const div180 = 1 / 180;
const div7787 = 1 / 7.787;
const div24 = 1 / 2.4;
/**
 * If we use ImageData to populate canvas pixels, we need to convert colors to RGBA model.
 */
export const convertToColorModelFunctions: Record<
  ColorModel,
  (color: Color) => Color
> = {
  rgba: (color: Color) => color,
  hsla: (color: Color) => {
    // https://stackoverflow.com/a/44134328
    const l = color[2] * 0.01;
    const a = color[1] * Math.min(l, 1 - l) * 0.01;
    const f = (n: number) => {
      const k = (n + color[0] * div30) % 12;
      const value = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * value);
    };
    return [f(0), f(8), f(4), color[3]];
  },
  lcha: (color: Color) => {
    // Convert LCH to Lab
    const radH = color[2] * Math.PI * div180; // Convert degrees to radians
    const a = Math.cos(radH) * color[1];
    let b = Math.sin(radH) * color[1];

    // Convert Lab to XYZ
    const y = (color[0] + 16) * div116;
    const x = a * 0.002 + y;
    const z = y - b * 0.005;

    const [X, Y, Z] = [x, y, z].map((v) =>
      v > 0.206893034 ? v ** 3 : (v - 16 * div116) * div7787
    );

    const [xr, yr, zr] = [X * refX, Y * refY, Z * refZ];

    // Convert XYZ to linear RGB
    const r = xr * 3.2406 + yr * -1.5372 + zr * -0.4986;
    const g = xr * -0.9689 + yr * 1.8758 + zr * 0.0415;
    b = xr * 0.0557 + yr * -0.204 + zr * 1.057;

    // Apply gamma correction
    const gammaCorrect = (c: number) =>
      c <= 0.0031308 ? 12.92 * c : 1.055 * c ** div24 - 0.055;

    const rgba = [gammaCorrect(r), gammaCorrect(g), gammaCorrect(b)]
      .map((value) => Math.max(0, Math.min(255, value * 255)))
      .concat(color[3]) as Color;

    return rgba;
  },
} as const;

export const colorToStringFuncs: Record<ColorModel, (color: Color) => string> =
  {
    rgba: (color: Color) =>
      `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`,
    hsla: (color: Color) =>
      `hsla(${color[0]}, ${color[1]}%, ${color[2]}%, ${color[3] / 255})`,
    lcha: (color: Color) =>
      `lch(${color[0]}% ${color[1]} ${color[2]} / ${color[3]})`,
  } as const;
