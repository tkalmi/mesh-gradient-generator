import { useRef } from 'react';
import { clamp } from './meshGradient/helpers';
import { ControlState } from './types';

type TooltipProps = {
  children: string;
};

function Tooltip(props: TooltipProps) {
  const { children } = props;
  const tooltipKeyRef = useRef(Math.random().toString());

  return (
    <div className="tooltip-container">
      <button
        id={tooltipKeyRef.current + '-trigger'}
        className="tooltip-anchor"
        type="button"
        popoverTarget={tooltipKeyRef.current}
        popoverTargetAction="toggle"
      >
        <svg
          width="1rem"
          height="1rem"
          viewBox="0 0 15 15"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M0.877075 7.49972C0.877075 3.84204 3.84222 0.876892 7.49991 0.876892C11.1576 0.876892 14.1227 3.84204 14.1227 7.49972C14.1227 11.1574 11.1576 14.1226 7.49991 14.1226C3.84222 14.1226 0.877075 11.1574 0.877075 7.49972ZM7.49991 1.82689C4.36689 1.82689 1.82708 4.36671 1.82708 7.49972C1.82708 10.6327 4.36689 13.1726 7.49991 13.1726C10.6329 13.1726 13.1727 10.6327 13.1727 7.49972C13.1727 4.36671 10.6329 1.82689 7.49991 1.82689ZM8.24993 10.5C8.24993 10.9142 7.91414 11.25 7.49993 11.25C7.08571 11.25 6.74993 10.9142 6.74993 10.5C6.74993 10.0858 7.08571 9.75 7.49993 9.75C7.91414 9.75 8.24993 10.0858 8.24993 10.5ZM6.05003 6.25C6.05003 5.57211 6.63511 4.925 7.50003 4.925C8.36496 4.925 8.95003 5.57211 8.95003 6.25C8.95003 6.74118 8.68002 6.99212 8.21447 7.27494C8.16251 7.30651 8.10258 7.34131 8.03847 7.37854L8.03841 7.37858C7.85521 7.48497 7.63788 7.61119 7.47449 7.73849C7.23214 7.92732 6.95003 8.23198 6.95003 8.7C6.95004 9.00376 7.19628 9.25 7.50004 9.25C7.8024 9.25 8.04778 9.00601 8.05002 8.70417L8.05056 8.7033C8.05924 8.6896 8.08493 8.65735 8.15058 8.6062C8.25207 8.52712 8.36508 8.46163 8.51567 8.37436L8.51571 8.37433C8.59422 8.32883 8.68296 8.27741 8.78559 8.21506C9.32004 7.89038 10.05 7.35382 10.05 6.25C10.05 4.92789 8.93511 3.825 7.50003 3.825C6.06496 3.825 4.95003 4.92789 4.95003 6.25C4.95003 6.55376 5.19628 6.8 5.50003 6.8C5.80379 6.8 6.05003 6.55376 6.05003 6.25Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <dialog
        className="tooltip-popover-content"
        role="tooltip"
        popover="auto"
        id={tooltipKeyRef.current}
      >
        {children}
      </dialog>
      <div className="tooltip-hover-content" role="tooltip">
        {children}
      </div>
    </div>
  );
}

type Props = {
  state: ControlState;
  dispatch: React.Dispatch<
    [key: keyof ControlState, value: ControlState[keyof ControlState]]
  >;
  handleRandomizeColors: () => void;
};

