import { ParametricValues, RGBA, TensorPatch, Vec2 } from '../types';
import { bilinearPixelInterpolation } from './colors';
import { meanValue, midPoint } from './helpers';
import { divideCubicBezier } from './patchSubdivision';

function transposeTensorPatch(patch: TensorPatch<Vec2>): TensorPatch<Vec2> {
  const { curve0, curve1, curve2, curve3, tensorValues } = patch;
  const [c00, c01, c02, c03] = curve0;
  const [c10, c11, c12, c13] = curve1;
  const [c20, c21, c22, c23] = curve2;
  const [c30, c31, c32, c33] = curve3;
  return {
    curve0: [c00, c10, c20, c30],
    curve1: [c01, c11, c21, c31],
    curve2: [c02, c12, c22, c32],
    curve3: [c03, c13, c23, c33],
    tensorValues: {
      northValue: tensorValues.northValue,
      eastValue: tensorValues.westValue,
      southValue: tensorValues.southValue,
      westValue: tensorValues.eastValue,
    },
  };
}

function subdivideHorizontal(
  tensorValues: ParametricValues<Vec2>
): [ParametricValues<Vec2>, ParametricValues<Vec2>] {
  const { northValue, eastValue, southValue, westValue } = tensorValues;
  const midNorthEast = midPoint(northValue, eastValue);
  const midSouthWest = midPoint(westValue, southValue);

  return [
    {
      northValue,
      eastValue: midNorthEast,
      southValue: midSouthWest,
      westValue,
    },
    {
      northValue: midNorthEast,
      eastValue,
      southValue,
      westValue: midSouthWest,
    },
  ];
}

function horizontalTensorSubdivide(
  patch: TensorPatch<Vec2>
): [TensorPatch<Vec2>, TensorPatch<Vec2>] {
  const [l0, r0] = divideCubicBezier(patch.curve0);
  const [l1, r1] = divideCubicBezier(patch.curve1);
  const [l2, r2] = divideCubicBezier(patch.curve2);
  const [l3, r3] = divideCubicBezier(patch.curve3);
  const [vl, vr] = subdivideHorizontal(patch.tensorValues);

  return [
    { curve0: l0, curve1: l1, curve2: l2, curve3: l3, tensorValues: vl },
    { curve0: r0, curve1: r1, curve2: r2, curve3: r3, tensorValues: vr },
  ];
}

function subdivideTensorPatch(patch: TensorPatch<Vec2>) {
  const [west, east] = horizontalTensorSubdivide(patch);
  const [northWest, southWest] = horizontalTensorSubdivide(
    transposeTensorPatch(west)
  );
  const [northEast, southEast] = horizontalTensorSubdivide(
    transposeTensorPatch(east)
  );
  return { northWest, northEast, southWest, southEast };
}

export function renderTensorPatchWithSubdivision(
  tensorPatch: TensorPatch<RGBA>,
  context: CanvasRenderingContext2D
) {
  const maxDepth = 5; // maxColorDeepness(originalPatch.coonsValues); TODO: Should we derive this value with a function (e.g., depending on canvas size) or use a constant?
  const basePatch: TensorPatch<Vec2> = {
    ...tensorPatch,
    tensorValues: {
      northValue: [0, 0],
      eastValue: [1, 0],
      southValue: [1, 1],
      westValue: [0, 1],
    },
  };

  // Function to draw the patch uniformly using bilinear interpolation
  function drawPatchUniform(patch: TensorPatch<Vec2>) {
    const { curve0, curve3, tensorValues } = patch;
    const [u, v] = meanValue(Object.values(tensorValues)); // Get mean UV from coonsValues

    const baseColors = tensorPatch.tensorValues;
    const color = bilinearPixelInterpolation(baseColors, u, v); // Interpolate texture color at UV coordinates

    // Draw the patch
    const patchPath = new Path2D();
    patchPath.moveTo(curve0[0][0], curve0[0][1]); // move to starting point
    patchPath.lineTo(curve3[0][0], curve3[0][1]);
    patchPath.lineTo(curve3[3][0], curve3[3][1]);
    patchPath.lineTo(curve0[3][0], curve0[3][1]);
    patchPath.lineTo(curve0[0][0], curve0[0][1]);

    context.lineWidth = 1;
    patchPath.closePath();
    context.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${
      color.a / 255
    })`;
    context.strokeStyle = context.fillStyle;
    context.stroke(patchPath);
    context.fill(patchPath);
  }

  // Recursive function to handle patch subdivision and rendering
  function go(depth: number, patch: TensorPatch<Vec2>) {
    if (depth === 0) {
      drawPatchUniform(patch);
    } else {
      const { northWest, northEast, southWest, southEast } =
        subdivideTensorPatch(patch);

      go(depth - 1, northWest);
      go(depth - 1, northEast);
      go(depth - 1, southWest);
      go(depth - 1, southEast);
    }
  }

  go(maxDepth, basePatch);
}
