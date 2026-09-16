import type {PathCommand} from './font.js';
import type {
  MountingHole,
  Point,
  PositionedGlyph,
  SignBacker,
  SignLayout,
} from './layout.js';
import type {Unit} from './types.js';

/** A single generated cut/engrave file, ready to write to disk. */
export interface GeneratedFile {
  readonly name: string;
  readonly content: string;
}

interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const EMPTY_BBOX: BoundingBox = {minX: 0, minY: 0, maxX: 0, maxY: 0};

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

function boundingBoxOf(path: readonly PathCommand[]): BoundingBox {
  const points = pathPoints(path);
  if (points.length === 0) {
    return EMPTY_BBOX;
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
  return {minX, minY, maxX, maxY};
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

// Keeps emitted coordinates finite-precision and file sizes sane.
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function strokeWidthFor(unit: Unit): number {
  return unit === 'mm' ? 0.1 : 0.004;
}

// SVG is Y-down; our geometry is Y-up, so every emitted Y is flipped
// against the file's own local height.
function pathToD(path: readonly PathCommand[], localHeight: number): string {
  const flipY = (y: number): number => round(localHeight - y);
  const segments: string[] = [];
  for (const command of path) {
    switch (command.type) {
      case 'M':
        segments.push(`M ${round(command.x)},${flipY(command.y)}`);
        break;
      case 'L':
        segments.push(`L ${round(command.x)},${flipY(command.y)}`);
        break;
      case 'C':
        segments.push(
          `C ${round(command.x1)},${flipY(command.y1)} ` +
            `${round(command.x2)},${flipY(command.y2)} ` +
            `${round(command.x)},${flipY(command.y)}`,
        );
        break;
      case 'Q':
        segments.push(
          `Q ${round(command.x1)},${flipY(command.y1)} ` +
            `${round(command.x)},${flipY(command.y)}`,
        );
        break;
      case 'Z':
        segments.push('Z');
        break;
    }
  }
  return segments.join(' ');
}

function pathElement(
  path: readonly PathCommand[],
  localHeight: number,
  strokeWidth: number,
): string {
  return `<path class="cut" d="${pathToD(path, localHeight)}" fill="none" stroke="#000000" stroke-width="${strokeWidth}"/>`;
}

function circleElement(
  center: Point,
  diameter: number,
  localHeight: number,
  kind: 'cut' | 'engrave',
  strokeWidth: number,
): string {
  const cx = round(center.x);
  const cy = round(localHeight - center.y);
  const r = round(diameter / 2);
  const stroke = kind === 'engrave' ? '#0000FF' : '#000000';
  return `<circle class="${kind}" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function svgDocument(
  width: number,
  height: number,
  unit: Unit,
  body: readonly string[],
): string {
  const w = round(width);
  const h = round(height);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}${unit}" height="${h}${unit}" viewBox="0 0 ${w} ${h}">`,
    ...body.map(element => `  ${element}`),
    '</svg>',
  ].join('\n');
}

// Per-glyph files are normalized to their own bounding box (translated so it
// starts at local (0,0)) rather than kept at their backer-relative offset,
// so a standalone cut file doesn't waste material sitting far from the origin.
function glyphFile(
  prefix: 'number' | 'name',
  index: number,
  glyph: PositionedGlyph,
  hole: MountingHole | undefined,
  unit: Unit,
): GeneratedFile {
  const bbox = boundingBoxOf(glyph.path);
  const localWidth = bbox.maxX - bbox.minX;
  const localHeight = bbox.maxY - bbox.minY;
  const strokeWidth = strokeWidthFor(unit);

  const normalizedPath = translatePath(glyph.path, -bbox.minX, -bbox.minY);
  const body: string[] = [
    pathElement(normalizedPath, localHeight, strokeWidth),
  ];

  if (hole) {
    const normalizedCenter: Point = {
      x: hole.center.x - bbox.minX,
      y: hole.center.y - bbox.minY,
    };
    body.push(
      circleElement(
        normalizedCenter,
        hole.diameter,
        localHeight,
        'cut',
        strokeWidth,
      ),
    );
  }

  return {
    name: `${prefix}-${index}-${glyph.character}.svg`,
    content: svgDocument(localWidth, localHeight, unit, body),
  };
}

// The backer file keeps the coordinate space layout.ts already computed
// (backer-local (0,0)-(width,height)) — no per-piece normalization needed
// since it's already the whole standalone piece.
function backerFile(
  backer: SignBacker,
  engravingMarks: readonly MountingHole[] | undefined,
  unit: Unit,
): GeneratedFile {
  const strokeWidth = strokeWidthFor(unit);
  const localHeight = backer.height;
  const body: string[] = [];

  if (backer.shape === 'round') {
    body.push(
      circleElement(
        {x: backer.width / 2, y: backer.height / 2},
        backer.width,
        localHeight,
        'cut',
        strokeWidth,
      ),
    );
  } else {
    body.push(
      `<rect class="cut" x="0" y="0" width="${round(backer.width)}" height="${round(backer.height)}" fill="none" stroke="#000000" stroke-width="${strokeWidth}"/>`,
    );
  }

  for (const mark of engravingMarks ?? []) {
    body.push(
      circleElement(
        mark.center,
        mark.diameter,
        localHeight,
        'engrave',
        strokeWidth,
      ),
    );
  }

  return {
    name: 'backer.svg',
    content: svgDocument(backer.width, backer.height, unit, body),
  };
}

/**
 * Generates one SVG cut/engrave file per physical piece of a laid-out sign:
 * one file per number glyph, one per name glyph (if any), and one for the
 * backer. Per-glyph files are normalized near the origin; the backer file
 * keeps layout.ts's own backer-relative coordinate space.
 */
export function generateSvgFiles(
  layout: SignLayout,
  unit: Unit,
): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  layout.numberGlyphs.forEach((glyph, index) => {
    files.push(
      glyphFile('number', index, glyph, layout.numberHoles?.[index], unit),
    );
  });

  layout.nameGlyphs?.forEach((glyph, index) => {
    files.push(
      glyphFile('name', index, glyph, layout.nameHoles?.[index], unit),
    );
  });

  files.push(backerFile(layout.backer, layout.engravingMarks, unit));

  return files;
}
