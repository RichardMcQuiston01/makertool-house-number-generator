import type {FontLoadError, FontRegistry, LoadedFont} from './font.js';
import type {LayoutError, LayoutOptions} from './layout.js';
import {computeSignLayout} from './layout.js';
import type {GeneratedFile} from './output-svg.js';
import {generateSvgFiles} from './output-svg.js';
import {generateDxfFiles} from './output-dxf.js';
import type {Result, SignConfig, ValidationError} from './types.js';
import {validateSignConfig} from './validation.js';

export type OutputFormat = 'svg' | 'dxf' | 'both';

/** Which stage of the pipeline failed, with that stage's own error shape. */
export type GenerateSignError =
  | {readonly stage: 'validation'; readonly errors: readonly ValidationError[]}
  | {readonly stage: 'font'; readonly error: FontLoadError}
  | {readonly stage: 'layout'; readonly error: LayoutError};

export interface GenerateSignOptions {
  readonly config: SignConfig;
  /**
   * Must already have the font(s) referenced by `config.font.numberFont` /
   * `config.font.nameFont` registered (see `createFontRegistry`).
   */
  readonly fonts: FontRegistry;
  /** Which output format(s) to generate. Defaults to `'both'`. */
  readonly format?: OutputFormat;
  readonly layoutOptions?: LayoutOptions;
}

/**
 * Runs the full pipeline for one house number sign: validate the config,
 * resolve its fonts, compute the physical layout, then generate cut/engrave
 * files. Returns every generated file (SVG and/or DXF, per-piece) as a flat
 * list, or the first error encountered, tagged with which stage produced it.
 */
export function generateSign(
  options: GenerateSignOptions,
): Result<GeneratedFile[], GenerateSignError> {
  const validation = validateSignConfig(options.config);
  if (!validation.ok) {
    return {
      ok: false,
      error: {stage: 'validation', errors: validation.error},
    };
  }
  const config = validation.value;

  const numberFontResult = options.fonts.get(config.font.numberFont);
  if (!numberFontResult.ok) {
    return {ok: false, error: {stage: 'font', error: numberFontResult.error}};
  }

  let nameFont: LoadedFont | undefined;
  if (config.style === 'nameAndNumbers') {
    const nameFontResult = options.fonts.get(config.font.nameFont as string);
    if (!nameFontResult.ok) {
      return {ok: false, error: {stage: 'font', error: nameFontResult.error}};
    }
    nameFont = nameFontResult.value;
  }

  const layoutResult = computeSignLayout(
    config,
    numberFontResult.value,
    nameFont,
    options.layoutOptions,
  );
  if (!layoutResult.ok) {
    return {ok: false, error: {stage: 'layout', error: layoutResult.error}};
  }

  const format = options.format ?? 'both';
  const files: GeneratedFile[] = [];
  if (format === 'svg' || format === 'both') {
    files.push(...generateSvgFiles(layoutResult.value, config.unit));
  }
  if (format === 'dxf' || format === 'both') {
    files.push(...generateDxfFiles(layoutResult.value, config.unit));
  }

  return {ok: true, value: files};
}
