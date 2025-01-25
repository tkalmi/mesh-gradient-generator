import {
  Color,
  ColorModel,
  CoonsPatch,
  CubicBezier,
  ParametricValues,
  Vec2,
} from '../types';
import { bilinearPixelInterpolation, colorToStringFuncs } from './colors';
import { lerp, meanValue, midPoint, vectorAdd, vectorSub } from './helpers';
import { divideCubicBezier } from './patchSubdivision';

/**
 * Create a straight line Bezier curve between two points
 * @param p0 Start point
 * @param p1 End point
 * @returns Cubic Bezier curve
 */
function straightLine(p0: Vec2, p1: Vec2): CubicBezier {
  return [p0, lerp(1 / 3, p1, p0), lerp(2 / 3, p1, p0), p1];
}

/**
 * Flips a Bezier curve upside down
 * @param bezier Bezier curve to flip
 * @returns inverse of the Bezier curve
 */
function inverseBezier(bezier: CubicBezier): CubicBezier {
  return [bezier[3], bezier[2], bezier[1], bezier[0]];
}

/**
 * Get UV values for all sub-patches
 * @param values UV values for the patch
 * @returns UV values for the four sub-patches
 */
function subdivideWeights(values: ParametricValues<Vec2>): {
  northWest: ParametricValues<Vec2>;
  northEast: ParametricValues<Vec2>;
  southWest: ParametricValues<Vec2>;
  southEast: ParametricValues<Vec2>;
} {
  const midNorthValue = midPoint(values.northValue, values.eastValue);
  const midWestValue = midPoint(values.northValue, values.westValue);
  const midSouthValue = midPoint(values.westValue, values.southValue);
  const midEastValue = midPoint(values.eastValue, values.southValue);
  const gridMidValue = midPoint(midNorthValue, midSouthValue);

  return {
    northWest: {
      northValue: values.northValue,
      eastValue: midNorthValue,
      southValue: gridMidValue,
      westValue: midWestValue,
    },
    northEast: {
      northValue: midNorthValue,
      eastValue: values.eastValue,
      southValue: midEastValue,
      westValue: gridMidValue,
    },
    southWest: {
      northValue: midWestValue,
      eastValue: gridMidValue,
      southValue: midSouthValue,
      westValue: values.westValue,
    },
    southEast: {
      northValue: gridMidValue,
      eastValue: midEastValue,
      southValue: values.southValue,
      westValue: midSouthValue,
    },
  };
}

/**
 * Combine three curves into a single Bezier curve
 * @param beziers Bezier curves to combine
 * @returns Combined Bezier curve
 */
function combine(
  bezier1: CubicBezier,
  bezier2: CubicBezier,
  bezier3: CubicBezier
): CubicBezier {
  return [
    vectorAdd(vectorSub(bezier1[0], bezier3[0]), bezier2[0]),
    vectorAdd(vectorSub(bezier1[1], bezier3[1]), bezier2[1]),
    vectorAdd(vectorSub(bezier1[2], bezier3[2]), bezier2[2]),
    vectorAdd(vectorSub(bezier1[3], bezier3[3]), bezier2[3]),
  ];
}

/**
 * Get Bezier curve between two Bezier curves.
 * @param bezier1
 * @param bezier2
 * @returns Mid-point Bezier curve
 */
function midCurve(bezier1: CubicBezier, bezier2: CubicBezier): CubicBezier {
  return [
    midPoint(bezier1[0], bezier2[3]),
    midPoint(bezier1[1], bezier2[2]),
    midPoint(bezier1[2], bezier2[1]),
    midPoint(bezier1[3], bezier2[0]),
  ];
}

/**
 * Divide a Coons patch into four smaller patches
 * @param patch Coons patch to split
 * @returns four smaller Coons patches
 */
