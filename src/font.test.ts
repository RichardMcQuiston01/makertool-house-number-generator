import opentype from 'opentype.js';
import {describe, expect, it} from 'vitest';
import {
  createFontRegistry,
  getGlyphOutline,
  getTextOutline,
  loadFont,
} from './font.js';

const UNITS_PER_EM = 1000;
const A_ADVANCE_WIDTH = 400;
const B_ADVANCE_WIDTH = 450;

function buildTestFontBuffer(): ArrayBuffer {
  const square = new opentype.Path();
  square.moveTo(0, 0);
  square.lineTo(300, 0);
  square.lineTo(300, 300);
  square.lineTo(0, 300);
  square.close();

  const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: 300,
    path: new opentype.Path(),
  });
  const aGlyph = new opentype.Glyph({
    name: 'A',
    unicode: 'A'.charCodeAt(0),
    advanceWidth: A_ADVANCE_WIDTH,
    path: square,
  });
  const bGlyph = new opentype.Glyph({
    name: 'B',
    unicode: 'B'.charCodeAt(0),
    advanceWidth: B_ADVANCE_WIDTH,
    path: square,
  });

  const font = new opentype.Font({
    familyName: 'House Number Test Font',
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: 800,
    descender: -200,
    glyphs: [notdefGlyph, aGlyph, bGlyph],
  });

  return font.toArrayBuffer();
}

describe('loadFont', () => {
  it('parses a valid font buffer', () => {
    const result = loadFont(buildTestFontBuffer());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.familyName).toBe('House Number Test Font');
      expect(result.value.unitsPerEm).toBe(UNITS_PER_EM);
    }
  });

  it('reports a descriptive error for invalid font data', () => {
    const garbage = new TextEncoder().encode('not a font').buffer;
    const result = loadFont(garbage);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});

describe('getGlyphOutline', () => {
  it('extracts a single glyph outline scaled to the requested size', () => {
    const font = loadFont(buildTestFontBuffer());
    if (!font.ok) throw new Error('test font failed to load');

    const result = getGlyphOutline(font.value, 'A', 100);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.character).toBe('A');
      expect(result.value.advanceWidth).toBeCloseTo(
        (A_ADVANCE_WIDTH * 100) / UNITS_PER_EM,
      );
      expect(result.value.path.length).toBeGreaterThan(0);
      expect(result.value.path[0]?.type).toBe('M');
    }
  });

  it('rejects a character missing from the font', () => {
    const font = loadFont(buildTestFontBuffer());
    if (!font.ok) throw new Error('test font failed to load');

    const result = getGlyphOutline(font.value, 'Z', 100);
    expect(result.ok).toBe(false);
  });

  it('rejects input that is not exactly one character', () => {
    const font = loadFont(buildTestFontBuffer());
    if (!font.ok) throw new Error('test font failed to load');

    const result = getGlyphOutline(font.value, 'AB', 100);
    expect(result.ok).toBe(false);
  });
});

describe('getTextOutline', () => {
  it('extracts a combined outline for a run of text', () => {
    const font = loadFont(buildTestFontBuffer());
    if (!font.ok) throw new Error('test font failed to load');

    const result = getTextOutline(font.value, 'AB', 100);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('AB');
      expect(result.value.advanceWidth).toBeCloseTo(
        ((A_ADVANCE_WIDTH + B_ADVANCE_WIDTH) * 100) / UNITS_PER_EM,
      );
      expect(result.value.path.length).toBeGreaterThan(0);
    }
  });

  it('rejects text containing a glyph the font does not have', () => {
    const font = loadFont(buildTestFontBuffer());
    if (!font.ok) throw new Error('test font failed to load');

    const result = getTextOutline(font.value, 'AZ', 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Z');
    }
  });

  it('rejects empty text', () => {
    const font = loadFont(buildTestFontBuffer());
    if (!font.ok) throw new Error('test font failed to load');

    const result = getTextOutline(font.value, '', 100);
    expect(result.ok).toBe(false);
  });
});

describe('createFontRegistry', () => {
  it('registers and retrieves fonts by id', () => {
    const registry = createFontRegistry();
    const registerResult = registry.register(
      'test-font',
      buildTestFontBuffer(),
    );
    expect(registerResult.ok).toBe(true);
    expect(registry.has('test-font')).toBe(true);

    const getResult = registry.get('test-font');
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value.familyName).toBe('House Number Test Font');
    }
  });

  it('reports a descriptive error for an unknown id', () => {
    const registry = createFontRegistry();
    const result = registry.get('missing');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('missing');
    }
  });

  it('does not register a font when the buffer is invalid', () => {
    const registry = createFontRegistry();
    const garbage = new TextEncoder().encode('not a font').buffer;
    const result = registry.register('bad-font', garbage);
    expect(result.ok).toBe(false);
    expect(registry.has('bad-font')).toBe(false);
  });
});
