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
  rgbaToLcha,
} from './meshGradient/colors';
import {
  renderTensorPatchWithFFD2d,
  renderTensorPatchesWithFFDWebGL,
} from './meshGradient/tensorPatchFFD';
import {
  renderTensorPatchWithSubdivision2d,
  renderTensorPatchesWithSubdivisionWebGL,
} from './meshGradient/tensorPatchSubdivision';
import { renderCoonsPatchWithFFD } from './meshGradient/coonsPatchFFD';
import { renderCoonsPatchWithSubdivision } from './meshGradient/coonsPatchSubdivision';
import { renderControlPoints } from './meshGradient/controlPoints';

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
  const colorPickerRef = useRef<HTMLInputElement>(null);

  const [points, setPoints] = useState<Vec2[]>(getNewPoints(1, 1));

  const [patchType, setPatchType] = useState<'coons' | 'tensor'>('tensor');
  const [rasterizerAlgorithm, setRasterizerAlgorithm] = useState<
    'ffd' | 'subdivision'
  >('subdivision');
  const [colorModel, setColorModel] = useState<ColorModel>('rgba');
  const [subdivisionCount, setSubdivisionCount] = useState(7);
  const [renderContext, setRenderContext] = useState<'2d' | 'webgl'>('webgl');
  const [showBezierCurves, setShowBezierCurves] = useState(false);
  const [showControlPoints, setShowControlPoints] = useState(true);
  const [rowCount, setRowCount] = useState(3);
  const [columnCount, setColumnCount] = useState(3);
  // In RGBA, two for each row
  const [rawColors, setColors] = useState<Color[]>(
    getColors(rowCount, columnCount)
  );

  const { columns, rows } = getColumnsAndRowsFromPoints(
    points,
    columnCount,
    rowCount
  );

  const colors = (() => {
    const newColors = getColors(rowCount, columnCount);
    if (newColors.length === rawColors.length) {
      return rawColors;
    }
    return newColors;
  })();

  const [activeColorIndex, setActiveColorIndex] = useState<
    [number, number] | null
  >(null);

  const convertedColors = useMemo(() => {
    // Convert to proper color model here if necessary
    switch (colorModel) {
      case 'hsla':
        return colors.map((color) => rgbaToHsla(color));
      case 'lcha':
        return colors.map((color) => rgbaToLcha(color));
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

  const coordinatesToPixels = useCallback(
    (patch: CoonsPatch<Color>): CoonsPatch<Color> => {
      const { height, width } = canvasDimensionsRef.current;
      return {
        ...patch,
        north: patch.north.map(([x, y]) => [
          x * 0.01 * (width - MARGIN.left - MARGIN.right) + MARGIN.left,
          y * 0.01 * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top,
        ]) as CubicBezier,
        south: patch.south.map(([x, y]) => [
          x * 0.01 * (width - MARGIN.left - MARGIN.right) + MARGIN.left,
          y * 0.01 * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top,
        ]) as CubicBezier,
        east: patch.east.map(([x, y]) => [
          x * 0.01 * (width - MARGIN.left - MARGIN.right) + MARGIN.left,
          y * 0.01 * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top,
        ]) as CubicBezier,
        west: patch.west.map(([x, y]) => [
          x * 0.01 * (width - MARGIN.left - MARGIN.right) + MARGIN.left,
          y * 0.01 * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top,
        ]) as CubicBezier,
      };
    },
    []
  );

  useEffect(() => {
    const context = (() => {
      const canvas = canvasRef.current!;
      if (renderContext === 'webgl') {
        const context = canvas.getContext('webgl')!;
        context.clearColor(0.0, 0.0, 0.0, 1.0);
        context.clearDepth(1);
        context.enable(context.DEPTH_TEST);
        context.depthFunc(context.LEQUAL);
        context.viewport(0, 0, context.canvas.width, context.canvas.height);
        context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
        return context;
      } else if (renderContext === '2d') {
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);
        return context;
      } else {
        throw Error('Unknown render context option selected.');
      }
    })();

    if (context instanceof CanvasRenderingContext2D) {
      const patches = getCoonsPatchFromRowsAndColumns(
        columns,
        rows,
        convertedColors,
        columnCount,
        rowCount
      );

      for (const patch of patches) {
        const coonsPatch = coordinatesToPixels(patch);
        if (patchType === 'tensor') {
          const tensorPatch = coonsToTensorPatch(coonsPatch);
          if (rasterizerAlgorithm === 'ffd') {
            renderTensorPatchWithFFD2d(tensorPatch, colorModel, context);
          } else {
            renderTensorPatchWithSubdivision2d(
              tensorPatch,
              colorModel,
              subdivisionCount,
              context
            );
          }
        } else {
          if (rasterizerAlgorithm === 'ffd') {
            renderCoonsPatchWithFFD(coonsPatch, colorModel, context);
          } else {
            renderCoonsPatchWithSubdivision(
              coonsPatch,
              colorModel,
              subdivisionCount,
              context
            );
          }
        }
      }
    } else if (context instanceof WebGLRenderingContext) {
      const patches = getCoonsPatchFromRowsAndColumns(
        columns,
        rows,
        convertedColors,
        columnCount,
        rowCount
      );
      const coonsPatches = patches.map((patch) => coordinatesToPixels(patch));
      const tensorPatches = coonsPatches.map((coonsPatch, ind) =>
        coonsToTensorPatch(coonsPatch)
      );
      if (rasterizerAlgorithm === 'subdivision') {
        if (patchType === 'tensor') {
          renderTensorPatchesWithSubdivisionWebGL(
            tensorPatches.map((patch, ind) => ({
              patch,
              x: ind % columnCount,
              y: Math.floor(ind / columnCount),
            })),
            colorModel,
            subdivisionCount,
            context
          );
        } else {
          // renderCoonsPatchesWithFFD(coonsPatch, colorModel, context);
        }
      } else {
        if (patchType === 'tensor') {
          renderTensorPatchesWithFFDWebGL(tensorPatches, colorModel, context);
        } else {
          // renderCoonsPatceshWithSubdivision(
          //   coonsPatch,
          //   colorModel,
          //   subdivisionCount,
          //   context
          // );
        }
      }
    }

    renderControlPoints(
      context,
      columns,
      rows,
      showControlPoints,
      showBezierCurves
    );
  }, [
    columns,
    rows,
    columnCount,
    rowCount,
    patchType,
    rasterizerAlgorithm,
    colorModel,
    coordinatesToPixels,
    subdivisionCount,
    convertedColors,
    renderContext,
    showControlPoints,
    showBezierCurves,
  ]);

  useEffect(() => {
    const setCanvasDimensionsRef = () => {
      canvasDimensionsRef.current = canvasRef.current!.getBoundingClientRect();
    };

    setCanvasDimensionsRef();

    window.addEventListener('resize', setCanvasDimensionsRef);
    return () => {
      window.removeEventListener('resize', setCanvasDimensionsRef);
    };
  }, []);

  const lastMouseDownTimestampRef = useRef(0);
  const draggedPointIndexRef = useRef<number | null>(null);

  const getHoveredPointIndex = useCallback(
    (event: React.MouseEvent<HTMLElement>): number => {
      const { left, top, width, height } = canvasDimensionsRef.current;
      const x = event.clientX - left;
      const y = event.clientY - top;
      const index = points.findIndex((point) => {
        const [px, py] = point;
        return (
          Math.abs(
            px * 0.01 * (width - MARGIN.left - MARGIN.right) + MARGIN.left - x
          ) <= CONTROL_POINT_RADIUS &&
          Math.abs(
            py * 0.01 * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top - y
          ) <= CONTROL_POINT_RADIUS
        );
      });

      return index;
    },
    [points]
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
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

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
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
      const { left, top, height, width } = canvasDimensionsRef.current;
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

      setPoints((prevPoints) => {
        const nextPoints = [...prevPoints];
        nextPoints[draggedPointIndexRef.current!] = [x, y];
        return nextPoints;
      });
    },
    [getHoveredPointIndex]
  );

  const handleMouseUp = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
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
    <div
      className="main-container"
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: '2rem',
        minWidth: '100vw',
        justifyContent: 'center',
      }}
    >
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

        <fieldset>
          <legend>Select rasterizer algorithm</legend>
          <label>
            <input
              type="radio"
              value="ffd"
              id="ffd"
              name="rasterizerAlgorithm"
              checked={rasterizerAlgorithm === 'ffd'}
              onChange={() => setRasterizerAlgorithm('ffd')}
            />{' '}
            Fast-forward differencing
          </label>
          <label>
            <input
              type="radio"
              value="subdivision"
              id="subdivision"
              name="rasterizerAlgorithm"
              checked={rasterizerAlgorithm === 'subdivision'}
              onChange={() => setRasterizerAlgorithm('subdivision')}
            />{' '}
            Patch subdivision
          </label>
          <label>
            <input
              style={{ marginInline: '0.5em' }}
              id="subdivision-count"
              disabled={rasterizerAlgorithm !== 'subdivision'}
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
          <legend>Select color space</legend>
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
              value="hsla"
              id="hsla"
              name="colorModel"
              checked={colorModel === 'hsla'}
              onChange={() => setColorModel('hsla')}
            />{' '}
            HSL
          </label>
          <label>
            <input
              type="radio"
              value="lcha"
              id="lcha"
              name="colorModel"
              checked={colorModel === 'lcha'}
              onChange={() => setColorModel('lcha')}
            />{' '}
            LCH
          </label>
        </fieldset>

        <fieldset>
          <legend>Select render context</legend>
          <label>
            <input
              type="radio"
              value="2d"
              id="2d"
              name="renderContext"
              checked={renderContext === '2d'}
              onChange={() => setRenderContext('2d')}
            />{' '}
            2D Canvas
          </label>
          <label>
            <input
              type="radio"
              value="webgl"
              id="webgl"
              name="renderContext"
              disabled={!window.WebGLRenderingContext}
              checked={renderContext === 'webgl'}
              onChange={() => setRenderContext('webgl')}
            />{' '}
            WebGL
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
          onClick={() => setColors(getColors(rowCount, columnCount))}
        >
          Randomize colors
        </button>
      </form>

      <div
        style={{ width: 800, height: 600, position: 'relative' }}
        className="hover-container"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
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
        {renderContext === '2d' && (
          <canvas
            width={800}
            height={600}
            ref={canvasRef}
            onMouseDown={handleMouseDown}
          />
        )}
        {renderContext === 'webgl' && (
          <canvas
            width={800}
            height={600}
            ref={canvasRef}
            onMouseDown={handleMouseDown}
          />
        )}
      </div>
    </div>
  );
}

export default App;
