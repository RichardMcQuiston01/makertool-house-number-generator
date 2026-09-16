import {describe, expect, it} from 'vitest';
import type {PathCommand} from './font.js';
import type {
  MountingHole,
  PositionedGlyph,
  SignBacker,
  SignLayout,
} from './layout.js';
import {generateDxfFiles} from './output-dxf.js';

// A unit square outline, offset by (ox, oy), as a single closed subpath.
function squarePath(ox: number, oy: number, size = 1): PathCommand[] {
  return [
    {type: 'M', x: ox, y: oy},
    {type: 'L', x: ox + size, y: oy},
    {type: 'L', x: ox + size, y: oy + size},
    {type: 'L', x: ox, y: oy + size},
    {type: 'Z'},
  ];
}

// Simulates a digit like "0": an outer square contour plus an inner
// counter, as two separate closed subpaths within one glyph.
function ringPath(ox: number, oy: number): PathCommand[] {
  return [...squarePath(ox, oy, 4), ...squarePath(ox + 1, oy + 1, 2)];
}

function glyph(character: string, path: PathCommand[]): PositionedGlyph {
  return {character, path};
}

function hole(x: number, y: number, diameter = 0.2): MountingHole {
  return {center: {x, y}, diameter};
}

function backer(overrides: Partial<SignBacker> = {}): SignBacker {
  return {shape: 'rectangle', width: 10, height: 6, ...overrides};
}

interface DxfEntity {
  readonly type: string;
  readonly layer: string;
  readonly raw: string;
}

// Minimal DXF entity parser for assertions: finds every "0\n<TYPE>\n...8\n<LAYER>"
// record and captures its type, layer, and raw text (for coordinate checks).
function parseEntities(content: string): DxfEntity[] {
  const entityTypes = ['CIRCLE', 'LWPOLYLINE'];
  const pattern = new RegExp(
    `0\\n(${entityTypes.join('|')})\\n([\\s\\S]*?)8\\n([^\\n]+)\\n([\\s\\S]*?)(?=0\\n(?:${entityTypes.join('|')}|ENDSEC))`,
    'g',
  );
  const entities: DxfEntity[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    entities.push({
      type: match[1] ?? '',
      layer: match[3] ?? '',
      raw: match[4] ?? '',
    });
  }
  return entities;
}

// DXF group codes always alternate code/value one per line, with no other
// structure in between, so pairing lines positionally (rather than scanning
// for a literal "10"/"20" on any line) avoids misreading a coordinate whose
// *value* happens to equal another group code's string, e.g. an x of 10.
function dxfPairs(raw: string): Array<{code: string; value: string}> {
  const lines = raw.split('\n');
  const pairs: Array<{code: string; value: string}> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push({code: lines[i] ?? '', value: lines[i + 1] ?? ''});
  }
  return pairs;
}

function vertexXs(raw: string): number[] {
  // Group code 10 lines are X coordinates for both CIRCLE centers and
  // LWPOLYLINE vertices.
  return dxfPairs(raw)
    .filter(pair => pair.code === '10')
    .map(pair => Number(pair.value));
}

function vertexYs(raw: string): number[] {
  return dxfPairs(raw)
    .filter(pair => pair.code === '20')
    .map(pair => Number(pair.value));
}

