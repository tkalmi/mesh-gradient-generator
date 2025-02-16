import {
  Color,
  ColorModel,
  ParametricValues,
  TensorPatch,
  Vec2,
  WebGLProgramInfo,
} from '../types';
import { bilinearPixelInterpolation, colorToStringFuncs } from './colors';
import { meanValue, midPoint } from './helpers';
import { divideCubicBezier } from './patchSubdivision';
import { initShaderProgram } from './webGL';

function transposeTensorPatch(patch: TensorPatch<Vec2>): TensorPatch<Vec2> {
  const { curve0, curve1, curve2, curve3, tensorValues } = patch;
  const [c00, c01, c02, c03] = curve0;
  const [c10, c11, c12, c13] = curve1;
  const [c20, c21, c22, c23] = curve2;
  const [c30, c31, c32, c33] = curve3;
  return {
    curve0: [c00, c10, c20, c30],
    curve1: [c01, c11, c21, c31],
    curve2: [c02, c12, c22, c32],
    curve3: [c03, c13, c23, c33],
    tensorValues: {
      northValue: tensorValues.northValue,
      eastValue: tensorValues.westValue,
      southValue: tensorValues.southValue,
      westValue: tensorValues.eastValue,
    },
  };
}

function subdivideHorizontal(
  tensorValues: ParametricValues<Vec2>
): [ParametricValues<Vec2>, ParametricValues<Vec2>] {
  const { northValue, eastValue, southValue, westValue } = tensorValues;
  const midNorthEast = midPoint(northValue, eastValue);
  const midSouthWest = midPoint(westValue, southValue);

  return [
    {
      northValue,
      eastValue: midNorthEast,
      southValue: midSouthWest,
      westValue,
    },
    {
      northValue: midNorthEast,
      eastValue,
      southValue,
      westValue: midSouthWest,
    },
  ];
}

function horizontalTensorSubdivide(
  patch: TensorPatch<Vec2>
): [TensorPatch<Vec2>, TensorPatch<Vec2>] {
  const [l0, r0] = divideCubicBezier(patch.curve0);
  const [l1, r1] = divideCubicBezier(patch.curve1);
  const [l2, r2] = divideCubicBezier(patch.curve2);
  const [l3, r3] = divideCubicBezier(patch.curve3);
  const [vl, vr] = subdivideHorizontal(patch.tensorValues);

  return [
    { curve0: l0, curve1: l1, curve2: l2, curve3: l3, tensorValues: vl },
    { curve0: r0, curve1: r1, curve2: r2, curve3: r3, tensorValues: vr },
  ];
}

function subdivideTensorPatch(patch: TensorPatch<Vec2>) {
  const [west, east] = horizontalTensorSubdivide(patch);
  const [northWest, southWest] = horizontalTensorSubdivide(
    transposeTensorPatch(west)
  );
  const [northEast, southEast] = horizontalTensorSubdivide(
    transposeTensorPatch(east)
  );
  return { northWest, northEast, southWest, southEast };
}

