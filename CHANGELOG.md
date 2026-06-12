# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1]

### Changed

- Add `repository`, `homepage`, `bugs` and `author` metadata so npm links back to the GitHub repository.
- Switch the npm release workflow to OIDC Trusted Publishing (no long-lived `NPM_TOKEN`); provenance is generated automatically.

## [0.1.0]

### Added

- SVG → Android VectorDrawable XML conversion, AST-based via svgo normalization.
- Linear and radial gradients, including `gradientTransform` baked into Android gradient coordinates.
- `objectBoundingBox` gradient units resolved through the filled path's bounding box (with a viewport fallback).
- `<use>` reference resolution by inlining the referenced geometry (supports `href` and legacy `xlink:href`).
- Baking of transforms that cannot map to an Android `<group>` (skew/shear) directly into path geometry.
- `clip-path` support via a `<group>` wrapping a `<clip-path>` element.
- Inheritance of presentation attributes set on the root `<svg>` element (Feather/Bootstrap icon style).
- Full CSS color support: hex, `rgb()`, `hsl()`, named colors, and `currentColor` substitution.
- Fail-loud behavior: warnings for every unrepresentable construct, with an optional `strict` mode that throws.
- CLI (`svgvd`) for single-file, batch, and inline-string conversion.
- Browser build exposing the same API (svgo resolved to its browser bundle, no Node built-ins).
