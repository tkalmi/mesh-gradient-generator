import { Color } from '../types';

const div255 = 1 / 255;

/**
 * Takes a tuple of rgba values and returns a corresponding hex string
 * @param rgba
 * @returns
 */
export function rgbaToHex(rgba: Color): string {
  return `#${rgba
    .slice(0, 3)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Takes a color hex string and returns an rgba tuple
 * @param hex
 * @returns
 */
export function hexToRgb(hex: string): Color {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

/**
 * From: https://gist.github.com/mjackson/5311256
 * Converts an RGB color value to HSL. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes r, g, and b are contained in the set [0, 255] and
 * returns h, s, and l in the set [0, 1].
 *
 * @param rgba RGBA as a vector of 4 numbers in range [0-255]
 * @returns vector of 4 numbers representing HSLA
 */
export function rgbaToHsla(rgba: Color): Color {
  const r = rgba[0] * div255;
  const g = rgba[1] * div255;
  const b = rgba[2] * div255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }

    h /= 6;
  }

  return [h * 360, s * 100, l * 100, rgba[3]];
}

function gammaInv(x: number): number {
  if (x > 0.04045) {
    x = Math.pow((x + 0.055) / 1.055, 2.4);
  } else {
    x = x / 12.92;
  }
  return x;
}

// https://github.com/beenotung/oklab.ts/blob/main/src/oklab.ts
export function rgbaToOklab(rgba: Color): Color {
  // Convert RGB to XYZ
  const r = gammaInv(rgba[0] / 255);
  const g = gammaInv(rgba[1] / 255);
  const b = gammaInv(rgba[2] / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const oklabL = l * +0.2104542553 + m * +0.793617785 + s * -0.0040720468;
  const oklabA = l * +1.9779984951 + m * -2.428592205 + s * +0.4505937099;
  const oklabB = l * +0.0259040371 + m * +0.7827717662 + s * -0.808675766;

  return [oklabL, oklabA, oklabB, rgba[3]];
}