export function renderTensorPatchWithSubdivision2d(
  tensorPatch: TensorPatch<Color>,
  colorModel: ColorModel,
  maxDepth: number,
  context: CanvasRenderingContext2D
) {
  const basePatch: TensorPatch<Vec2> = {
    ...tensorPatch,
    tensorValues: {
      northValue: [0, 0],
      eastValue: [1, 0],
      southValue: [1, 1],
      westValue: [0, 1],
    },
  };

  const colorToString = colorToStringFuncs[colorModel];

  // Function to draw the patch uniformly using bilinear interpolation
  function drawPatchUniform(patch: TensorPatch<Vec2>) {
    const { curve0, curve3, tensorValues } = patch;
    const [u, v] = meanValue(Object.values(tensorValues)); // Get mean UV from coonsValues

    console.log('UV', Object.values(tensorValues).flat());
    console.log('REAL UV', [u, v]);

    const baseColors = tensorPatch.tensorValues;
    console.log('BASE COLORS', baseColors);
    const color = bilinearPixelInterpolation(baseColors, u, v); // Interpolate texture color at UV coordinates

    // Draw the patch
    const patchPath = new Path2D();
    patchPath.moveTo(curve0[0][0], curve0[0][1]); // move to starting point
    patchPath.lineTo(curve3[0][0], curve3[0][1]);
    patchPath.lineTo(curve3[3][0], curve3[3][1]);
    patchPath.lineTo(curve0[3][0], curve0[3][1]);
    patchPath.lineTo(curve0[0][0], curve0[0][1]);

    context.lineWidth = 1;
    patchPath.closePath();
    context.fillStyle = colorToString(color);
    context.strokeStyle = context.fillStyle;
    context.stroke(patchPath);
    context.fill(patchPath);
  }

  const queue: [number, TensorPatch<Vec2>][] = [[maxDepth, basePatch]];
  while (queue.length > 0) {
    const [depth, patch] = queue.pop()!;
    if (depth === 0) {
      drawPatchUniform(patch);
    } else {
      const { northWest, northEast, southWest, southEast } =
        subdivideTensorPatch(patch);

      queue.push([depth - 1, southEast]);
      queue.push([depth - 1, southWest]);
      queue.push([depth - 1, northEast]);
      queue.push([depth - 1, northWest]);
    }
  }
}

type ProgramInfo = WebGLProgramInfo<
  {
    a_position: number;
    a_uv_north_east: number;
    a_uv_south_west: number;
    a_corners_north_east: number;
    a_corners_south_west: number;
  },
  { u_resolution: WebGLUniformLocation; u_colors: WebGLUniformLocation }
>;

const vsSource = /*glsl*/ `
  attribute vec2 a_position;
  attribute vec4 a_uv_north_east;
  attribute vec4 a_uv_south_west;
  // attribute vec4 a_color;
  attribute vec4 a_corners_north_east;
  attribute vec4 a_corners_south_west;
  
  uniform vec2 u_resolution;
  uniform mat4 u_colors;

  varying vec4 v_uv_north_east;
  varying vec4 v_uv_south_west;
  varying vec4 v_corners_north_east;
  varying vec4 v_corners_south_west;
  varying vec4 v_position;

  void main() {
    vec2 scaledPosition = a_position.xy / u_resolution; // transform to [0, 1] space
    vec2 zeroToTwo = scaledPosition * 2.0;
    vec2 clipSpacePosition = zeroToTwo - 1.0; // transform to [-1, 1] clip space
    gl_Position = vec4(clipSpacePosition.x, -clipSpacePosition.y, 0.0, 1.0);
    v_uv_north_east = a_uv_north_east;
    v_uv_south_west = a_uv_south_west;
    v_corners_north_east = a_corners_north_east;
    v_corners_south_west = a_corners_south_west;
    v_position = gl_Position;

  }
`;

