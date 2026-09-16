/**
 * @richardmcquiston01/house-number-generator
 *
 * Generates SVG/DXF laser-cutter cut files for house number signs.
 * Public API surface is added incrementally in later development stages.
 */

export type {
  AssemblyConfig,
  FontConfig,
  Result,
  ScrewSize,
  SignConfig,
  SignShape,
  SignStyle,
  Unit,
  ValidationError,
} from './types.js';
export {validateSignConfig} from './validation.js';

export type {
  FontLoadError,
  FontRegistry,
  GlyphOutline,
  LoadedFont,
  PathCommand,
  TextOutline,
} from './font.js';
export {
  createFontRegistry,
  getGlyphOutline,
  getTextOutline,
  loadFont,
} from './font.js';

export type {
  LayoutError,
  LayoutOptions,
  MountingHole,
  Point,
  PositionedGlyph,
  SignBacker,
  SignLayout,
} from './layout.js';
export {computeSignLayout} from './layout.js';

// GeneratedFile is structurally identical in both output-svg.ts and
// output-dxf.ts; re-exported once here as the shared public type.
export type {GeneratedFile} from './output-svg.js';
export {generateSvgFiles} from './output-svg.js';
export {generateDxfFiles} from './output-dxf.js';

export type {
  GenerateSignError,
  GenerateSignOptions,
  OutputFormat,
} from './generate.js';
export {generateSign} from './generate.js';
