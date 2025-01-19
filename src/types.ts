export type Vec2<T = number> = [T, T];

export type Vec4<T = number> = [T, T, T, T];

export type CubicBezier = Vec4<Vec2>;

export type RGBA = {
  r: number;
  g: number;
  b: number;
  a: number;
};

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
