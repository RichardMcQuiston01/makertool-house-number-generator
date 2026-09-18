import type {GlyphOutline, LoadedFont, PathCommand} from './font.js';
import {getGlyphOutline} from './font.js';
import type {Result, ScrewSize, SignConfig, SignShape, Unit} from './types.js';

/**
 * Sign geometry uses a Y-up coordinate system (origin at the bottom-left of
 * the sign backer, X right, Y up), matching common CAD/DXF conventions.
 * Output generators (SVG, etc.) are responsible for flipping Y if their
 * target format expects Y-down.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A single character's outline, already positioned in sign-backer coordinates. */
export interface PositionedGlyph {
  readonly character: string;
  readonly path: readonly PathCommand[];
}

/** A circular mounting/engraving hole, in sign-backer coordinates. */
export interface MountingHole {
  readonly center: Point;
  readonly diameter: number;
}

/** The sign's backing plate. */
export interface SignBacker {
  readonly shape: SignShape;
  readonly width: number;
  /** Equal to {@link width} when {@link shape} is `round` (both hold the diameter). */
  readonly height: number;
}

/** Computed geometry for every piece needed to cut and assemble a sign. */
export interface SignLayout {
  readonly backer: SignBacker;
  readonly numberGlyphs: readonly PositionedGlyph[];
  /** Present only when the config style is `nameAndNumbers`. */
  readonly nameGlyphs?: readonly PositionedGlyph[];
  /** Present only when assembly type is `hardware`. One hole per number glyph, centered on it. */
  readonly numberHoles?: readonly MountingHole[];
  /** Present only when assembly type is `hardware` and a name is present. One hole per name glyph, centered on it. */
  readonly nameHoles?: readonly MountingHole[];
  /** Present only when assembly type is `hardware`. Backer-side marks mirroring every number/name hole position. */
  readonly engravingMarks?: readonly MountingHole[];
}

export interface LayoutError {
  readonly message: string;
}

export interface LayoutOptions {
  /** Gap between characters within a row, in the config's unit. Defaults to 0. */
  readonly letterSpacing?: number;
  /** Gap between the name row and the number row, in the config's unit. Defaults to half the number height. */
  readonly rowGap?: number;
}

const REFERENCE_FONT_SIZE = 1000;
const MM_PER_INCH = 25.4;
const HOLE_CLEARANCE_MM = 0.5;
const ENGRAVING_MARK_DIAMETER_MM = 1.5;

const SCREW_MAJOR_DIAMETER_MM: Record<ScrewSize, number> = {
  M3: 3,
  M4: 4,
  M5: 5,
  '#4-40': 2.845,
  '#6-32': 3.505,
  '#8-32': 4.166,
  '#10-24': 4.826,
  '1/4-20': 6.35,
};

function toUnit(mm: number, unit: Unit): number {
  return unit === 'mm' ? mm : mm / MM_PER_INCH;
}

function holeDiameter(screwSize: ScrewSize, unit: Unit): number {
  return toUnit(SCREW_MAJOR_DIAMETER_MM[screwSize] + HOLE_CLEARANCE_MM, unit);
}

interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

// Uses control/end points rather than true curve extrema, so curved glyphs
// get a bounding box that is a close but conservative (never too small) fit.
function pathPoints(path: readonly PathCommand[]): Point[] {
  const points: Point[] = [];
  for (const command of path) {
    switch (command.type) {
      case 'M':
      case 'L':
        points.push({x: command.x, y: command.y});
        break;
      case 'Q':
        points.push(
          {x: command.x1, y: command.y1},
          {x: command.x, y: command.y},
        );
        break;
      case 'C':
        points.push(
          {x: command.x1, y: command.y1},
          {x: command.x2, y: command.y2},
          {x: command.x, y: command.y},
        );
        break;
      case 'Z':
        break;
    }
  }
  return points;
}

function boundingBoxOf(points: readonly Point[]): BoundingBox {
  if (points.length === 0) {
    return {minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0};
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY};
}

function unionBoundingBox(
  paths: readonly (readonly PathCommand[])[],
): BoundingBox {
  return boundingBoxOf(paths.flatMap(pathPoints));
}

/** Number of straight-line segments used to flatten each C/Q Bezier curve. */
const HOLE_SEARCH_CURVE_SEGMENTS = 12;

