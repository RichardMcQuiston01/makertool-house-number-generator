import opentype from 'opentype.js';
import {beforeAll, describe, expect, it} from 'vitest';
import {loadFont} from './font.js';
import type {LoadedFont} from './font.js';
import {computeSignLayout} from './layout.js';
import type {SignConfig} from './types.js';

const UNITS_PER_EM = 1000;
const GLYPH_HEIGHT = 700; // every test glyph spans y=0..700, for predictable scaling.

function buildTestFontBuffer(characters: string): ArrayBuffer {
  const glyphs = [
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 300,
      path: new opentype.Path(),
    }),
  ];

  let index = 0;
  for (const character of characters) {
    const path = new opentype.Path();
    const width = 300 + index * 20;
    path.moveTo(0, 0);
    path.lineTo(width, 0);
    path.lineTo(width, GLYPH_HEIGHT);
    path.lineTo(0, GLYPH_HEIGHT);
    path.close();
    glyphs.push(
      new opentype.Glyph({
        name: character,
        unicode: character.charCodeAt(0),
        advanceWidth: width + 50,
        path,
      }),
    );
    index += 1;
  }

  const font = new opentype.Font({
    familyName: 'Layout Test Font',
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: 800,
    descender: -200,
    glyphs,
  });

  return font.toArrayBuffer();
}

// A square ring — solid material between an outer square and a smaller
// concentric inner square counter, like the digit "0" or letter "O". Its
// bounding-box center coincides exactly with the counter's own center, so a
// center-placement bug that ignores counters (using only the bounding box)
// reproduces every time against this fixture, unlike the solid-rectangle
// glyphs above.
function buildRingFontBuffer(character: string): ArrayBuffer {
  const glyphs = [
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 300,
      path: new opentype.Path(),
    }),
  ];

  const path = new opentype.Path();
  path.moveTo(0, 0);
  path.lineTo(700, 0);
  path.lineTo(700, 700);
  path.lineTo(0, 700);
  path.close();
  // Inner counter, opposite winding, centered in the outer square.
  path.moveTo(200, 200);
  path.lineTo(200, 500);
  path.lineTo(500, 500);
  path.lineTo(500, 200);
  path.close();

  glyphs.push(
    new opentype.Glyph({
      name: character,
      unicode: character.charCodeAt(0),
      advanceWidth: 750,
      path,
    }),
  );

  const font = new opentype.Font({
    familyName: 'Ring Test Font',
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: 800,
    descender: -200,
    glyphs,
  });

  return font.toArrayBuffer();
}

// An "L" hook: a horizontal foot (x:[0,700], y:[0,200]) unioned with a
// vertical bar (x:[0,200], y:[0,700]). Its bounding-box center, (350, 350),
// falls outside both arms entirely — a second, distinct way a bounding-box
// center can miss a glyph's ink (as opposed to landing in a counter).
function buildHookFontBuffer(character: string): ArrayBuffer {
  const glyphs = [
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 300,
      path: new opentype.Path(),
    }),
  ];

  const path = new opentype.Path();
  path.moveTo(0, 0);
  path.lineTo(700, 0);
  path.lineTo(700, 200);
  path.lineTo(200, 200);
  path.lineTo(200, 700);
  path.lineTo(0, 700);
  path.close();

  glyphs.push(
    new opentype.Glyph({
      name: character,
      unicode: character.charCodeAt(0),
      advanceWidth: 750,
      path,
    }),
  );

  const font = new opentype.Font({
    familyName: 'Hook Test Font',
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: 800,
    descender: -200,
    glyphs,
  });

  return font.toArrayBuffer();
}

// A very thin vertical bar — its width is tiny relative to its height, so no
// reasonable screw hole fits within it. Used to trigger the "hole doesn't
// fit" guard rather than to check placement geometry.
function buildThinBarFontBuffer(character: string): ArrayBuffer {
  const glyphs = [
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 300,
      path: new opentype.Path(),
    }),
  ];

  const barWidth = 10;
  const path = new opentype.Path();
  path.moveTo(0, 0);
  path.lineTo(barWidth, 0);
  path.lineTo(barWidth, GLYPH_HEIGHT);
  path.lineTo(0, GLYPH_HEIGHT);
  path.close();

  glyphs.push(
    new opentype.Glyph({
      name: character,
      unicode: character.charCodeAt(0),
      advanceWidth: barWidth + 50,
      path,
    }),
  );

  const font = new opentype.Font({
    familyName: 'Thin Bar Test Font',
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: 800,
    descender: -200,
    glyphs,
  });

  return font.toArrayBuffer();
}

