import { clamp } from './meshGradient/helpers';
import { ControlState } from './types';

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
        <legend>Select patch subdivision count</legend>
        <label>
          <input
            style={{ marginInline: '0.5em' }}
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
        <legend>Use simple UV</legend>
        <label>
          <input
            type="radio"
            value="true"
            id="use-simple-uv-true"
            name="useSimpleUV"
            checked={useSimpleUV}
            onChange={() => dispatch(['useSimpleUV', true])}
          />{' '}
          True
        </label>
        <label>
          <input
            type="radio"
            value="false"
            id="use-simple-uv-false"
            name="useSimpleUV"
            checked={!useSimpleUV}
            onChange={() => dispatch(['useSimpleUV', false])}
          />{' '}
          False
        </label>
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

      <fieldset>
        <legend>Select patch count</legend>
        <label>
          <input
            style={{ marginInline: '0.5em' }}
            id="row-count"
            value={rowCount}
            onChange={(event) =>
              dispatch([
                'rowCount',
                clamp(1, 4, Math.round(Number(event.target.value ?? 0))),
              ])
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
              dispatch([
                'columnCount',
                clamp(1, 4, Math.round(Number(event.target.value ?? 0))),
              ])
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
        onClick={handleRandomizeColors}
      >
        Randomize colors
      </button>
    </form>
  );
}

export default Controls;
