import { useCallback, useEffect, useRef, useState } from 'react';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import './App.css';

type Vec2<T = number> = [T, T];

type Vec4<T = number> = [T, T, T, T];

type CubicBezier = Vec4<Vec2>;

type RGBA = {
  r: number;
  g: number;
  b: number;
  a: number;
};

type ParametricValues<T> = {
  northValue: T;
  southValue: T;
  eastValue: T;
  westValue: T;
};

type CoonsPatch<T = Vec2> = {
  north: CubicBezier; // control points for north curve
  south: CubicBezier; // control points for south curve
  east: CubicBezier; // control points for east curve
  west: CubicBezier; // control points for west curve
  coonsValues: ParametricValues<T>;
};

const MARGIN = { left: 15, right: 15, top: 15, bottom: 15 } as const;
const CONTROL_POINT_RADIUS = 10 as const;

function vectorAdd(v1: Vec2, v2: Vec2): Vec2 {
  return [v1[0] + v2[0], v1[1] + v2[1]];
}

function vectorSub(v1: Vec2, v2: Vec2): Vec2 {
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
// TODO: Should we flip this like above?
function lerp(t: number, p0: Vec2, p1: Vec2): Vec2 {
  return [t * p1[0] + (1 - t) * p0[0], t * p1[1] + (1 - t) * p0[1]];
}

/**
 * Returns the midpoint between two points.
 * @param a point a
 * @param b point b
 * @returns the point that is halfway between a and b
 */
function midPoint(a: Vec2, b: Vec2): Vec2 {
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
 * Get linear interpolation between two 8-bit color values.
 * @param t float from 0 to 1
 * @param a color value a
 * @param b color value b
 * @returns interpolated color value at t
 */
function lerpWord8(t: number, a: number, b: number): number {
  return Math.floor((1 - t) * a + t * b);
}

/**
 * Get linear interpolation between two RGBA colors.
 * @param t float from 0 to 1
 * @param color1 color value a
 * @param color2 color value b
 * @returns interpolated color value at t
 */
function lerpColor(t: number, color1: RGBA, color2: RGBA): RGBA {
  return {
    r: lerpWord8(t, color1.r, color2.r),
    g: lerpWord8(t, color1.g, color2.g),
    b: lerpWord8(t, color1.b, color2.b),
    a: lerpWord8(t, color1.a, color2.a),
  };
}

/**
 * Perform bilinear interpolation between four colors.
 * TODO: Other color spaces than RGBA
 * @param parametricValues Colors at the corners of the patch
 * @param dx U coordinate
 * @param dy V coordinate
 * @returns interpolated color at UV coordinates
 */
function bilinearPixelInterpolation(
  parametricValues: ParametricValues<RGBA>,
  dx: number,
  dy: number
): RGBA {
  const { northValue, southValue, eastValue, westValue } = parametricValues;

  const colorTop = lerpColor(dx, northValue, eastValue); // Interpolate top (north-east) color
  const colorBottom = lerpColor(dx, westValue, southValue); // Interpolate bottom (west-south) color

  return lerpColor(dy, colorTop, colorBottom); // Interpolate between top and bottom colors
}

/**
 * Get the mean value of a list of points.
 * @param points array of 2D points
 * @returns the mean value of the points
 */
function meanValue(points: Vec2[]): Vec2 {
  const sum = points.reduce(vectorAdd, [0, 0]);
  return scalePoint(sum, 1 / points.length);
}

/**
 * Split the Bezier curve into two at mid point with De Casteljau's algorithm?
 * @param bezier Cubic Bezier curve to split
 * @returns Two Cubic Bezier curves
 */
function divideCubicBezier(bezier: CubicBezier): Vec2<CubicBezier> {
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

function coordinatesToPixels<T>(
  patch: CoonsPatch<T>,
  canvas: HTMLCanvasElement
): CoonsPatch<T> {
  const { height, width } = canvas.getBoundingClientRect();
  return {
    ...patch,
    north: patch.north.map(([x, y]) => [
      (x / 100) * (width - MARGIN.left - MARGIN.right) + MARGIN.left,
      (y / 100) * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top,
    ]) as CubicBezier,
    south: patch.south.map(([x, y]) => [
      (x / 100) * (width - MARGIN.left - MARGIN.right) + MARGIN.left,
      (y / 100) * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top,
    ]) as CubicBezier,
    east: patch.east.map(([x, y]) => [
      (x / 100) * (width - MARGIN.left - MARGIN.right) + MARGIN.left,
      (y / 100) * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top,
    ]) as CubicBezier,
    west: patch.west.map(([x, y]) => [
      (x / 100) * (width - MARGIN.left - MARGIN.right) + MARGIN.left,
      (y / 100) * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top,
    ]) as CubicBezier,
  };
}

function renderCoonsPatch(
  originalPatch: CoonsPatch<RGBA>,
  context: CanvasRenderingContext2D
) {
  const maxDepth = 5; // maxColorDeepness(originalPatch.coonsValues); TODO: Should we derive this value with a function (e.g., depending on canvas size) or use a constant?
  const basePatch: CoonsPatch<Vec2> = {
    ...originalPatch,
    coonsValues: {
      northValue: [0, 0],
      eastValue: [1, 0],
      southValue: [1, 1],
      westValue: [0, 1],
    },
  };

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
    context.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${
      color.a / 255
    })`;
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

function getCoonsPatchFromRowsAndColumns(
  columns: CubicBezier[],
  rows: CubicBezier[]
): CoonsPatch<RGBA>[] {
  const patches: CoonsPatch<RGBA>[] = [];
  for (let i = 1; i < rows.length; i++) {
    for (let j = 1; j < columns.length; j++) {
      const north = rows[j - 1];
      const south = rows[j].slice().reverse() as CubicBezier;
      const west = columns[i - 1].slice().reverse() as CubicBezier;
      const east = columns[i];

      const coonsPatch: CoonsPatch<RGBA> = {
        north,
        east,
        south,
        west,
        coonsValues: {
          northValue: { r: 255, g: 0, b: 0, a: 255 },
          eastValue: { r: 0, g: 255, b: 0, a: 255 },
          southValue: { r: 0, g: 0, b: 255, a: 255 },
          westValue: { r: 255, g: 0, b: 255, a: 255 },
        },
      };

      patches.push(coonsPatch);
    }
  }

  return patches;
}

function convertXToCanvasX(x: number, width: number): number {
  return (x / 100) * (width - MARGIN.left - MARGIN.right) + MARGIN.left;
}

function convertYToCanvasY(y: number, height: number): number {
  return (y / 100) * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top;
}

function renderControlPoints(
  context: CanvasRenderingContext2D,
  columns: CubicBezier[],
  rows: CubicBezier[]
) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  context.fillStyle = 'white';
  context.strokeStyle = '#5a5a5a';
  context.lineWidth = 2;

  for (const column of columns) {
    context.strokeStyle = '#5a5a5a';
    for (const point of column) {
      context.beginPath();
      context.arc(
        convertXToCanvasX(point[0], width),
        convertYToCanvasY(point[1], height),
        CONTROL_POINT_RADIUS,
        0,
        2 * Math.PI
      );
      context.stroke();
      context.fill();
    }

    context.strokeStyle = 'white';
    context.moveTo(
      convertXToCanvasX(column[0][0], width),
      convertYToCanvasY(column[0][1], height)
    );
    context.bezierCurveTo(
      convertXToCanvasX(column[1][0], width),
      convertYToCanvasY(column[1][1], height),
      convertXToCanvasX(column[2][0], width),
      convertYToCanvasY(column[2][1], height),
      convertXToCanvasX(column[3][0], width),
      convertYToCanvasY(column[3][1], height)
    );
    context.stroke();
  }

  for (const row of rows) {
    context.strokeStyle = '#5a5a5a';
    for (const point of row) {
      context.beginPath();
      context.arc(
        convertXToCanvasX(point[0], width),
        convertYToCanvasY(point[1], height),
        CONTROL_POINT_RADIUS,
        0,
        2 * Math.PI
      );
      context.stroke();
      context.fill();
    }

    context.strokeStyle = 'white';
    context.moveTo(
      convertXToCanvasX(row[0][0], width),
      convertYToCanvasY(row[0][1], height)
    );
    context.bezierCurveTo(
      convertXToCanvasX(row[1][0], width),
      convertYToCanvasY(row[1][1], height),
      convertXToCanvasX(row[2][0], width),
      convertYToCanvasY(row[2][1], height),
      convertXToCanvasX(row[3][0], width),
      convertYToCanvasY(row[3][1], height)
    );
    context.stroke();
  }
}

type TensorPatch<T = RGBA> = {
  curve0: CubicBezier;
  curve1: CubicBezier;
  curve2: CubicBezier;
  curve3: CubicBezier;
  tensorValues: ParametricValues<T>;
};

/**
 * Creates a Tensor Patch out of a Coons patch.
 * @param coonsPatch
 * @returns
 */
function coonsToTensorPatch(coonsPatch: CoonsPatch<RGBA>): TensorPatch<RGBA> {
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

function renderTensorPatch(
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
function estimateFDStepCount(curve: CubicBezier): number {
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
function fixIter<T>(iterCount: number, func: (x: T) => T, initialValue: T): T {
  function go(remaining: number, value: T): T {
    if (remaining === 0) {
      return value;
    }
    return go(remaining - 1, func(value));
  }

  return go(iterCount, initialValue);
}

type ForwardDifferenceCoefficient = {
  fdA: number;
  fdB: number;
  fdC: number;
};

function bezierToFDCoeff(
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

function halveFDCoefficients(
  coeff: ForwardDifferenceCoefficient
): ForwardDifferenceCoefficient {
  const cPrime = coeff.fdC * 0.125;
  const bPrime = coeff.fdB * 0.25 - cPrime;
  const aPrime = (coeff.fdA - bPrime) * 0.5;

  return { fdA: aPrime, fdB: bPrime, fdC: cPrime };
}

function halveFDCoefficientsVec2(
  coeffs: Vec2<ForwardDifferenceCoefficient>
): Vec2<ForwardDifferenceCoefficient> {
  return [halveFDCoefficients(coeffs[0]), halveFDCoefficients(coeffs[1])];
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

function updatePointsAndCoeff(
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

function renderCubicBezier(
  source: ParametricValues<RGBA>,
  curve: CubicBezier,
  uStart: number,
  vStart: number,
  uEnd: number,
  vEnd: number,
  imageData: ImageData
) {
  const baseFfd = bezierToFDCoeff(curve);
  const shiftCount = Math.round(estimateFDStepCount(curve) / 1);
  const maxStepCount = 1 << shiftCount;

  const [xCoeff, yCoeff] = baseFfd.map((coeff) =>
    fixIter(shiftCount, halveFDCoefficients, coeff)
  );

  const dv = (vEnd - vStart) / maxStepCount;

  const [xStart, yStart] = curve[0];

  function goUnsafe(
    currentStep: number,
    ax: number,
    bx: number,
    ay: number,
    by: number,
    x: number,
    y: number,
    v: number
  ) {
    if (currentStep >= maxStepCount) {
      return;
    }

    const i = (Math.floor(x) + Math.floor(y) * imageData.width) * 4;
    const color = bilinearPixelInterpolation(source, uStart, v);
    imageData.data[i + 0] = color.r;
    imageData.data[i + 1] = color.g;
    imageData.data[i + 2] = color.b;
    imageData.data[i + 3] = color.a;

    goUnsafe(
      currentStep + 1,
      ax + bx,
      bx + xCoeff.fdC,
      ay + by,
      by + yCoeff.fdC,
      x + ax,
      y + ay,
      v + dv
    );
  }

  goUnsafe(
    0,
    xCoeff.fdA,
    xCoeff.fdB,
    yCoeff.fdA,
    yCoeff.fdB,
    xStart,
    yStart,
    vStart
  );
}

/**
 * Rasterize patch using Fast-Forward Differencing algorithm
 */
function renderTensorPatchWithFFD(
  patch: TensorPatch<RGBA>,
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

  const imageData = context.getImageData(
    0,
    0,
    context.canvas.clientWidth,
    context.canvas.clientHeight
  );

  function go(
    i: number,
    points: Vec2[],
    coeffs: ForwardDifferenceCoefficient[][],
    ut: number
  ) {
    if (i == 0) {
      return;
    }

    const [newPoints, newCoeff] = updatePointsAndCoeff(points, coeffs);

    renderCubicBezier(
      tensorValues,
      points as CubicBezier,
      ut,
      0,
      ut,
      1,
      imageData
    );

    go(i - 1, newPoints, newCoeff, ut + du);
  }

  go(maxStepCount, basePoints, ffCoeff, 0);

  context.putImageData(imageData, 0, 0);
}

function App() {
  const [count, setCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [rows, setRows] = useState<CubicBezier[]>([
    [
      [0, 0],
      [33, 0],
      [67, 0],
      [100, 0],
    ],
    [
      [0, 100],
      [33, 100],
      [67, 100],
      [100, 100],
    ],
  ]);

  const [columns, setColumns] = useState<CubicBezier[]>([
    [
      [0, 0],
      [0, 33],
      [0, 67],
      [0, 100],
    ],
    [
      [100, 0],
      [100, 33],
      [100, 67],
      [100, 100],
    ],
  ]);

  const [patchType, setPatchType] = useState<'coons' | 'tensor'>('coons');

  useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;

    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const patches = getCoonsPatchFromRowsAndColumns(columns, rows);

    for (const patch of patches) {
      const coonsPatch = coordinatesToPixels(patch, canvas);
      if (patchType === 'tensor') {
        // renderTensorPatch(coonsToTensorPatch(coonsPatch), context);
        renderTensorPatchWithFFD(coonsToTensorPatch(coonsPatch), context);
      } else {
        renderCoonsPatch(coonsPatch, context);
      }
    }

    renderControlPoints(context, columns, rows);
  }, [columns, rows, patchType]);

  const lastMouseDownTimestampRef = useRef(0);
  const draggedPointRowAndColumnIndexRef = useRef<
    [[number, number] | null, [number, number] | null]
  >([null, null]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      lastMouseDownTimestampRef.current = performance.now();

      const canvas = event.target as HTMLCanvasElement;
      const { left, top, width, height } = canvas.getBoundingClientRect();
      const x = event.clientX - left;
      const y = event.clientY - top;
      const columnPoint = columns.flat().findIndex((point) => {
        const [px, py] = point;
        return (
          Math.abs(
            (px / 100) * (width - MARGIN.left - MARGIN.right) + MARGIN.left - x
          ) <= CONTROL_POINT_RADIUS &&
          Math.abs(
            (py / 100) * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top - y
          ) <= CONTROL_POINT_RADIUS
        );
      });
      const rowPoint = rows.flat().findIndex((point) => {
        const [px, py] = point;
        return (
          Math.abs(convertXToCanvasX(px, width) - x) <= CONTROL_POINT_RADIUS &&
          Math.abs(convertYToCanvasY(py, height) - y) <= CONTROL_POINT_RADIUS
        );
      });
      const columnPointIndex =
        columnPoint > -1
          ? ([Math.floor(columnPoint / 4), columnPoint % 4] as [number, number])
          : null;
      const rowPointIndex =
        rowPoint > -1
          ? ([Math.floor(rowPoint / 4), rowPoint % 4] as [number, number])
          : null;

      draggedPointRowAndColumnIndexRef.current = [
        columnPointIndex,
        rowPointIndex,
      ];
    },
    [columns, rows]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (
        draggedPointRowAndColumnIndexRef.current.every(
          (index) => index === null
        )
      ) {
        return;
      }
      const canvas = event.target as HTMLCanvasElement;
      const { left, top, height, width } = canvas.getBoundingClientRect();
      const x =
        ((Math.min(
          Math.max(CONTROL_POINT_RADIUS, event.clientX - left),
          width - CONTROL_POINT_RADIUS
        ) -
          MARGIN.left) /
          (width - MARGIN.left - MARGIN.right)) *
        100;

      const y =
        ((Math.min(
          Math.max(CONTROL_POINT_RADIUS, event.clientY - top),
          height - CONTROL_POINT_RADIUS
        ) -
          MARGIN.top) /
          (height - MARGIN.top - MARGIN.bottom)) *
        100;

      const [columnIndex, rowIndex] = draggedPointRowAndColumnIndexRef.current;
      if (columnIndex !== null) {
        setColumns((columns) => {
          const clone = columns.slice();
          clone[columnIndex[0]][columnIndex[1]] = [x, y];
          return clone;
        });
      }
      if (rowIndex !== null) {
        setRows((rows) => {
          const clone = rows.slice();
          clone[rowIndex[0]][rowIndex[1]] = [x, y];
          return clone;
        });
      }
    },
    []
  );

  const handleMouseUp = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      draggedPointRowAndColumnIndexRef.current = [null, null];
      // TODO: detect if the mouse was dragged or clicked
      // If it was clicked, open color palette
    },
    []
  );

  return (
    <>
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <fieldset>
          <legend>Select patch type</legend>
          <label>
            <input
              type="radio"
              value="coons"
              id="coons"
              name="patchType"
              checked={patchType === 'coons'}
              onChange={() => setPatchType('coons')}
            />{' '}
            Coons patch
          </label>
          <label>
            <input
              type="radio"
              value="tensor"
              id="tensor"
              name="patchType"
              checked={patchType === 'tensor'}
              onChange={() => setPatchType('tensor')}
            />{' '}
            Tensor-product patch
          </label>
        </fieldset>
      </form>

      <div style={{ width: 800, height: 600, position: 'relative' }}>
        <canvas
          width={800}
          height={600}
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseMove={handleMouseMove}
          onMouseOut={handleMouseUp}
        />
      </div>
    </>
  );
}

export default App;
