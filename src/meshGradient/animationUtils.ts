import { Color, Vec2 } from '../types';

// Simple noise function to create smooth motion.
export function noise2D(x: number, y: number, seed: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;

  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  const topRight = (X + Y * 57 + seed * 131) * 6;
  const topLeft = (X + 1 + Y * 57 + seed * 131) * 6;
  const bottomRight = (X + (Y + 1) * 57 + seed * 131) * 6;
  const bottomLeft = (X + 1 + (Y + 1) * 57 + seed * 131) * 6;

  const u = fade(xf);
  const v = fade(yf);

  // Enhanced oscillation to make animation more visible
  const a = lerp(
    Math.sin(topRight + seed) * 0.5 + 0.5,
    Math.sin(topLeft + seed) * 0.5 + 0.5,
    u
  );
  const b = lerp(
    Math.sin(bottomRight + seed) * 0.5 + 0.5,
    Math.sin(bottomLeft + seed) * 0.5 + 0.5,
    u
  );

  return lerp(a, b, v);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Animate a point with smooth random motion - enhanced for visible movement
export function animatePoint(
  point: Vec2,
  time: number,
  seed: number,
  amplitude: number = 3
): Vec2 {
  const [x, y] = point;

  // Use smoother motion with multiple sine waves
  const timeOffset = time * 0.3;
  const noiseX =
    Math.sin(timeOffset + seed * 0.1) *
    Math.cos(timeOffset * 0.5 + seed * 0.2) *
    amplitude;
  const noiseY =
    Math.cos(timeOffset + seed * 0.3) *
    Math.sin(timeOffset * 0.7 + seed * 0.4) *
    amplitude;

  return [x + noiseX, y + noiseY];
}

// Keep the animateColor function for compatibility
export function animateColor(
  color: Color,
  time: number,
  seed: number,
  amplitude: number = 15
): Color {
  const [r, g, b, a] = color;

  const timeOffset = time * 0.5;
  const noiseR = Math.sin(timeOffset + seed * 0.1) * amplitude;
  const noiseG = Math.sin(timeOffset + seed * 0.1 + 2) * amplitude;
  const noiseB = Math.sin(timeOffset + seed * 0.1 + 4) * amplitude;

  return [
    Math.max(0, Math.min(255, r + noiseR)),
    Math.max(0, Math.min(255, g + noiseG)),
    Math.max(0, Math.min(255, b + noiseB)),
    a,
  ];
}
