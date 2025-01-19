import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { CoonsPatch, CubicBezier, RGBA } from './types';
import { MARGIN } from './constants';
import {
  coonsToTensorPatch,
  coordinatesToPixels,
  renderCoonsPatchWithFFD,
  renderCoonsPatchWithSubdivision,
  renderTensorPatchWithFFD,
  renderTensorPatchWithSubdivision,
} from './meshGradient';

const CONTROL_POINT_RADIUS = 10 as const;

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

function App() {
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

  const [patchType, setPatchType] = useState<'coons' | 'tensor'>('tensor');
  const [rasterizerAlgorithm, setRasterizerAlgorithm] = useState<
    'ffd' | 'subdivision'
  >('ffd');

  useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;

    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const patches = getCoonsPatchFromRowsAndColumns(columns, rows);

    for (const patch of patches) {
      const coonsPatch = coordinatesToPixels(patch, canvas);
      if (patchType === 'tensor') {
        if (rasterizerAlgorithm === 'ffd') {
          renderTensorPatchWithFFD(coonsToTensorPatch(coonsPatch), context);
        } else {
          renderTensorPatchWithSubdivision(
            coonsToTensorPatch(coonsPatch),
            context
          );
        }
      } else {
        if (rasterizerAlgorithm === 'ffd') {
          renderCoonsPatchWithFFD(coonsPatch, context);
        } else {
          renderCoonsPatchWithSubdivision(coonsPatch, context);
        }
      }
    }

    renderControlPoints(context, columns, rows);
  }, [columns, rows, patchType, rasterizerAlgorithm]);

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