function Controls(props: Props) {
  const { state, dispatch, handleRandomizeColors } = props;
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
  } = state;

  const maxSubdivisions = 8; /* 
  Theoretically the maximum depth should be something like this, but it's pretty heavy, so limit it to 8, which seems to be the upper limit for my MBP.
  Math.round(
    Math.max(
      Math.log2(canvasDimensionsRef.current.width / (columns.length - 1)),
      Math.log2(canvasDimensionsRef.current.height / (rows.length - 1))
    )
  ); */

  return (
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
            id="animation-enabled"
            name="animationEnabled"
            checked={animationEnabled}
            onChange={() => dispatch(['animationEnabled', !animationEnabled])}
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
                  dispatch([
                    'animationSpeed',
                    clamp(0.1, 5, Number(event.target.value)),
                  ])
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
                  dispatch([
                    'animationAmplitude',
                    clamp(1, 15, Math.round(Number(event.target.value))),
                  ])
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
        <legend>Select color model</legend>
        <label>
          <input
            type="radio"
            value="rgba"
            id="rgba"
            name="colorModel"
            checked={colorModel === 'rgba'}
            onChange={() => dispatch(['colorModel', 'rgba'])}
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
            onChange={() => dispatch(['colorModel', 'oklab'])}
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
            onChange={() => dispatch(['colorModel', 'hsla'])}
          />{' '}
          HSL
        </label>
      </fieldset>

      <fieldset>
        <legend>
          Retro tesselation{' '}
          <Tooltip>
            Gives the gradient a more low-poly look on low subdivision counts.
          </Tooltip>
        </legend>
        <label>
          <input
            type="checkbox"
            id="simple-uv-enabled"
            name="useSimpleUV"
            checked={useSimpleUV}
            onChange={() => dispatch(['useSimpleUV', !useSimpleUV])}
          />{' '}
          Enable retro tesselation
        </label>
      </fieldset>

      <fieldset>
        <legend>
          Subdivision count: {subdivisionCount}{' '}
          <Tooltip>
            Controls how many times each patch is subdivided. Affects curve
            jaggedness, and the "retroness" of the retro tesselation mode.
            Higher subdivision count is harder on performance.
          </Tooltip>
        </legend>

        <input
          style={{ marginInline: '0.5em', width: '100%' }}
          id="subdivision-count"
          value={subdivisionCount}
          onChange={(event) =>
            dispatch([
              'subdivisionCount',
              clamp(
                0,
                maxSubdivisions,
                Math.round(Number(event.target.value ?? 0))
              ),
            ])
          }
          type="range"
          min={0}
          max={maxSubdivisions}
          step={1}
        />
      </fieldset>

      <fieldset>
        <legend>Patch count</legend>
        <div>
          <label htmlFor="row-count">Row count: {rowCount}</label>
          <input
            style={{ marginInline: '0.5em', width: '100%' }}
            id="row-count"
            value={rowCount}
            onChange={(event) =>
              dispatch([
                'rowCount',
                clamp(1, 4, Math.round(Number(event.target.value ?? 0))),
              ])
            }
            type="range"
            min={1}
            max={4}
            step={1}
          />
        </div>
        <div>
          <label htmlFor="column-count">Column count: {columnCount}</label>
          <input
            style={{ marginInline: '0.5em', width: '100%' }}
            id="column-count"
            value={columnCount}
            onChange={(event) =>
              dispatch([
                'columnCount',
                clamp(1, 4, Math.round(Number(event.target.value ?? 0))),
              ])
            }
            type="range"
            min={1}
            max={4}
            step={1}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>Helper visibility</legend>
        <label>
          <input
            type="checkbox"
            id="show-bezier-curves"
            name="showBezierCurves"
            checked={showBezierCurves}
            onChange={() => dispatch(['showBezierCurves', !showBezierCurves])}
          />{' '}
          Show Bezier curves
        </label>
        <label>
          <input
            type="checkbox"
            id="show-control-points"
            name="showControlPoints"
            checked={showControlPoints}
            onChange={() => dispatch(['showControlPoints', !showControlPoints])}
          />{' '}
          Show control points
        </label>
      </fieldset>

      <button
        type="button"
        style={{ marginTop: '1rem' }}
        onClick={handleRandomizeColors}
      >
        Randomize colors
      </button>
    </form>
  );
}

export default Controls;
