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

    const baseColors = tensorPatch.tensorValues;
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
    a_color_north: number;
    a_color_east: number;
    a_color_south: number;
    a_color_west: number;
    a_corners_north_east: number;
    a_corners_south_west: number;
  },
  {
    u_resolution: WebGLUniformLocation;
    u_colors: WebGLUniformLocation;
  }
>;

const vsSource = /*glsl*/ `
  attribute vec2 a_position;
  // TODO: Could just save UV min and max
  attribute vec4 a_uv_north_east;
  attribute vec4 a_uv_south_west;
  attribute vec4 a_color_north;
  attribute vec4 a_color_east;
  attribute vec4 a_color_south;
  attribute vec4 a_color_west;
  attribute vec4 a_corners_north_east;
  attribute vec4 a_corners_south_west;
  
  uniform vec2 u_resolution;

  varying vec4 v_position;
  varying vec4 v_color_north;
  varying vec4 v_color_east;
  varying vec4 v_color_south;
  varying vec4 v_color_west;
  varying vec2 v_uv;

  // Use barycentric coordinates to get the UV value of any point
  vec2 getUV(vec2 point) {
    float EPSILON = 0.00000001;

    vec2 p1 = a_corners_north_east.xy;
    vec2 p2 = a_corners_north_east.zw;
    vec2 p3 = a_corners_south_west.xy;
    vec2 p4 = a_corners_south_west.zw;

    float d1 = length(point - p1);
    float d2 = length(point - p2);
    float d3 = length(point - p3);
    float d4 = length(point - p4);

    float w1 = 1.0 / (d1 + EPSILON);
    float w2 = 1.0 / (d2 + EPSILON);
    float w3 = 1.0 / (d3 + EPSILON);
    float w4 = 1.0 / (d4 + EPSILON);

    vec2 v1 = a_uv_north_east.xy;
    vec2 v2 = a_uv_north_east.zw;
    vec2 v3 = a_uv_south_west.xy;
    vec2 v4 = a_uv_south_west.zw;

    vec2 uv = (v1 * w1 + v2 * w2 + v3 * w3 + v4 * w4) / (w1 + w2 + w3 + w4);

    return uv;
  }

  void main() {
    vec2 scaledPosition = a_position.xy / u_resolution; // transform to [0, 1] space
    vec2 zeroToTwo = scaledPosition * 2.0;
    vec2 clipSpacePosition = zeroToTwo - 1.0; // transform to [-1, 1] clip space
    gl_Position = vec4(clipSpacePosition.x, -clipSpacePosition.y, 0.0, 1.0);

    v_color_north = a_color_north;
    v_color_east = a_color_east;
    v_color_south = a_color_south;
    v_color_west = a_color_west;

    v_position = gl_Position;

    v_uv = getUV(a_position.xy);
  }
`;

const fsSource = /*glsl*/ `
  precision mediump float;

  varying vec4 v_position;
  varying vec4 v_color_north;
  varying vec4 v_color_east;
  varying vec4 v_color_south;
  varying vec4 v_color_west;
  varying vec2 v_uv;


  vec4 bilinearPixelInterpolation() {
    vec4 colorTop = mix(v_color_north, v_color_east, v_uv.x);
    vec4 colorBottom = mix(v_color_west, v_color_south, v_uv.x);

    return mix(colorTop, colorBottom, v_uv.y) * 0.00392156862745098; // Divide by 255.0
  }

  void main() {
    gl_FragColor = bilinearPixelInterpolation();
  }
`;

function getShaderProgram(gl: WebGLRenderingContext, colorModel: ColorModel) {
  // TODO: Take color model into account
  return initShaderProgram(gl, vsSource, fsSource);
}

