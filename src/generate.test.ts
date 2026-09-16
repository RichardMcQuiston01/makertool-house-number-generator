import opentype from 'opentype.js';
import {beforeAll, describe, expect, it} from 'vitest';
import {createFontRegistry} from './font.js';
import type {FontRegistry} from './font.js';
import {generateSign} from './generate.js';
import type {SignConfig} from './types.js';

function buildTestFontBuffer(characters: string): ArrayBuffer {
  const glyphs = [
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 300,
      path: new opentype.Path(),
    }),
  ];

  for (const character of characters) {
    const path = new opentype.Path();
    path.moveTo(0, 0);
    path.lineTo(300, 0);
    path.lineTo(300, 700);
    path.lineTo(0, 700);
    path.close();
    glyphs.push(
      new opentype.Glyph({
        name: character,
        unicode: character.charCodeAt(0),
        advanceWidth: 350,
        path,
      }),
    );
  }

  const font = new opentype.Font({
    familyName: 'Generate Test Font',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
  });

  return font.toArrayBuffer();
}

function baseConfig(overrides: Partial<SignConfig> = {}): SignConfig {
  return {
    style: 'numbersOnly',
    houseNumber: '123',
    font: {numberFont: 'digits'},
    shape: 'rectangle',
    numberHeight: 4,
    margin: 0.5,
    unit: 'in',
    assembly: {type: 'adhesive'},
    ...overrides,
  };
}

describe('generateSign', () => {
  let fonts: FontRegistry;

  beforeAll(() => {
    fonts = createFontRegistry();
    const digits = fonts.register('digits', buildTestFontBuffer('0123456789'));
    if (!digits.ok) throw new Error('digits test font failed to register');
    const name = fonts.register('name', buildTestFontBuffer('SMITH'));
    if (!name.ok) throw new Error('name test font failed to register');
  });

  it('generates both SVG and DXF files by default', () => {
    const result = generateSign({config: baseConfig(), fonts});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const svgFiles = result.value.filter(f => f.name.endsWith('.svg'));
      const dxfFiles = result.value.filter(f => f.name.endsWith('.dxf'));
      expect(svgFiles.length).toBe(4); // 3 digits + backer
      expect(dxfFiles.length).toBe(4);
    }
  });

  it('generates only SVG files when format is "svg"', () => {
    const result = generateSign({config: baseConfig(), fonts, format: 'svg'});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.every(f => f.name.endsWith('.svg'))).toBe(true);
      expect(result.value.length).toBe(4);
    }
  });

  it('generates only DXF files when format is "dxf"', () => {
    const result = generateSign({config: baseConfig(), fonts, format: 'dxf'});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.every(f => f.name.endsWith('.dxf'))).toBe(true);
      expect(result.value.length).toBe(4);
    }
  });

  it('generates files for nameAndNumbers style', () => {
    const result = generateSign({
      config: baseConfig({
        style: 'nameAndNumbers',
        name: 'SMITH',
        font: {numberFont: 'digits', nameFont: 'name'},
      }),
      fonts,
      format: 'svg',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 3 number glyphs + 5 name glyphs + backer
      expect(result.value.length).toBe(9);
    }
  });

  it('returns a validation-stage error for an invalid config', () => {
    const result = generateSign({
      config: baseConfig({houseNumber: 'not-digits'}),
      fonts,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.stage).toBe('validation');
      if (result.error.stage === 'validation') {
        expect(result.error.errors).toContainEqual(
          expect.objectContaining({field: 'houseNumber'}),
        );
      }
    }
  });

  it('returns a font-stage error when the number font id is not registered', () => {
    const result = generateSign({
      config: baseConfig({font: {numberFont: 'missing-font'}}),
      fonts,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.stage).toBe('font');
    }
  });

  it('returns a font-stage error when the name font id is not registered', () => {
    const result = generateSign({
      config: baseConfig({
        style: 'nameAndNumbers',
        name: 'SMITH',
        font: {numberFont: 'digits', nameFont: 'missing-font'},
      }),
      fonts,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.stage).toBe('font');
    }
  });

  it('returns a layout-stage error when the font is missing a glyph the house number needs', () => {
    const digitsOnlyTo5 = createFontRegistry();
    const registerResult = digitsOnlyTo5.register(
      'partial-digits',
      buildTestFontBuffer('012345'),
    );
    expect(registerResult.ok).toBe(true);

    const result = generateSign({
      config: baseConfig({
        houseNumber: '789',
        font: {numberFont: 'partial-digits'},
      }),
      fonts: digitsOnlyTo5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.stage).toBe('layout');
    }
  });

  it('generates one mounting hole per glyph for hardware assembly, reflected in output', () => {
    const result = generateSign({
      config: baseConfig({assembly: {type: 'hardware', screwSize: 'M3'}}),
      fonts,
      format: 'dxf',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const backer = result.value.find(f => f.name === 'backer.dxf');
      expect(backer).toBeDefined();
      expect(backer?.content).toContain('ENGRAVE');
    }
  });
});
