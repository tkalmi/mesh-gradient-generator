import { Color, CoonsPatch, TensorPatch, Vec2 } from '../types';

/**
 * Add two vectors (of length 2) together.
 * @param v1 vector 1
 * @param v2 vector 2
 * @returns v1 + v2
 */
export function vectorAdd(v1: Vec2, v2: Vec2): Vec2 {
  return [v1[0] + v2[0], v1[1] + v2[1]];
}

/**
 * Subtract vector 2 from vector 1. Both vectors are of length 2
 * @param v1 vector 1
 * @param v2 vector 2
 * @returns v1 - v2
 */
export function vectorSub(v1: Vec2, v2: Vec2): Vec2 {
  return [v1[0] - v2[0], v1[1] - v2[1]];
}

// /**
//  * Performs linear interpolation (i.e., lerp) between the two given points.
//  * Notice that this is reversed from the typical order of arguments,
//  * i.e., linearInterpolation(0, p1, p2) = p2 instead of p1
//  * @param t float from 0 to 1
//  * @param p1 point 1
//  * @param p2 point 2
//  * @returns the point that is t percent between p1 and p2
//  */
// function lerp(t: number, p0: Vec2, p1: Vec2): Vec2 {
//   return [t * p0[0] + (1 - t) * p1[0], t * p0[1] + (1 - t) * p1[1]];
// }
export function lerp(t: number, p0: Vec2, p1: Vec2): Vec2 {
  return [t * p1[0] + (1 - t) * p0[0], t * p1[1] + (1 - t) * p0[1]];
}

/**
 * Returns the midpoint between two points.
 * @param a point a
 * @param b point b
 * @returns the point that is halfway between a and b
 */
export function midPoint(a: Vec2, b: Vec2): Vec2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Scales a point by a scalar.
 * @param point
 * @param scalar
 * @returns scalar * point
 */
function scalePoint(point: Vec2, scalar: number): Vec2 {
  return [point[0] * scalar, point[1] * scalar];
}

/**
 * Get the mean value of a list of points.
 * @param points array of 2D points
 * @returns the mean value of the points
 */
export function meanValue(points: Vec2[]): Vec2 {
  const sum = points.reduce(vectorAdd, [0, 0]);
  return scalePoint(sum, 1 / points.length);
}

/**
 * Creates a Tensor Patch out of a Coons patch.
 * @param coonsPatch
 * @returns
 */
export function coonsToTensorPatch(
  coonsPatch: CoonsPatch<Color>
): TensorPatch<Color> {
  const formula = (
    a: Vec2,
    b: Vec2,
    c: Vec2,
    d: Vec2,
    e: Vec2,
    f: Vec2,
    g: Vec2,
    h: Vec2
  ) => {
    let result = scalePoint(a, -4);
    result = vectorAdd(result, scalePoint(vectorAdd(b, c), 6));
    result = vectorSub(result, scalePoint(vectorAdd(d, e), 2));
    result = vectorAdd(result, scalePoint(vectorAdd(f, g), 3));
    result = vectorSub(result, h);
    return scalePoint(result, 1 / 9);
  };

  const [p03, p13, p23, p33] = coonsPatch.north;
  const [, p32, p31] = coonsPatch.east;
  const [p30, p20, p10, p00] = coonsPatch.south;
  const [, p01, p02] = coonsPatch.west;

  const [sa, sb, sc, sd] = coonsPatch.south;
  const [, et, eb] = coonsPatch.east;
  const [, wb, wt] = coonsPatch.west;

  const p11 = formula(p00, p10, p01, p30, p03, p13, p31, p33);
  const p12 = formula(p03, p13, p02, p33, p00, p10, p32, p30);
  const p21 = formula(p30, p20, p31, p00, p33, p23, p01, p03);
  const p22 = formula(p33, p23, p32, p03, p30, p20, p02, p00);

  return {
    curve0: coonsPatch.north,
    curve1: [wt, p12, p22, et],
    curve2: [wb, p11, p21, eb],
    curve3: [sd, sc, sb, sa],
    tensorValues: coonsPatch.coonsValues,
  };
}
