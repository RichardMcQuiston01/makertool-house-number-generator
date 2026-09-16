import opentype from 'opentype.js';
import type {Result} from './types.js';

/** Vector path command, mirroring the SVG/Canvas path command grammar. */
export type PathCommand =
  | {readonly type: 'M'; readonly x: number; readonly y: number}
  | {readonly type: 'L'; readonly x: number; readonly y: number}
  | {
      readonly type: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'Q';
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | {readonly type: 'Z'};

/** Vector outline for a single character, scaled to the requested font size. */
export interface GlyphOutline {
  readonly character: string;
  /** Horizontal distance to advance the cursor after this glyph, in the same units as {@link path}. */
  readonly advanceWidth: number;
  readonly path: readonly PathCommand[];
}

/** Vector outline for a run of text, with kerning already applied. */
export interface TextOutline {
  readonly text: string;
  /** Total horizontal width of the rendered text, in the same units as {@link path}. */
  readonly advanceWidth: number;
  readonly path: readonly PathCommand[];
}

export interface FontLoadError {
  readonly message: string;
}

/** An opaque, successfully-parsed font. Obtain one via {@link loadFont}. */
export interface LoadedFont {
  readonly familyName: string;
  readonly unitsPerEm: number;
}

const fontInternals = new WeakMap<LoadedFont, opentype.Font>();

// LoadedFont is only ever constructed by loadFont(), so a missing entry here
// means the caller passed an object of the right shape but wrong origin.
function requireOpentypeFont(font: LoadedFont): opentype.Font {
  const internal = fontInternals.get(font);
  if (!internal) {
    throw new Error('LoadedFont was not created by loadFont().');
  }
  return internal;
}

// opentype.js's glyph paths are Y-down (baseline y=0, ascender negative,
// matching the canvas convention its own draw() methods target) — the
// opposite of this package's Y-up sign convention (see layout.ts). Negate Y
// here, once, so every consumer of PathCommand can assume Y-up.
function toPathCommands(path: opentype.Path): PathCommand[] {
  return path.commands.map((command): PathCommand => {
    switch (command.type) {
      case 'M':
        return {type: 'M', x: command.x, y: -command.y};
      case 'L':
        return {type: 'L', x: command.x, y: -command.y};
      case 'C':
        return {
          type: 'C',
          x1: command.x1,
          y1: -command.y1,
          x2: command.x2,
          y2: -command.y2,
          x: command.x,
          y: -command.y,
        };
      case 'Q':
        return {
          type: 'Q',
          x1: command.x1,
          y1: -command.y1,
          x: command.x,
          y: -command.y,
        };
      case 'Z':
        return {type: 'Z'};
    }
  });
}

/** Parses a TrueType/OpenType font from raw bytes. */
export function loadFont(
  buffer: ArrayBuffer,
): Result<LoadedFont, FontLoadError> {
  let parsed: opentype.Font;
  try {
    parsed = opentype.parse(buffer);
  } catch (err) {
    return {
      ok: false,
      error: {
        message: `Failed to parse font file: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  if (!parsed.supported) {
    return {
      ok: false,
      error: {message: 'Font file uses an unsupported format or table layout.'},
    };
  }

  const loaded: LoadedFont = {
    familyName: parsed.getEnglishName('fontFamily') || 'Unknown',
    unitsPerEm: parsed.unitsPerEm,
  };
  fontInternals.set(loaded, parsed);
  return {ok: true, value: loaded};
}

/** Extracts the outline for a single character at the given font size (in the same units as the font size, typically px). */
export function getGlyphOutline(
  font: LoadedFont,
  character: string,
  fontSizePx: number,
): Result<GlyphOutline, FontLoadError> {
  if ([...character].length !== 1) {
    return {
      ok: false,
      error: {
        message: `getGlyphOutline requires exactly one character, got "${character}".`,
      },
    };
  }

  const opentypeFont = requireOpentypeFont(font);
  if (!opentypeFont.hasChar(character)) {
    return {
      ok: false,
      error: {
        message: `Font "${font.familyName}" does not contain a glyph for "${character}".`,
      },
    };
  }

  const glyph = opentypeFont.charToGlyph(character);
  const path = glyph.getPath(0, 0, fontSizePx);
  const advanceWidth = glyph.advanceWidth
    ? (glyph.advanceWidth * fontSizePx) / opentypeFont.unitsPerEm
    : 0;

  return {
    ok: true,
    value: {character, advanceWidth, path: toPathCommands(path)},
  };
}

/** Extracts the outline for a run of text at the given font size, with kerning applied. */
export function getTextOutline(
  font: LoadedFont,
  text: string,
  fontSizePx: number,
): Result<TextOutline, FontLoadError> {
  if (text.length === 0) {
    return {
      ok: false,
      error: {message: 'getTextOutline requires non-empty text.'},
    };
  }

  const opentypeFont = requireOpentypeFont(font);
  const missing = [
    ...new Set([...text].filter(ch => ch !== ' ' && !opentypeFont.hasChar(ch))),
  ];
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        message: `Font "${font.familyName}" is missing glyphs for: ${missing.join(', ')}`,
      },
    };
  }

  const path = opentypeFont.getPath(text, 0, 0, fontSizePx);
  const advanceWidth = opentypeFont.getAdvanceWidth(text, fontSizePx);

  return {
    ok: true,
    value: {text, advanceWidth, path: toPathCommands(path)},
  };
}

/** A named collection of loaded fonts, referenced elsewhere by id (see {@link FontConfig}). */
export interface FontRegistry {
  register(id: string, buffer: ArrayBuffer): Result<LoadedFont, FontLoadError>;
  get(id: string): Result<LoadedFont, FontLoadError>;
  has(id: string): boolean;
}

export function createFontRegistry(): FontRegistry {
  const fonts = new Map<string, LoadedFont>();

  return {
    register(
      id: string,
      buffer: ArrayBuffer,
    ): Result<LoadedFont, FontLoadError> {
      const result = loadFont(buffer);
      if (!result.ok) {
        return result;
      }
      fonts.set(id, result.value);
      return result;
    },
    get(id: string): Result<LoadedFont, FontLoadError> {
      const font = fonts.get(id);
      if (!font) {
        return {
          ok: false,
          error: {message: `No font registered with id "${id}".`},
        };
      }
      return {ok: true, value: font};
    },
    has(id: string): boolean {
      return fonts.has(id);
    },
  };
}
