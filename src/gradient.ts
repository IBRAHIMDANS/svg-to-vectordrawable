import { toAndroidColor } from './color.js';
import { applyPoint, IDENTITY, multiply, parseTransform, scaleFactor, type Matrix } from './transform.js';
import type { Warning } from './types.js';

export interface XastElement {
    type: string;
    name?: string;
    attributes?: Record<string, string>;
    children?: XastElement[];
}

export interface Viewport {
    width: number;
    height: number;
}

export interface BBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

type TileMode = 'clamp' | 'repeated' | 'mirror';
const SPREAD: Record<string, TileMode> = { pad: 'clamp', repeat: 'repeated', reflect: 'mirror' };

/** A gradient as declared in the SVG, before resolving against a viewport or path bounding box. */
export interface RawGradient {
    type: 'linear' | 'radial';
    /** true for gradientUnits="objectBoundingBox" (the SVG default). */
    objectBox: boolean;
    attrs: Record<string, string>;
    matrix: Matrix | null;
    stops: { offset: number; color: string }[];
    tileMode?: TileMode;
}

/** A gradient with Android coordinates computed, ready to render. */
export interface ResolvedGradient {
    type: 'linear' | 'radial';
    coords: Record<string, number>;
    stops: { offset: number; color: string }[];
    tileMode?: TileMode;
}

const round = (v: number, p: number): number => {
    const f = 10 ** p;
    return Math.round(v * f) / f;
};

/** Parses a coordinate (number or percentage). Percentages are taken relative to `ref`. */
function coord(value: string | undefined, fallback: number, ref: number): number {
    if (value === undefined) return fallback;
    const v = value.trim();
    if (v.endsWith('%')) return (parseFloat(v) / 100) * ref;
    const n = parseFloat(v);
    return Number.isNaN(n) ? fallback : n;
}

/**
 * Builds the gradient lookup, resolving `href`/`xlink:href` inheritance (shared stops/attributes).
 * Coordinates are kept raw; placement happens in {@link resolveGradient} so objectBoundingBox
 * gradients can use the filled path's bounding box.
 */
export function collectGradients(
    gradientEls: XastElement[],
    currentColor: string,
    // Kept for call-site symmetry with resolveGradient; collection itself never warns.
    _warn: (w: Warning) => void,
): Map<string, RawGradient> {
    const byId = new Map<string, XastElement>();
    for (const el of gradientEls) {
        const id = el.attributes?.id;
        if (id) byId.set(id, el);
    }
    const attrsOf = (el: XastElement, seen = 0): Record<string, string> => {
        const href = el.attributes?.href ?? el.attributes?.['xlink:href'];
        const parent = seen < 10 && href?.startsWith('#') ? byId.get(href.slice(1)) : undefined;
        return { ...(parent ? attrsOf(parent, seen + 1) : {}), ...el.attributes };
    };
    const stopsOf = (el: XastElement, seen = 0): XastElement[] => {
        const own = (el.children ?? []).filter((c) => c.name === 'stop');
        if (own.length) return own;
        const href = el.attributes?.href ?? el.attributes?.['xlink:href'];
        const parent = seen < 10 && href?.startsWith('#') ? byId.get(href.slice(1)) : undefined;
        return parent ? stopsOf(parent, seen + 1) : [];
    };

    const out = new Map<string, RawGradient>();
    for (const el of gradientEls) {
        const id = el.attributes?.id;
        if (!id) continue;
        const a = attrsOf(el);
        const stops = stopsOf(el)
            .map((s) => {
                const off = s.attributes?.offset ?? '0';
                const offset = off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off);
                const color = toAndroidColor(
                    s.attributes?.['stop-color'] ?? '#000',
                    s.attributes?.['stop-opacity'] !== undefined ? parseFloat(s.attributes['stop-opacity']) : undefined,
                    currentColor,
                );
                return color ? { offset: Number.isNaN(offset) ? 0 : offset, color } : null;
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);
        if (stops.length === 0) continue;

        const tileMode = a.spreadMethod ? SPREAD[a.spreadMethod] : undefined;
        out.set(id, {
            type: el.name === 'radialGradient' ? 'radial' : 'linear',
            objectBox: (a.gradientUnits ?? 'objectBoundingBox') !== 'userSpaceOnUse',
            attrs: a,
            matrix: parseTransform(a.gradientTransform),
            stops,
            ...(tileMode ? { tileMode } : {}),
        });
    }
    return out;
}

