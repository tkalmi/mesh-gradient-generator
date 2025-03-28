import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import './App.css';
import { Color, ControlState, CoonsPatch, CubicBezier, Vec2 } from './types';
import { MARGIN } from './constants';
import { coonsToTensorPatch } from './meshGradient/helpers';
import { rgbaToHsla, rgbaToOklab } from './meshGradient/colors';
import { renderTensorPatchesWithSubdivisionWebGL } from './meshGradient/tensorPatchSubdivision';
import { renderControlPoints } from './meshGradient/controlPoints';
import { animatePoint } from './meshGradient/animationUtils';
import Controls from './Controls';
import CanvasWrapper from './CanvasWrapper';

function getNewPoints(rowCount: number, columnCount: number): Vec2[] {
  const newPoints: Vec2[] = [];

  for (let i = 0; i <= rowCount * 3; i++) {
    for (let j = 0; j <= columnCount * 3; j++) {
      if (i % 3 !== 0 && j % 3 !== 0) {
        continue;
      }
      newPoints.push([
        (j / (columnCount * 3)) * 100,
        (i / (rowCount * 3)) * 100,
      ]);
    }
  }

  return newPoints;
}

function getColors(rowCount: number, columnCount: number): Color[] {
  const colors: Color[] = [];
  for (let i = 0; i < (columnCount + 1) * (rowCount + 1); i++) {
    colors.push([
      Math.round(Math.random() * 255),
      Math.round(Math.random() * 255),
      Math.round(Math.random() * 255),
      255,
    ]);
  }
  return colors;
}

function getColumnsAndRowsFromPoints(
  rawPoints: Vec2[],
  columnCount: number,
  rowCount: number
): { columns: CubicBezier[]; rows: CubicBezier[] } {
  const backupPoints = getNewPoints(rowCount, columnCount);
  const points =
    backupPoints.length === rawPoints.length ? rawPoints : backupPoints;
  const rows: CubicBezier[] = [];
  for (let i = 0; i <= rowCount; i++) {
    for (let j = 0; j < columnCount; j++) {
      const startInd = i * (columnCount * 5 + 3) + j * 3;
      const row: CubicBezier = [
        points[startInd],
        points[startInd + 1],
        points[startInd + 2],
        points[startInd + 3],
      ];
      rows.push(row);
    }
  }

  const columns: CubicBezier[] = [];
  for (let j = 0; j < rowCount; j++) {
    for (let i = 0; i <= columnCount; i++) {
      const column: Vec2[] = [
        points[j * (columnCount * 5 + 3) + (i % (columnCount + 1)) * 3],
        points[(j + 1) * (columnCount * 3 + 1) + 2 * j * (columnCount + 1) + i],
        points[
          (j + 1) * (columnCount * 3 + 1) + (2 * j + 1) * (columnCount + 1) + i
        ],
        points[(j + 1) * (columnCount * 5 + 3) + (i % (columnCount + 1)) * 3],
      ];

      columns.push(column as CubicBezier);
    }
  }

  return { columns, rows };
}

