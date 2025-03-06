export type Vec2<T = number> = [T, T];

export type Vec4<T = number> = [T, T, T, T];

export type CubicBezier = Vec4<Vec2>;

export type ColorModel = 'rgba' | 'hsla' | 'oklab';

export type Color = Vec4<number>; // This four-value vector represents any four-value color space color, e.g., RGBA, HSL(A), or Oklab

export type ParametricValues<T> = {
  northValue: T;
  southValue: T;
  eastValue: T;
  westValue: T;
};

export type CoonsPatch<T = Vec2> = {
  north: CubicBezier; // control points for north curve
  south: CubicBezier; // control points for south curve
  east: CubicBezier; // control points for east curve
  west: CubicBezier; // control points for west curve
  coonsValues: ParametricValues<T>;
};

export type TensorPatch<T = Color> = {
  curve0: CubicBezier;
  curve1: CubicBezier;
  curve2: CubicBezier;
  curve3: CubicBezier;
  tensorValues: ParametricValues<T>;
};

export type ForwardDifferenceCoefficient = {
  fdA: number;
  fdB: number;
  fdC: number;
};

export type WebGLProgramInfo<AttributeLocations, UniformLocations> = {
  program: WebGLShader;
  attribLocations: AttributeLocations;
  uniformLocations: UniformLocations;
};