const fsSource = /*glsl*/ `
  precision mediump float;

  varying vec4 v_uv_north_east;
  varying vec4 v_uv_south_west;
  varying vec4 v_corners_north_east;
  varying vec4 v_corners_south_west;
  varying vec4 v_position;

  uniform mat4 u_colors;

  vec4 bilinearPixelInterpolation(float u, float v) {
    vec4 colorNorth = u_colors[0];
    vec4 colorEast = u_colors[1];
    vec4 colorSouth = u_colors[2];
    vec4 colorWest = u_colors[3];

    vec4 colorTop = mix(colorNorth, colorEast, u);
    vec4 colorBottom = mix(colorWest, colorSouth, u);

    return mix(colorTop, colorBottom, v) / 255.0;
  }

  vec4 getColor() {
    // float distNorth = length(v_position.xy - v_corners_north_east.xy);
    // float distEast = length(v_position.xy - v_corners_north_east.zw);
    // float distSouth = length(v_position.xy - v_corners_south_west.xy);
    // float distWest = length(v_position.xy - v_corners_south_west.zw);
  
    // float distNorthSouth = length(v_corners_south_west.xy - v_corners_north_east.xy);
    // float distEastWest = length(v_corners_south_west.zw - v_corners_north_east.zw);

    // vec4 normalizedDistances = vec4(distNorth, distEast, distSouth, distWest) / max(distNorthSouth, distEastWest) * -1.0 + 1.0;

    // vec2 uvNorth = v_uv_north_east.xy * normalizedDistances.x;
    // vec2 uvEast = v_uv_north_east.zw * normalizedDistances.y;
    // vec2 uvSouth = v_uv_south_west.xy * normalizedDistances.x;
    // vec2 uvWest = v_uv_south_west.zw * normalizedDistances.y;

    // vec2 uv = (uvNorth + uvEast + uvSouth + uvWest) / 4.0;

    vec2 uv = vec2(v_uv_north_east.xy + v_uv_north_east.zw + v_uv_south_west.xy + v_uv_south_west.zw)/ 4.0;

    return bilinearPixelInterpolation(uv.x, uv.y);
  }

  void main() {
    gl_FragColor = getColor();
  }
`;

function getShaderProgram(gl: WebGLRenderingContext, colorModel: ColorModel) {
  // TODO: Take color model into account
  return initShaderProgram(gl, vsSource, fsSource);
}

