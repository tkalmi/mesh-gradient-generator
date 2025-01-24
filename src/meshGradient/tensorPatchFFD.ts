import {
  bezierToFDCoeff,
  estimateFDStepCount,
  fixIter,
  halveFDCoefficientsVec2,
  renderCubicBezier,
  updatePointsAndCoeff,
} from './fastForwardDifferencing';
import {
  Color,
  ColorModel,
  CubicBezier,
  ForwardDifferenceCoefficient,
  TensorPatch,
  Vec2,
} from '../types';
import { colorToStringFuncs } from './colors';

/**
 * Rasterize patch using Fast-Forward Differencing algorithm
 */
export function renderTensorPatchWithFFD(
  patch: TensorPatch<Color>,
  colorModel: ColorModel,
  context: CanvasRenderingContext2D
) {
  const { curve0, curve1, curve2, curve3, tensorValues } = patch;
  const curves = [curve0, curve1, curve2, curve3];
  const shiftStep = Math.max(...curves.map(estimateFDStepCount));

  const basePoints = curves.map((curve) => curve[0]);
  const ffCoeff = curves.map((curve) =>
    fixIter(shiftStep, halveFDCoefficientsVec2, bezierToFDCoeff(curve))
  );

  const maxStepCount = 1 << shiftStep;

  const du = 1 / maxStepCount;

  const imageWidth = context.canvas.clientWidth;
  const imageHeight = context.canvas.clientHeight;

  let points = basePoints;
  let coeffs = ffCoeff;
  let ut = 0;

  if (colorModel === 'rgba') {
    // If in RGBA mode, use ImageData, as that's the most efficient way

    const imageData = context.getImageData(0, 0, imageWidth, imageHeight);

    for (let i = maxStepCount; i > 0; i--) {
      if (i === 0) {
        continue;
      }

      const [newPoints, newCoeffs] = updatePointsAndCoeff(points, coeffs);

      renderCubicBezier(
        tensorValues,
        points as CubicBezier,
        ut,
        0,
        ut,
        1,
        imageData.data,
        imageWidth
      );

      points = newPoints;
      coeffs = newCoeffs as Vec2<ForwardDifferenceCoefficient>[];
      ut += du;
    }

    context.putImageData(imageData, 0, 0);
  } else {
    // If in HSL or LCH, draw pixel-sized rectangles to avoid having to convert to RGBA

    const colorToString = colorToStringFuncs[colorModel];
    const pixels: number[] = new Array(imageWidth * imageHeight * 4).fill(0);

    for (let i = maxStepCount; i > 0; i--) {
      if (i === 0) {
        continue;
      }

      const [newPoints, newCoeffs] = updatePointsAndCoeff(points, coeffs);

      renderCubicBezier(
        tensorValues,
        points as CubicBezier,
        ut,
        0,
        ut,
        1,
        pixels,
        imageWidth
      );

      points = newPoints;
      coeffs = newCoeffs as Vec2<ForwardDifferenceCoefficient>[];
      ut += du;
    }

    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < imageWidth; x++) {
        const start = (y * imageWidth + x) * 4;
        context.fillStyle = colorToString(
          pixels.slice(start, start + 4) as Color
        );
        context.fillRect(x, y, 1, 1);
      }
    }
  }
}
