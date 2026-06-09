import { describe, expect, it, vi } from 'vitest';
import { convert } from '../src/index.js';

const svg = (inner: string, attrs = 'viewBox="0 0 24 24"'): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
// Most tests use optimize:false for deterministic output (svgo would rewrite paths/colors/transforms).
const raw = { optimize: false };

describe('basic paths & colors', () => {
    it('emits an opaque fillColor for a hex fill', () => {
        const { xml } = convert(svg('<path d="M0 0h24v24H0z" fill="#ff0000"/>'), raw);
        expect(xml).toContain('android:pathData="M0 0h24v24H0z"');
        expect(xml).toContain('android:fillColor="#FFFF0000"');
    });

    it('defaults unfilled paths to black (SVG default)', () => {
        const { xml } = convert(svg('<path d="M0 0h1v1z"/>'), raw);
        expect(xml).toContain('android:fillColor="#FF000000"');
    });

    it('omits fill for fill="none"', () => {
        const { xml } = convert(svg('<path d="M0 0h1v1z" fill="none"/>'), raw);
        expect(xml).not.toContain('android:fillColor');
    });

    it('resolves named, rgb() and hsl() colors', () => {
        expect(convert(svg('<path d="M0 0z" fill="red"/>'), raw).xml).toContain('#FFFF0000');
        expect(convert(svg('<path d="M0 0z" fill="rgb(0,128,0)"/>'), raw).xml).toContain('#FF008000');
        expect(convert(svg('<path d="M0 0z" fill="hsl(240,100%,50%)"/>'), raw).xml).toContain('#FF0000FF');
    });

    it('substitutes currentColor', () => {
        const { xml } = convert(svg('<path d="M0 0z" fill="currentColor"/>'), {
            optimize: false,
            currentColor: '#112233',
        });
        expect(xml).toContain('android:fillColor="#FF112233"');
    });

    it('maps fill-rule="evenodd" to fillType', () => {
        const { xml } = convert(svg('<path d="M0 0z" fill="#000" fill-rule="evenodd"/>'), raw);
        expect(xml).toContain('android:fillType="evenOdd"');
    });
});

