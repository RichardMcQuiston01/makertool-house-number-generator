# CHANGELOG

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffolding: TypeScript build (`tsup`, ESM + CJS + type declarations),
  ESLint + Prettier, Vitest, and GitHub Actions CI.
- Full Apache License 2.0 text.
- Package configured for publishing as `@richardmcquiston01/house-number-generator`.
- Core domain types (`SignConfig`, `SignStyle`, `SignShape`, `AssemblyConfig`,
  `ScrewSize`, `FontConfig`, `Unit`) describing a house number sign request.
- `validateSignConfig()`, which checks a `SignConfig` against every rule from
  the sign requirements (digits-only house number, name+font required for
  `nameAndNumbers`, positive margin, supported screw size) and returns a
  typed `Result` with descriptive, per-field error messages instead of
  throwing.
- Font engine (`loadFont`, `getGlyphOutline`, `getTextOutline`,
  `createFontRegistry`), built on `opentype.js`, for extracting vector
  glyph outlines from a TrueType/OpenType font file — for a single
  character (house number digits) or a run of text with kerning applied
  (the name layer).