// Flattens a glyph path into closed polygon rings (Beziers subdivided into
// line segments), one ring per subpath. A glyph like "0" or "8" produces two
// rings: the outer contour and an inner counter: glyphCenter (below) needs
// real edges, not just control points, to tell "inside the letter" apart
// from "inside its counter."
function flattenPathToRings(
  path: readonly PathCommand[],
  segments = HOLE_SEARCH_CURVE_SEGMENTS,
): Point[][] {
  const rings: Point[][] = [];
  let ring: Point[] = [];
  let current: Point = {x: 0, y: 0};

  const finishRing = (): void => {
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };
  const quadPoints = (p0: Point, c: Point, p2: Point): Point[] => {
    const points: Point[] = [];
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;
      points.push({
        x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p2.x,
        y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p2.y,
      });
    }
    return points;
  };
  const cubicPoints = (p0: Point, c1: Point, c2: Point, p3: Point): Point[] => {
    const points: Point[] = [];
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;
      points.push({
        x:
          mt * mt * mt * p0.x +
          3 * mt * mt * t * c1.x +
          3 * mt * t * t * c2.x +
          t * t * t * p3.x,
        y:
          mt * mt * mt * p0.y +
          3 * mt * mt * t * c1.y +
          3 * mt * t * t * c2.y +
          t * t * t * p3.y,
      });
    }
    return points;
  };

  for (const command of path) {
    switch (command.type) {
      case 'M':
        finishRing();
        current = {x: command.x, y: command.y};
        ring = [current];
        break;
      case 'L':
        current = {x: command.x, y: command.y};
        ring.push(current);
        break;
      case 'Q': {
        const end = {x: command.x, y: command.y};
        ring.push(...quadPoints(current, {x: command.x1, y: command.y1}, end));
        current = end;
        break;
      }
      case 'C': {
        const end = {x: command.x, y: command.y};
        ring.push(
          ...cubicPoints(
            current,
            {x: command.x1, y: command.y1},
            {x: command.x2, y: command.y2},
            end,
          ),
        );
        current = end;
        break;
      }
      case 'Z':
        finishRing();
        break;
    }
  }
  finishRing();
  return rings;
}

// Shortest distance from a point to a line segment.
function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToRings(p: Point, rings: readonly Point[][]): number {
  let min = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      min = Math.min(min, pointToSegmentDistance(p, ring[j]!, ring[i]!));
    }
  }
  return min;
}

// Even-odd point-in-polygon test across every ring: a point inside the outer
// contour but also inside a nested counter (e.g. the hole of "0") crosses an
// even number of edges overall, correctly reading as "outside the ink."
function isInsideRings(p: Point, rings: readonly Point[][]): boolean {
  let crossings = 0;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]!;
      const b = ring[i]!;
      const straddles = a.y > p.y !== b.y > p.y;
      if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        crossings++;
      }
    }
  }
  return crossings % 2 === 1;
}

// Positive inside the glyph's ink (distance to the nearest edge), negative
// outside it (e.g. inside a counter, or off the glyph entirely).
function signedDistanceToInk(p: Point, rings: readonly Point[][]): number {
  const distance = distanceToRings(p, rings);
  return isInsideRings(p, rings) ? distance : -distance;
}

interface SearchCell {
  readonly x: number;
  readonly y: number;
  readonly halfSize: number;
  readonly distance: number;
  /** Best distance any point in this cell could possibly reach. */
  readonly potential: number;
}

function makeCell(
  x: number,
  y: number,
  halfSize: number,
  rings: readonly Point[][],
): SearchCell {
  const distance = signedDistanceToInk({x, y}, rings);
  return {
    x,
    y,
    halfSize,
    distance,
    potential: distance + halfSize * Math.SQRT2,
  };
}

// Finds the point deepest inside the glyph's ink — the "pole of
// inaccessibility" — via a branch-and-bound grid search (Mapbox's polylabel
// algorithm). Unlike a bounding-box center, this is guaranteed to land on
// solid material: it maximizes distance from every edge, including the
// inner edges of counters like the holes in "0" or "8", so it never
// coincides with a counter and stays clear of thin strokes.
function poleOfInaccessibility(
  rings: readonly Point[][],
  bbox: BoundingBox,
  precision: number,
): Point {
  const cellSize = Math.min(bbox.width, bbox.height);
  if (cellSize <= 0) {
    return {x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2};
  }

  let bestCell = makeCell(
    bbox.minX + bbox.width / 2,
    bbox.minY + bbox.height / 2,
    0,
    rings,
  );

  const queue: SearchCell[] = [];
  const halfSize = cellSize / 2;
  for (let x = bbox.minX; x < bbox.maxX; x += cellSize) {
    for (let y = bbox.minY; y < bbox.maxY; y += cellSize) {
      queue.push(makeCell(x + halfSize, y + halfSize, halfSize, rings));
    }
  }

  while (queue.length > 0) {
    queue.sort((a, b) => a.potential - b.potential);
    const cell = queue.pop()!;
    if (cell.distance > bestCell.distance) bestCell = cell;
    // No child of this cell could beat the best point found so far.
    if (cell.potential - bestCell.distance <= precision) continue;

    const quarter = cell.halfSize / 2;
    queue.push(
      makeCell(cell.x - quarter, cell.y - quarter, quarter, rings),
      makeCell(cell.x + quarter, cell.y - quarter, quarter, rings),
      makeCell(cell.x - quarter, cell.y + quarter, quarter, rings),
      makeCell(cell.x + quarter, cell.y + quarter, quarter, rings),
    );
  }

  return {x: bestCell.x, y: bestCell.y};
}

