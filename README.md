# svg-vectordrawable

Convert SVG to **Android VectorDrawable** XML — robustly, across SVGs from any editor.

Built on [svgo](https://github.com/svg/svgo) (v4) for parsing and normalization, with a hand‑written
walker that emits the VectorDrawable. Notably handles **gradients including `gradientTransform`**
(linear & radial), which the popular but unmaintained `svg2vectordrawable` gets wrong.

```
npm i svg-vectordrawable
```

## Why another one?

`svg2vectordrawable` is unmaintained (last release 2022), pins `svgo@2`, and ignores
`gradientTransform` (Figma radial gradients render at the wrong place). This library is on
`svgo@4`, bakes `gradientTransform` into the Android coordinates, and **fails loud** instead of
emitting plausible‑but‑wrong output.

## Usage

```ts
import { convert } from 'svg-vectordrawable';

const { xml, warnings } = convert(svgString, {
    optimize: true, // run svgo normalization first (recommended)
    currentColor: '#000', // value substituted for `currentColor`
    floatPrecision: 3,
    fillBlackForUnfilled: true, // unfilled paths get black (SVG default)
    xmlTag: false, // prepend <?xml ...?>
    tint: '#FFFFFFFF', // android:tint on <vector> (Android color literal)
    strict: false, // throw on unsupported constructs instead of warning
    onWarn: (w) => console.warn(w.code, w.message),
});
```

`convert` is synchronous and returns `{ xml, warnings }`.

Node file helpers:

```ts
import { convertFile, convertDir } from 'svg-vectordrawable';
convertFile('icon.svg', 'res/drawable/icon.xml');
convertDir('svg/', 'res/drawable/');
```

### CLI

```
svgvd icon.svg                 # writes icon.xml next to it
svgvd icons/ -o out/           # batch a directory
svgvd icon.svg --stdout        # print to stdout
svgvd -s '<svg>…</svg>'        # convert an inline SVG string
svgvd icon.svg --xml-tag --tint '#FFFFFFFF'
svgvd icon.svg --strict        # fail on anything not representable
```

### Browser

A browser build (svgo's browser bundle, no Node built-ins) is published under the `./browser`
subpath:

```ts
import { convert } from 'svg-vectordrawable/browser';
const { xml } = convert(svgString);
```

## What it handles

| Feature                                                                                                                                  | Status     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Paths, `fill`, `stroke` (width/cap/join/miter), `fill-rule` → `fillType`                                                                 | ✅         |
| Shapes (`rect`/`circle`/`ellipse`/`line`/`poly*`) → path                                                                                 | ✅         |
| Colors: `#rgb[a]`, `#rrggbb[aa]`, `rgb()/rgba()`, `hsl()/hsla()`, named, `currentColor`                                                  | ✅         |
| Attribute inheritance (incl. presentation attrs on the `<svg>` root and `<g>`)                                                           | ✅         |
| Inline `style="…"` and `<style>` (via svgo)                                                                                              | ✅         |
| Linear & radial **gradients**, `gradientTransform`, **`objectBoundingBox`** (via path bbox), `href` sharing, `spreadMethod` → `tileMode` | ✅         |
| `<g transform>` → `<group>` (translate/rotate/scale); **skew/shear baked into geometry**                                                 | ✅         |
| **`<use>` / `<symbol>`** references — inlined before conversion                                                                          | ✅         |
| `clip-path` → `<clip-path>`                                                                                                              | ✅ (basic) |
| `opacity` folded into `fillAlpha`/`strokeAlpha`                                                                                          | ✅         |

## Known limitations

A VectorDrawable simply cannot represent some SVG features. These are **warned** (or throw in
`strict` mode), never silently mis‑rendered:

- `<mask>`, `<filter>`, `<pattern>`, `<image>`, `<text>` — not representable.
- `stroke-dasharray` and gradient **strokes** — dropped (VectorDrawable supports neither).
- `gradientUnits="objectBoundingBox"` is resolved from the path's bounding box; only when that box
  is unavailable does it fall back to the viewport (with a warning).
- `clip-path` on a `<g>` (vs. on a drawable element) is not applied.

## Robustness

Validated against ~10,700 real icons (Feather, Bootstrap Icons, Heroicons, Tabler) plus ~900
Figma‑exported brand assets: 100% converted with the correct paint model (stroke icons stay
strokes, filled icons stay fills). A sample (incl. gradients, `gradientTransform`, `objectBoundingBox`,
`<use>`, sheared groups, clip-path) is **compiled with `aapt2`** — Android's own toolchain accepts
the output — and a golden-snapshot suite locks the exact XML against regressions.

## License

MIT
