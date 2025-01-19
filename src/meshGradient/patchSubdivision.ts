import { CubicBezier, Vec2 } from '../types';
import { midPoint } from './helpers';

/**
 * Split the Bezier curve into two at mid point with De Casteljau's algorithm?
 * @param bezier Cubic Bezier curve to split
 * @returns Two Cubic Bezier curves
 */
export function divideCubicBezier(bezier: CubicBezier): Vec2<CubicBezier> {
  const ab = midPoint(bezier[0], bezier[1]);
  const bc = midPoint(bezier[1], bezier[2]);
  const cd = midPoint(bezier[2], bezier[3]);
  const abbc = midPoint(ab, bc);
  const bccd = midPoint(bc, cd);
  const abbcbccd = midPoint(abbc, bccd);

  return [
    [bezier[0], ab, abbc, abbcbccd],
    [abbcbccd, bccd, cd, bezier[3]],
  ];
}
