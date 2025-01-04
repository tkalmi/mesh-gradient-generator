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

  useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;

    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const patches = getCoonsPatchFromRowsAndColumns(columns, rows);

    for (const patch of patches) {
      renderCoonsPatch(coordinatesToPixels(patch, canvas), context);
    }

    renderControlPoints(context, columns, rows);
  }, [columns, rows]);

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
