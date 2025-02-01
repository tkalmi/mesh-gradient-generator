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

const fsSource = /*glsl*/ `
    precision mediump float;

    uniform sampler2D u_texture;

    varying vec2 v_texcoord;

    void main() {
      gl_FragColor = texture2D(u_texture, v_texcoord);
    }
  `;

let globalShaderProgram: WebGLProgram;
let globalWebGLRenderingContext: WebGLRenderingContext | null = null;
// TODO: Make this into a proper singleton
function getShaderProgram(gl: WebGLRenderingContext) {
  if (!globalShaderProgram || globalWebGLRenderingContext !== gl) {
    globalWebGLRenderingContext = gl;
    globalShaderProgram = initShaderProgram(gl, vsSource, fsSource);
  }
  return globalShaderProgram;
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

  const shaderProgram = getShaderProgram(gl);

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

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      imageWidth,
      imageHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(textureData)
    );
    // gl.texImage2D(
    //   gl.TEXTURE_2D,
    //   0,
    //   gl.RGBA,
    //   imageWidth,
    //   imageHeight,
    //   0,
    //   gl.RGBA,
    //   gl.FLOAT,
    //   new Float32Array(textureData)
    // );

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(programInfo.uniformLocations.u_texture, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  const buffers = initBuffers();

  drawPatch(buffers, programInfo);
}
