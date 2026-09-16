import {Colors, DxfWriter, LWPolylineFlags, Units} from '@tarikjabiri/dxf';
import type {PathCommand} from './font.js';
import type {MountingHole, PositionedGlyph, SignLayout} from './layout.js';
import type {Unit} from './types.js';

/** A single generated cut/engrave file, ready to write to disk. */
export interface GeneratedFile {
  readonly name: string;
  readonly content: string;
}

/** Number of straight-line segments used to flatten each C/Q Bezier curve. */
const BEZIER_SEGMENTS = 16;

const CUT_LAYER = 'CUT';
const ENGRAVE_LAYER = 'ENGRAVE';

interface FlatPoint {
  readonly x: number;
  readonly y: number;
}

interface BoundingBoxOrigin {
  readonly minX: number;
  readonly minY: number;
}

// Bounding box of a single glyph's own path, used only for per-glyph
// normalization (see moveSubpathsNearOrigin below). Walks every coordinate
// field of every command, including Bezier control points, matching the
// approach layout.ts uses for its own (conservative, control-point-based)
// bounding boxes.
function pathBoundingBoxOrigin(
  path: readonly PathCommand[],
): BoundingBoxOrigin {
  let minX = Infinity;
  let minY = Infinity;
  let found = false;

  const consider = (x: number, y: number): void => {
    found = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  };

  for (const command of path) {
    switch (command.type) {
      case 'M':
      case 'L':
        consider(command.x, command.y);
        break;
      case 'Q':
        consider(command.x1, command.y1);
        consider(command.x, command.y);
        break;
      case 'C':
        consider(command.x1, command.y1);
        consider(command.x2, command.y2);
        consider(command.x, command.y);
        break;
      case 'Z':
        break;
    }
  }

  return found ? {minX, minY} : {minX: 0, minY: 0};
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

function translateHole(
  hole: MountingHole,
  dx: number,
  dy: number,
): MountingHole {
  return {
    center: {x: hole.center.x + dx, y: hole.center.y + dy},
    diameter: hole.diameter,
  };
}

function cubicPointAt(
  p0: FlatPoint,
  p1: FlatPoint,
  p2: FlatPoint,
  p3: FlatPoint,
  t: number,
): FlatPoint {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x,
    y:
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y,
  };
}

