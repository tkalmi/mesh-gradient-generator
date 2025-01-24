import {
  Color,
  CubicBezier,
  ForwardDifferenceCoefficient,
  ParametricValues,
  Vec2,
} from '../types';
import { bilinearPixelInterpolation } from './colors';

function halveFDCoefficients(
  coeff: ForwardDifferenceCoefficient
): ForwardDifferenceCoefficient {
  const cPrime = coeff.fdC * 0.125;
  const bPrime = coeff.fdB * 0.25 - cPrime;
  const aPrime = (coeff.fdA - bPrime) * 0.5;

  return { fdA: aPrime, fdB: bPrime, fdC: cPrime };
}

export function halveFDCoefficientsVec2(
  coeffs: Vec2<ForwardDifferenceCoefficient>
): Vec2<ForwardDifferenceCoefficient> {
  return [halveFDCoefficients(coeffs[0]), halveFDCoefficients(coeffs[1])];
}

/**
 * Get the mantissa and exponent of a number
 * @param value number to decompose
 * @returns [mantissa, exponent]
 */
function frExp(value: number): [number, number] {
  if (value === 0) {
    return [0, 0];
  }
  const exponent = Math.floor(Math.log2(Math.abs(value))) + 1;
  const mantissa = value / 2 ** exponent;
  return [mantissa, exponent];
}

/**
 * Get squared distance between two points
 * @param p1 point 1
 * @param p2 point 2
 * @returns squared distance between p1 and p2
 */
function squaredDistance(p1: Vec2, p2: Vec2): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return dx * dx + dy * dy;
}

/**
 * Get estimated forward difference step count
 * @param curve
 * @returns
 */
export function estimateFDStepCount(curve: CubicBezier): number {
  const [p0, p1, p2, p3] = curve;
  const distances = [
    squaredDistance(p0, p1),
    squaredDistance(p2, p3),
    squaredDistance(p0, p2) / 4,
    squaredDistance(p1, p3) / 4,
  ];
  function toInt(value: number): number {
    const [, exponent] = frExp(Math.max(1, value * 18));
    return Math.floor((exponent + 1) / 2);
  }

  return toInt(Math.max(...distances));
}

/**
 * Iterates given function for the initial value iterCount many times.
 * @param iterCount how many times we want func to run
 * @param func func to run on initialValue
 * @param initialValue value to run through func iterCount many times
 * @returns initialValue after it's been ran through func iterCount many times
 */
export function fixIter<T>(
  iterCount: number,
  func: (x: T) => T,
  initialValue: T
): T {
  function go(remaining: number, value: T): T {
    if (remaining === 0) {
      return value;
    }
    return go(remaining - 1, func(value));
  }

  return go(iterCount, initialValue);
}

export function bezierToFDCoeff(
  curve: CubicBezier
): Vec2<ForwardDifferenceCoefficient> {
  const [x, y, z, w] = curve;

  const ax = w[0] - x[0];
  const ay = w[1] - x[1];

  const bx = (w[0] - z[0] * 2 + y[0]) * 6;
  const by = (w[1] - z[1] * 2 + y[1]) * 6;

  const cx = (w[0] - z[0] * 3 + y[0] * 3 - x[0]) * 6;
  const cy = (w[1] - z[1] * 3 + y[1] * 3 - x[1]) * 6;

  const xCoeffs: ForwardDifferenceCoefficient = { fdA: ax, fdB: bx, fdC: cx };
  const yCoeffs: ForwardDifferenceCoefficient = { fdA: ay, fdB: by, fdC: cy };

  return [xCoeffs, yCoeffs];
}

function updateForwardDifferencing(
  coeff: ForwardDifferenceCoefficient
): ForwardDifferenceCoefficient {
  return {
    fdA: coeff.fdA + coeff.fdB,
    fdB: coeff.fdB + coeff.fdC,
    fdC: coeff.fdC,
  };
}

function advancePoint(v: number, coeff: ForwardDifferenceCoefficient): number {
  return v + coeff.fdA;
}

export function updatePointsAndCoeff(
  points: Vec2[],
  coeffs: ForwardDifferenceCoefficient[][]
): [Vec2[], ForwardDifferenceCoefficient[][]] {
  const updatedPoints = points.map((p, i) => {
    const c = coeffs[i];
    return p.map((value: number, j: number) => {
      return advancePoint(value, c[j]);
    }) as Vec2<number>;
  });

  const updatedCoeffs = coeffs.map((c) =>
    c.map((coeff) => updateForwardDifferencing(coeff))
  );

  return [updatedPoints, updatedCoeffs];
}

export function renderCubicBezier(
  source: ParametricValues<Color>,
  curve: CubicBezier,
  uStart: number,
  vStart: number,
  uEnd: number,
  vEnd: number,
  pixelArray: Uint8ClampedArray | number[],
  imageWidth: number
) {
  const baseFfd = bezierToFDCoeff(curve);
  const shiftCount = estimateFDStepCount(curve);
  const maxStepCount = 1 << shiftCount;

  const [xCoeff, yCoeff] = baseFfd.map((coeff) =>
    fixIter(shiftCount, halveFDCoefficients, coeff)
  );

  const dv = (vEnd - vStart) / maxStepCount;

  const [xStart, yStart] = curve[0];

  let ax = xCoeff.fdA;
  let bx = xCoeff.fdB;
  let ay = yCoeff.fdA;
  let by = yCoeff.fdB;
  let x = xStart;
  let y = yStart;
  let v = vStart;

  for (let currentStep = 0; currentStep < maxStepCount; currentStep++) {
    if (currentStep >= maxStepCount) {
      return;
    }

    const i = (Math.floor(x) + Math.floor(y) * imageWidth) * 4;
    const color = bilinearPixelInterpolation(source, uStart, v);
    pixelArray[i + 0] = color[0];
    pixelArray[i + 1] = color[1];
    pixelArray[i + 2] = color[2];
    pixelArray[i + 3] = color[3];

    ax += bx;
    bx += xCoeff.fdC;
    ay += by;
    by += yCoeff.fdC;
    x += ax;
    y += ay;
    v += dv;
  }
}
