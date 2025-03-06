import { Color } from '../types';

const div255 = 1 / 255;

export function rgbaToHex(rgba: Color): string {
  return `#${rgba
    .slice(0, 3)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

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

// https://gist.github.com/avisek/eadfbe7a7a169b1001a2d3affc21052e
export function rgbaToLcha(rgba: Color): Color {
  // Convert RGB to XYZ
  const xyz = (() => {
    let r = rgba[0] / 255;
    let g = rgba[1] / 255;
    let b = rgba[2] / 255;

    if (r > 0.04045) {
      r = Math.pow((r + 0.055) / 1.055, 2.4);
    } else {
      r = r / 12.92;
    }

    if (g > 0.04045) {
      g = Math.pow((g + 0.055) / 1.055, 2.4);
    } else {
      g = g / 12.92;
    }

    if (b > 0.04045) {
      b = Math.pow((b + 0.055) / 1.055, 2.4);
    } else {
      b = b / 12.92;
    }

    r *= 100;
    g *= 100;
    b *= 100;

    // Observer = 2°, Illuminant = D65
    const x = r * 0.4124 + g * 0.3576 + b * 0.1805;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const z = r * 0.0193 + g * 0.1192 + b * 0.9505;

    return [x, y, z];
  })();

  // Convert XYZ to Lab
  const lab = (() => {
    let [x, y, z] = xyz;
    x /= 95.047;
    y /= 100.0;
    z /= 108.883;

    if (x > 0.008856) {
      x = Math.pow(x, 0.333333333);
    } else {
      x = 7.787 * x + 0.137931034;
    }

    if (y > 0.008856) {
      y = Math.pow(y, 0.333333333);
    } else {
      y = 7.787 * y + 0.137931034;
    }

    if (z > 0.008856) {
      z = Math.pow(z, 0.333333333);
    } else {
      z = 7.787 * z + 0.137931034;
    }

    const l = 116 * y - 16;
    const a = 500 * (x - y);
    const b = 200 * (y - z);

    return [l, a, b];
  })();

  // Convert Lab to LCH
  const lch = (() => {
    const [l, a, b] = lab;
    const c = Math.sqrt(Math.pow(a, 2) + Math.pow(b, 2));

    let h = Math.atan2(b, a); //Quadrant by signs
    if (h > 0) {
      h = (h / Math.PI) * 180;
    } else {
      h = 360 - (Math.abs(h) / Math.PI) * 180;
    }

    return [l, c, h];
  })();

  return [...lch, rgba[3]] as Color;
}