function quadPointAt(
  p0: FlatPoint,
  p1: FlatPoint,
  p2: FlatPoint,
  t: number,
): FlatPoint {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

interface FlattenedSubpath {
  readonly vertices: readonly FlatPoint[];
  readonly closed: boolean;
}

// DXF's LWPOLYLINE is straight-segment-only, so C/Q commands are subdivided
// into BEZIER_SEGMENTS line segments each. A path may contain several
// subpaths (e.g. digits like "0"/"8" have an outer contour plus an inner
// counter), each becoming its own subpath here and, in turn, its own
// LWPOLYLINE entity.
function flattenPathToSubpaths(
  path: readonly PathCommand[],
): FlattenedSubpath[] {
  const subpaths: FlattenedSubpath[] = [];
  let currentVertices: FlatPoint[] = [];
  let currentClosed = false;
  let currentPoint: FlatPoint = {x: 0, y: 0};
  let startPoint: FlatPoint = {x: 0, y: 0};

  const finalizeCurrent = (): void => {
    if (currentVertices.length > 0) {
      subpaths.push({vertices: currentVertices, closed: currentClosed});
    }
    currentVertices = [];
    currentClosed = false;
  };

  for (const command of path) {
    switch (command.type) {
      case 'M':
        finalizeCurrent();
        currentPoint = {x: command.x, y: command.y};
        startPoint = currentPoint;
        currentVertices.push(currentPoint);
        break;
      case 'L':
        currentPoint = {x: command.x, y: command.y};
        currentVertices.push(currentPoint);
        break;
      case 'C': {
        const p0 = currentPoint;
        const p1: FlatPoint = {x: command.x1, y: command.y1};
        const p2: FlatPoint = {x: command.x2, y: command.y2};
        const p3: FlatPoint = {x: command.x, y: command.y};
        for (let i = 1; i <= BEZIER_SEGMENTS; i += 1) {
          currentVertices.push(
            cubicPointAt(p0, p1, p2, p3, i / BEZIER_SEGMENTS),
          );
        }
        currentPoint = p3;
        break;
      }
      case 'Q': {
        const p0 = currentPoint;
        const p1: FlatPoint = {x: command.x1, y: command.y1};
        const p2: FlatPoint = {x: command.x, y: command.y};
        for (let i = 1; i <= BEZIER_SEGMENTS; i += 1) {
          currentVertices.push(quadPointAt(p0, p1, p2, i / BEZIER_SEGMENTS));
        }
        currentPoint = p2;
        break;
      }
      case 'Z':
        currentClosed = true;
        currentPoint = startPoint;
        break;
    }
  }
  finalizeCurrent();

  return subpaths;
}

function createWriter(unit: Unit): DxfWriter {
  const dxf = new DxfWriter();
  dxf.addLayer(CUT_LAYER, Colors.White);
  dxf.addLayer(ENGRAVE_LAYER, Colors.Red);
  dxf.setUnits(unit === 'mm' ? Units.Millimeters : Units.Inches);
  return dxf;
}

function addOutline(
  dxf: DxfWriter,
  path: readonly PathCommand[],
  layerName: string,
): void {
  for (const subpath of flattenPathToSubpaths(path)) {
    if (subpath.vertices.length === 0) continue;
    dxf.addLWPolyline(
      subpath.vertices.map(vertex => ({point: {x: vertex.x, y: vertex.y}})),
      {
        layerName,
        flags: subpath.closed ? LWPolylineFlags.Closed : LWPolylineFlags.None,
      },
    );
  }
}

function addHole(dxf: DxfWriter, hole: MountingHole, layerName: string): void {
  dxf.addCircle({x: hole.center.x, y: hole.center.y, z: 0}, hole.diameter / 2, {
    layerName,
  });
}

// Compacts a single glyph's outline (and its matching hole, if any) near the
// origin, so a standalone cut file for that character doesn't waste material
// sitting far out at its backer-relative position.
function buildGlyphFile(
  namePrefix: string,
  index: number,
  glyph: PositionedGlyph,
  hole: MountingHole | undefined,
  unit: Unit,
): GeneratedFile {
  const origin = pathBoundingBoxOrigin(glyph.path);
  const dx = -origin.minX;
  const dy = -origin.minY;

  const normalizedPath = translatePath(glyph.path, dx, dy);
  const normalizedHole = hole ? translateHole(hole, dx, dy) : undefined;

  const dxf = createWriter(unit);
  addOutline(dxf, normalizedPath, CUT_LAYER);
  if (normalizedHole) {
    addHole(dxf, normalizedHole, CUT_LAYER);
  }

  return {
    name: `${namePrefix}-${index}-${glyph.character}.dxf`,
    content: dxf.stringify(),
  };
}

// Unlike the per-glyph files, the backer file keeps its own native
// coordinate space (0,0)-(width,height) untouched, since layout.ts already
// positions everything relative to the backer.
function buildBackerFile(layout: SignLayout, unit: Unit): GeneratedFile {
  const dxf = createWriter(unit);
  const {backer} = layout;

  if (backer.shape === 'round') {
    dxf.addCircle(
      {x: backer.width / 2, y: backer.height / 2, z: 0},
      backer.width / 2,
      {layerName: CUT_LAYER},
    );
  } else {
    dxf.addLWPolyline(
      [
        {point: {x: 0, y: 0}},
        {point: {x: backer.width, y: 0}},
        {point: {x: backer.width, y: backer.height}},
        {point: {x: 0, y: backer.height}},
      ],
      {layerName: CUT_LAYER, flags: LWPolylineFlags.Closed},
    );
  }

  for (const mark of layout.engravingMarks ?? []) {
    addHole(dxf, mark, ENGRAVE_LAYER);
  }

  return {name: 'backer.dxf', content: dxf.stringify()};
}

/**
 * Generates one DXF file per physical cut piece for a sign layout: one per
 * number glyph, one per name glyph (if any), and one for the backer.
 */
export function generateDxfFiles(
  layout: SignLayout,
  unit: Unit,
): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  layout.numberGlyphs.forEach((glyph, index) => {
    files.push(
      buildGlyphFile('number', index, glyph, layout.numberHoles?.[index], unit),
    );
  });

  (layout.nameGlyphs ?? []).forEach((glyph, index) => {
    files.push(
      buildGlyphFile('name', index, glyph, layout.nameHoles?.[index], unit),
    );
  });

  files.push(buildBackerFile(layout, unit));

  return files;
}
