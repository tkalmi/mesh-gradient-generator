import {
  bezierToFDCoeff,
  estimateFDStepCount,
  fixIter,
  halveFDCoefficientsVec2,
  renderCubicBezier,
  updatePointsAndCoeff,
} from './fastForwardDifferencing';
import {
  Color,
  ColorModel,
  CubicBezier,
  ForwardDifferenceCoefficient,
  TensorPatch,
  Vec2,
  WebGLProgramInfo,
} from '../types';
import { colorToStringFuncs } from './colors';
import { initShaderProgram } from './webGL';

/**
 * Rasterize patch using Fast-Forward Differencing algorithm
 */
export function renderTensorPatchWithFFD2d(
  patch: TensorPatch<Color>,
  colorModel: ColorModel,
  context: CanvasRenderingContext2D
) {
  const { curve0, curve1, curve2, curve3, tensorValues } = patch;
  const curves = [curve0, curve1, curve2, curve3];
  const shiftStep = Math.max(...curves.map(estimateFDStepCount));

  const basePoints = curves.map((curve) => curve[0]);
  const ffCoeff = curves.map((curve) =>
    fixIter(shiftStep, halveFDCoefficientsVec2, bezierToFDCoeff(curve))
  );

  const maxStepCount = 1 << shiftStep;

  const du = 1 / maxStepCount;

  const imageWidth = context.canvas.clientWidth;
  const imageHeight = context.canvas.clientHeight;

  let points = basePoints;
  let coeffs = ffCoeff;
  let ut = 0;

  const indicesInitialized = new Set<number>();

  if (colorModel === 'rgba') {
    // If in RGBA mode, use ImageData, as that's the most efficient way

    const imageData = context.getImageData(0, 0, imageWidth, imageHeight);

    for (let i = maxStepCount; i > 0; i--) {
      if (i === 0) {
        continue;
      }

      const [newPoints, newCoeffs] = updatePointsAndCoeff(points, coeffs);

      renderCubicBezier(
        tensorValues,
        points as CubicBezier,
        ut,
        0,
        ut,
        1,
        imageData.data,
        indicesInitialized,
        imageWidth
      );

      points = newPoints;
      coeffs = newCoeffs as Vec2<ForwardDifferenceCoefficient>[];
      ut += du;
    }

    context.putImageData(imageData, 0, 0);
  } else {
    // If in HSL or LCH, draw pixel-sized rectangles to avoid having to convert to RGBA

    const colorToString = colorToStringFuncs[colorModel];
    const pixels: number[] = new Array(imageWidth * imageHeight * 4).fill(0);

    for (let i = maxStepCount; i > 0; i--) {
      if (i === 0) {
        continue;
      }

      const [newPoints, newCoeffs] = updatePointsAndCoeff(points, coeffs);

      renderCubicBezier(
        tensorValues,
        points as CubicBezier,
        ut,
        0,
        ut,
        1,
        pixels,
        indicesInitialized,
        imageWidth
      );

      points = newPoints;
      coeffs = newCoeffs as Vec2<ForwardDifferenceCoefficient>[];
      ut += du;
    }

    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < imageWidth; x++) {
        const start = (y * imageWidth + x) * 4;
        context.fillStyle = colorToString(
          pixels.slice(start, start + 4) as Color
        );
        context.fillRect(x, y, 1, 1);
      }
    }
  }
}

type ProgramInfo = WebGLProgramInfo<
  { a_position: number; a_texcoord: number },
  { u_texture: WebGLUniformLocation }
>;

const vsSource = /*glsl*/ `
    attribute vec2 a_position;
    attribute vec2 a_texcoord;

    varying vec2 v_texcoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);

      v_texcoord = a_texcoord;

    }
  `;

function getFsSource(colorModel: ColorModel) {
  const fsSource = /*glsl*/ `
    precision mediump float;

    uniform sampler2D u_texture;

    varying vec2 v_texcoord;

    vec4 hslaToRgba(vec4 hsla) {
      // Normalize input values
      float h = hsla.x * 255.0;
      float s = hsla.y * 255.0; // Saturation: [0, 100] -> [0, 1]
      // Since texture in WebGL can store only 8-bit values, store the additional hue bit in saturation, as hue is in range [0, 360] (= it needs 9 bits) and saturation is in range [0, 100] (= needs only 7 bits).
      if (s > 100.0) {
        h += 128.0;
        s -= 128.0;
      }
      h *= 0.002777777777777778; // Hue: [0, 360] -> [0, 1]
      s *= 0.01; // Saturation: [0, 100] -> [0, 1]
      float l = hsla.z * 2.55;     // Lightness: [0, 100] -> [0, 1]

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
      float L = lcha.x * 255.0;  // Convert from [0,1] to [0,100]
      float C = lcha.y * 255.0;  // Convert from [0,1] to [0,Inf]
      float H = lcha.z * 255.0;

      if (L > 100.0) {
        L -= 128.0;
        H += 128.0;
      }
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

    void main() {
      vec4 color = texture2D(u_texture, v_texcoord);
      if (color.w <= 0.0) {
        discard;
      } else {
        ${(() => {
          switch (colorModel) {
            case 'hsla':
              return 'gl_FragColor = hslaToRgba(color);';
            case 'lcha':
              return 'gl_FragColor = lchaToRgba(color);';
            case 'rgba':
            default:
              return 'gl_FragColor = color;';
          }
        })()}
      }
    }
  `;

  return fsSource;
}