describe('generateDxfFiles', () => {
  it('produces one file per glyph plus one backer file (numbers only, adhesive)', () => {
    const layout: SignLayout = {
      backer: backer(),
      numberGlyphs: [
        glyph('1', squarePath(4, 1)),
        glyph('2', squarePath(5.5, 1)),
      ],
    };
    const files = generateDxfFiles(layout, 'in');
    expect(files).toHaveLength(3);
    expect(files.map(f => f.name)).toEqual([
      'number-0-1.dxf',
      'number-1-2.dxf',
      'backer.dxf',
    ]);
  });

  it('names files with index first so repeated characters stay unique', () => {
    const layout: SignLayout = {
      backer: backer(),
      numberGlyphs: [
        glyph('1', squarePath(0, 0)),
        glyph('1', squarePath(2, 0)),
      ],
    };
    const files = generateDxfFiles(layout, 'in');
    const names = files.map(f => f.name);
    expect(names).toContain('number-0-1.dxf');
    expect(names).toContain('number-1-1.dxf');
  });

  it('produces well-formed DXF text starting with SECTION and ending with EOF', () => {
    const layout: SignLayout = {
      backer: backer(),
      numberGlyphs: [glyph('1', squarePath(0, 0))],
    };
    const files = generateDxfFiles(layout, 'in');
    for (const file of files) {
      expect(file.content.startsWith('0\nSECTION\n')).toBe(true);
      expect(file.content.trimEnd().endsWith('0\nEOF')).toBe(true);
    }
  });

  it('normalizes per-glyph files so coordinates start near the origin', () => {
    const layout: SignLayout = {
      backer: backer(),
      numberGlyphs: [glyph('1', squarePath(4, 3, 1))],
    };
    const files = generateDxfFiles(layout, 'in');
    const numberFile = files.find(f => f.name === 'number-0-1.dxf');
    expect(numberFile).toBeDefined();
    const entities = parseEntities(numberFile?.content ?? '');
    const polyline = entities.find(e => e.type === 'LWPOLYLINE');
    expect(polyline).toBeDefined();
    const xs = vertexXs(polyline?.raw ?? '');
    const ys = vertexYs(polyline?.raw ?? '');
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(1, 5);
  });

  it('leaves the backer file in the backer own coordinate space', () => {
    const layout: SignLayout = {
      backer: backer({shape: 'rectangle', width: 10, height: 6}),
      numberGlyphs: [glyph('1', squarePath(4, 2))],
    };
    const files = generateDxfFiles(layout, 'in');
    const backerFile = files.find(f => f.name === 'backer.dxf');
    const entities = parseEntities(backerFile?.content ?? '');
    const polyline = entities.find(e => e.type === 'LWPOLYLINE');
    expect(polyline).toBeDefined();
    const xs = vertexXs(polyline?.raw ?? '');
    const ys = vertexYs(polyline?.raw ?? '');
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(10, 5);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(Math.max(...ys)).toBeCloseTo(6, 5);
  });

  it('emits a circle for a round backer sized to backer.width', () => {
    const layout: SignLayout = {
      backer: backer({shape: 'round', width: 8, height: 8}),
      numberGlyphs: [glyph('1', squarePath(2, 2))],
    };
    const files = generateDxfFiles(layout, 'in');
    const backerFile = files.find(f => f.name === 'backer.dxf');
    const entities = parseEntities(backerFile?.content ?? '');
    const circle = entities.find(e => e.type === 'CIRCLE' && e.layer === 'CUT');
    expect(circle).toBeDefined();
    expect(circle?.raw).toMatch(/\n40\n4\n/); // radius = width / 2
  });

  it('produces a closed LWPOLYLINE rectangle for rectangle/square backers', () => {
    const layout: SignLayout = {
      backer: backer({shape: 'square', width: 5, height: 5}),
      numberGlyphs: [glyph('1', squarePath(0, 0))],
    };
    const files = generateDxfFiles(layout, 'in');
    const backerFile = files.find(f => f.name === 'backer.dxf');
    const entities = parseEntities(backerFile?.content ?? '');
    const polyline = entities.find(e => e.type === 'LWPOLYLINE');
    expect(polyline).toBeDefined();
    expect(polyline?.raw).toMatch(/\n70\n1\n/); // LWPolylineFlags.Closed
  });

  it('emits holes on CUT and engraving marks on ENGRAVE for hardware assembly', () => {
    const layout: SignLayout = {
      backer: backer(),
      numberGlyphs: [glyph('1', squarePath(4, 2))],
      numberHoles: [hole(4.5, 2.5)],
      engravingMarks: [hole(4.5, 2.5, 0.05)],
    };
    const files = generateDxfFiles(layout, 'in');

    const numberFile = files.find(f => f.name === 'number-0-1.dxf');
    const numberEntities = parseEntities(numberFile?.content ?? '');
    const numberCircles = numberEntities.filter(e => e.type === 'CIRCLE');
    expect(numberCircles).toHaveLength(1);
    expect(numberCircles[0]?.layer).toBe('CUT');

    const backerFile = files.find(f => f.name === 'backer.dxf');
    const backerEntities = parseEntities(backerFile?.content ?? '');
    const engraveCircles = backerEntities.filter(
      e => e.type === 'CIRCLE' && e.layer === 'ENGRAVE',
    );
    expect(engraveCircles).toHaveLength(1);
    const cutCircles = backerEntities.filter(
      e => e.type === 'CIRCLE' && e.layer === 'CUT',
    );
    expect(cutCircles).toHaveLength(0);
  });

  it('produces no circle entities for adhesive assembly', () => {
    const layout: SignLayout = {
      backer: backer(),
      numberGlyphs: [glyph('1', squarePath(4, 2))],
    };
    const files = generateDxfFiles(layout, 'in');
    for (const file of files) {
      const entities = parseEntities(file.content);
      expect(entities.filter(e => e.type === 'CIRCLE')).toHaveLength(0);
    }
  });

  it('produces two LWPOLYLINE entities for a glyph with two subpaths', () => {
    const layout: SignLayout = {
      backer: backer(),
      numberGlyphs: [glyph('0', ringPath(3, 1))],
    };
    const files = generateDxfFiles(layout, 'in');
    const numberFile = files.find(f => f.name === 'number-0-0.dxf');
    const entities = parseEntities(numberFile?.content ?? '');
    expect(entities.filter(e => e.type === 'LWPOLYLINE')).toHaveLength(2);
  });

  it('produces both number and name files for nameAndNumbers style', () => {
    const layout: SignLayout = {
      backer: backer(),
      numberGlyphs: [
        glyph('1', squarePath(4, 1)),
        glyph('2', squarePath(5.5, 1)),
      ],
      nameGlyphs: [
        glyph('S', squarePath(4, 4)),
        glyph('M', squarePath(5.5, 4)),
      ],
    };
    const files = generateDxfFiles(layout, 'in');
    expect(files).toHaveLength(5);
    const names = files.map(f => f.name);
    expect(names).toEqual([
      'number-0-1.dxf',
      'number-1-2.dxf',
      'name-0-S.dxf',
      'name-1-M.dxf',
      'backer.dxf',
    ]);
  });

  it('uses matching name holes by index when present', () => {
    const layout: SignLayout = {
      backer: backer(),
      numberGlyphs: [glyph('1', squarePath(4, 1))],
      nameGlyphs: [glyph('S', squarePath(4, 4))],
      numberHoles: [hole(4.5, 1.5)],
      nameHoles: [hole(4.5, 4.5)],
      engravingMarks: [hole(4.5, 1.5, 0.05), hole(4.5, 4.5, 0.05)],
    };
    const files = generateDxfFiles(layout, 'in');
    const nameFile = files.find(f => f.name === 'name-0-S.dxf');
    const entities = parseEntities(nameFile?.content ?? '');
    expect(entities.filter(e => e.type === 'CIRCLE')).toHaveLength(1);
  });
});