// Screw holes need to land on solid material, not in a counter (the enclosed
// hole in glyphs like "0", "4", "6", "8", "9") or hanging off a thin stroke —
// a bounding-box center can fall in either. This instead finds the point
// deepest inside the glyph's ink, guaranteeing it sits on material with the
// most clearance from every edge.
function glyphCenter(path: readonly PathCommand[]): Point {
  const bbox = boundingBoxOf(pathPoints(path));
  const rings = flattenPathToRings(path);
  if (rings.length === 0) {
    // No visible ink (e.g. a space in the name row): fall back to the
    // bounding box, matching prior behavior for this edge case.
    return {x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2};
  }
  const precision = Math.max(bbox.width, bbox.height) * 0.005;
  return poleOfInaccessibility(rings, bbox, precision);
}

function translatePath(
  path: readonly PathCommand[],
  dx: number,
  dy: number,
): PathCommand[] {
  return path.map((command): PathCommand => {
    switch (command.type) {
      case 'M':
        return {type: 'M', x: command.x + dx, y: command.y + dy};
      case 'L':
        return {type: 'L', x: command.x + dx, y: command.y + dy};
      case 'C':
        return {
          type: 'C',
          x1: command.x1 + dx,
          y1: command.y1 + dy,
          x2: command.x2 + dx,
          y2: command.y2 + dy,
          x: command.x + dx,
          y: command.y + dy,
        };
      case 'Q':
        return {
          type: 'Q',
          x1: command.x1 + dx,
          y1: command.y1 + dy,
          x: command.x + dx,
          y: command.y + dy,
        };
      case 'Z':
        return {type: 'Z'};
    }
  });
}

function translateGlyphs(
  glyphs: readonly PositionedGlyph[],
  dx: number,
  dy: number,
): PositionedGlyph[] {
  return glyphs.map(glyph => ({
    character: glyph.character,
    path: translatePath(glyph.path, dx, dy),
  }));
}

interface RowLayout {
  readonly glyphs: readonly PositionedGlyph[];
  readonly width: number;
  readonly height: number;
}

// Physical signs mount each character as a separate piece, so characters are
// spaced by advance width (+ letterSpacing) rather than typographic kerning,
// which could pull pieces close enough to overlap.
function layoutRow(
  font: LoadedFont,
  text: string,
  targetHeight: number,
  letterSpacing: number,
): Result<RowLayout, LayoutError> {
  const characters = [...text];
  if (characters.length === 0) {
    return {ok: false, error: {message: 'Cannot lay out empty text.'}};
  }

  const referenceGlyphs: GlyphOutline[] = [];
  for (const character of characters) {
    const result = getGlyphOutline(font, character, REFERENCE_FONT_SIZE);
    if (!result.ok) {
      return {ok: false, error: {message: result.error.message}};
    }
    referenceGlyphs.push(result.value);
  }

  const referenceHeight = unionBoundingBox(
    referenceGlyphs.map(g => g.path),
  ).height;
  if (referenceHeight <= 0) {
    return {
      ok: false,
      error: {message: `Text "${text}" produced no visible glyph outlines.`},
    };
  }

  const fontSize = REFERENCE_FONT_SIZE * (targetHeight / referenceHeight);
  const glyphs: PositionedGlyph[] = [];
  let cursorX = 0;
  for (const character of characters) {
    const result = getGlyphOutline(font, character, fontSize);
    if (!result.ok) {
      return {ok: false, error: {message: result.error.message}};
    }
    glyphs.push({
      character,
      path: translatePath(result.value.path, cursorX, 0),
    });
    cursorX += result.value.advanceWidth + letterSpacing;
  }

  const width = Math.max(0, cursorX - letterSpacing);
  const height = unionBoundingBox(glyphs.map(g => g.path)).height;
  return {ok: true, value: {glyphs, width, height}};
}