let globalShaderProgramRGB: WebGLProgram;
let globalShaderProgramHSL: WebGLProgram;
let globalShaderProgramLCH: WebGLProgram;
let globalWebGLRenderingContext: WebGLRenderingContext | null = null;
// TODO: Make this into a proper singleton
function getShaderProgram(gl: WebGLRenderingContext, colorModel: ColorModel) {
  switch (colorModel) {
    case 'hsla':
      globalShaderProgramHSL =
        !globalShaderProgramHSL || globalWebGLRenderingContext !== gl
          ? initShaderProgram(gl, vsSource, getFsSource(colorModel))
          : globalShaderProgramHSL;
      globalWebGLRenderingContext = gl;
      return globalShaderProgramHSL;
    case 'lcha':
      globalShaderProgramLCH =
        !globalShaderProgramLCH || globalWebGLRenderingContext !== gl
          ? initShaderProgram(gl, vsSource, getFsSource(colorModel))
          : globalShaderProgramLCH;
      globalWebGLRenderingContext = gl;
      return globalShaderProgramLCH;
    case 'rgba':
    default:
      globalShaderProgramRGB =
        !globalShaderProgramRGB || globalWebGLRenderingContext !== gl
          ? initShaderProgram(gl, vsSource, getFsSource(colorModel))
          : globalShaderProgramRGB;
      globalWebGLRenderingContext = gl;
      return globalShaderProgramRGB;
  }
}

export function renderTensorPatchWithFFDWebGL(
  patch: TensorPatch<Color>,
  colorModel: ColorModel,
  gl: WebGLRenderingContext
) {
  const { curve0, curve1, curve2, curve3, tensorValues } = patch;
  const curves = [curve0, curve1, curve2, curve3];
  const shiftStep = Math.max(...curves.map(estimateFDStepCount));

  const basePoints = curves.map((curve) => curve[0]);
  const ffCoeff = curves.map((curve) =>
    fixIter(shiftStep, halveFDCoefficientsVec2, bezierToFDCoeff(curve))
  );

  const maxStepCount = 1 << shiftStep;

  const du = 1 / maxStepCount;

  const imageWidth = gl.canvas.width;
  const imageHeight = gl.canvas.height;

  let points = basePoints;
  let coeffs = ffCoeff;
  let ut = 0;

  const textureData: number[] = new Array(imageWidth * imageHeight * 4).fill(0);
  const indicesInitialized = new Set<number>();

  for (let i = maxStepCount; i > 0; i--) {
    if (i === 0) {
      continue;
    }

    const [newPoints, newCoeffs] = updatePointsAndCoeff(points, coeffs);

    renderCubicBezier(
      tensorValues,
      points as CubicBezier,
      ut,
      0,
      ut,
      1,
      textureData,
      indicesInitialized,
      imageWidth
    );

    points = newPoints;
    coeffs = newCoeffs as Vec2<ForwardDifferenceCoefficient>[];
    ut += du;
  }

  const shaderProgram = getShaderProgram(gl, colorModel);

  const programInfo: ProgramInfo = {
    program: shaderProgram,
    attribLocations: {
      a_position: gl.getAttribLocation(shaderProgram, 'a_position'),
      a_texcoord: gl.getAttribLocation(shaderProgram, 'a_texcoord'),
    },
    uniformLocations: {
      u_texture: gl.getUniformLocation(shaderProgram, 'u_texture')!,
    },
  };

  function initBuffers() {
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1,
        1, // Bottom-left
        -1,
        -1, // Top-left
        1,
        1, // Bottom-right
        -1,
        -1, // Top-left
        1,
        -1, // Top-right
        1,
        1, // Bottom-right
      ]),
      gl.STATIC_DRAW
    );

    const texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        0,
        0, // Bottom-left
        0,
        1, // Top-left
        1,
        0, // Bottom-right
        0,
        1, // Top-left
        1,
        1, // Top-right
        1,
        0, // Bottom-right
      ]),
      gl.STATIC_DRAW
    );

    return {
      a_position: positionBuffer,
      a_texcoord: texcoordBuffer,
    };
  }

  function setPositionAttribute(
    buffers: { a_position: WebGLBuffer; a_texcoord: WebGLBuffer },
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

  function setTexcoordAttribute(
    buffers: { a_texcoord: WebGLBuffer },
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
    buffers: { a_position: WebGLBuffer; a_texcoord: WebGLBuffer },
    programInfo: ProgramInfo
  ) {
    setPositionAttribute(buffers, programInfo);
    setTexcoordAttribute(buffers, programInfo);

    gl.useProgram(programInfo.program);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    const remappedTextureData: number[] = textureData.slice();
    if (colorModel === 'hsla') {
      for (let i = 0; i < remappedTextureData.length; i += 4) {
        if (remappedTextureData[i] > 255) {
          remappedTextureData[i] -= 128;
          remappedTextureData[i + 1] += 128;
        }
      }
    } else if (colorModel === 'lcha') {
      for (let i = 0; i < remappedTextureData.length; i++) {
        if (remappedTextureData[i] > 255) {
          remappedTextureData[i] -= 128;
          remappedTextureData[i - 2] += 128;
        }
      }
    }

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      imageWidth,
      imageHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(remappedTextureData)
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(programInfo.uniformLocations.u_texture, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  const buffers = initBuffers();

  drawPatch(buffers, programInfo);
}