describe('shapes → path', () => {
    it('converts a <rect> with rounded corners', () => {
        const { xml } = convert(svg('<rect x="0" y="0" width="10" height="10" rx="2" fill="#000"/>'), raw);
        expect(xml).toContain('<path');
        expect(xml).toContain('android:pathData="M2,0');
    });

    it('converts a <circle>', () => {
        const { xml } = convert(svg('<circle cx="5" cy="5" r="4" fill="#000"/>'), raw);
        expect(xml).toMatch(/android:pathData="M1,5a4,4/);
    });
});

describe('gradients', () => {
    it('renders a linear gradient as an aapt block', () => {
        const { xml } = convert(
            svg(
                '<defs><linearGradient id="g" x1="0" y1="0" x2="24" y2="0" gradientUnits="userSpaceOnUse">' +
                    '<stop stop-color="#504E9C"/><stop offset="1" stop-color="#07B8D8"/></linearGradient></defs>' +
                    '<path d="M0 0h24v24H0z" fill="url(#g)"/>',
            ),
            raw,
        );
        expect(xml).toContain('xmlns:aapt="http://schemas.android.com/aapt"');
        expect(xml).toContain('android:type="linear"');
        expect(xml).toContain('android:startX="0"');
        expect(xml).toContain('android:endX="24"');
        expect(xml).toContain('android:color="#FF504E9C"');
        expect(xml).toContain('android:color="#FF07B8D8"');
        expect(xml).not.toContain('android:fillColor="#FF000000"');
    });

    it('bakes gradientTransform into a radial gradient (the svg2vectordrawable gap)', () => {
        const { xml } = convert(
            svg(
                '<defs><radialGradient id="r" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" ' +
                    'gradientTransform="translate(7 5) rotate(90) scale(28)">' +
                    '<stop stop-color="#fff"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>' +
                    '<path d="M0 0h24v24H0z" fill="url(#r)"/>',
            ),
            raw,
        );
        expect(xml).toContain('android:type="radial"');
        expect(xml).toContain('android:centerX="7"');
        expect(xml).toContain('android:centerY="5"');
        expect(xml).toContain('android:gradientRadius="28"');
        expect(xml).toContain('android:color="#FFFFFFFF"');
        expect(xml).toContain('android:color="#00000000"');
    });

    it('maps an objectBoundingBox gradient through the path bounding box', () => {
        const { xml } = convert(
            svg(
                '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>' +
                    '<path d="M0 0h10v10h-10z" fill="url(#g)"/>',
            ),
            raw,
        );
        // default objectBoundingBox: x2=1 maps to bbox width (10), x1=0 to 0
        expect(xml).toContain('android:type="linear"');
        expect(xml).toContain('android:startX="0"');
        expect(xml).toContain('android:endX="10"');
    });

    it('warns and falls back to black on a missing gradient', () => {
        const onWarn = vi.fn();
        const { xml } = convert(svg('<path d="M0 0z" fill="url(#nope)"/>'), { optimize: false, onWarn });
        expect(xml).toContain('android:fillColor="#FF000000"');
        expect(onWarn).toHaveBeenCalledWith(expect.objectContaining({ code: 'missing-gradient' }));
    });
});

describe('inheritance & groups', () => {
    it('inherits fill from a parent <g>', () => {
        const { xml } = convert(svg('<g fill="#f00"><path d="M0 0h1v1z"/></g>'), raw);
        expect(xml).toContain('android:fillColor="#FFFF0000"');
    });

    it('maps a <g transform> to an Android <group>', () => {
        const { xml } = convert(svg('<g transform="translate(2 3)"><path d="M0 0h1v1z" fill="#000"/></g>'), raw);
        expect(xml).toContain('<group');
        expect(xml).toContain('android:translateX="2"');
        expect(xml).toContain('android:translateY="3"');
    });

    it('inherits presentation attributes set on the <svg> root (Feather/Bootstrap style)', () => {
        const { xml } = convert(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
                '<path d="M2 12h20"/></svg>',
            { optimize: false, currentColor: '#123456' },
        );
        expect(xml).toContain('android:strokeColor="#FF123456"');
        expect(xml).toContain('android:strokeWidth="2"');
        expect(xml).toContain('android:strokeLineCap="round"');
        expect(xml).not.toContain('android:fillColor'); // fill="none" inherited from <svg>
    });

    it('resolves <use> references by inlining them', () => {
        const onWarn = vi.fn();
        const { xml } = convert(svg('<defs><path id="p" d="M0 0h8v8z"/></defs><use href="#p" fill="#0a0"/>'), {
            optimize: false,
            onWarn,
        });
        expect(xml).toContain('android:pathData="M0 0h8v8z"');
        expect(xml).toContain('android:fillColor="#FF00AA00"');
        expect(onWarn).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported-element' }));
    });

    it('bakes a sheared <g> transform into path geometry (no <group>)', () => {
        const onWarn = vi.fn();
        // matrix(1,0,0.5,1,0,0): x' = x + 0.5y → (0,10) becomes (5,10)
        const { xml } = convert(svg('<g transform="matrix(1,0,0.5,1,0,0)"><path d="M0 0L0 10" fill="#000"/></g>'), {
            optimize: false,
            onWarn,
        });
        expect(onWarn).toHaveBeenCalledWith(expect.objectContaining({ code: 'group-skew' }));
        expect(xml).not.toContain('<group');
        expect(xml).toMatch(/5[ ,]10/); // skewed endpoint baked into the path
    });

    it('folds opacity into fillAlpha', () => {
        const { xml } = convert(svg('<path d="M0 0z" fill="#000" opacity="0.5"/>'), raw);
        expect(xml).toContain('android:fillAlpha="0.5"');
    });
});

describe('fail-loud on unsupported', () => {
    it('warns on stroke-dasharray (not representable on a path)', () => {
        const onWarn = vi.fn();
        convert(svg('<path d="M0 0h10" stroke="#000" stroke-dasharray="4 2"/>'), { optimize: false, onWarn });
        expect(onWarn).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported-stroke-dasharray' }));
    });

    it('warns (non-strict) on <mask> and skips it', () => {
        const { xml, warnings } = convert(svg('<mask id="m"></mask><path d="M0 0z" fill="#000"/>'), raw);
        expect(warnings.some((w) => w.code === 'unsupported-element')).toBe(true);
        expect(xml).toContain('android:pathData="M0 0z"');
    });

    it('throws in strict mode', () => {
        expect(() => convert(svg('<text>hi</text>'), { optimize: false, strict: true })).toThrow();
    });
});

describe('options parity (xmlTag, tint)', () => {
    it('prepends an XML declaration with xmlTag', () => {
        const { xml } = convert(svg('<path d="M0 0z" fill="#000"/>'), { optimize: false, xmlTag: true });
        expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    });

    it('adds android:tint (Android color, verbatim) to the vector', () => {
        const { xml } = convert(svg('<path d="M0 0z" fill="#000"/>'), { optimize: false, tint: '#80FF0000' });
        expect(xml).toContain('android:tint="#80FF0000"');
    });
});

describe('end-to-end with svgo normalization', () => {
    it('converts shapes+styles via svgo and keeps the gradient', () => {
        const { xml } = convert(
            svg(
                '<style>.a{fill:#0a0}</style><rect class="a" x="0" y="0" width="8" height="8"/>' +
                    '<defs><linearGradient id="g" x1="0" y1="0" x2="24" y2="0" gradientUnits="userSpaceOnUse">' +
                    '<stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>' +
                    '<path d="M0 0h24v24H0z" fill="url(#g)"/>',
            ),
        );
        expect(xml).toContain('<vector');
        expect(xml).toContain('android:type="linear"');
        // the styled rect became a filled path
        expect(xml).toMatch(/android:fillColor="#FF00AA00"/i);
    });
});
