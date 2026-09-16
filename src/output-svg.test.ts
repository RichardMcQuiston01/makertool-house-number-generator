import {describe, expect, it} from 'vitest';
import type {PathCommand} from './font.js';
import type {MountingHole, PositionedGlyph, SignLayout} from './layout.js';
import {generateSvgFiles} from './output-svg.js';

// A 1x1 square glyph outline, offset from the origin by (ox, oy) to mimic a
// glyph's backer-relative position from computeSignLayout().
function squareAt(ox: number, oy: number): PathCommand[] {
  return [
    {type: 'M', x: ox, y: oy},
    {type: 'L', x: ox + 1, y: oy},
    {type: 'L', x: ox + 1, y: oy + 1},
    {type: 'L', x: ox, y: oy + 1},
    {type: 'Z'},
  ];
}

function glyph(character: string, ox: number, oy: number): PositionedGlyph {
  return {character, path: squareAt(ox, oy)};
}

function holeFor(ox: number, oy: number, diameter = 0.3): MountingHole {
  return {center: {x: ox + 0.5, y: oy + 0.5}, diameter};
}

const numberGlyphs: PositionedGlyph[] = [glyph('1', 2, 1), glyph('2', 4, 1)];
const nameGlyphs: PositionedGlyph[] = [glyph('S', 1, 3), glyph('M', 3, 3)];

function baseLayout(overrides: Partial<SignLayout> = {}): SignLayout {
  return {
    backer: {shape: 'rectangle', width: 10, height: 6},
    numberGlyphs,
    ...overrides,
  };
}

