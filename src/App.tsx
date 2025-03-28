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
import {
  getColors,
  getColumnsAndRowsFromPoints,
  getCoonsPatchFromRowsAndColumns,
  getNewPoints,
} from './appHelpers';

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

  const handleRandomizeColors = useCallback(() => {
    setColors(getColors(rowCount, columnCount));
    if (animationEnabled) {
      timeRef.current = 0;
      seedRef.current = Math.random() * 1000;
    }
  }, [animationEnabled, columnCount, rowCount]);

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

  // Initialize new points when row or column count changes
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

  // Handle rendering, which is triggered when any of the parameters change
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

    function adjustForMargin(patch: CoonsPatch<Color>): CoonsPatch<Color> {
      const { height, width } = cssCanvasDimensionsRef.current;
      const dpr = window.devicePixelRatio || 1;
      // Convert margins to percentages
      const marginLeft = ((MARGIN.left / width) * 100) / dpr;
      const marginRight = ((MARGIN.right / width) * 100) / dpr;
      const marginTop = ((MARGIN.top / height) * 100) / dpr;
      const marginBottom = ((MARGIN.bottom / height) * 100) / dpr;

      const getX = (x: number): number =>
        x * 0.01 * (100 - marginLeft - marginRight) + marginLeft;
      const getY = (y: number): number =>
        y * 0.01 * (100 - marginTop - marginBottom) + marginTop;

      return {
        ...patch,
        north: patch.north.map(([x, y]) => [getX(x), getY(y)]) as CubicBezier,
        south: patch.south.map(([x, y]) => [getX(x), getY(y)]) as CubicBezier,
        east: patch.east.map(([x, y]) => [getX(x), getY(y)]) as CubicBezier,
        west: patch.west.map(([x, y]) => [getX(x), getY(y)]) as CubicBezier,
      };
    }

    const coonsPatches = patches.map((patch) => adjustForMargin(patch));
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
    subdivisionCount,
    convertedColors,
    showControlPoints,
    showBezierCurves,
    useSimpleUV,
    forceUpdateKey,
  ]);

  // Handle animation loop
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

  // Initialize canvas sizing and handle resize
  useEffect(() => {
    const handleResize = () => {
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
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Re-seed animation params when toggled on.
  useEffect(() => {
    if (animationEnabled) {
      timeRef.current = 0;
      seedRef.current = Math.random() * 1000;
    }
  }, [animationEnabled]);

  return (
    <div className="main-container">
      <Controls
        state={controlState}
        dispatch={dispatchControlState}
        handleRandomizeColors={handleRandomizeColors}
      />

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
