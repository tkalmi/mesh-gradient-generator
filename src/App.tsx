import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Color, ColorModel, CoonsPatch, CubicBezier, Vec2 } from './types';
import { CONTROL_POINT_RADIUS, MARGIN } from './constants';
import {
  clamp,
  convertXToCanvasX,
  convertYToCanvasY,
  coonsToTensorPatch,
} from './meshGradient/helpers';
import {
  hexToRgb,
  rgbaToHex,
  rgbaToHsla,
  rgbaToOklab,
} from './meshGradient/colors';
import { renderTensorPatchesWithSubdivisionWebGL } from './meshGradient/tensorPatchSubdivision';
import { renderControlPoints } from './meshGradient/controlPoints';
import { animatePoint } from './meshGradient/animationUtils';

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

  const colorPickerRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef(0);
  const seedRef = useRef(Math.random() * 1000);
  const [forceUpdateKey, setForceUpdateKey] = useState(0); // The sole purpose of this state is to retrigger a useMemo call

  const [colorModel, setColorModel] = useState<ColorModel>('rgba');
  const [subdivisionCount, setSubdivisionCount] = useState(4);
  const [showBezierCurves, setShowBezierCurves] = useState(true);
  const [showControlPoints, setShowControlPoints] = useState(true);
  const [rowCount, setRowCount] = useState(2);
  const [columnCount, setColumnCount] = useState(2);
  const [useSimpleUV, setUseSimpleUV] = useState(false);

  const [points, setPoints] = useState<Vec2[]>(getNewPoints(1, 1));
  const [animationEnabled, setAnimationEnabled] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [animationAmplitude, setAnimationAmplitude] = useState(5);
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

  const [activeColorIndex, setActiveColorIndex] = useState<
    [number, number] | null
  >(null);

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

  const lastMouseDownTimestampRef = useRef(0);
  const draggedPointIndexRef = useRef<number | null>(null);

  const getHoveredPointIndex = useCallback(
    (
      event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>
    ): number => {
      const { left, top } = cssCanvasDimensionsRef.current;
      const { width, height } = cssCanvasDimensionsRef.current;

      const x =
        'changedTouches' in event
          ? (event as React.TouchEvent<HTMLElement>).changedTouches[0].clientX
          : (event as React.MouseEvent<HTMLElement>).clientX - left;
      const y =
        'changedTouches' in event
          ? (event as React.TouchEvent<HTMLElement>).changedTouches[0].clientY
          : (event as React.MouseEvent<HTMLElement>).clientY - top;
      const distanceThreshold =
        'changedTouches' in event ? 50 : CONTROL_POINT_RADIUS;
      const index = points.findIndex((point) => {
        const [px, py] = point;
        return (
          Math.abs(
            px * 0.01 * (width - MARGIN.left - MARGIN.right) + MARGIN.left - x
          ) <= distanceThreshold &&
          Math.abs(
            py * 0.01 * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top - y
          ) <= distanceThreshold
        );
      });

      return index;
    },
    [points]
  );

  const handleCursorDown = useCallback(
    (
      event:
        | React.MouseEvent<HTMLCanvasElement>
        | React.TouchEvent<HTMLCanvasElement>
    ) => {
      lastMouseDownTimestampRef.current = performance.now();

      if (
        activeColorIndex &&
        event.currentTarget.closest('input') !== colorPickerRef.current
      ) {
        setActiveColorIndex(null);
      }

      draggedPointIndexRef.current = getHoveredPointIndex(event);
    },
    [getHoveredPointIndex, activeColorIndex]
  );

  const handleCursorMove = useCallback(
    (
      event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>
    ) => {
      const container = containerRef.current as HTMLDivElement;
      if (draggedPointIndexRef.current === null) {
        if (getHoveredPointIndex(event) >= 0) {
          container.style.cursor = 'grab';
        } else {
          container.style.cursor = 'default';
        }
        return;
      }
      container.style.cursor = 'grabbing';
      const { left, top } = cssCanvasDimensionsRef.current;
      const { width, height } = cssCanvasDimensionsRef.current;
      const { clientX, clientY } =
        'changedTouches' in event
          ? (event as React.TouchEvent<HTMLDivElement>).changedTouches[0]
          : (event as React.MouseEvent<HTMLDivElement>);
      const x =
        ((clamp(
          CONTROL_POINT_RADIUS,
          width - CONTROL_POINT_RADIUS,
          clientX - left
        ) -
          MARGIN.left) /
          (width - MARGIN.left - MARGIN.right)) *
        100;

      const y =
        ((clamp(
          CONTROL_POINT_RADIUS,
          height - CONTROL_POINT_RADIUS,
          clientY - top
        ) -
          MARGIN.top) /
          (height - MARGIN.top - MARGIN.bottom)) *
        100;

      setPoints((prevPoints) => {
        const nextPoints = [...prevPoints];
        nextPoints[draggedPointIndexRef.current!] = [x, y];
        return nextPoints;
      });
    },
    [getHoveredPointIndex]
  );

  const handleCursorUp = useCallback(
    (
      event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>
    ) => {
      function getControlPointColorIndex(
        pointIndex: number | null
      ): number | null {
        if (pointIndex === null) {
          return null;
        }
        const fullRowLength = columnCount * 3 + 1;
        const controlRowLength = columnCount + 1;
        let index = pointIndex;
        let rowsAdded = 0;
        while (true) {
          if (index < 0) {
            return null;
          } else if (index < fullRowLength) {
            return index % 3 === 0
              ? index / 3 + rowsAdded * (columnCount + 1)
              : null;
          } else if (index >= fullRowLength + 2 * controlRowLength) {
            index -= fullRowLength + 2 * controlRowLength;
            rowsAdded++;
          } else {
            return null;
          }
        }
      }

      draggedPointIndexRef.current = null;
      const hoveredPointIndex = getHoveredPointIndex(event);
      // Detect if the mouse was dragged or clicked by comparing
      if (performance.now() - lastMouseDownTimestampRef.current < 200) {
        // If it was clicked on top of a corner control point, open color palette
        const colorIndex = getControlPointColorIndex(hoveredPointIndex);
        if (hoveredPointIndex !== null && colorIndex !== null) {
          setActiveColorIndex([colorIndex, hoveredPointIndex]);
          setTimeout(() => colorPickerRef.current?.click(), 50); // Set a minor delay to give the color picker time to position right
        } else {
          setActiveColorIndex(null);
        }
      } else {
        setActiveColorIndex(null);
      }

      const container = containerRef.current as HTMLDivElement;
      if (hoveredPointIndex !== null) {
        container.style.cursor = 'grab';
      } else {
        container.style.cursor = 'default';
      }
    },
    [getHoveredPointIndex, columnCount]
  );

  const maxSubdivisions = 8; /* 
  Theoretically the maximum depth should be something like this, but it's pretty heavy, so limit it to 8, which seems to be the upper limit for my MBP.
  Math.round(
    Math.max(
      Math.log2(canvasDimensionsRef.current.width / (columns.length - 1)),
      Math.log2(canvasDimensionsRef.current.height / (rows.length - 1))
    )
  ); */

  return (
    <div className="main-container">
      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <fieldset>
          <legend>Animation</legend>
          <label>
            <input
              type="checkbox"
              id="animationEnabled"
              name="animationEnabled"
              checked={animationEnabled}
              onChange={() => setAnimationEnabled((prev) => !prev)}
            />{' '}
            Enable animation
          </label>
          {animationEnabled && (
            <>
              <div>
                <label htmlFor="animation-speed">
                  Speed: {animationSpeed.toFixed(1)}
                </label>
                <input
                  style={{ marginInline: '0.5em', width: '100%' }}
                  id="animation-speed"
                  value={animationSpeed}
                  onChange={(event) =>
                    setAnimationSpeed(clamp(0.1, 5, Number(event.target.value)))
                  }
                  type="range"
                  min={0.1}
                  max={5}
                  step={0.1}
                />
              </div>
              <div>
                <label htmlFor="animation-amplitude">
                  Amplitude: {animationAmplitude}
                </label>
                <input
                  style={{ marginInline: '0.5em', width: '100%' }}
                  id="animation-amplitude"
                  value={animationAmplitude}
                  onChange={(event) =>
                    setAnimationAmplitude(
                      clamp(1, 15, Math.round(Number(event.target.value)))
                    )
                  }
                  type="range"
                  min={1}
                  max={15}
                  step={1}
                />
              </div>
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>Select patch subdivision count</legend>
          <label>
            <input
              style={{ marginInline: '0.5em' }}
              id="subdivision-count"
              value={subdivisionCount}
              onChange={(event) =>
                setSubdivisionCount(
                  clamp(
                    0,
                    maxSubdivisions,
                    Math.round(Number(event.target.value ?? 0))
                  )
                )
              }
              type="number"
              min={0}
              max={maxSubdivisions}
            />
            subdivisions
          </label>
        </fieldset>

        <fieldset>
          <legend>Select color model</legend>
          <label>
            <input
              type="radio"
              value="rgba"
              id="rgba"
              name="colorModel"
              checked={colorModel === 'rgba'}
              onChange={() => setColorModel('rgba')}
            />{' '}
            RGB
          </label>
          <label>
            <input
              type="radio"
              value="oklab"
              id="oklab"
              name="colorModel"
              checked={colorModel === 'oklab'}
              onChange={() => setColorModel('oklab')}
            />{' '}
            Oklab
          </label>
          <label>
            <input
              type="radio"
              value="hsla"
              id="hsla"
              name="colorModel"
              checked={colorModel === 'hsla'}
              onChange={() => setColorModel('hsla')}
            />{' '}
            HSL
          </label>
        </fieldset>

        <fieldset>
          <legend>Use simple UV</legend>
          <label>
            <input
              type="radio"
              value="true"
              id="useSimpleUV-true"
              name="useSimpleUV"
              checked={useSimpleUV}
              onChange={() => setUseSimpleUV(true)}
            />{' '}
            True
          </label>
          <label>
            <input
              type="radio"
              value="false"
              id="useSimpleUV-false"
              name="useSimpleUV"
              checked={!useSimpleUV}
              onChange={() => setUseSimpleUV(false)}
            />{' '}
            False
          </label>
        </fieldset>

        <fieldset>
          <legend>Helper visibility</legend>
          <label>
            <input
              type="checkbox"
              id="showBezierCurves"
              name="showBezierCurves"
              checked={showBezierCurves}
              onChange={() => setShowBezierCurves((prev) => !prev)}
            />{' '}
            Show Bezier curves
          </label>
          <label>
            <input
              type="checkbox"
              id="showControlPoints"
              name="showBezierCurves"
              checked={showControlPoints}
              onChange={() => setShowControlPoints((prev) => !prev)}
            />{' '}
            Show control points
          </label>
        </fieldset>

        <fieldset>
          <legend>Select patch count</legend>
          <label>
            <input
              style={{ marginInline: '0.5em' }}
              id="row-count"
              value={rowCount}
              onChange={(event) =>
                setRowCount(
                  clamp(1, 4, Math.round(Number(event.target.value ?? 0)))
                )
              }
              type="number"
              min={1}
              max={4}
            />
            rows
          </label>
          <label>
            <input
              style={{ marginInline: '0.5em' }}
              id="column-count"
              value={columnCount}
              onChange={(event) =>
                setColumnCount(
                  clamp(1, 4, Math.round(Number(event.target.value ?? 0)))
                )
              }
              type="number"
              min={1}
              max={4}
            />
            columns
          </label>
        </fieldset>

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
      </form>

      <div
        style={{ width: 800, height: 600, position: 'relative' }}
        className="hover-container"
        onTouchMove={handleCursorMove}
        onTouchEnd={handleCursorUp}
        onMouseMove={handleCursorMove}
        onMouseUp={handleCursorUp}
        ref={containerRef}
      >
        <input
          style={{
            opacity: 0,
            visibility: 'hidden',
            width: 0,
            height: 0,
            position: 'absolute',
            top: convertYToCanvasY(
              points[activeColorIndex?.[1] ?? 0][1],
              canvasRef.current?.height ?? 0
            ),
            left: convertXToCanvasX(
              points[activeColorIndex?.[1] ?? 0][0],
              canvasRef.current?.width ?? 0
            ),
            pointerEvents: activeColorIndex == null ? 'none' : 'auto',
          }}
          type="color"
          id="color-picker"
          value={rgbaToHex(colors[activeColorIndex?.[0] ?? 0])}
          autoFocus
          onChange={(event: React.FormEvent<HTMLInputElement>) => {
            const value = event.currentTarget.value;
            setColors((prevColors) =>
              prevColors.map((color, ind) =>
                ind === activeColorIndex?.[0] ? hexToRgb(value) : color
              )
            );
          }}
          ref={colorPickerRef}
        />
        <canvas
          style={{ width: 800, height: 600 }}
          ref={canvasRef}
          onMouseDown={handleCursorDown}
          onTouchStart={handleCursorDown}
        />
      </div>
    </div>
  );
}

export default App;