/**
 * Computes Android gradient coordinates. For `userSpaceOnUse`, coordinates are viewport-relative.
 * For `objectBoundingBox` (the SVG default), the unit square is mapped through the path's bounding
 * box — falling back to the viewport (with a warning) when the box is unavailable.
 */
export function resolveGradient(
    g: RawGradient,
    bbox: BBox | null,
    viewport: Viewport,
    precision: number,
    warn: (w: Warning) => void,
): ResolvedGradient {
    let base: Matrix;
    let refW: number;
    let refH: number;
    let refD: number;

    if (g.objectBox) {
        const bb = bbox ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
        if (!bbox)
            warn({
                code: 'gradient-bbox-unavailable',
                message:
                    'objectBoundingBox gradient could not use the path bounding box; approximated to the viewport.',
            });
        // unit square → bounding box, then the gradient's own transform inside the unit square
        base = multiply({ a: bb.width, b: 0, c: 0, d: bb.height, e: bb.x, f: bb.y }, g.matrix ?? IDENTITY);
        refW = 1;
        refH = 1;
        refD = Math.SQRT2 / 2; // diagonal of the unit square, per SVG (sqrt(2)/2)
    } else {
        base = g.matrix ?? IDENTITY;
        refW = viewport.width;
        refH = viewport.height;
        refD = Math.hypot(refW, refH) / Math.SQRT2;
    }

    const a = g.attrs;
    const scale = scaleFactor(base);
    if (g.type === 'radial') {
        const cx = coord(a.cx, 0.5 * refW, refW);
        const cy = coord(a.cy, 0.5 * refH, refH);
        const r = coord(a.r, 0.5 * refD, refD);
        const [centerX, centerY] = applyPoint(base, cx, cy);
        return {
            type: 'radial',
            coords: {
                centerX: round(centerX, precision),
                centerY: round(centerY, precision),
                gradientRadius: round(r * scale, precision),
            },
            stops: g.stops,
            ...(g.tileMode ? { tileMode: g.tileMode } : {}),
        };
    }
    const x1 = coord(a.x1, 0, refW);
    const y1 = coord(a.y1, 0, refH);
    const x2 = coord(a.x2, refW, refW);
    const y2 = coord(a.y2, 0, refH);
    const [sx, sy] = applyPoint(base, x1, y1);
    const [ex, ey] = applyPoint(base, x2, y2);
    return {
        type: 'linear',
        coords: {
            startX: round(sx, precision),
            startY: round(sy, precision),
            endX: round(ex, precision),
            endY: round(ey, precision),
        },
        stops: g.stops,
        ...(g.tileMode ? { tileMode: g.tileMode } : {}),
    };
}

/** Renders a resolved gradient as an `<aapt:attr name="android:fillColor">` block. */
export function renderGradient(g: ResolvedGradient, pad: string, step: string): string {
    const inner = pad + step + step;
    const coordLines = Object.entries(g.coords)
        .map(([k, v]) => `${inner + step}android:${k}="${v}"`)
        .join('\n');
    const tile = g.tileMode ? `\n${inner + step}android:tileMode="${g.tileMode}"` : '';
    const items = g.stops
        .map((s) => `${inner + step}<item android:offset="${s.offset}" android:color="${s.color}" />`)
        .join('\n');
    return (
        `${pad + step}<aapt:attr name="android:fillColor">\n` +
        `${inner}<gradient\n${coordLines}\n${inner + step}android:type="${g.type}"${tile}>\n` +
        `${items}\n` +
        `${inner}</gradient>\n` +
        `${pad + step}</aapt:attr>`
    );
}