function getCoonsPatchFromRowsAndColumns(
  columns: CubicBezier[],
  rows: CubicBezier[],
  colors: Color[],
  columnCount: number,
  rowCount: number
): CoonsPatch<Color>[] {
  const patches: CoonsPatch<Color>[] = [];

  for (let i = 0; i < rowCount; i++) {
    for (let j = 0; j < columnCount; j++) {
      // Take the ith row; this is north
      // Take the (i + columnCount)th row and flip it; this is south
      // Take the column with the same starting point as north's start, then flip it; this is west
      // Take the column with the same starting point as north's end; this is east
      const north = rows[i * columnCount + j];
      const south = rows[(i + 1) * columnCount + j]
        .slice()
        .reverse() as CubicBezier;
      const west = columns
        .find(
          (column) =>
            column[0][0] === north[0][0] && column[0][1] === north[0][1]
        )
        ?.slice()
        .reverse() as CubicBezier;
      const east = columns.find(
        (column) => column[0][0] === north[3][0] && column[0][1] === north[3][1]
      ) as CubicBezier;

      const coonsValues = {
        northValue: colors[i * (columnCount + 1) + (j % (columnCount + 1))],
        eastValue: colors[i * (columnCount + 1) + (j % (columnCount + 1)) + 1],
        southValue:
          colors[(i + 1) * (columnCount + 1) + (j % (columnCount + 1)) + 1],
        westValue:
          colors[(i + 1) * (columnCount + 1) + (j % (columnCount + 1))],
      };

      const coonsPatch: CoonsPatch<Color> = {
        north,
        east,
        south,
        west,
        coonsValues,
      };

      patches.push(coonsPatch);
    }
  }

  return patches;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasDimensionsRef = useRef<{
    left: number;
    top: number;
    height: number;
    width: number;
  }>({ left: 0, top: 0, height: 600, width: 800 });

  const cssCanvasDimensionsRef = useRef<{
    left: number;
    top: number;
    height: number;
    width: number;
  }>({ left: 0, top: 0, height: 600, width: 800 });

  const timeRef = useRef(0);
  const seedRef = useRef(Math.random() * 1000);
  const [forceUpdateKey, setForceUpdateKey] = useState(0); // The sole purpose of this state is to retrigger a useMemo call

  const [controlState, dispatchControlState] = useReducer(
    function reducer<K extends keyof ControlState>(
      state: ControlState,
      action: [key: K, value: ControlState[K]]
    ): ControlState {
      return { ...state, [action[0]]: action[1] };
    },
    {
      colorModel: 'rgba',
      subdivisionCount: 4,
      showControlPoints: true,
      showBezierCurves: true,
      rowCount: 2,
      columnCount: 2,
      useSimpleUV: false,
      animationEnabled: false,
      animationSpeed: 1,
      animationAmplitude: 5,
    }
  );

  const {
    colorModel,
    subdivisionCount,
    showControlPoints,
    showBezierCurves,
    rowCount,
    columnCount,
    useSimpleUV,
    animationEnabled,
    animationSpeed,
    animationAmplitude,
  } = controlState;

  const [points, setPoints] = useState<Vec2[]>(getNewPoints(1, 1));
  const [rawColors, setColors] = useState<Color[]>(
    getColors(rowCount, columnCount)
  );

  const animatedPoints = useMemo(() => {
    if (!animationEnabled) return points;

    return points.map((point, index) => {
      const [x, y] = point;

      // Instead of calculating rows/columns, use the actual position values
      // Points are on the edge if they're at 0% or 100%
      const isOnLeftEdge = Math.abs(x) < 0.01; // x ≈ 0
      const isOnRightEdge = Math.abs(x - 100) < 0.01; // x ≈ 100
      const isOnTopEdge = Math.abs(y) < 0.01; // y ≈ 0
      const isOnBottomEdge = Math.abs(y - 100) < 0.01; // y ≈ 100

      // Keep all edge points stable
      if (isOnLeftEdge || isOnRightEdge || isOnTopEdge || isOnBottomEdge) {
        return point;
      }

      // Only animate interior points
      return animatePoint(
        point,
        timeRef.current,
        seedRef.current + index,
        animationAmplitude
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, animationEnabled, animationAmplitude, forceUpdateKey]);

  const { columns, rows } = useMemo(
    () => getColumnsAndRowsFromPoints(animatedPoints, columnCount, rowCount),
    [animatedPoints, columnCount, rowCount]
  );

  const colors = useMemo(() => {
    const baseColors = (() => {
      const newColors = getColors(rowCount, columnCount);
      if (newColors.length === rawColors.length) {
        return rawColors;
      }
      return newColors;
    })();

    return baseColors;
  }, [rawColors, rowCount, columnCount]);

  const convertedColors = useMemo(() => {
    switch (colorModel) {
      case 'hsla':
        return colors.map((color) => rgbaToHsla(color));
      case 'oklab':
        return colors.map((color) => rgbaToOklab(color));
      case 'rgba':
      default:
        return colors;
    }
  }, [colors, colorModel]);

  useEffect(() => {
    const newPoints = getNewPoints(rowCount, columnCount);
    setPoints(newPoints);

    setColors((prevColors) => {
      const newColors = [
        ...prevColors,
        ...getColors(rowCount, columnCount),
      ].slice(0, (rowCount + 1) * (columnCount + 1));
      return newColors;
    });
  }, [rowCount, columnCount]);

  // TODO: Skip the conversion -- if we pass values [0, 100] to the shader, we can convert them there using a simple multiplication
  const coordinatesToPixels = useCallback(
    (patch: CoonsPatch<Color>): CoonsPatch<Color> => {
      const { height, width } = cssCanvasDimensionsRef.current;
      const dpr = window.devicePixelRatio || 1;

      return {
        ...patch,
        north: patch.north.map(([x, y]) => [
          x * 0.01 * (width - MARGIN.left) * dpr + MARGIN.left,
          y * 0.01 * (height - MARGIN.top) * dpr + MARGIN.top,
        ]) as CubicBezier,
        south: patch.south.map(([x, y]) => [
          x * 0.01 * (width - MARGIN.left) * dpr + MARGIN.left,
          y * 0.01 * (height - MARGIN.top) * dpr + MARGIN.top,
        ]) as CubicBezier,
        east: patch.east.map(([x, y]) => [
          x * 0.01 * (width - MARGIN.left) * dpr + MARGIN.left,
          y * 0.01 * (height - MARGIN.top) * dpr + MARGIN.top,
        ]) as CubicBezier,
        west: patch.west.map(([x, y]) => [
          x * 0.01 * (width - MARGIN.left) * dpr + MARGIN.left,
          y * 0.01 * (height - MARGIN.top) * dpr + MARGIN.top,
        ]) as CubicBezier,
      };
    },
    []
  );

  useEffect(() => {
    const context = (() => {
      const canvas = canvasRef.current!;
      const context = canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      })!;

      context.enable(context.BLEND);
      context.blendFunc(context.SRC_ALPHA, context.ONE_MINUS_SRC_ALPHA);
      context.clearColor(0.0, 0.0, 0.0, 1.0);
      context.clearDepth(1);
      context.enable(context.DEPTH_TEST);
      context.depthFunc(context.LEQUAL);
      context.viewport(0, 0, context.canvas.width, context.canvas.height);
      context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
      return context;
    })();

    const { columns: uiColumns, rows: uiRows } = getColumnsAndRowsFromPoints(
      points,
      columnCount,
      rowCount
    );

    const patches = getCoonsPatchFromRowsAndColumns(
      columns,
      rows,
      convertedColors,
      columnCount,
      rowCount
    );
    const coonsPatches = patches.map((patch) => coordinatesToPixels(patch));
    const tensorPatches = coonsPatches.map((coonsPatch) =>
      coonsToTensorPatch(coonsPatch)
    );
    renderTensorPatchesWithSubdivisionWebGL(
      tensorPatches.map((patch, ind) => ({
        patch,
        x: ind % columnCount,
        y: Math.floor(ind / columnCount),
      })),
      colorModel,
      subdivisionCount,
      useSimpleUV,
      context
    );

    renderControlPoints(
      context,
      uiColumns,
      uiRows,
      showControlPoints,
      showBezierCurves
    );
  }, [
    points,
    columns,
    rows,
    columnCount,
    rowCount,
    colorModel,
    coordinatesToPixels,
    subdivisionCount,
    convertedColors,
    showControlPoints,
    showBezierCurves,
    useSimpleUV,
    forceUpdateKey,
  ]);

  useEffect(() => {
    let animationFrame: number | null = null;
    const animate = () => {
      timeRef.current += 0.015 * animationSpeed;

      setForceUpdateKey((prev) => prev + 1);
      animationFrame = requestAnimationFrame(animate);
    };

    if (animationEnabled) {
      animationFrame = requestAnimationFrame(animate);
    } else if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };
  }, [animationEnabled, animationSpeed]);

  useEffect(() => {
    if (canvasRef.current) {
      const currentDevicePixelRatio = window.devicePixelRatio || 1;

      const rect = canvasRef.current.getBoundingClientRect();

      cssCanvasDimensionsRef.current = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };

      canvasRef.current.width = rect.width * currentDevicePixelRatio;
      canvasRef.current.height = rect.height * currentDevicePixelRatio;

      canvasRef.current.style.width = `${rect.width}px`;
      canvasRef.current.style.height = `${rect.height}px`;

      canvasDimensionsRef.current = {
        left: rect.left,
        top: rect.top,
        width: rect.width * currentDevicePixelRatio,
        height: rect.height * currentDevicePixelRatio,
      };
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const currentDevicePixelRatio = window.devicePixelRatio || 1;

        cssCanvasDimensionsRef.current = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };

        canvasDimensionsRef.current = {
          left: rect.left,
          top: rect.top,
          width: rect.width * currentDevicePixelRatio,
          height: rect.height * currentDevicePixelRatio,
        };

        canvasRef.current.width = rect.width * currentDevicePixelRatio;
        canvasRef.current.height = rect.height * currentDevicePixelRatio;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (animationEnabled) {
      timeRef.current = 0;
      seedRef.current = Math.random() * 1000;
    }
  }, [animationEnabled]);

  return (
    <div className="main-container">
      <div>
        <Controls state={controlState} dispatch={dispatchControlState} />

        <button
          type="button"
          style={{ marginTop: '1rem' }}
          onClick={() => {
            setColors(getColors(rowCount, columnCount));
            if (animationEnabled) {
              timeRef.current = 0;
              seedRef.current = Math.random() * 1000;
            }
          }}
        >
          Randomize colors
        </button>
      </div>

      <CanvasWrapper
        canvasRef={canvasRef}
        containerRef={containerRef}
        cssCanvasDimensionsRef={cssCanvasDimensionsRef}
        controlState={controlState}
        setColors={setColors}
        setPoints={setPoints}
        points={points}
        colors={colors}
      />
    </div>
  );
}

export default App;
