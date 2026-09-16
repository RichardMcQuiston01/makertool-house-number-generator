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
});
