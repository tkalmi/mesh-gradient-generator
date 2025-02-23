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
    a_texcoord: number;
  },
  {
    u_resolution: WebGLUniformLocation;
    u_colors: WebGLUniformLocation;
    u_color_texture: WebGLUniformLocation;
    u_col_row_count: WebGLUniformLocation;
  }
>;

const POSITION_LOCATION = 0;
const UV_NE_LOCATION = 1;
const UV_SW_LOCATION = 2;
const TEXCOORD_LOCATION = 3;

const vsSource = /*glsl*/ `#version 300 es
  layout(location = ${POSITION_LOCATION}) in vec2 a_position;
  layout(location = ${UV_NE_LOCATION}) in vec4 a_uv_north_east;
  layout(location = ${UV_SW_LOCATION}) in vec4 a_uv_south_west;
  layout(location = ${TEXCOORD_LOCATION}) in vec2 a_texcoord;

  uniform vec2 u_resolution;
  uniform vec2 u_col_row_count;

  out vec4 v_position;
  out vec2 v_uv;
  out vec2 v_texcoord;

  // Use barycentric coordinates to get the UV value of any point
  vec2 getUV() {
    vec2 v1 = a_uv_north_east.xy;
    vec2 v2 = a_uv_north_east.zw;
    vec2 v3 = a_uv_south_west.xy;
    vec2 v4 = a_uv_south_west.zw;

    vec2 uv = (v1 + v2 + v3 + v4) * 0.25;

    return uv;
  }

  void main() {
    vec2 scaledPosition = a_position.xy / u_resolution; // transform to [0, 1] space
    vec2 zeroToTwo = scaledPosition * 2.0;
    vec2 clipSpacePosition = zeroToTwo - 1.0; // transform to [-1, 1] clip space
    gl_Position = vec4(clipSpacePosition.x, -clipSpacePosition.y, 0.0, 1.0);

    v_position = gl_Position;

    v_texcoord = a_texcoord;

    v_uv = getUV();
  }
`;

