# House Number Sign Generator

[**Live demo**](https://house-number-generator-demo.vercel.app/)

## Overview

- User chooses sign style(numbers only or name + numbers).
- User enters digits representing their house's street number.
- User chooses from list of fonts for numbers
  -- If user chose "name + numbers", user can also choose a font for name
- User chooses sign shape(square, rectangle, or round)
- User selects sign margin(i.e. 1/2")
- User selects assembly type(hardware(i.e. screw) or non-hardware(i.e. glued, adhesive paper, etc.)
  -- If user chooses Hardware assembly type, user should select screw size(i.e. M3, 3/8", etc.).

- Generate DXF(or SVG) for each Number for cutting out on Laser Cutter.
  -- If user selected Hardware assembly type, we'll need to add holes for affixing number(s) to sign backer using screw hardware

- If user chose "name + numbers", generate a cut file for the Name as well.
  -- If user selected Hardware assembly type, we'll need to add holes for affixing name layer to sign backer using screw hardware

- Generate sign backer based upon sign shape such that all numbers fit within the bounds of the sign including the margin selected for each edge(top, bottom, left, and right).
  -- If user selected Hardware assembly type, we should add engraving marks to sign backer where screws for number(s) and/or name will be attached to sign backer.

## Getting Started

This package is under active development (see [CHANGELOG.md](./CHANGELOG.md)
for progress).

### Prerequisites

- Node.js >= 18

### Installation

```bash
npm install @richardmcquiston01/house-number-generator
```

### Usage

```ts
import {
  createFontRegistry,
  generateSign,
} from '@richardmcquiston01/house-number-generator';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';

const fonts = createFontRegistry();
const fontBytes = new Uint8Array(readFileSync('./fonts/DejaVuSans.ttf')).buffer;
fonts.register('digits', fontBytes);

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

Each call to `generateSign()` returns one file per physical laser-cut piece —
a separate file per house number digit (and per name letter, if `style` is
`nameAndNumbers`), plus one `backer` file for the sign's backing plate.

### Examples

The package also installs a CLI for local testing, without writing any code:

```bash
npx house-number-generator \
  --config sign.json \
  --number-font ./fonts/DejaVuSans.ttf \
  --out ./output
```

Where `sign.json` holds the `SignConfig` fields shown above (minus `font`,
which the CLI fills in from `--number-font`/`--name-font`):

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
npm run build      # compile to dist/ (ESM + CJS + types)
npm test           # run unit tests
npm run lint        # lint with ESLint
npm run format      # format with Prettier
npm run typecheck   # type-check without emitting
```

## Buy Me a Coffee

If this app, code, or repository has helped you or someone you know, please consider donating. I appreciate any help to offset the costs of development and/or AI Credits.

[**Donate via Stripe**](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800), or scan:

[![Donate via Stripe](./donate.svg)](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800)

## License

Apache 2

## Copyright

(c)2026 Richard McQuiston. All rights reserved.
