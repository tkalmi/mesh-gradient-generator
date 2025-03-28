import { Color, CoonsPatch, CubicBezier, Vec2 } from './types';

/**
 * Get initial control point positions for given row and column count
 * @param rowCount
 * @param columnCount
 * @returns array of points
 */
export function getNewPoints(rowCount: number, columnCount: number): Vec2[] {
  const newPoints: Vec2[] = [];

  for (let i = 0; i <= rowCount * 3; i++) {
    for (let j = 0; j <= columnCount * 3; j++) {
      if (i % 3 !== 0 && j % 3 !== 0) {
        continue;
      }
      newPoints.push([
        (j / (columnCount * 3)) * 100,
        (i / (rowCount * 3)) * 100,
      ]);
    }
  }

  return newPoints;
}

/**
 * Gets random colors to fill control points
 * @param rowCount
 * @param columnCount
 * @returns array of colors to assign to control points
 */
export function getColors(rowCount: number, columnCount: number): Color[] {
  const colors: Color[] = [];
  for (let i = 0; i < (columnCount + 1) * (rowCount + 1); i++) {
    colors.push([
      Math.round(Math.random() * 255),
      Math.round(Math.random() * 255),
      Math.round(Math.random() * 255),
      255,
    ]);
  }
  return colors;
}

/**
 * Create Bezier curves from given control points, based on how many rows and columns there should be
 * @param rawPoints control points to assign to curves. Order matters here: column-major order
 * @param columnCount
 * @param rowCount
 * @returns Bezier curves separated to columns and rows. Note that it's possible to drag columns into looking like rows, and vice versa.
 */
export function getColumnsAndRowsFromPoints(
  rawPoints: Vec2[],
  columnCount: number,
  rowCount: number
): { columns: CubicBezier[]; rows: CubicBezier[] } {
  const backupPoints = getNewPoints(rowCount, columnCount);
  const points =
    backupPoints.length === rawPoints.length ? rawPoints : backupPoints;
  const rows: CubicBezier[] = [];
  for (let i = 0; i <= rowCount; i++) {
    for (let j = 0; j < columnCount; j++) {
      const startInd = i * (columnCount * 5 + 3) + j * 3;
      const row: CubicBezier = [
        points[startInd],
        points[startInd + 1],
        points[startInd + 2],
        points[startInd + 3],
      ];
      rows.push(row);
    }
  }

  const columns: CubicBezier[] = [];
  for (let j = 0; j < rowCount; j++) {
    for (let i = 0; i <= columnCount; i++) {
      const column: Vec2[] = [
        points[j * (columnCount * 5 + 3) + (i % (columnCount + 1)) * 3],
        points[(j + 1) * (columnCount * 3 + 1) + 2 * j * (columnCount + 1) + i],
        points[
          (j + 1) * (columnCount * 3 + 1) + (2 * j + 1) * (columnCount + 1) + i
        ],
        points[(j + 1) * (columnCount * 5 + 3) + (i % (columnCount + 1)) * 3],
      ];

      columns.push(column as CubicBezier);
    }
  }

  return { columns, rows };
}

/**
 * Form a Coons patches from given Bezier curves and colors.
 * @param columns
 * @param rows
 * @param colors
 * @param columnCount
 * @param rowCount
 * @returns array of Coons patches encircled by the given columns and rows.
 */
export function getCoonsPatchFromRowsAndColumns(
  columns: CubicBezier[],
  rows: CubicBezier[],
  colors: Color[],
  columnCount: number,
  rowCount: number
): CoonsPatch<Color>[] {
  const patches: CoonsPatch<Color>[] = [];

  for (let i = 0; i < rowCount; i++) {
    for (let j = 0; j < columnCount; j++) {
      // Take the ith row; this is north
      // Take the (i + columnCount)th row and flip it; this is south
      // Take the column with the same starting point as north's start, then flip it; this is west
      // Take the column with the same starting point as north's end; this is east
      const north = rows[i * columnCount + j];
      const south = rows[(i + 1) * columnCount + j]
        .slice()
        .reverse() as CubicBezier;
      const west = columns
        .find(
          (column) =>
            column[0][0] === north[0][0] && column[0][1] === north[0][1]
        )
        ?.slice()
        .reverse() as CubicBezier;
      const east = columns.find(
        (column) => column[0][0] === north[3][0] && column[0][1] === north[3][1]
      ) as CubicBezier;

      const coonsValues = {
        northValue: colors[i * (columnCount + 1) + (j % (columnCount + 1))],
        eastValue: colors[i * (columnCount + 1) + (j % (columnCount + 1)) + 1],
        southValue:
          colors[(i + 1) * (columnCount + 1) + (j % (columnCount + 1)) + 1],
        westValue:
          colors[(i + 1) * (columnCount + 1) + (j % (columnCount + 1))],
      };

      const coonsPatch: CoonsPatch<Color> = {
        north,
        east,
        south,
        west,
        coonsValues,
      };

      patches.push(coonsPatch);
    }
  }

  return patches;
}