interface TestPoint {
  readonly x: number;
  readonly y: number;
}

// Splits a path built only from M/L/Z (as the fixtures above use) into its
// separate closed rings, for asserting against known fixture geometry.
function ringsFromPath(
  path: readonly {type: string; x?: number; y?: number}[],
): TestPoint[][] {
  const rings: TestPoint[][] = [];
  let ring: TestPoint[] = [];
  for (const command of path) {
    if (command.type === 'M') {
      if (ring.length > 0) rings.push(ring);
      ring = [{x: command.x ?? 0, y: command.y ?? 0}];
    } else if (command.type === 'L') {
      ring.push({x: command.x ?? 0, y: command.y ?? 0});
    } else if (command.type === 'Z') {
      rings.push(ring);
      ring = [];
    }
  }
  if (ring.length > 0) rings.push(ring);
  return rings;
}

function bboxOfRing(ring: readonly TestPoint[]) {
  const xs = ring.map(p => p.x);
  const ys = ring.map(p => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function isInsidePolygon(
  point: TestPoint,
  ring: readonly TestPoint[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    const straddles = a.y > point.y !== b.y > point.y;
    if (
      straddles &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function baseConfig(overrides: Partial<SignConfig> = {}): SignConfig {
  return {
    style: 'numbersOnly',
    houseNumber: '1234',
    font: {numberFont: 'digits'},
    shape: 'rectangle',
    numberHeight: 4,
    margin: 0.5,
    unit: 'in',
    assembly: {type: 'adhesive'},
    ...overrides,
  };
}

describe('computeSignLayout', () => {
  let digitsFont: LoadedFont;
  let nameFont: LoadedFont;

  beforeAll(() => {
    const digits = loadFont(buildTestFontBuffer('0123456789'));
    if (!digits.ok) throw new Error('digits test font failed to load');
    digitsFont = digits.value;

    const name = loadFont(buildTestFontBuffer('SMITH'));
    if (!name.ok) throw new Error('name test font failed to load');
    nameFont = name.value;
  });

  it('lays out a numbers-only sign with no name or holes', () => {
    const result = computeSignLayout(baseConfig(), digitsFont, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.numberGlyphs).toHaveLength(4);
      expect(result.value.nameGlyphs).toBeUndefined();
      expect(result.value.numberHoles).toBeUndefined();
      expect(result.value.engravingMarks).toBeUndefined();
    }
  });

  it('scales number glyphs to the requested numberHeight', () => {
    const result = computeSignLayout(baseConfig(), digitsFont, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ys = result.value.numberGlyphs.flatMap(g =>
        g.path.flatMap(cmd => ('y' in cmd ? [cmd.y] : [])),
      );
      const height = Math.max(...ys) - Math.min(...ys);
      expect(height).toBeCloseTo(4, 5);
    }
  });

  it('sizes a rectangle backer to content plus margin on every edge', () => {
    const result = computeSignLayout(baseConfig(), digitsFont, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const contentWidth = result.value.backer.width - 2 * 0.5;
      const contentHeight = result.value.backer.height - 2 * 0.5;
      expect(contentHeight).toBeCloseTo(4, 5);
      expect(contentWidth).toBeGreaterThan(0);
    }
  });

  it('produces a square backer with equal width and height', () => {
    const result = computeSignLayout(
      baseConfig({shape: 'square'}),
      digitsFont,
      undefined,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.backer.width).toBeCloseTo(
        result.value.backer.height,
        10,
      );
    }
  });

  it('produces a round backer with equal width and height', () => {
    const result = computeSignLayout(
      baseConfig({shape: 'round'}),
      digitsFont,
      undefined,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.backer.width).toBeCloseTo(
        result.value.backer.height,
        10,
      );
    }
  });

  it('lays out name and number rows when style is nameAndNumbers', () => {
    const result = computeSignLayout(
      baseConfig({
        style: 'nameAndNumbers',
        name: 'SMITH',
        font: {numberFont: 'digits', nameFont: 'name'},
      }),
      digitsFont,
      nameFont,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nameGlyphs).toHaveLength(5);
      expect(result.value.numberGlyphs).toHaveLength(4);
      // Name row is stacked above the number row: every name glyph's y
      // coordinates should be strictly above every number glyph's.
      const numberMaxY = Math.max(
        ...result.value.numberGlyphs.flatMap(g =>
          g.path.flatMap(cmd => ('y' in cmd ? [cmd.y] : [])),
        ),
      );
      const nameMinY = Math.min(
        ...(result.value.nameGlyphs ?? []).flatMap(g =>
          g.path.flatMap(cmd => ('y' in cmd ? [cmd.y] : [])),
        ),
      );
      expect(nameMinY).toBeGreaterThanOrEqual(numberMaxY);
    }
  });

  it('fails when style is nameAndNumbers but no nameFont is supplied', () => {
    const result = computeSignLayout(
      baseConfig({
        style: 'nameAndNumbers',
        name: 'SMITH',
        font: {numberFont: 'digits', nameFont: 'name'},
      }),
      digitsFont,
      undefined,
    );
    expect(result.ok).toBe(false);
  });

  it('generates one mounting hole per glyph for hardware assembly', () => {
    const result = computeSignLayout(
      baseConfig({
        style: 'nameAndNumbers',
        name: 'SMITH',
        font: {numberFont: 'digits', nameFont: 'name'},
        assembly: {type: 'hardware', screwSize: 'M3'},
      }),
      digitsFont,
      nameFont,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.numberHoles).toHaveLength(4);
      expect(result.value.nameHoles).toHaveLength(5);
      expect(result.value.engravingMarks).toHaveLength(9);
      for (const hole of result.value.numberHoles ?? []) {
        expect(hole.diameter).toBeGreaterThan(0);
      }
    }
  });

  it('omits holes and marks for adhesive assembly', () => {
    const result = computeSignLayout(
      baseConfig({assembly: {type: 'adhesive'}}),
      digitsFont,
      undefined,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.numberHoles).toBeUndefined();
      expect(result.value.nameHoles).toBeUndefined();
      expect(result.value.engravingMarks).toBeUndefined();
    }
  });

  describe('mounting hole placement', () => {
    it('does not place the hole inside a glyph counter (e.g. "0")', () => {
      const ring = loadFont(buildRingFontBuffer('0'));
      if (!ring.ok) throw new Error('ring test font failed to load');

      const result = computeSignLayout(
        baseConfig({
          houseNumber: '0',
          assembly: {type: 'hardware', screwSize: 'M3'},
        }),
        ring.value,
        undefined,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const hole = result.value.numberHoles?.[0];
      const glyph = result.value.numberGlyphs[0];
      expect(hole).toBeDefined();
      expect(glyph).toBeDefined();
      if (!hole || !glyph) return;

      const rings = ringsFromPath(glyph.path);
      expect(rings).toHaveLength(2);
      const [outer, counter] = [...rings].sort((a, b) => {
        const areaOf = (r: TestPoint[]): number => {
          const box = bboxOfRing(r);
          return (box.maxX - box.minX) * (box.maxY - box.minY);
        };
        return areaOf(b) - areaOf(a);
      });

      // A bounding-box-center bug lands exactly at the counter's own
      // center; the fix must land somewhere in the solid ring instead.
      expect(isInsidePolygon(hole.center, counter!)).toBe(false);
      expect(isInsidePolygon(hole.center, outer!)).toBe(true);
    });

    it('does not place the hole off the ink entirely (e.g. an "L"-shaped glyph)', () => {
      const hook = loadFont(buildHookFontBuffer('L'));
      if (!hook.ok) throw new Error('hook test font failed to load');

      const result = computeSignLayout(
        baseConfig({
          houseNumber: 'L',
          font: {numberFont: 'hook'},
          assembly: {type: 'hardware', screwSize: 'M3'},
        }),
        hook.value,
        undefined,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const hole = result.value.numberHoles?.[0];
      const glyph = result.value.numberGlyphs[0];
      expect(hole).toBeDefined();
      expect(glyph).toBeDefined();
      if (!hole || !glyph) return;

      const rings = ringsFromPath(glyph.path);
      expect(rings).toHaveLength(1);
      // A bounding-box-center bug lands in the empty notch between the
      // hook's two arms; the fix must land on the hook's ink instead.
      expect(isInsidePolygon(hole.center, rings[0]!)).toBe(true);
    });

    it('fails with a descriptive error when a screw hole cannot fit within a glyph', () => {
      const thin = loadFont(buildThinBarFontBuffer('1'));
      if (!thin.ok) throw new Error('thin bar test font failed to load');

      const result = computeSignLayout(
        baseConfig({
          houseNumber: '1',
          font: {numberFont: 'thin'},
          assembly: {type: 'hardware', screwSize: 'M3'},
        }),
        thin.value,
        undefined,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('number "1"');
      expect(result.error.message).toContain('M3');
    });

    it('still succeeds when every glyph has enough clearance for the screw', () => {
      const result = computeSignLayout(
        baseConfig({assembly: {type: 'hardware', screwSize: 'M3'}}),
        digitsFont,
        undefined,
      );
      expect(result.ok).toBe(true);
    });
  });
});