function subdividePatch(patch: CoonsPatch): {
  northWest: CoonsPatch;
  northEast: CoonsPatch;
  southEast: CoonsPatch;
  southWest: CoonsPatch;
} {
  const { north, south, east, west } = patch;

  const [nw, , , ne] = north;
  const [se, , , sw] = south;

  const midNorthLinear = midPoint(nw, ne);
  const midSouthLinear = midPoint(sw, se);
  const midWestLinear = midPoint(nw, sw);
  const midEastLinear = midPoint(ne, se);

  const [northLeft, northRight] = divideCubicBezier(north);
  const [southRight, southLeft] = divideCubicBezier(south);
  const [westBottom, westTop] = divideCubicBezier(west);
  const [eastTop, eastBottom] = divideCubicBezier(east);

  const midNorth = northLeft[3];
  const midSouth = southRight[3];
  const midWest = westBottom[3];
  const midEast = eastTop[3];

  const midNorthSouth = midCurve(north, south); // direction: west->east
  const midEastWest = midCurve(east, west); // direction: north->south

  const [splitNorthSouthTop, splitNorthSouthBottom] = // direction north->south
    divideCubicBezier(
      combine(
        midEastWest,
        straightLine(midNorth, midSouth),
        straightLine(midNorthLinear, midSouthLinear)
      )
    );

  const [splitWestEastLeft, splitWestEastRight] = divideCubicBezier(
    combine(
      midNorthSouth,
      straightLine(midWest, midEast),
      straightLine(midWestLinear, midEastLinear)
    )
  );

  const weights = subdivideWeights(patch.coonsValues);

  const northWest = {
    north: northLeft,
    south: inverseBezier(splitWestEastLeft),
    west: westTop,
    east: splitNorthSouthTop,
    coonsValues: weights.northWest,
  };

  const northEast = {
    north: northRight,
    east: eastTop,
    west: inverseBezier(splitNorthSouthTop),
    south: inverseBezier(splitWestEastRight),
    coonsValues: weights.northEast,
  };

  const southWest = {
    north: splitWestEastLeft,
    east: splitNorthSouthBottom,
    west: westBottom,
    south: southLeft,
    coonsValues: weights.southWest,
  };

  const southEast = {
    north: splitWestEastRight,
    east: eastBottom,
    west: inverseBezier(splitNorthSouthBottom),
    south: southRight,
    coonsValues: weights.southEast,
  };

  return { northWest, northEast, southWest, southEast };
}

export function renderCoonsPatchWithSubdivision(
  originalPatch: CoonsPatch<Color>,
  colorModel: ColorModel,
  maxDepth: number,
  context: CanvasRenderingContext2D
) {
  const basePatch: CoonsPatch<Vec2> = {
    ...originalPatch,
    coonsValues: {
      northValue: [0, 0],
      eastValue: [1, 0],
      southValue: [1, 1],
      westValue: [0, 1],
    },
  };

  const colorToString = colorToStringFuncs[colorModel];

  // Function to draw the patch uniformly using bilinear interpolation
  function drawPatchUniform(patch: CoonsPatch<Vec2>) {
    const { north, south, east, west, coonsValues } = patch;

    const [u, v] = meanValue(Object.values(coonsValues)); // Get mean UV from coonsValues

    const baseColors = originalPatch.coonsValues;
    const color = bilinearPixelInterpolation(baseColors, u, v); // Interpolate texture color at UV coordinates

    // Draw the patch
    const patchPath = new Path2D();
    patchPath.moveTo(north[0][0], north[0][1]); // move to starting point
    for (const curve of [north, east, south, west]) {
      patchPath.lineTo(curve[3][0], curve[3][1]);
    }
    context.lineWidth = 0;
    patchPath.closePath();
    context.fillStyle = colorToString(color);
    context.strokeStyle = context.fillStyle;
    context.stroke(patchPath);
    context.fill(patchPath);
  }

  // Recursive function to handle patch subdivision and rendering
  function go(depth: number, patch: CoonsPatch) {
    if (depth === 0) {
      drawPatchUniform(patch);
    } else {
      const { northWest, northEast, southWest, southEast } =
        subdividePatch(patch);

      go(depth - 1, northWest);
      go(depth - 1, northEast);
      go(depth - 1, southWest);
      go(depth - 1, southEast);
    }
  }

  go(maxDepth, basePatch);
}
