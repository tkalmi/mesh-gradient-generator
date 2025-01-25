import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import {
  Color,
  ColorModel,
  CoonsPatch,
  CubicBezier,
  ParametricValues,
} from './types';
import { MARGIN } from './constants';
import { renderTensorPatchWithFFD } from './meshGradient/tensorPatchFFD';
import { coonsToTensorPatch } from './meshGradient/helpers';
import { renderTensorPatchWithSubdivision } from './meshGradient/tensorPatchSubdivision';
import { renderCoonsPatchWithFFD } from './meshGradient/coonsPatchFFD';
import { renderCoonsPatchWithSubdivision } from './meshGradient/coonsPatchSubdivision';

const CONTROL_POINT_RADIUS = 10 as const;

function convertXToCanvasX(x: number, width: number): number {
  return x * 0.01 * (width - MARGIN.left - MARGIN.right) + MARGIN.left;
}

function convertYToCanvasY(y: number, height: number): number {
  return y * 0.01 * (height - MARGIN.top - MARGIN.bottom) + MARGIN.top;
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

function getCoonsPatchFromRowsAndColumns(
  columns: CubicBezier[],
  rows: CubicBezier[],
  colorModel: ColorModel
): CoonsPatch<Color>[] {
  const patches: CoonsPatch<Color>[] = [];
  const coonsValues = {
    rgba: {
      northValue: [255, 0, 0, 255],
      eastValue: [0, 255, 0, 255],
      southValue: [0, 0, 255, 255],
      westValue: [255, 0, 255, 255],
    } as ParametricValues<Color>,
    hsla: {
      northValue: [0, 100, 50, 255],
      eastValue: [120, 100, 50, 255],
      southValue: [240, 100, 50, 255],
      westValue: [300, 100, 50, 255],
    } as ParametricValues<Color>,
    lcha: {
      northValue: [53.3, 100, 50, 40],
      eastValue: [87.7, 119.8, 136, 255],
      southValue: [32.3, 133.8, 306.3, 255],
      westValue: [60.3, 115.6, 328.2, 255],
    } as ParametricValues<Color>,
  }[colorModel];
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

  const [patchType, setPatchType] = useState<'coons' | 'tensor'>('tensor');
  const [rasterizerAlgorithm, setRasterizerAlgorithm] = useState<
    'ffd' | 'subdivision'
  >('ffd');
  const [colorModel, setColorModel] = useState<ColorModel>('rgba');

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
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;

    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const patches = getCoonsPatchFromRowsAndColumns(columns, rows, colorModel);

    for (const patch of patches) {
      const coonsPatch = coordinatesToPixels(patch);
      if (patchType === 'tensor') {
        const tensorPatch = coonsToTensorPatch(coonsPatch);
        if (rasterizerAlgorithm === 'ffd') {
          renderTensorPatchWithFFD(tensorPatch, colorModel, context);
        } else {
          renderTensorPatchWithSubdivision(tensorPatch, colorModel, context);
        }
      } else {
        if (rasterizerAlgorithm === 'ffd') {
          renderCoonsPatchWithFFD(coonsPatch, colorModel, context);
        } else {
          renderCoonsPatchWithSubdivision(coonsPatch, colorModel, context);
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

      const [columnPointIndex, rowPointIndex] =
        getHoveredColumnAndRowPointIndexes(event);

      draggedPointRowAndColumnIndexRef.current = [
        columnPointIndex,
        rowPointIndex,
      ];
    },
    [getHoveredColumnAndRowPointIndexes]
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
      // Detect if the mouse was dragged or clicked by comparing
      if (performance.now() - lastMouseDownTimestampRef.current < 200) {
        // TODO: If it was clicked, open color palette
        console.log('Clicked!');
      }

      const container = containerRef.current as HTMLDivElement;
      container!.style.cursor = 'default';
    },
    []
  );

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
              RGBA
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
        </form>

        <div style={{ width: 800, height: 600, position: 'relative' }}>
          <canvas
            width={800}
            height={600}
            ref={canvasRef}
            onMouseDown={handleMouseDown}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
