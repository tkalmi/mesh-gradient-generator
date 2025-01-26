import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Color, ColorModel, CoonsPatch, CubicBezier } from './types';
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
import { renderControlPoints } from './meshGradient/controlPoints';
import { renderTensorPatchWithFFD } from './meshGradient/tensorPatchFFD';
import { renderTensorPatchWithSubdivision } from './meshGradient/tensorPatchSubdivision';
import { renderCoonsPatchWithFFD } from './meshGradient/coonsPatchFFD';
import { renderCoonsPatchWithSubdivision } from './meshGradient/coonsPatchSubdivision';

function getCoonsPatchFromRowsAndColumns(
  columns: CubicBezier[],
  rows: CubicBezier[],
  colors: Color[]
): CoonsPatch<Color>[] {
  const patches: CoonsPatch<Color>[] = [];
  for (let i = 1; i < rows.length; i++) {
    for (let j = 1; j < columns.length; j++) {
      const north = rows[j - 1];
      const south = rows[j].slice().reverse() as CubicBezier;
      const west = columns[i - 1].slice().reverse() as CubicBezier;
      const east = columns[i];

      const coonsPatch: CoonsPatch<Color> = {
        north,
        east,
        south,
        west,
        coonsValues: {
          northValue: colors[(j - 1) * 2],
          eastValue: colors[(j - 1) * 2 + 1],
          southValue: colors[j * 2 + 1],
          westValue: colors[j * 2],
        },
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

  // In RGBA, two for each row
  const [colors, setColors] = useState<Color[]>([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [255, 0, 255, 255],
    [0, 0, 255, 255],
  ]);

  const [patchType, setPatchType] = useState<'coons' | 'tensor'>('tensor');
  const [rasterizerAlgorithm, setRasterizerAlgorithm] = useState<
    'ffd' | 'subdivision'
  >('ffd');
  const [colorModel, setColorModel] = useState<ColorModel>('rgba');
  const [subdivisionCount, setSubdivisionCount] = useState(5);
  const [renderContext, setRenderContext] = useState<'2d' | 'webgl'>('2d');

  const [activeColorIndex, setActiveColorIndex] = useState<number | null>(null);

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
      // TODO: Implement WebGL versions of these
      const patches = getCoonsPatchFromRowsAndColumns(
        columns,
        rows,
        convertedColors
      );

      for (const patch of patches) {
        const coonsPatch = coordinatesToPixels(patch);
        if (patchType === 'tensor') {
          const tensorPatch = coonsToTensorPatch(coonsPatch);
          if (rasterizerAlgorithm === 'ffd') {
            renderTensorPatchWithFFD(tensorPatch, colorModel, context);
          } else {
            renderTensorPatchWithSubdivision(
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
    }

    renderControlPoints(context, columns, rows);
  }, [
    columns,
    rows,
    patchType,
    rasterizerAlgorithm,
    colorModel,
    coordinatesToPixels,
    subdivisionCount,
    convertedColors,
    renderContext,
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
  const draggedPointRowAndColumnIndexRef = useRef<
    [[number, number] | null, [number, number] | null]
  >([null, null]);

  const getHoveredColumnAndRowPointIndexes = useCallback(
    (
      event: React.MouseEvent<HTMLElement>
    ): [[number, number] | null, [number, number] | null] => {
      const { left, top, width, height } = canvasDimensionsRef.current;
      const x = event.clientX - left;
      const y = event.clientY - top;
      const columnPoint = columns.flat().findIndex((point) => {
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

      return [columnPointIndex, rowPointIndex];
    },
    [columns, rows]
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

      const [columnPointIndex, rowPointIndex] =
        getHoveredColumnAndRowPointIndexes(event);

      draggedPointRowAndColumnIndexRef.current = [
        columnPointIndex,
        rowPointIndex,
      ];
    },
    [getHoveredColumnAndRowPointIndexes, activeColorIndex]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current as HTMLDivElement;
      if (
        draggedPointRowAndColumnIndexRef.current.every(
          (index) => index === null
        )
      ) {
        if (
          getHoveredColumnAndRowPointIndexes(event).some((ind) => ind != null)
        ) {
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
    [getHoveredColumnAndRowPointIndexes]
  );

  const handleMouseUp = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      draggedPointRowAndColumnIndexRef.current = [null, null];
      const hoveredColumnAndRowPointIndexes =
        getHoveredColumnAndRowPointIndexes(event);
      // Detect if the mouse was dragged or clicked by comparing
      if (performance.now() - lastMouseDownTimestampRef.current < 200) {
        // If it was clicked on top of a corner control point, open color palette
        const rowPointIndex = hoveredColumnAndRowPointIndexes[1];
        if (rowPointIndex != null && [0, 3].includes(rowPointIndex[1])) {
          setActiveColorIndex(rowPointIndex[0] * 2 + (rowPointIndex[1] % 2));
          setTimeout(() => colorPickerRef.current?.click(), 50); // Set a minor delay to give the color picker time to position right
        } else {
          setActiveColorIndex(null);
        }
      } else {
        setActiveColorIndex(null);
      }

      const container = containerRef.current as HTMLDivElement;
      if (hoveredColumnAndRowPointIndexes.some((ind) => ind != null)) {
        container.style.cursor = 'grab';
      } else {
        container.style.cursor = 'default';
      }
    },
    [getHoveredColumnAndRowPointIndexes]
  );

  const maxSubdivisions = 8; /* 
  Theoretically the maximum depth should be something like this, but it's pretty heavy, so limit it to 8, which is the upper limit for my MBP.
  Math.round(
    Math.max(
      Math.log2(canvasDimensionsRef.current.width / (columns.length - 1)),
      Math.log2(canvasDimensionsRef.current.height / (rows.length - 1))
    )
  ); */

  return (
    <div
      className="hover-container"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      ref={containerRef}
    >
      <div className="main-container">
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
        </form>

        <div style={{ width: 800, height: 600, position: 'relative' }}>
          <input
            style={{
              opacity: 0,
              visibility: 'hidden',
              width: 0,
              height: 0,
              position: 'absolute',
              top: convertYToCanvasY(
                rows[Math.floor((activeColorIndex ?? 0) / 2)][
                  (activeColorIndex ?? 0) % 2 ? 3 : 0
                ][1],
                canvasRef.current?.height ?? 0
              ),
              left: convertXToCanvasX(
                rows[Math.floor((activeColorIndex ?? 0) / 2)][
                  (activeColorIndex ?? 0) % 2 ? 3 : 0
                ][0],
                canvasRef.current?.width ?? 0
              ),
              pointerEvents: activeColorIndex == null ? 'none' : 'auto',
            }}
            type="color"
            id="color-picker"
            value={rgbaToHex(colors[activeColorIndex ?? 0])}
            autoFocus
            onChange={(event: React.FormEvent<HTMLInputElement>) => {
              const value = event.currentTarget.value;
              setColors((prevColors) =>
                prevColors.map((color, ind) =>
                  ind === activeColorIndex ? hexToRgb(value) : color
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
    </div>
  );
}

export default App;
