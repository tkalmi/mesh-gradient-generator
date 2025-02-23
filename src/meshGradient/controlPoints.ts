import { CONTROL_POINT_RADIUS } from '../constants';
import { CubicBezier, Vec2 } from '../types';
import { convertXToCanvasX, convertYToCanvasY } from './helpers';
import { initShaderProgram } from './webGL';

export function renderControlPoints2d(
  context: CanvasRenderingContext2D,
  columns: CubicBezier[],
  rows: CubicBezier[],
  showControlPoints: boolean,
  showBezierCurves: boolean
) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  context.fillStyle = 'white';
  context.strokeStyle = '#5a5a5a';
  context.lineWidth = 2;

  for (const column of columns) {
    context.strokeStyle = '#5a5a5a';
    for (const point of column) {
      if (showControlPoints) {
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
    }

    if (showBezierCurves) {
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
  }

  for (const row of rows) {
    context.strokeStyle = '#5a5a5a';
    for (const point of row) {
      if (showControlPoints) {
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
    }

    if (showBezierCurves) {
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
}

export function renderControlPointsWebGL(
  gl: WebGL2RenderingContext,
  columns: CubicBezier[],
  rows: CubicBezier[]
) {
  const width = gl.canvas.width;
  const height = gl.canvas.height;
  const totalSlicesPerCircle = 50;
  const positions = rows
    .flat(1)
    .concat(columns.flat(1))
    .flatMap((center) => {
      const x = convertXToCanvasX(center[0], width);
      const y = convertYToCanvasY(center[1], height);
      const vertices: Vec2<number>[] = [[x, y]];

      for (let i = 0; i <= totalSlicesPerCircle; i++) {
        vertices.push([
          x +
            CONTROL_POINT_RADIUS *
              Math.cos((i * 2 * Math.PI) / (totalSlicesPerCircle / 2)),
          y +
            CONTROL_POINT_RADIUS *
              Math.sin((i * 2 * Math.PI) / (totalSlicesPerCircle / 2)),
        ]);
      }
      return vertices;
    })
    .flat();

  const vsSource = /*glsl*/ `#version 300 es
    in vec2 a_position;

    uniform vec2 u_resolution;

    void main() {
      // Convert position from pixels to 0.0 to 1.0
      vec2 zeroToOne = a_position / u_resolution;

      // Convert from 0->1 to 0->2
      vec2 zeroToTwo = zeroToOne * 2.0;

      // Convert from 0->2 to -1->+1 (clip space)
      vec2 clipSpace = (zeroToTwo - 1.0) * vec2(1, -1);
      
      gl_Position = vec4(clipSpace, 0.0, 1.0);
    }
  `;

  const fsSource = /*glsl*/ `#version 300 es
    precision mediump float;

    out vec4 outputColor;

    void main() {

      outputColor = vec4(1.0,1.0,1.0,1.0);
    }
  `;

  const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

  const programInfo = {
    program: shaderProgram,
    attribLocations: {
      a_position: gl.getAttribLocation(shaderProgram, 'a_position'),
    },
    uniformLocations: {
      u_resolution: gl.getUniformLocation(shaderProgram, 'u_resolution')!,
    },
  };

  function initBuffers(gl: WebGL2RenderingContext) {
    const positionBuffer = initCtrlPointPositionBuffer(gl);

    return { a_position: positionBuffer };
  }

  function initCtrlPointPositionBuffer(
    gl: WebGL2RenderingContext
  ): WebGLBuffer {
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    return positionBuffer;
  }

  function setPositionAttribute(
    gl: WebGL2RenderingContext,
    buffers: { a_position: WebGLBuffer },
    programInfo: {
      program: WebGLShader;
      attribLocations: {
        a_position: number;
      };
      uniformLocations: {
        u_resolution: WebGLUniformLocation;
      };
    }
  ) {
    const numComponents = 2;
    const type = gl.FLOAT;
    const normalize = false;
    const stride = 0;
    const offset = 0;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_position);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_position,
      numComponents,
      type,
      normalize,
      stride,
      offset
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_position);
  }

  function drawCtrlPoints(
    gl: WebGL2RenderingContext,
    buffers: { a_position: WebGLBuffer },
    programInfo: {
      program: WebGLShader;
      attribLocations: {
        a_position: number;
      };
      uniformLocations: {
        u_resolution: WebGLUniformLocation;
      };
    }
  ) {
    setPositionAttribute(gl, buffers, programInfo);

    gl.useProgram(programInfo.program);

    gl.uniform2f(
      programInfo.uniformLocations.u_resolution,
      gl.canvas.width,
      gl.canvas.height
    );

    for (let i = 0; i < rows.flat(1).length + columns.flat(1).length; i++) {
      gl.drawArrays(
        gl.TRIANGLE_FAN,
        i * (totalSlicesPerCircle + 2),
        totalSlicesPerCircle / 2 + 2
      );
    }
  }

  const buffers = initBuffers(gl);

  drawCtrlPoints(gl, buffers, programInfo);
}

/**
 * Render control points in given context, either with WebGL or 2D. The first and last values of each column should correspond to start/end of a row, and vice versa.
 * @param context
 * @param columns columns formed by control points
 * @param rows rows formed by control points
 */
export function renderControlPoints(
  context: CanvasRenderingContext2D | WebGL2RenderingContext,
  columns: CubicBezier[],
  rows: CubicBezier[],
  showControlPoints: boolean,
  showBezierCurves: boolean
) {
  if (context instanceof WebGL2RenderingContext) {
    renderControlPointsWebGL(
      context,
      columns,
      rows,
      showControlPoints,
      showBezierCurves
    );
  } else if (context instanceof CanvasRenderingContext2D) {
    renderControlPoints2d(
      context,
      columns,
      rows,
      showControlPoints,
      showBezierCurves
    );
  } else {
    throw Error('Unknown render context mode selected.');
  }
}
