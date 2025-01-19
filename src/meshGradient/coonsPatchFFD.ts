import {
  CoonsPatch,
  CubicBezier,
  ForwardDifferenceCoefficient,
  RGBA,
  Vec2,
} from '../types';
import {
  bezierToFDCoeff,
  estimateFDStepCount,
  fixIter,
  halveFDCoefficientsVec2,
  renderCubicBezier,
  updatePointsAndCoeff,
} from './fastForwardDifferencing';
import { lerp } from './helpers';

export function renderCoonsPatchWithFFD(
  patch: CoonsPatch<RGBA>,
  context: CanvasRenderingContext2D
) {
  const { north, east, south, west, coonsValues } = patch;
  /**
   * Not sure if doing a simple linear interpolation here is what we actually want, but it seems to work well enough, and this project is not about mathematical elegancy but cool gradients.
   */
  const curves = [
    north,
    [
      west[2],
      lerp(1 / 3, west[2], east[1]),
      lerp(2 / 3, west[2], east[1]),
      east[1],
    ],
    [
      west[1],
      lerp(1 / 3, west[1], east[2]),
      lerp(2 / 3, west[1], east[2]),
      east[2],
    ],
    [south[3], south[2], south[1], south[0]],
  ] as CubicBezier[];
  const shiftStep = Math.max(...curves.map(estimateFDStepCount));

  const basePoints = curves.map((curve) => curve[0]);
  const ffCoeff = curves.map((curve) =>
    fixIter(shiftStep, halveFDCoefficientsVec2, bezierToFDCoeff(curve))
  );

  const maxStepCount = 1 << shiftStep;

  const du = 1 / maxStepCount;

  const imageWidth = context.canvas.clientWidth;
  const imageHeight = context.canvas.clientHeight;
  const imageData = context.getImageData(0, 0, imageWidth, imageHeight);

  let points = basePoints;
  let coeffs = ffCoeff;
  let ut = 0;

  for (let i = maxStepCount; i > 0; i--) {
    if (i === 0) {
      continue;
    }

    const [newPoints, newCoeffs] = updatePointsAndCoeff(points, coeffs);

    renderCubicBezier(
      coonsValues,
      points as CubicBezier,
      ut,
      0,
      ut,
      1,
      imageData,
      imageWidth
    );

    points = newPoints;
    coeffs = newCoeffs as Vec2<ForwardDifferenceCoefficient>[];
    ut += du;
  }

  context.putImageData(imageData, 0, 0);
}