function getFsSource(colorModel: ColorModel) {
  const fsSource = /*glsl*/ `#version 300 es
  precision highp float;

  uniform sampler2D u_color_texture;
  uniform vec2 u_col_row_count;

  in vec4 v_position;
  in vec2 v_uv;
  in vec2 v_texcoord;

  out vec4 outputColor;

  vec4 hslaToRgba(vec4 hsla) {
    float h = hsla.x;
    float s = hsla.y;
    float l = hsla.z;

    // Chroma, the intensity of the color
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;

    // X and m for the RGB conversion
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));  // Intermediate color calculation
    float m = l - 0.5 * c;  // Adjustment for lightness

    // RGB intermediate values
    float r, g, b;

    float sixth = 0.166666666666;

    if (h < 1.0 * sixth) {
        r = c; g = x; b = 0.0;
    } else if (h < 2.0 * sixth) {
        r = x; g = c; b = 0.0;
    } else if (h < 3.0 * sixth) {
        r = 0.0; g = c; b = x;
    } else if (h < 4.0 * sixth) {
        r = 0.0; g = x; b = c;
    } else if (h < 5.0 * sixth) {
        r = x; g = 0.0; b = c;
    } else {
        r = c; g = 0.0; b = x;
    }

    // Adjust by m to get final RGB values
    r += m;
    g += m;
    b += m;

    // Return final RGBA vec4
    return vec4(r, g, b, 1.0); // alpha is converted back to [0, 255]
  }

  vec4 lchaToRgba(vec4 lcha) {
    float L = lcha.x;
    float C = lcha.y;
    float H = lcha.z;

    H = radians(H); // Convert from [0,1] to degrees, then to radians

    // Convert LCH to Lab
    float a = C * cos(H);
    float b = C * sin(H);

    float one116th = 0.008620689655172414; // 1.0 / 116.0
    // Convert Lab to XYZ (D65)
    float Y = (L + 16.0) * one116th;
    float X = a * 0.002 + Y;
    float Z = Y - b * 0.005;

    float xPow3 = X * X * X;
    float yPow3 = Y * Y * Y;
    float zPow3 = Z * Z * Z;

    // Reverse gamma correction
    X = 95.047 * ((xPow3 > 0.008856) ? (xPow3) : ((X - 16.0 * one116th) * 0.1284191601386927));
    Y = 100.000 * ((yPow3 > 0.008856) ? (yPow3) : ((Y - 16.0 * one116th) * 0.1284191601386927));
    Z = 108.883 * ((zPow3 > 0.008856) ? (zPow3) : ((Z - 16.0 * one116th) * 0.1284191601386927));

    X *= 0.01;
    Y *= 0.01;
    Z *= 0.01;

    // Convert XYZ to linear sRGB
    float r = X *  3.2406 + Y * -1.5372 + Z * -0.4986;
    float g = X * -0.9689 + Y *  1.8758 + Z *  0.0415;
    b = X *  0.0557 + Y * -0.2040 + Z *  1.0570;

    // Apply gamma correction (sRGB)
    float one24th = 0.4166666666666667; // 1.0 / 2.4
    r = (r > 0.0031308) ? (1.055 * pow(r, one24th) - 0.055) : (12.92 * r);
    g = (g > 0.0031308) ? (1.055 * pow(g, one24th) - 0.055) : (12.92 * g);
    b = (b > 0.0031308) ? (1.055 * pow(b, one24th) - 0.055) : (12.92 * b);

    // Clamp to valid RGB range
    return clamp(vec4(r, g, b, 1.0), 0.0, 1.0);
  }

  vec4 readHslaColor(vec4 rawColor) {
    // Normalize input values
    float h = rawColor.x * 255.0;
    float s = rawColor.y * 255.0;
    // Since RGBA texture in WebGL can store only 8-bit values, store the additional hue bit in saturation, as hue is in range [0, 360] (= it needs 9 bits) and saturation is in range [0, 100] (= needs only 7 bits).
    if (s > 100.0) {
      h += 128.0;
      s -= 128.0;
    }
    h *= 0.002777777777777778; // Hue: [0, 360] -> [0, 1]
    s *= 0.01; // Saturation: [0, 100] -> [0, 1]
    float l = rawColor.z * 2.55;     // Lightness: [0, 100] -> [0, 1]
    return vec4(h, s, l, 1.0);
  }

  vec4 readLchaColor(vec4 rawColor) {
    float L = rawColor.x * 255.0;  // Convert from [0,1] to [0,100]
    float C = rawColor.y * 255.0;  // Convert from [0,1] to [0,Inf]
    float H = rawColor.z * 255.0;

    if (L > 100.0) {
      L -= 128.0;
      H += 128.0;
    }

    return vec4(L, C, H, 255.0);
  }

  vec4 readColor(vec2 texcoord) {
    ${(() => {
      switch (colorModel) {
        case 'hsla':
          return 'return readHslaColor(texture(u_color_texture, texcoord));';
        case 'lcha':
          return 'return readLchaColor(texture(u_color_texture, texcoord));';
        case 'rgba':
        default:
          return 'return texture(u_color_texture, texcoord);';
      }
    })()}
  }


  vec4 bilinearPixelInterpolation() {
    float xStep = 1.0 / (u_col_row_count.x);
    float yStep = 1.0 / (u_col_row_count.y);
    vec4 northColor = readColor(v_texcoord);
    vec4 eastColor = readColor(v_texcoord + vec2(xStep, 0.0));
    vec4 southColor = readColor(v_texcoord + vec2(xStep, yStep));
    vec4 westColor = readColor(v_texcoord + vec2(0.0, yStep));

    vec4 colorTop = mix(northColor, eastColor, v_uv.x);
    vec4 colorBottom = mix(westColor, southColor, v_uv.x);

    return mix(colorTop, colorBottom, v_uv.y);
  }

  void main() {
    vec4 color = bilinearPixelInterpolation();
    ${(() => {
      switch (colorModel) {
        case 'hsla':
          return 'outputColor = hslaToRgba(color);';
        case 'lcha':
          return 'outputColor = lchaToRgba(color);';
        case 'rgba':
        default:
          return 'outputColor = color;';
      }
    })()}
  }
`;

  return fsSource;
}

