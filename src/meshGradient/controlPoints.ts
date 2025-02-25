import { CONTROL_POINT_RADIUS } from '../constants';
import { CubicBezier } from '../types';
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

type ProgramInfo = {
  program: WebGLShader;
  attribLocations: {
    a_position: number;
    a_center: number;
  };
  uniformLocations: {
    u_resolution: WebGLUniformLocation;
    u_radius: WebGLUniformLocation;
  };
};

const POSITION_LOCATION = 0;
const CENTER_LOCATION = 1;

export function renderControlPointsWebGL(
  gl: WebGL2RenderingContext,
  columns: CubicBezier[],
  rows: CubicBezier[],
  showControlPoints: boolean,
  showBezierCurves: boolean
) {
  if (!showControlPoints) {
    return;
  }
  const width = gl.canvas.width;
  const height = gl.canvas.height;
  const centerVecs = rows.flat(1).concat(columns.flat(1));
  const centers = new Float32Array(centerVecs.length * 2 * 6);
  centerVecs.forEach((center, ind) => {
    const x = convertXToCanvasX(center[0], width);
    const y = convertYToCanvasY(center[1], height);

    centers[ind * 12 + 0] = x;
    centers[ind * 12 + 1] = y;
    centers[ind * 12 + 2] = x;
    centers[ind * 12 + 3] = y;
    centers[ind * 12 + 4] = x;
    centers[ind * 12 + 5] = y;
    centers[ind * 12 + 6] = x;
    centers[ind * 12 + 7] = y;
    centers[ind * 12 + 8] = x;
    centers[ind * 12 + 9] = y;
    centers[ind * 12 + 10] = x;
    centers[ind * 12 + 11] = y;
  });
  const vertices = new Float32Array(centerVecs.length * 2 * 6);
  centerVecs.forEach((center, ind) => {
    const x = convertXToCanvasX(center[0], width);
    const y = convertYToCanvasY(center[1], height);

    vertices[ind * 12 + 0] = x - CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 1] = y - CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 2] = x - CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 3] = y + CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 4] = x + CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 5] = y + CONTROL_POINT_RADIUS;

    vertices[ind * 12 + 6] = x - CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 7] = y - CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 8] = x + CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 9] = y - CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 10] = x + CONTROL_POINT_RADIUS;
    vertices[ind * 12 + 11] = y + CONTROL_POINT_RADIUS;

    return vertices;
  });

  const vsSource = /*glsl*/ `#version 300 es
    in vec2 a_position;
    in vec2 a_center;

    uniform vec2 u_resolution;

    out vec2 v_position;
    out vec2 v_center;

    vec2 toClipSpace(vec2 point, vec2 resolution) {
      vec2 zeroToOne = point / resolution; // Convert from pixels to (0,1)
      vec2 zeroToTwo = zeroToOne * 2.0; // Convert (0,1) to (0,2)
      vec2 clipSpace = zeroToTwo - 1.0; // Convert (0,2) to (-1,1)
      clipSpace.y *= -1.0; // Flip Y to match WebGL's coordinate system
      return clipSpace;
    }

    void main() {
      v_position = a_position / u_resolution; // Normalize positions (0 to 1)
      v_center = a_center / u_resolution; // Normalize centers (0 to 1)

      gl_Position = vec4(toClipSpace(a_position, u_resolution), 0.0, 1.0);
    }
  `;

  const fsSource = /*glsl*/ `#version 300 es
    precision highp float;

    in vec2 v_position;
    in vec2 v_center;

    uniform vec2 u_resolution;
    uniform float u_radius;
    
    out vec4 outputColor;

    void main() {
      vec2 aspectRatio = vec2(u_resolution.x / u_resolution.y, 1.0); // Apply aspect ratio correction
      vec2 correctedPosition = v_position * aspectRatio;
      vec2 correctedCenter = v_center * aspectRatio;

      float radius = u_radius / u_resolution.y;  // Normalize radius correctly
      float dist = length(correctedPosition - correctedCenter);

      float edgeSmooth = radius * 0.1;  // Smooth transition for anti-aliasing
      float alpha = smoothstep(radius + edgeSmooth, radius - edgeSmooth, dist);

      outputColor = vec4(1.0, 1.0, 1.0, alpha);
    }
`;

  const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

  const programInfo = {
    program: shaderProgram,
    attribLocations: {
      a_position: POSITION_LOCATION,
      a_center: CENTER_LOCATION,
    },
    uniformLocations: {
      u_resolution: gl.getUniformLocation(shaderProgram, 'u_resolution')!,
      u_radius: gl.getUniformLocation(shaderProgram, 'u_radius')!,
    },
  };

  function initBuffers(gl: WebGL2RenderingContext) {
    return initCtrlPointPositionBuffers(gl);
  }

  function initCtrlPointPositionBuffers(gl: WebGL2RenderingContext): {
    a_position: WebGLBuffer;
    a_center: WebGLBuffer;
  } {
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const centerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, centerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, centers, gl.STATIC_DRAW);

    return { a_position: positionBuffer, a_center: centerBuffer };
  }

  function setPositionAttribute(
    gl: WebGL2RenderingContext,
    buffers: { a_position: WebGLBuffer; a_center: WebGLBuffer },
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

  function setCenterAttribute(
    gl: WebGL2RenderingContext,
    buffers: { a_position: WebGLBuffer; a_center: WebGLBuffer },
    programInfo: ProgramInfo
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_center);
    gl.vertexAttribPointer(
      programInfo.attribLocations.a_center,
      2,
      gl.FLOAT,
      false,
      0,
      0
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.a_center);
  }

  function drawCtrlPoints(
    gl: WebGL2RenderingContext,
    buffers: { a_position: WebGLBuffer; a_center: WebGLBuffer },
    programInfo: ProgramInfo
  ) {
    setPositionAttribute(gl, buffers, programInfo);
    setCenterAttribute(gl, buffers, programInfo);

    gl.useProgram(programInfo.program);

    gl.uniform1f(programInfo.uniformLocations.u_radius, CONTROL_POINT_RADIUS);

    gl.uniform2f(
      programInfo.uniformLocations.u_resolution,
      gl.canvas.width,
      gl.canvas.height
    );

    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
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
