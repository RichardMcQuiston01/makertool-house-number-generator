# House Number Sign Generator

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
for progress). Prerequisites, installation, usage, and examples will be
filled in as the public API stabilizes.

### Prerequisites

- Node.js >= 18

### Installation

```bash
npm install @richardmcquiston01/house-number-generator
```

### Usage

_Coming soon._

### Examples

_Coming soon._

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