export function renderTensorPatchesWithSubdivisionWebGL(
  tensorPatches: { patch: TensorPatch<Color>; x: number; y: number }[],
  colorModel: ColorModel,
  maxDepth: number,
  gl: WebGLRenderingContext
) {
  const vertices = new Float32Array(4 ** maxDepth * 12 * tensorPatches.length);
  const uv1 = new Float32Array(4 ** maxDepth * 6 * 4 * tensorPatches.length);
  const uv2 = new Float32Array(4 ** maxDepth * 6 * 4 * tensorPatches.length);

  const corners1 = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const corners2 = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );

  const colorNorth = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const colorEast = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const colorSouth = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const colorWest = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );

  const quadMinUV: Vec2[] = new Array(4 ** maxDepth * tensorPatches.length);

  for (let patchInd = 0; patchInd < tensorPatches.length; patchInd++) {
    const { patch: tensorPatch, x, y } = tensorPatches[patchInd];

    const basePatch: TensorPatch<Vec2> = {
      ...tensorPatch,
      tensorValues: {
        northValue: [0, 0],
        eastValue: [1, 0],
        southValue: [1, 1],
        westValue: [0, 1],
      },
    };

    const {
      northValue: baseNorthValue,
      eastValue: baseEastValue,
      southValue: baseSouthValue,
      westValue: baseWestValue,
    } = tensorPatch.tensorValues;

    const baseVertexOffset = patchInd * 4 ** maxDepth * 12;
    const baseAuxOffset = 4 ** maxDepth * 6 * 4 * patchInd;

    let addPatchCounter = 0;
    function addPatchToAttributes(patch: TensorPatch<Vec2>) {
      const { curve0, curve3, tensorValues } = patch;
      const { northValue, eastValue, southValue, westValue } = tensorValues;
      const vertexBaseIndex = baseVertexOffset + addPatchCounter * 12;

      const minV = Math.min(
        northValue[1],
        eastValue[1],
        southValue[1],
        westValue[1]
      );
      const minU = Math.min(
        northValue[0],
        eastValue[0],
        southValue[0],
        westValue[0]
      );
      quadMinUV[patchInd * 4 ** maxDepth + addPatchCounter] = [
        minU + x,
        minV + y,
      ] as Vec2;

      // Add vertices
      // Triangle 1
      vertices[vertexBaseIndex + 0] = curve0[0][0];
      vertices[vertexBaseIndex + 1] = curve0[0][1];

      vertices[vertexBaseIndex + 2] = curve3[0][0];
      vertices[vertexBaseIndex + 3] = curve3[0][1];

      vertices[vertexBaseIndex + 4] = curve3[3][0];
      vertices[vertexBaseIndex + 5] = curve3[3][1];
      // Triangle 2
      vertices[vertexBaseIndex + 6] = curve3[3][0];
      vertices[vertexBaseIndex + 7] = curve3[3][1];

      vertices[vertexBaseIndex + 8] = curve0[3][0];
      vertices[vertexBaseIndex + 9] = curve0[3][1];

      vertices[vertexBaseIndex + 10] = curve0[0][0];
      vertices[vertexBaseIndex + 11] = curve0[0][1];

      const auxBaseIndex1 = addPatchCounter * 6;
      for (let i = 0; i < 6; i++) {
        const auxBaseIndex2 = baseAuxOffset + ((auxBaseIndex1 + i) << 2);
        // Add UV coordinates for all triangle vertices
        uv1[auxBaseIndex2 + 0] = northValue[0];
        uv1[auxBaseIndex2 + 1] = northValue[1];

        uv1[auxBaseIndex2 + 2] = eastValue[0];
        uv1[auxBaseIndex2 + 3] = eastValue[1];

        uv2[auxBaseIndex2 + 0] = southValue[0];
        uv2[auxBaseIndex2 + 1] = southValue[1];

        uv2[auxBaseIndex2 + 2] = westValue[0];
        uv2[auxBaseIndex2 + 3] = westValue[1];

        // Add corners
        // North
        corners1[auxBaseIndex2 + 0] = curve0[0][0];
        corners1[auxBaseIndex2 + 1] = curve0[0][1];

        // East
        corners1[auxBaseIndex2 + 2] = curve0[3][0];
        corners1[auxBaseIndex2 + 3] = curve0[3][1];

        // South
        corners2[auxBaseIndex2 + 0] = curve3[3][0];
        corners2[auxBaseIndex2 + 1] = curve3[3][1];

        // West
        corners2[auxBaseIndex2 + 2] = curve3[0][0];
        corners2[auxBaseIndex2 + 3] = curve3[0][1];

        // Add colors
        colorNorth[auxBaseIndex2 + 0] = baseNorthValue[0];
        colorNorth[auxBaseIndex2 + 1] = baseNorthValue[1];
        colorNorth[auxBaseIndex2 + 2] = baseNorthValue[2];
        colorNorth[auxBaseIndex2 + 3] = baseNorthValue[3];

        colorEast[auxBaseIndex2 + 0] = baseEastValue[0];
        colorEast[auxBaseIndex2 + 1] = baseEastValue[1];
        colorEast[auxBaseIndex2 + 2] = baseEastValue[2];
        colorEast[auxBaseIndex2 + 3] = baseEastValue[3];

        colorSouth[auxBaseIndex2 + 0] = baseSouthValue[0];
        colorSouth[auxBaseIndex2 + 1] = baseSouthValue[1];
        colorSouth[auxBaseIndex2 + 2] = baseSouthValue[2];
        colorSouth[auxBaseIndex2 + 3] = baseSouthValue[3];

        colorWest[auxBaseIndex2 + 0] = baseWestValue[0];
        colorWest[auxBaseIndex2 + 1] = baseWestValue[1];
        colorWest[auxBaseIndex2 + 2] = baseWestValue[2];
        colorWest[auxBaseIndex2 + 3] = baseWestValue[3];
      }

      addPatchCounter++;
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
  }

  const renderOrder = [...new Array(quadMinUV.length).keys()];
  renderOrder.sort((a, b) => {
    const dv = quadMinUV[a][1] - quadMinUV[b][1];
    if (dv === 0) {
      return quadMinUV[a][0] - quadMinUV[b][0];
    }
    return dv;
  });

  const sortedVertices = new Float32Array(
    4 ** maxDepth * 12 * tensorPatches.length
  );
  const sortedUV1 = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const sortedUV2 = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );

  const sortedCorners1 = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const sortedCorners2 = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );

  const sortedColorNorth = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const sortedColorEast = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const sortedColorSouth = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const sortedColorWest = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  renderOrder.forEach((ind, i) => {
    const sortedVertexBaseIndex = i * 12;
    const vertexBaseIndex = ind * 12;
    sortedVertices.set(
      vertices.subarray(vertexBaseIndex, vertexBaseIndex + 12),
      sortedVertexBaseIndex
    );

    const sortedAuxBaseIndex1 = i * 24;
    const auxBaseIndex1 = ind * 24;

    sortedUV1.set(
      uv1.subarray(auxBaseIndex1, auxBaseIndex1 + 24),
      sortedAuxBaseIndex1
    );
    sortedUV2.set(
      uv2.subarray(auxBaseIndex1, auxBaseIndex1 + 24),
      sortedAuxBaseIndex1
    );

    sortedCorners1.set(
      corners1.subarray(auxBaseIndex1, auxBaseIndex1 + 24),
      sortedAuxBaseIndex1
    );
    sortedCorners2.set(
      corners2.subarray(auxBaseIndex1, auxBaseIndex1 + 24),
      sortedAuxBaseIndex1
    );

    sortedColorNorth.set(
      colorNorth.subarray(auxBaseIndex1, auxBaseIndex1 + 24),
      sortedAuxBaseIndex1
    );
    sortedColorEast.set(
      colorEast.subarray(auxBaseIndex1, auxBaseIndex1 + 24),
      sortedAuxBaseIndex1
    );
    sortedColorSouth.set(
      colorSouth.subarray(auxBaseIndex1, auxBaseIndex1 + 24),
      sortedAuxBaseIndex1
    );
    sortedColorWest.set(
      colorWest.subarray(auxBaseIndex1, auxBaseIndex1 + 24),
      sortedAuxBaseIndex1
    );
  });

  const shaderProgram = getShaderProgram(gl, colorModel);

  const programInfo: ProgramInfo = {
    program: shaderProgram,
    attribLocations: {
      a_position: gl.getAttribLocation(shaderProgram, 'a_position'),
      a_uv_north_east: gl.getAttribLocation(shaderProgram, 'a_uv_north_east'),
      a_uv_south_west: gl.getAttribLocation(shaderProgram, 'a_uv_south_west'),
      a_color_north: gl.getAttribLocation(shaderProgram, 'a_color_north'),
      a_color_east: gl.getAttribLocation(shaderProgram, 'a_color_east'),
      a_color_south: gl.getAttribLocation(shaderProgram, 'a_color_south'),
      a_color_west: gl.getAttribLocation(shaderProgram, 'a_color_west'),
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
    gl.bufferData(gl.ARRAY_BUFFER, sortedVertices, gl.STATIC_DRAW);

    const uvNorthEastBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvNorthEastBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sortedUV1, gl.STATIC_DRAW);

    const uvSouthWestBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvSouthWestBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sortedUV2, gl.STATIC_DRAW);

    const colorNorthBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorNorthBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sortedColorNorth, gl.STATIC_DRAW);

    const colorEastBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorEastBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sortedColorEast, gl.STATIC_DRAW);

    const colorSouthBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorSouthBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sortedColorSouth, gl.STATIC_DRAW);

    const colorWestBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorWestBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sortedColorWest, gl.STATIC_DRAW);

    const cornersNorthEastBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornersNorthEastBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sortedCorners1, gl.STATIC_DRAW);

    const cornersSouthWestBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornersSouthWestBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sortedCorners2, gl.STATIC_DRAW);

    return {
      a_position: positionBuffer,
      a_uv_north_east: uvNorthEastBuffer,
      a_uv_south_west: uvSouthWestBuffer,
      a_color_north: colorNorthBuffer,
      a_color_east: colorEastBuffer,
      a_color_south: colorSouthBuffer,
      a_color_west: colorWestBuffer,
      a_corners_north_east: cornersNorthEastBuffer,
      a_corners_south_west: cornersSouthWestBuffer,
    };
  }

  function setPositionAttribute(
    buffers: {
      a_position: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
      a_color_north: WebGLBuffer;
      a_color_east: WebGLBuffer;
      a_color_south: WebGLBuffer;
      a_color_west: WebGLBuffer;
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
      a_color_north: WebGLBuffer;
      a_color_east: WebGLBuffer;
      a_color_south: WebGLBuffer;
      a_color_west: WebGLBuffer;
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
      a_color_north: WebGLBuffer;
      a_color_east: WebGLBuffer;
      a_color_south: WebGLBuffer;
      a_color_west: WebGLBuffer;
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

  function setColorAttribute(
    buffers: {
      a_position: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
      a_color_north: WebGLBuffer;
      a_color_east: WebGLBuffer;
      a_color_south: WebGLBuffer;
      a_color_west: WebGLBuffer;
      a_corners_north_east: WebGLBuffer;
      a_corners_south_west: WebGLBuffer;
    },
    programInfo: ProgramInfo
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_color_north);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_color_north,
      4,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_color_north);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_color_east);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_color_east,
      4,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_color_east);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_color_south);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_color_south,
      4,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_color_south);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_color_west);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_color_west,
      4,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_color_west);
  }

  function drawPatch(
    buffers: {
      a_position: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
      a_color_north: WebGLBuffer;
      a_color_east: WebGLBuffer;
      a_color_south: WebGLBuffer;
      a_color_west: WebGLBuffer;
      a_corners_north_east: WebGLBuffer;
      a_corners_south_west: WebGLBuffer;
    },
    programInfo: ProgramInfo
  ) {
    setPositionAttribute(buffers, programInfo);
    setUVAttribute(buffers, programInfo);
    setCornersAttribute(buffers, programInfo);
    setColorAttribute(buffers, programInfo);

    gl.useProgram(programInfo.program);

    gl.uniform2f(
      programInfo.uniformLocations.u_resolution,
      gl.canvas.width,
      gl.canvas.height
    );

    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
  }

  const buffers = initBuffers();

  drawPatch(buffers, programInfo);
}
