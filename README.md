# House Number Sign Generator

[![npm](https://img.shields.io/npm/v/@richardmcquiston01/house-number-generator)](https://www.npmjs.com/package/@richardmcquiston01/house-number-generator)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

Generate SVG and DXF cut files for a laser-cut house number sign: one file per
digit, one per name letter, and one for the backer plate. Describe the sign in
a config object and get back files ready for a laser cutter, CNC, or Cricut.

[**Live demo**](https://house-number-generator-demo.vercel.app/) — configure a
sign in the browser and download the files, no code required.

## Features

- **Two sign styles** — house number only, or a name plus the number.
- **Three backer shapes** — square, rectangle, or round, sized automatically so
  every glyph fits inside the margin you choose.
- **Your fonts** — load any TrueType/OpenType font; glyph outlines become cut
  paths.
- **Hardware or adhesive assembly** — for screws, a mounting hole is placed at
  the deepest interior point of each glyph, with matching engraving marks on
  the backer. Supports M3, M4, M5, #4-40, #6-32, #8-32, #10-24, and 1/4-20.
- **SVG and DXF output** — physically sized (`4in`, `100mm`), with cut and
  engrave geometry kept separate.
- **Typed errors, no exceptions** — every fallible call returns a `Result` that
  says which stage failed and why.
- **CLI included** — generate files from a JSON config without writing code.

## Installation

Requires Node.js 18 or later.

```bash
npm install @richardmcquiston01/house-number-generator
```

## Usage

```ts
import {
  createFontRegistry,
  generateSign,
} from '@richardmcquiston01/house-number-generator';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';

const fonts = createFontRegistry();
const fontBytes = new Uint8Array(readFileSync('./fonts/DejaVuSans.ttf')).buffer;
const registered = fonts.register('digits', fontBytes);
if (!registered.ok) {
  throw new Error(`Could not load font: ${registered.error.message}`);
}

const result = generateSign({
  config: {
    style: 'numbersOnly',
    houseNumber: '742',
    font: {numberFont: 'digits'},
    shape: 'rectangle',
    numberHeight: 4, // inches
    margin: 0.5,
    unit: 'in',
    assembly: {type: 'hardware', screwSize: 'M3'},
  },
  fonts,
  format: 'both', // 'svg' | 'dxf' | 'both'
});

if (!result.ok) {
  // result.error.stage is 'validation' | 'font' | 'layout'
  throw new Error(`Sign generation failed at ${result.error.stage} stage`);
}

mkdirSync('./output', {recursive: true});
for (const file of result.value) {
  writeFileSync(`./output/${file.name}`, file.content);
}
```

### Output files

`generateSign()` returns one `{name, content}` file per physical piece, per
requested format:

| File                       | Piece                                  |
| -------------------------- | -------------------------------------- |
| `number-<i>-<digit>.<ext>` | One per house number digit             |
| `name-<i>-<letter>.<ext>`  | One per name letter (`nameAndNumbers`) |
| `backer.<ext>`             | The backer plate, with engraving marks |

`<ext>` is `svg` or `dxf`. Cut geometry is on a `CUT` layer (SVG:
`class="cut"`, black); screw-position marks are on `ENGRAVE` (SVG:
`class="engrave"`, blue).

### Configuration

| Field          | Type                                                  | Notes                                      |
| -------------- | ----------------------------------------------------- | ------------------------------------------ |
| `style`        | `'numbersOnly' \| 'nameAndNumbers'`                   |                                            |
| `houseNumber`  | `string`                                              | Digits only                                |
| `name`         | `string`                                              | Required for `nameAndNumbers`              |
| `font`         | `{numberFont, nameFont?}`                             | IDs registered in the font registry        |
| `shape`        | `'square' \| 'rectangle' \| 'round'`                  |                                            |
| `numberHeight` | `number`                                              | Glyph height; drives the overall sign size |
| `nameHeight`   | `number`                                              | Defaults to `numberHeight`                 |
| `margin`       | `number`                                              | Applied to every edge of the backer        |
| `unit`         | `'in' \| 'mm'`                                        |                                            |
| `assembly`     | `{type: 'hardware', screwSize} \| {type: 'adhesive'}` |                                            |

Hardware assembly fails with a descriptive `LayoutError` if a screw hole can't
fit inside a glyph's stroke (for example, a thin letter with a large screw).
The message lists each offending character with the clearance available versus
required; choose a smaller screw or a thicker font.

### Lower-level API

`generateSign()` chains these, and each is exported on its own:

- `validateSignConfig(config)` — field-level validation errors.
- `loadFont`, `createFontRegistry`, `getGlyphOutline`, `getTextOutline` — font
  loading and glyph outlines.
- `computeSignLayout(config, numberFont, nameFont, options?)` — sign geometry,
  with optional `letterSpacing` and `rowGap`.
- `generateSvgFiles(layout, unit)` and `generateDxfFiles(layout, unit)` — turn a
  layout into files.

## Command line

The package installs a `house-number-generator` command:

```bash
npx house-number-generator \
  --config sign.json \
  --number-font ./fonts/DejaVuSans.ttf \
  --out ./output
```

| Flag            | Required | Description                              |
| --------------- | -------- | ---------------------------------------- |
| `--config`      | yes      | Path to the sign config JSON             |
| `--number-font` | yes      | Font file for the house number           |
| `--name-font`   | no       | Font file for the name                   |
| `--out`         | yes      | Output directory                         |
| `--format`      | no       | `svg`, `dxf`, or `both` (default `both`) |

`sign.json` holds the config fields above, minus `font` (the CLI fills it in
from the font flags):

```json
{
  "style": "numbersOnly",
  "houseNumber": "742",
  "shape": "rectangle",
  "numberHeight": 4,
  "margin": 0.5,
  "unit": "in",
  "assembly": {"type": "hardware", "screwSize": "M3"}
}
```

## Development

```bash
npm install
npm run build       # compile to dist/ (ESM + CJS + types)
npm test            # run unit tests
npm run lint        # lint with ESLint
npm run format      # format with Prettier
npm run typecheck   # type-check without emitting
```

Pushing a `v*` tag runs the publish workflow (format check, lint, typecheck,
tests, build, then `npm publish`). See [CHANGELOG.md](./CHANGELOG.md) for
release history.

## License

Licensed under the [Apache License 2.0](./LICENSE).

© 2026 Richard McQuiston. All rights reserved.

## Buy Me a Coffee

If this app, code, or repository has helped you or someone you know, please consider donating. I appreciate any help to offset the costs of development and/or AI Credits.

[**Donate via Stripe**](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800), or scan:

[![Donate via Stripe](./donate.svg)](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800)
