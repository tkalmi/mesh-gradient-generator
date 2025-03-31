import { useCallback, useRef, useState } from 'react';
import { CONTROL_POINT_RADIUS, MARGIN } from './constants';
import {
  clamp,
  convertXToCanvasX,
  convertYToCanvasY,
} from './meshGradient/helpers';
import { hexToRgb, rgbaToHex } from './meshGradient/colors';
import { Color, ControlState, Vec2 } from './types';

type Props = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  cssCanvasDimensionsRef: React.RefObject<{
    left: number;
    top: number;
    height: number;
    width: number;
  }>;
  controlState: ControlState;
  setColors: React.Dispatch<React.SetStateAction<Color[]>>;
  setPoints: React.Dispatch<React.SetStateAction<Vec2[]>>;
  points: Vec2[];
  colors: Color[];
};

function CanvasWrapper(props: Props) {
  const {
    canvasRef,
    containerRef,
    cssCanvasDimensionsRef,
    controlState,
    setColors,
    setPoints,
    points,
    colors,
  } = props;
  const { columnCount } = controlState;

  const [activeColorIndex, setActiveColorIndex] = useState<
    [number, number] | null
  >(null);

  const lastMouseDownTimestampRef = useRef(0);
  const draggedPointIndexRef = useRef<number | null>(null);
  const colorPickerRef = useRef<HTMLInputElement>(null);

  const getHoveredPointIndex = useCallback(
    (
      event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>
    ): number => {
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const { left, top } = cssCanvasDimensionsRef.current!;
      const { width, height } = cssCanvasDimensionsRef.current!;

      const x =
        'changedTouches' in event
          ? (event as React.TouchEvent<HTMLElement>).changedTouches[0].clientX
          : (event as React.MouseEvent<HTMLElement>).clientX - left;
      const y =
        'changedTouches' in event
          ? (event as React.TouchEvent<HTMLElement>).changedTouches[0].clientY
          : (event as React.MouseEvent<HTMLElement>).clientY - top;
      const index = points.findIndex((point) => {
        const [px, py] = point;
        return (
          Math.abs(convertXToCanvasX(px, width) - x - scrollX) <=
            CONTROL_POINT_RADIUS &&
          Math.abs(convertYToCanvasY(py, height) - y - scrollY) <=
            CONTROL_POINT_RADIUS
        );
      });

      return index;
    },
    [points, cssCanvasDimensionsRef]
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
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const { left, top } = cssCanvasDimensionsRef.current!;
      const { width, height } = cssCanvasDimensionsRef.current!;
      const { clientX, clientY } =
        'changedTouches' in event
          ? (event as React.TouchEvent<HTMLDivElement>).changedTouches[0]
          : (event as React.MouseEvent<HTMLDivElement>);
      const x =
        ((clamp(
          CONTROL_POINT_RADIUS,
          width - CONTROL_POINT_RADIUS,
          clientX - left + scrollX
        ) -
          MARGIN.left) /
          (width - MARGIN.left - MARGIN.right)) *
        100;

      const y =
        ((clamp(
          CONTROL_POINT_RADIUS,
          height - CONTROL_POINT_RADIUS,
          clientY - top + scrollY
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
    [getHoveredPointIndex, containerRef, cssCanvasDimensionsRef, setPoints]
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
    [getHoveredPointIndex, columnCount, containerRef]
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div
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
              (canvasRef.current?.height ?? 0) / devicePixelRatio
            ),
            left: convertXToCanvasX(
              points[activeColorIndex?.[1] ?? 0][0],
              (canvasRef.current?.width ?? 0) / devicePixelRatio
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
          ref={canvasRef}
          onMouseDown={handleCursorDown}
          onTouchStart={handleCursorDown}
        />
      </div>
      <p>
        Feeling lost? Instructions in the{' '}
        <a
          href="https://github.com/tkalmi/mesh-gradient-generator"
          target="__blank"
        >
          GitHub repo
        </a>
        .
      </p>
    </div>
  );
}

export default CanvasWrapper;
