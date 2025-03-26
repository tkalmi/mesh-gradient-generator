import { CONTROL_POINT_RADIUS } from '../constants';
import { CubicBezier } from '../types';
import { convertXToCanvasX, convertYToCanvasY } from './helpers';
import { initShaderProgram } from './webGL';

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
  rows: CubicBezier[]
) {
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

export function renderBezierCurvesWebGL(
  gl: WebGL2RenderingContext,
  columns: CubicBezier[],
  rows: CubicBezier[]
) {
  const vsSource = /*glsl*/ `#version 300 es
    precision highp float;
    layout(location = 0) in float a_t;
    layout(location = 1) in vec2 a_p0;
    layout(location = 2) in vec2 a_p1;
    layout(location = 3) in vec2 a_p2;
    layout(location = 4) in vec2 a_p3;

    out vec2 v_position; // Pass position to fragment shader for debugging

    void main() {
      float u = 1.0 - a_t;
      float tt = a_t * a_t;
      float uu = u * u;
      float uuu = uu * u;
      float ttt = tt * a_t;

      vec2 position = uuu * a_p0 + 3.0 * uu * a_t * a_p1 + 3.0 * u * tt * a_p2 + ttt * a_p3;

      gl_Position = vec4(position.x, -position.y, 0.0, 1.0);
      v_position = position;
    }`;

  const fsSource = /*glsl*/ `#version 300 es
    precision highp float;
    out vec4 outColor;
    in vec2 v_position; // Receive interpolated position

    void main() {
        outColor = vec4(1.0, 1.0, 1.0, 1.0);
    }`;

  const program = initShaderProgram(gl, vsSource, fsSource);
  if (!program) {
    console.error('Shader program initialization failed.');
    return;
  }
  gl.useProgram(program);

  const width = gl.canvas.width;
  const height = gl.canvas.height;
  const segmentsPerLine = 100;

  const lines = columns.concat(rows);
  const totalVertices = lines.length * (segmentsPerLine + 1);
  const vertexData = new Float32Array(totalVertices * 9); // Each vertex: t + p0..p3 (x,y)

  let index = 0;
  for (const line of lines) {
    // Transform control points to clip space
    const x0 = (convertXToCanvasX(line[0][0], width) / width) * 2 - 1;
    const y0 = (convertXToCanvasX(line[0][1], height) / height) * 2 - 1; // Corrected Y
    const x1 = (convertXToCanvasX(line[1][0], width) / width) * 2 - 1;
    const y1 = (convertXToCanvasX(line[1][1], height) / height) * 2 - 1; // Corrected Y
    const x2 = (convertXToCanvasX(line[2][0], width) / width) * 2 - 1;
    const y2 = (convertXToCanvasX(line[2][1], height) / height) * 2 - 1; // Corrected Y
    const x3 = (convertXToCanvasX(line[3][0], width) / width) * 2 - 1;
    const y3 = (convertXToCanvasX(line[3][1], height) / height) * 2 - 1; // Corrected Y

    for (let i = 0; i <= segmentsPerLine; i++) {
      const t = i / segmentsPerLine;
      vertexData.set([t, x0, y0, x1, y1, x2, y2, x3, y3], index);
      index += 9;
    }
  }

  const vertexBuffer = gl.createBuffer();
  if (!vertexBuffer) {
    console.error('Failed to create vertex buffer');
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

  const tLocation = gl.getAttribLocation(program, 'a_t');
  const p0Location = gl.getAttribLocation(program, 'a_p0');
  const p1Location = gl.getAttribLocation(program, 'a_p1');
  const p2Location = gl.getAttribLocation(program, 'a_p2');
  const p3Location = gl.getAttribLocation(program, 'a_p3');

  gl.enableVertexAttribArray(tLocation);
  gl.vertexAttribPointer(tLocation, 1, gl.FLOAT, false, 9 * 4, 0);

  gl.enableVertexAttribArray(p0Location);
  gl.vertexAttribPointer(p0Location, 2, gl.FLOAT, false, 9 * 4, 1 * 4);

  gl.enableVertexAttribArray(p1Location);
  gl.vertexAttribPointer(p1Location, 2, gl.FLOAT, false, 9 * 4, 3 * 4);

  gl.enableVertexAttribArray(p2Location);
  gl.vertexAttribPointer(p2Location, 2, gl.FLOAT, false, 9 * 4, 5 * 4);

  gl.enableVertexAttribArray(p3Location);
  gl.vertexAttribPointer(p3Location, 2, gl.FLOAT, false, 9 * 4, 7 * 4);

  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    gl.drawArrays(gl.LINE_STRIP, offset, segmentsPerLine + 1);
    offset += segmentsPerLine + 1;
  }

  // Check for errors
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    console.error('WebGL Error:', error);
  }
}

/**
 * Render control points in given context, either with WebGL or 2D. The first and last values of each column should correspond to start/end of a row, and vice versa.
 * @param context
 * @param columns columns formed by control points
 * @param rows rows formed by control points
 */
export function renderControlPoints(
  context: WebGL2RenderingContext,
  columns: CubicBezier[],
  rows: CubicBezier[],
  showControlPoints: boolean,
  showBezierCurves: boolean
) {
  if (showControlPoints) {
    renderControlPointsWebGL(context, columns, rows);
  }
  if (showBezierCurves) {
    renderBezierCurvesWebGL(context, columns, rows);
  }
}