describe('generateSvgFiles', () => {
  it('produces one file per glyph plus one backer file (numbersOnly)', () => {
    const files = generateSvgFiles(baseLayout(), 'in');
    expect(files).toHaveLength(numberGlyphs.length + 1);
  });

  it('produces number, name, and backer files for nameAndNumbers layouts', () => {
    const layout = baseLayout({nameGlyphs});
    const files = generateSvgFiles(layout, 'in');
    expect(files).toHaveLength(numberGlyphs.length + nameGlyphs.length + 1);
  });

  it('names files using the {prefix}-{index}-{character}.svg scheme', () => {
    const layout = baseLayout({nameGlyphs});
    const files = generateSvgFiles(layout, 'in');
    const names = files.map(f => f.name);
    expect(names).toContain('number-0-1.svg');
    expect(names).toContain('number-1-2.svg');
    expect(names).toContain('name-0-S.svg');
    expect(names).toContain('name-1-M.svg');
    expect(names).toContain('backer.svg');
  });

  it('gives repeated characters unique index-qualified filenames', () => {
    const layout = baseLayout({
      numberGlyphs: [glyph('1', 0, 0), glyph('1', 2, 0)],
    });
    const files = generateSvgFiles(layout, 'in');
    const names = files.map(f => f.name);
    expect(names).toContain('number-0-1.svg');
    expect(names).toContain('number-1-1.svg');
  });

  it('normalizes per-glyph files to their own bounding box, not backer size', () => {
    const layout = baseLayout();
    const files = generateSvgFiles(layout, 'in');
    const glyphFile = files.find(f => f.name === 'number-0-1.svg');
    expect(glyphFile).toBeDefined();
    // The glyph is a 1x1 square; its normalized file should be sized ~1x1,
    // not the 10x6 backer.
    const viewBoxMatch = glyphFile?.content.match(
      /viewBox="0 0 ([\d.]+) ([\d.]+)"/,
    );
    expect(viewBoxMatch).not.toBeNull();
    expect(Number(viewBoxMatch?.[1])).toBeCloseTo(1, 5);
    expect(Number(viewBoxMatch?.[2])).toBeCloseTo(1, 5);

    const widthMatch = glyphFile?.content.match(/width="([\d.]+)in"/);
    const heightMatch = glyphFile?.content.match(/height="([\d.]+)in"/);
    expect(Number(widthMatch?.[1])).toBeCloseTo(1, 5);
    expect(Number(heightMatch?.[1])).toBeCloseTo(1, 5);

    // The path's own coordinates should start at/near local (0,0), not the
    // glyph's original backer-relative offset (ox=2, oy=1).
    expect(glyphFile?.content).toContain('M 0,1');
  });

  it('sizes the backer file to backer.width x backer.height with a rect for rectangle', () => {
    const layout = baseLayout();
    const files = generateSvgFiles(layout, 'in');
    const backer = files.find(f => f.name === 'backer.svg');
    expect(backer).toBeDefined();
    expect(backer?.content).toContain('viewBox="0 0 10 6"');
    expect(backer?.content).toContain('width="10in"');
    expect(backer?.content).toContain('height="6in"');
    expect(backer?.content).toMatch(
      /<rect class="cut"[^>]*width="10"[^>]*height="6"/,
    );
  });

  it('produces a circle element for a round backer, sized from its width', () => {
    const layout = baseLayout({backer: {shape: 'round', width: 8, height: 8}});
    const files = generateSvgFiles(layout, 'in');
    const backer = files.find(f => f.name === 'backer.svg');
    expect(backer?.content).toMatch(/<circle class="cut" cx="4" cy="4" r="4"/);
    expect(backer?.content).not.toContain('<rect');
  });

  it('emits hole and engraving-mark circles for hardware assembly, with correct classes', () => {
    const numberHoles: MountingHole[] = [holeFor(2, 1), holeFor(4, 1)];
    const engravingMarks: MountingHole[] = [
      {center: {x: 2.5, y: 1.5}, diameter: 0.06},
      {center: {x: 4.5, y: 1.5}, diameter: 0.06},
    ];
    const layout = baseLayout({numberHoles, engravingMarks});
    const files = generateSvgFiles(layout, 'in');

    const glyphFile = files.find(f => f.name === 'number-0-1.svg');
    expect(glyphFile?.content).toMatch(/<circle class="cut"/);

    const backer = files.find(f => f.name === 'backer.svg');
    expect(backer?.content).toMatch(
      /<circle class="engrave"[^>]*stroke="#0000FF"/,
    );
    // Backer's own outline circle/rect stays "cut", not "engrave".
    expect(backer?.content).toMatch(/<rect class="cut"/);
  });

  it('produces no hole/mark circles for adhesive assembly', () => {
    const layout = baseLayout();
    const files = generateSvgFiles(layout, 'in');

    const glyphFile = files.find(f => f.name === 'number-0-1.svg');
    expect(glyphFile?.content).not.toContain('<circle');

    const backer = files.find(f => f.name === 'backer.svg');
    expect(backer?.content).not.toContain('<circle');
  });

  it('appends the correct unit suffix to width/height attributes', () => {
    const inFiles = generateSvgFiles(baseLayout(), 'in');
    const mmFiles = generateSvgFiles(baseLayout(), 'mm');

    const inBacker = inFiles.find(f => f.name === 'backer.svg');
    const mmBacker = mmFiles.find(f => f.name === 'backer.svg');

    expect(inBacker?.content).toContain('width="10in"');
    expect(mmBacker?.content).toContain('width="10mm"');
    expect(inBacker?.content).not.toContain('10mm');
    expect(mmBacker?.content).not.toContain('10in');
  });

  it('uses a smaller hairline stroke width for inches than millimeters', () => {
    const inFiles = generateSvgFiles(baseLayout(), 'in');
    const mmFiles = generateSvgFiles(baseLayout(), 'mm');
    expect(inFiles[0]?.content).toContain('stroke-width="0.004"');
    expect(mmFiles[0]?.content).toContain('stroke-width="0.1"');
  });

  it('includes matching holes on per-glyph files, indexed to their glyph', () => {
    const numberHoles: MountingHole[] = [holeFor(2, 1), holeFor(4, 1)];
    const layout = baseLayout({numberHoles});
    const files = generateSvgFiles(layout, 'in');

    const first = files.find(f => f.name === 'number-0-1.svg');
    const second = files.find(f => f.name === 'number-1-2.svg');
    // Each glyph's hole should be normalized into that glyph's own local
    // space (center at local (0.5, 0.5) after normalization), not shared.
    expect(first?.content).toMatch(/<circle class="cut" cx="0.5" cy="0.5"/);
    expect(second?.content).toMatch(/<circle class="cut" cx="0.5" cy="0.5"/);
  });
});