export function renderTensorPatchWithSubdivisionWebGL(
  tensorPatch: TensorPatch<Color>,
  colorModel: ColorModel,
  maxDepth: number,
  gl: WebGLRenderingContext
) {
  const basePatch: TensorPatch<Vec2> = {
    ...tensorPatch,
    tensorValues: {
      northValue: [0, 0],
      eastValue: [1, 0],
      southValue: [1, 1],
      westValue: [0, 1],
    },
  };

  const vertices: number[] = [];
  const corners1: number[] = [];
  const corners2: number[] = [];
  const uv1: number[] = [];
  const uv2: number[] = [];

  function addPatchToAttributes(patch: TensorPatch<Vec2>) {
    const { curve0, curve3, tensorValues } = patch;

    // Add vertices
    // Triangle 1
    vertices.push(curve0[0][0]);
    vertices.push(curve0[0][1]);

    vertices.push(curve3[0][0]);
    vertices.push(curve3[0][1]);

    vertices.push(curve3[3][0]);
    vertices.push(curve3[3][1]);
    // Triangle 2
    vertices.push(curve3[3][0]);
    vertices.push(curve3[3][1]);

    vertices.push(curve0[3][0]);
    vertices.push(curve0[3][1]);

    vertices.push(curve0[0][0]);
    vertices.push(curve0[0][1]);

    for (let i = 0; i < 6; i++) {
      // Add UV coordinates for all triangle vertices
      uv1.push(tensorValues.northValue[0]);
      uv1.push(tensorValues.northValue[1]);

      uv1.push(tensorValues.eastValue[0]);
      uv1.push(tensorValues.eastValue[1]);

      uv2.push(tensorValues.southValue[0]);
      uv2.push(tensorValues.southValue[1]);

      uv2.push(tensorValues.westValue[0]);
      uv2.push(tensorValues.westValue[1]);

      // Add corners
      // North
      corners1.push(curve0[0][0]);
      corners1.push(curve0[0][1]);

      // East
      corners1.push(curve0[1][0]);
      corners1.push(curve0[1][1]);

      // South
      corners2.push(curve3[1][0]);
      corners2.push(curve3[1][1]);

      // West
      corners2.push(curve3[0][0]);
      corners2.push(curve3[0][1]);
    }
  }

  const queue: [number, TensorPatch<Vec2>][] = [[maxDepth, basePatch]];
  while (queue.length > 0) {
    const [depth, patch] = queue.pop()!;
    if (depth === 0) {
      addPatchToAttributes(patch);
    } else {
      const { northWest, northEast, southWest, southEast } =
        subdivideTensorPatch(patch);

      queue.push([depth - 1, southEast]);
      queue.push([depth - 1, southWest]);
      queue.push([depth - 1, northEast]);
      queue.push([depth - 1, northWest]);
    }
  }

  const shaderProgram = getShaderProgram(gl, colorModel);

  const programInfo: ProgramInfo = {
    program: shaderProgram,
    attribLocations: {
      a_position: gl.getAttribLocation(shaderProgram, 'a_position'),
      a_uv_north_east: gl.getAttribLocation(shaderProgram, 'a_uv_north_east'),
      a_uv_south_west: gl.getAttribLocation(shaderProgram, 'a_uv_south_west'),
      a_corners_north_east: gl.getAttribLocation(
        shaderProgram,
        'a_corners_north_east'
      ),
      a_corners_south_west: gl.getAttribLocation(
        shaderProgram,
        'a_corners_south_west'
      ),
    },
    uniformLocations: {
      u_resolution: gl.getUniformLocation(shaderProgram, 'u_resolution')!,
      u_colors: gl.getUniformLocation(shaderProgram, 'u_colors')!,
    },
  };

  function initBuffers() {
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    const uvNorthEastBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvNorthEastBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv1), gl.STATIC_DRAW);

    const uvSouthWestBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvSouthWestBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv2), gl.STATIC_DRAW);

    const cornersNorthEastBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornersNorthEastBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners1), gl.STATIC_DRAW);

    const cornersSouthWestBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornersSouthWestBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners2), gl.STATIC_DRAW);

    return {
      a_position: positionBuffer,
      a_uv_north_east: uvNorthEastBuffer,
      a_uv_south_west: uvSouthWestBuffer,
      a_corners_north_east: cornersNorthEastBuffer,
      a_corners_south_west: cornersSouthWestBuffer,
    };
  }

  function setPositionAttribute(
    buffers: {
      a_position: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
      a_corners_north_east: WebGLBuffer;
      a_corners_south_west: WebGLBuffer;
    },
    programInfo: ProgramInfo
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_position);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_position,
      2,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_position);
  }

  function setUVAttribute(
    buffers: {
      a_position: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
      a_corners_north_east: WebGLBuffer;
      a_corners_south_west: WebGLBuffer;
    },
    programInfo: ProgramInfo
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_uv_north_east);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_uv_north_east,
      4,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_uv_north_east);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_uv_south_west);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_uv_south_west,
      4,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_uv_south_west);
  }

  function setCornersAttribute(
    buffers: {
      a_position: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
      a_corners_north_east: WebGLBuffer;
      a_corners_south_west: WebGLBuffer;
    },
    programInfo: ProgramInfo
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_corners_north_east);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_corners_north_east,
      4,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(
      programInfo.attribLocations.a_corners_north_east
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_corners_south_west);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_corners_south_west,
      4,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(
      programInfo.attribLocations.a_corners_south_west
    );
  }

  function drawPatch(
    buffers: {
      a_position: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
      a_corners_north_east: WebGLBuffer;
      a_corners_south_west: WebGLBuffer;
    },
    programInfo: ProgramInfo
  ) {
    setPositionAttribute(buffers, programInfo);
    setUVAttribute(buffers, programInfo);
    setCornersAttribute(buffers, programInfo);

    gl.useProgram(programInfo.program);

    gl.uniform2f(
      programInfo.uniformLocations.u_resolution,
      gl.canvas.width,
      gl.canvas.height
    );

    gl.uniformMatrix4fv(
      programInfo.uniformLocations.u_colors,
      false,
      new Float32Array(Object.values(tensorPatch.tensorValues).flat())
    );

    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
  }

  const buffers = initBuffers();

  drawPatch(buffers, programInfo);
}