function computeBacker(
  shape: SignShape,
  contentWidth: number,
  contentHeight: number,
  margin: number,
): SignBacker {
  switch (shape) {
    case 'rectangle':
      return {
        shape,
        width: contentWidth + margin * 2,
        height: contentHeight + margin * 2,
      };
    case 'square': {
      const side = Math.max(contentWidth, contentHeight) + margin * 2;
      return {shape, width: side, height: side};
    }
    case 'round': {
      const halfDiagonal = Math.sqrt(
        (contentWidth / 2) ** 2 + (contentHeight / 2) ** 2,
      );
      const diameter = 2 * (halfDiagonal + margin);
      return {shape, width: diameter, height: diameter};
    }
  }
}

/**
 * Computes the full geometry for a sign: backer dimensions, positioned
 * number/name glyphs, and (for hardware assembly) mounting holes and
 * matching backer engraving marks.
 */
export function computeSignLayout(
  config: SignConfig,
  numberFont: LoadedFont,
  nameFont: LoadedFont | undefined,
  options: LayoutOptions = {},
): Result<SignLayout, LayoutError> {
  if (config.style === 'nameAndNumbers' && (!config.name || !nameFont)) {
    return {
      ok: false,
      error: {
        message:
          'A name and nameFont are required when style is "nameAndNumbers".',
      },
    };
  }

  const letterSpacing = options.letterSpacing ?? 0;

  const numberRowResult = layoutRow(
    numberFont,
    config.houseNumber,
    config.numberHeight,
    letterSpacing,
  );
  if (!numberRowResult.ok) {
    return numberRowResult;
  }
  const numberRow = numberRowResult.value;

  let nameRow: RowLayout | undefined;
  if (config.style === 'nameAndNumbers') {
    const nameHeight = config.nameHeight ?? config.numberHeight;
    const nameRowResult = layoutRow(
      nameFont as LoadedFont,
      config.name as string,
      nameHeight,
      letterSpacing,
    );
    if (!nameRowResult.ok) {
      return nameRowResult;
    }
    nameRow = nameRowResult.value;
  }

  const rowGap = options.rowGap ?? config.numberHeight * 0.5;
  const contentWidth = Math.max(numberRow.width, nameRow?.width ?? 0);
  const contentHeight =
    numberRow.height + (nameRow ? rowGap + nameRow.height : 0);

  // Number row sits at the bottom of the content block; name row (if any) above it.
  let numberGlyphs = translateGlyphs(
    numberRow.glyphs,
    (contentWidth - numberRow.width) / 2,
    0,
  );
  let nameGlyphs = nameRow
    ? translateGlyphs(
        nameRow.glyphs,
        (contentWidth - nameRow.width) / 2,
        numberRow.height + rowGap,
      )
    : undefined;

  const backer = computeBacker(
    config.shape,
    contentWidth,
    contentHeight,
    config.margin,
  );
  const offsetX = (backer.width - contentWidth) / 2;
  const offsetY = (backer.height - contentHeight) / 2;
  numberGlyphs = translateGlyphs(numberGlyphs, offsetX, offsetY);
  nameGlyphs = nameGlyphs
    ? translateGlyphs(nameGlyphs, offsetX, offsetY)
    : undefined;

  let numberHoles: MountingHole[] | undefined;
  let nameHoles: MountingHole[] | undefined;
  let engravingMarks: MountingHole[] | undefined;
  if (config.assembly.type === 'hardware') {
    const diameter = holeDiameter(config.assembly.screwSize, config.unit);
    numberHoles = numberGlyphs.map(g => ({
      center: glyphCenter(g.path),
      diameter,
    }));
    nameHoles = nameGlyphs?.map(g => ({
      center: glyphCenter(g.path),
      diameter,
    }));
    const markDiameter = toUnit(ENGRAVING_MARK_DIAMETER_MM, config.unit);
    engravingMarks = [...numberHoles, ...(nameHoles ?? [])].map(hole => ({
      center: hole.center,
      diameter: markDiameter,
    }));
  }

  return {
    ok: true,
    value: {
      backer,
      numberGlyphs,
      ...(nameGlyphs ? {nameGlyphs} : {}),
      ...(numberHoles ? {numberHoles} : {}),
      ...(nameHoles ? {nameHoles} : {}),
      ...(engravingMarks ? {engravingMarks} : {}),
    },
  };
}
