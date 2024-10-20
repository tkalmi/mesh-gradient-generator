import { useEffect, useRef, useState } from 'react';
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

function renderCoonsPatch(
  originalPatch: CoonsPatch<RGBA>,
  context: CanvasRenderingContext2D
) {
  const maxDepth = 7; // maxColorDeepness(originalPatch.coonsValues); TODO: Should we derive this value with a function (e.g., depending on canvas size) or use a constant?
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
      // TODO: Should we use context.bezierCurveTo instead of context.lineTo?
      patchPath.bezierCurveTo(
        curve[1][0],
        curve[1][1],
        curve[2][0],
        curve[2][1],
        curve[3][0],
        curve[3][1]
      ); // draw curve
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

function App() {
  const [count, setCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;

    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const coonsPatch: CoonsPatch<RGBA> = {
      north: [
        [30, 50],
        [150, 20],
        [250, 100],
        [350, 50],
      ],
      east: [
        [350, 50],
        [300, 150],
        [380, 250],
        [350, 350],
      ],
      south: [
        [350, 350],
        [150, 380],
        [250, 200],
        [50, 350],
      ],
      west: [
        [50, 350],
        [20, 150],
        [90, 250],
        [30, 50],
      ],
      coonsValues: {
        northValue: { r: 255, g: 0, b: 0, a: 255 },
        eastValue: { r: 0, g: 255, b: 0, a: 255 },
        southValue: { r: 0, g: 0, b: 255, a: 255 },
        westValue: { r: 255, g: 0, b: 255, a: 255 },
      },
    };

    renderCoonsPatch(coonsPatch, context);
  }, []);

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

      <canvas width={400} height={400} ref={canvasRef} />
    </>
  );
}

export default App;