function getShaderProgram(gl: WebGL2RenderingContext, colorModel: ColorModel) {
  // TODO: Take color model into account
  return initShaderProgram(gl, vsSource, getFsSource(colorModel));
}

export function renderTensorPatchesWithSubdivisionWebGL(
  tensorPatches: { patch: TensorPatch<Color>; x: number; y: number }[],
  colorModel: ColorModel,
  maxDepth: number,
  gl: WebGL2RenderingContext
) {
  const vertices = new Float32Array(4 ** maxDepth * 12 * tensorPatches.length);
  const uv1 = new Float32Array(4 ** maxDepth * 6 * 4 * tensorPatches.length);
  const uv2 = new Float32Array(4 ** maxDepth * 6 * 4 * tensorPatches.length);
  const texCoordinates = new Float32Array(
    4 ** maxDepth * 12 * tensorPatches.length
  );
  const colCount = Math.max(...tensorPatches.map(({ x }) => x)) + 1;
  const rowCount = Math.max(...tensorPatches.map(({ y }) => y)) + 1;
  const colorTextureData = new Float32Array(
    4 * (colCount + 1) * (rowCount + 1)
  );

  const quadMinUV: Vec2[] = new Array(4 ** maxDepth * tensorPatches.length);

  for (let patchInd = 0; patchInd < tensorPatches.length; patchInd++) {
    const { patch: tensorPatch, x, y } = tensorPatches[patchInd];

    const northInd = ((colCount + 1) * y + x) * 4;
    const eastInd = ((colCount + 1) * y + x + 1) * 4;
    const southInd = ((colCount + 1) * (y + 1) + x + 1) * 4;
    const westInd = ((colCount + 1) * (y + 1) + x) * 4;

    // Set color texture
    colorTextureData.set(tensorPatch.tensorValues.northValue, northInd);
    colorTextureData.set(tensorPatch.tensorValues.eastValue, eastInd);
    colorTextureData.set(tensorPatch.tensorValues.southValue, southInd);
    colorTextureData.set(tensorPatch.tensorValues.westValue, westInd);

    const basePatch: TensorPatch<Vec2> = {
      ...tensorPatch,
      tensorValues: {
        northValue: [0, 0],
        eastValue: [1, 0],
        southValue: [1, 1],
        westValue: [0, 1],
      },
    };

    const baseVertexOffset = patchInd * 4 ** maxDepth * 12;
    const baseAuxOffset = 4 ** maxDepth * 6 * 4 * patchInd;

    let addPatchCounter = 0;
    function addPatchToAttributes(patch: TensorPatch<Vec2>) {
      const { curve0, curve3, tensorValues } = patch;
      const { northValue, eastValue, southValue, westValue } = tensorValues;
      const vertexBaseIndex = baseVertexOffset + addPatchCounter * 12;

      const texCoordX = x / colCount;
      const texCoordY = y / rowCount;

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

      // Add texCoordinates
      // Triangle 1
      texCoordinates[vertexBaseIndex + 0] = texCoordX;
      texCoordinates[vertexBaseIndex + 1] = texCoordY;

      texCoordinates[vertexBaseIndex + 2] = texCoordX;
      texCoordinates[vertexBaseIndex + 3] = texCoordY;

      texCoordinates[vertexBaseIndex + 4] = texCoordX;
      texCoordinates[vertexBaseIndex + 5] = texCoordY;
      // Triangle 2
      texCoordinates[vertexBaseIndex + 6] = texCoordX;
      texCoordinates[vertexBaseIndex + 7] = texCoordY;

      texCoordinates[vertexBaseIndex + 8] = texCoordX;
      texCoordinates[vertexBaseIndex + 9] = texCoordY;

      texCoordinates[vertexBaseIndex + 10] = texCoordX;
      texCoordinates[vertexBaseIndex + 11] = texCoordY;

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
  const sortedTexCoord = new Float32Array(
    4 ** maxDepth * 12 * tensorPatches.length
  );
  const sortedUV1 = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );
  const sortedUV2 = new Float32Array(
    4 ** maxDepth * 6 * 4 * tensorPatches.length
  );

  renderOrder.forEach((ind, i) => {
    const sortedVertexBaseIndex = i * 12;
    const vertexBaseIndex = ind * 12;
    sortedVertices.set(
      vertices.subarray(vertexBaseIndex, vertexBaseIndex + 12),
      sortedVertexBaseIndex
    );
    sortedTexCoord.set(
      texCoordinates.subarray(vertexBaseIndex, vertexBaseIndex + 12),
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
  });

  const shaderProgram = getShaderProgram(gl, colorModel);

  const programInfo: ProgramInfo = {
    program: shaderProgram,
    attribLocations: {
      a_position: POSITION_LOCATION,
      a_uv_north_east: UV_NE_LOCATION,
      a_uv_south_west: UV_SW_LOCATION,
      a_texcoord: TEXCOORD_LOCATION,
    },
    uniformLocations: {
      u_resolution: gl.getUniformLocation(shaderProgram, 'u_resolution')!,
      u_colors: gl.getUniformLocation(shaderProgram, 'u_colors')!,
      u_color_texture: gl.getUniformLocation(shaderProgram, 'u_color_texture')!,
      u_col_row_count: gl.getUniformLocation(shaderProgram, 'u_col_row_count')!,
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

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sortedTexCoord, gl.STATIC_DRAW);

    return {
      a_position: positionBuffer,
      a_uv_north_east: uvNorthEastBuffer,
      a_uv_south_west: uvSouthWestBuffer,
      a_texcoord: texCoordBuffer,
    };
  }

  function setPositionAttribute(
    buffers: {
      a_position: WebGLBuffer;
      a_texcoord: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
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
      a_texcoord: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
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

  function setTexCoordAttribute(
    buffers: {
      a_position: WebGLBuffer;
      a_texcoord: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
    },
    programInfo: ProgramInfo
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_texcoord);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_texcoord,
      2,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_texcoord);
  }

  function drawPatch(
    buffers: {
      a_position: WebGLBuffer;
      a_texcoord: WebGLBuffer;
      a_uv_north_east: WebGLBuffer;
      a_uv_south_west: WebGLBuffer;
    },
    programInfo: ProgramInfo
  ) {
    setPositionAttribute(buffers, programInfo);
    setUVAttribute(buffers, programInfo);
    setTexCoordAttribute(buffers, programInfo);

    gl.useProgram(programInfo.program);

    const texture0 = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture0);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Remap colors with a trick to fit them in 8-bit values: in HSL, S is in range [0, 100], whereas H is in range [0, 360]. Therefore, S fits in 7 bits and H in 9 bits; so 16 bits in total. Use the unused bit in S to pack the extra bit in H.
    if (colorModel === 'hsla') {
      for (let i = 0; i < colorTextureData.length; i += 4) {
        if (colorTextureData[i] > 255) {
          colorTextureData[i] -= 128;
          colorTextureData[i + 1] += 128;
        }
      }
    }
    // Similarly to LCH, fit the extra H bit to the unused L bit.
    else if (colorModel === 'lcha') {
      for (let i = 0; i < colorTextureData.length; i++) {
        if (colorTextureData[i] > 255) {
          colorTextureData[i] -= 128;
          colorTextureData[i - 2] += 128;
        }
      }
    }

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      colCount + 1,
      rowCount + 1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(colorTextureData)
    );

    gl.uniform1i(programInfo.uniformLocations.u_color_texture, 0);

    gl.uniform2f(
      programInfo.uniformLocations.u_resolution,
      gl.canvas.width,
      gl.canvas.height
    );

    gl.uniform2f(
      programInfo.uniformLocations.u_col_row_count,
      colCount,
      rowCount
    );

    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
  }

  const buffers = initBuffers();

  drawPatch(buffers, programInfo);
}
