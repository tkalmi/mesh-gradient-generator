import { CONTROL_POINT_RADIUS } from '../constants';
import { CubicBezier } from '../types';
import { convertXToCanvasX, convertYToCanvasY } from './helpers';
import { initShaderProgram } from './webGL';

export function renderControlPointsWebGL(
  gl: WebGL2RenderingContext,
  columns: CubicBezier[],
  rows: CubicBezier[]
) {
  const width = gl.canvas.width;
  const height = gl.canvas.height;
  const aspect = width / height;
  const controlPoints = rows.flat(1).concat(columns.flat(1));

  const vertices: number[] = [];

  for (const point of controlPoints) {
    // Convert control point coordinates to WebGL clip space (-1 to 1)
    const x = (convertXToCanvasX(point[0], width) / width) * 2 - 1;
    const y = (convertYToCanvasY(point[1], height) / height) * 2 - 1;

    // Fix the y flip by inverting it
    const correctedY = -y;

    // Radius in clip space
    const r = (CONTROL_POINT_RADIUS / width) * 2;

    // Define a full quad around each point, with UVs ranging from (-1, -1) to (1, 1)
    vertices.push(
      x - r,
      correctedY - r,
      -1,
      -1, // Bottom-left
      x + r,
      correctedY - r,
      1,
      -1, // Bottom-right
      x + r,
      correctedY + r,
      1,
      1, // Top-right

      x - r,
      correctedY - r,
      -1,
      -1, // Bottom-left
      x + r,
      correctedY + r,
      1,
      1, // Top-right
      x - r,
      correctedY + r,
      -1,
      1 // Top-left
    );
  }

  const vsSource = /*glsl*/ `#version 300 es
    precision highp float;
    layout(location = 0) in vec2 a_position;
    layout(location = 1) in vec2 a_uv;

    uniform float u_aspect; // Aspect ratio correction

    out vec2 v_uv;

    void main() {
      v_uv = vec2(a_uv.x * u_aspect, a_uv.y); // Scale x by aspect ratio
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fsSource = /*glsl*/ `#version 300 es
    precision highp float;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
      float dist = length(v_uv); // Distance from center (normalized)
      float alpha = smoothstep(1.0, 0.9, dist); // Smooth antialiasing

      if (dist > 1.0) discard; // Remove pixels outside the circle

      outColor = vec4(1.0, 1.0, 1.0, alpha); // White with smooth edges
    }
  `;

  const shaderProgram = initShaderProgram(gl, vsSource, fsSource);
  const positionBuffer = gl.createBuffer();

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  const programInfo = {
    program: shaderProgram,
    attribLocations: {
      a_position: gl.getAttribLocation(shaderProgram, 'a_position'),
      a_uv: gl.getAttribLocation(shaderProgram, 'a_uv'),
    },
    uniformLocations: {
      u_aspect: gl.getUniformLocation(shaderProgram, 'u_aspect'),
    },
  };

  gl.enableVertexAttribArray(programInfo.attribLocations.a_position);
  gl.vertexAttribPointer(
    programInfo.attribLocations.a_position,
    2,
    gl.FLOAT,
    false,
    4 * 4,
    0
  );

  gl.enableVertexAttribArray(programInfo.attribLocations.a_uv);
  gl.vertexAttribPointer(
    programInfo.attribLocations.a_uv,
    2,
    gl.FLOAT,
    false,
    4 * 4,
    2 * 4
  );

  gl.useProgram(programInfo.program);

  // Send aspect ratio to the shader
  gl.uniform1f(programInfo.uniformLocations.u_aspect, aspect);

  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4);
}

export function renderBezierCurvesWebGL(
  gl: WebGL2RenderingContext,
  columns: CubicBezier[],
  rows: CubicBezier[]
) {
  const vsSource = /*glsl*/ `#version 300 es
    precision highp float;
    layout(location = 0) in vec2 a_position;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }`;

  const fsSource = /*glsl*/ `#version 300 es
    precision highp float;
    out vec4 outColor;

    void main() {
        outColor = vec4(1.0, 1.0, 1.0, 1.0); // White color
    }`;

  const program = initShaderProgram(gl, vsSource, fsSource);
  if (!program) {
    console.error('Shader program initialization failed.');
    return;
  }
  gl.useProgram(program);

  const width = gl.canvas.width;
  const height = gl.canvas.height;
  const segmentsPerLine = 200; // More segments for smoother curves

  // Use a width that looks good with anti-aliasing
  const pixelLineWidth = 1.5; // Between 1-2 pixels for balance
  const lineWidth = (pixelLineWidth / width) * 2;

  const lines = columns.concat(rows);

  function bezier(
    t: number,
    p0: number[],
    p1: number[],
    p2: number[],
    p3: number[]
  ) {
    const u = 1 - t;
    const uu = u * u;
    const uuu = uu * u;
    const tt = t * t;
    const ttt = tt * t;
    return [
      uuu * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + ttt * p3[0],
      uuu * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + ttt * p3[1],
    ];
  }

  function normalize(v: number[]) {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    return len > 0 ? [v[0] / len, v[1] / len] : [0, 0];
  }

  function computeNormal(p1: number[], p2: number[]) {
    const tangent = [p2[0] - p1[0], p2[1] - p1[1]];
    const normal = normalize([-tangent[1], tangent[0]]); // Rotate by 90 degrees
    return normal;
  }

  const positionLocation = gl.getAttribLocation(program, 'a_position');

  for (const line of lines) {
    const vertexData: number[] = [];

    // Use normal conversion without rounding for smoother curves
    const p0 = [
      (convertXToCanvasX(line[0][0], width) / width) * 2 - 1,
      (-convertYToCanvasY(line[0][1], height) / height) * 2 + 1,
    ];
    const p1 = [
      (convertXToCanvasX(line[1][0], width) / width) * 2 - 1,
      (-convertYToCanvasY(line[1][1], height) / height) * 2 + 1,
    ];
    const p2 = [
      (convertXToCanvasX(line[2][0], width) / width) * 2 - 1,
      (-convertYToCanvasY(line[2][1], height) / height) * 2 + 1,
    ];
    const p3 = [
      (convertXToCanvasX(line[3][0], width) / width) * 2 - 1,
      (-convertYToCanvasY(line[3][1], height) / height) * 2 + 1,
    ];

    let prevPoint = bezier(0, p0, p1, p2, p3);

    for (let i = 1; i <= segmentsPerLine; i++) {
      const t = i / segmentsPerLine;
      const point = bezier(t, p0, p1, p2, p3);
      const normal = computeNormal(prevPoint, point);

      // Offset for thickness
      const left = [
        point[0] + normal[0] * lineWidth,
        point[1] + normal[1] * lineWidth,
      ];
      const right = [
        point[0] - normal[0] * lineWidth,
        point[1] - normal[1] * lineWidth,
      ];

      vertexData.push(...left, ...right);
      prevPoint = point;
    }

    const vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) {
      console.error('Failed to create vertex buffer');
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(vertexData),
      gl.STATIC_DRAW
    );

    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertexData.length / 2);
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
