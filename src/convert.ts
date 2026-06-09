import { toAndroidColor } from './color.js';
import { collectGradients, renderGradient, resolveGradient, type RawGradient, type XastElement } from './gradient.js';
import { parseSvg } from './normalize.js';
import { pathBBox, transformPathData } from './pathData.js';
import { resolveUses } from './useResolver.js';
import { shapeToPathData, SHAPE_NAMES } from './shapes.js';
import { decompose, IDENTITY, multiply, parseTransform, type Matrix } from './transform.js';
import type { ConvertOptions, ConvertResult, Warning } from './types.js';

const UNSUPPORTED = new Set(['mask', 'filter', 'pattern', 'image', 'text', 'foreignObject', 'marker', 'switch']);
const SKIP = new Set([
    'defs',
    'symbol',
    'metadata',
    'title',
    'desc',
    'style',
    'linearGradient',
    'radialGradient',
    'clipPath',
]);

/** Escapes characters that would break an XML attribute value. */
const escapeXml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Inherited {
    fill?: string;
    fillOpacity: number;
    fillRule?: string;
    stroke?: string;
    strokeOpacity: number;
    strokeWidth?: string;
    strokeLinecap?: string;
    strokeLinejoin?: string;
    strokeMiterlimit?: string;
    color: string;
    opacityMul: number;
}

const INHERITABLE = [
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-opacity',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'color',
] as const;

function parseStyle(style: string | undefined): Record<string, string> {
    if (!style) return {};
    const out: Record<string, string> = {};
    for (const decl of style.split(';')) {
        const i = decl.indexOf(':');
        if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
    }
    return out;
}

function num(value: string, precision: number): string {
    const f = 10 ** precision;
    return String(Math.round(parseFloat(value) * f) / f);
}

function collectByName(node: XastElement, names: Set<string>, out: XastElement[]): void {
    for (const child of node.children ?? []) {
        if (child.type === 'element') {
            if (child.name && names.has(child.name)) out.push(child);
            collectByName(child, names, out);
        }
    }
}

export function convert(svg: string, options: ConvertOptions = {}): ConvertResult {
    const {
        optimize = true,
        svgoConfig,
        floatPrecision = 3,
        currentColor = '#000000',
        fillBlackForUnfilled = true,
        strict = false,
        indent = 4,
        xmlTag = false,
        tint,
        onWarn,
    } = options;

    const warnings: Warning[] = [];
    const warn = (w: Warning): void => {
        if (strict) throw new Error(`[${w.code}] ${w.message}`);
        warnings.push(w);
        onWarn?.(w);
    };

    const root = parseSvg(svg, optimize, svgoConfig);
    resolveUses(root); // inline <use> references so the walker sees concrete geometry
    const svgEl = (root.children ?? []).find((c) => c.type === 'element' && c.name === 'svg');
    if (!svgEl) throw new Error('No <svg> root element found');

    const a = svgEl.attributes ?? {};
    let viewBox = a.viewBox?.trim();
    let vbParts = viewBox ? viewBox.split(/[\s,]+/).map(Number) : [];
    if (vbParts.length !== 4 || vbParts.some(Number.isNaN)) {
        const w = parseFloat(a.width ?? '') || 24;
        const h = parseFloat(a.height ?? '') || 24;
        vbParts = [0, 0, w, h];
        viewBox = undefined;
    }
    const [, , vpW, vpH] = vbParts as [number, number, number, number];
    const width = parseFloat(a.width ?? '') || vpW || 24;
    const height = parseFloat(a.height ?? '') || vpH || 24;

    const gradientEls: XastElement[] = [];
    collectByName(svgEl, new Set(['linearGradient', 'radialGradient']), gradientEls);
    const gradients = collectGradients(gradientEls, currentColor, warn);

    const clipEls: XastElement[] = [];
    collectByName(svgEl, new Set(['clipPath']), clipEls);
    const clipPaths = new Map<string, string>();
    for (const clip of clipEls) {
        const id = clip.attributes?.id;
        if (!id) continue;
        const d = (clip.children ?? [])
            .map((c) =>
                c.name === 'path'
                    ? c.attributes?.d
                    : SHAPE_NAMES.has(c.name ?? '')
                      ? shapeToPathData(c.name!, c.attributes ?? {})
                      : null,
            )
            .filter(Boolean)
            .join('');
        if (d) clipPaths.set(id, d);
    }

    const step = ' '.repeat(indent);
    let usesGradient = false;

    const resolveStyle = (el: XastElement, parent: Inherited): Inherited => {
        const attrs = el.attributes ?? {};
        const style = parseStyle(attrs.style);
        const get = (name: string): string | undefined => style[name] ?? attrs[name];
        const next: Inherited = { ...parent };
        for (const prop of INHERITABLE) {
            const v = get(prop);
            if (v === undefined) continue;
            if (prop === 'fill') next.fill = v;
            else if (prop === 'fill-opacity') next.fillOpacity = parseFloat(v);
            else if (prop === 'fill-rule') next.fillRule = v;
            else if (prop === 'stroke') next.stroke = v;
            else if (prop === 'stroke-opacity') next.strokeOpacity = parseFloat(v);
            else if (prop === 'stroke-width') next.strokeWidth = v;
            else if (prop === 'stroke-linecap') next.strokeLinecap = v;
            else if (prop === 'stroke-linejoin') next.strokeLinejoin = v;
            else if (prop === 'stroke-miterlimit') next.strokeMiterlimit = v;
            else if (prop === 'color') next.color = v;
        }
        const op = get('opacity');
        next.opacityMul = parent.opacityMul * (op !== undefined ? parseFloat(op) : 1);
        return next;
    };

    const emitPath = (d: string, el: XastElement, style: Inherited, pad: string, bake?: Matrix): string => {
        const attrs = el.attributes ?? {};
        const pd = bake ? transformPathData(d, bake) : d;
        const lines: string[] = [`${pad}<path`, `${pad}${step}android:pathData="${escapeXml(pd)}"`];
        let gradientChild: string | null = null;

        const fillRaw = style.fill ?? (fillBlackForUnfilled ? '#000000' : 'none');
        const urlMatch = /^url\(#([^)]+)\)/.exec(fillRaw.trim());
        if (urlMatch) {
            const raw: RawGradient | undefined = gradients.get(urlMatch[1]!);
            if (raw) {
                if (bake)
                    warn({
                        code: 'gradient-under-skew',
                        message: 'Gradient under a skewed/baked group may be imprecisely placed.',
                        node: 'path',
                    });
                const bbox = raw.objectBox ? pathBBox(pd) : null;
                const resolved = resolveGradient(raw, bbox, { width: vpW, height: vpH }, floatPrecision, warn);
                gradientChild = renderGradient(resolved, pad, step);
                usesGradient = true;
            } else {
                warn({
                    code: 'missing-gradient',
                    message: `Path references unknown gradient "${urlMatch[1]}"; using black.`,
                    node: 'path',
                });
                lines.push(`${pad}${step}android:fillColor="#FF000000"`);
            }
        } else if (fillRaw.trim().toLowerCase() !== 'none') {
            const color = toAndroidColor(fillRaw, undefined, style.color);
            if (color) lines.push(`${pad}${step}android:fillColor="${color}"`);
        }

        const fillAlpha = style.fillOpacity * style.opacityMul;
        if (fillAlpha < 1) lines.push(`${pad}${step}android:fillAlpha="${Math.max(fillAlpha, 0)}"`);

        if (style.fillRule === 'evenodd') lines.push(`${pad}${step}android:fillType="evenOdd"`);

        if (style.stroke && style.stroke.trim().toLowerCase() !== 'none') {
            const dash = parseStyle(attrs.style)['stroke-dasharray'] ?? attrs['stroke-dasharray'];
            if (dash && dash.trim().toLowerCase() !== 'none')
                warn({
                    code: 'unsupported-stroke-dasharray',
                    message: 'stroke-dasharray is not representable on a VectorDrawable path; ignored.',
                    node: 'path',
                });
            if (/^url\(/.test(style.stroke.trim())) {
                warn({
                    code: 'unsupported-stroke-gradient',
                    message: 'Gradient strokes are not supported by VectorDrawable; stroke dropped.',
                    node: 'path',
                });
            } else {
                const sc = toAndroidColor(style.stroke, undefined, style.color);
                if (sc) {
                    lines.push(`${pad}${step}android:strokeColor="${sc}"`);
                    lines.push(`${pad}${step}android:strokeWidth="${num(style.strokeWidth ?? '1', floatPrecision)}"`);
                    const sa = style.strokeOpacity * style.opacityMul;
                    if (sa < 1) lines.push(`${pad}${step}android:strokeAlpha="${Math.max(sa, 0)}"`);
                    if (style.strokeLinecap === 'round' || style.strokeLinecap === 'square')
                        lines.push(`${pad}${step}android:strokeLineCap="${style.strokeLinecap}"`);
                    if (
                        style.strokeLinejoin === 'round' ||
                        style.strokeLinejoin === 'bevel' ||
                        style.strokeLinejoin === 'miter'
                    )
                        lines.push(`${pad}${step}android:strokeLineJoin="${style.strokeLinejoin}"`);
                    if (style.strokeMiterlimit)
                        lines.push(
                            `${pad}${step}android:strokeMiterLimit="${num(style.strokeMiterlimit, floatPrecision)}"`,
                        );
                }
            }
        }

        const clipD = clipRef(attrs);
        const clip = clipD && bake ? transformPathData(clipD, bake) : clipD;
        const body = gradientChild ? `${lines.join('\n')}>\n${gradientChild}\n${pad}</path>` : `${lines.join('\n')} />`;
        return clip ? wrapClip(clip, body, pad) : body;
    };

    const clipRef = (attrs: Record<string, string>): string | null => {
        const m = /^url\(#([^)]+)\)/.exec((attrs['clip-path'] ?? '').trim());
        if (!m) return null;
        const d = clipPaths.get(m[1]!);
        if (!d) {
            warn({ code: 'missing-clip-path', message: `Unknown clip-path "${m[1]}"; ignored.`, node: 'clip-path' });
            return null;
        }
        return d;
    };

    const wrapClip = (d: string, body: string, pad: string): string =>
        `${pad}<group>\n${pad}${step}<clip-path android:pathData="${escapeXml(d)}" />\n${body.replace(/^/gm, step)}\n${pad}</group>`;

    const r = (v: number): string => String(Math.round(v * 10 ** floatPrecision) / 10 ** floatPrecision);

    const walk = (el: XastElement, parent: Inherited, pad: string, bake?: Matrix): string => {
        const out: string[] = [];
        for (const child of el.children ?? []) {
            if (child.type !== 'element' || !child.name) continue;
            const name = child.name;
            if (SKIP.has(name)) continue;
            if (UNSUPPORTED.has(name)) {
                warn({
                    code: 'unsupported-element',
                    message: `<${name}> cannot be represented in a VectorDrawable; skipped.`,
                    node: name,
                });
                continue;
            }
            const style = resolveStyle(child, parent);

            if (name === 'g') {
                const matrix = parseTransform(child.attributes?.transform);
                if (matrix) {
                    const dec = decompose(matrix);
                    // A sheared transform (or any transform nested under a baked one) can't be an
                    // Android <group>; bake the matrix into descendant geometry instead.
                    if (bake || dec.hasSkew) {
                        if (dec.hasSkew && !bake)
                            warn({
                                code: 'group-skew',
                                message: 'A <g> uses skew/shear; baking the transform into path geometry.',
                                node: 'g',
                            });
                        const inner = walk(child, style, pad, multiply(bake ?? IDENTITY, matrix));
                        if (inner.trim()) out.push(inner);
                    } else {
                        const inner = walk(child, style, pad + step);
                        if (inner.trim()) {
                            const attrs: string[] = [];
                            if (Math.abs(dec.translateX) > 1e-6)
                                attrs.push(`${pad}${step}android:translateX="${r(dec.translateX)}"`);
                            if (Math.abs(dec.translateY) > 1e-6)
                                attrs.push(`${pad}${step}android:translateY="${r(dec.translateY)}"`);
                            if (Math.abs(dec.rotation) > 1e-6)
                                attrs.push(`${pad}${step}android:rotation="${r(dec.rotation)}"`);
                            if (Math.abs(dec.scaleX - 1) > 1e-6)
                                attrs.push(`${pad}${step}android:scaleX="${r(dec.scaleX)}"`);
                            if (Math.abs(dec.scaleY - 1) > 1e-6)
                                attrs.push(`${pad}${step}android:scaleY="${r(dec.scaleY)}"`);
                            const head = attrs.length ? `${pad}<group\n${attrs.join('\n')}>` : `${pad}<group>`;
                            out.push(`${head}\n${inner}\n${pad}</group>`);
                        }
                    }
                } else {
                    const inner = walk(child, style, pad, bake);
                    if (inner.trim()) out.push(inner);
                }
                continue;
            }

            let d: string | null = null;
            if (name === 'path') d = child.attributes?.d ?? null;
            else if (SHAPE_NAMES.has(name)) d = shapeToPathData(name, child.attributes ?? {});

            if (d) out.push(emitPath(d, child, style, pad, bake));
            else if (name !== 'use')
                warn({ code: 'empty-path', message: `<${name}> produced no drawable geometry; skipped.`, node: name });
            else
                warn({
                    code: 'unsupported-element',
                    message: '<use> references are not resolved; skipped.',
                    node: 'use',
                });
        }
        return out.join('\n');
    };

    const rootStyle: Inherited = { fillOpacity: 1, strokeOpacity: 1, color: currentColor, opacityMul: 1 };
    // Presentation attributes (fill/stroke/stroke-width…) set on the <svg> element itself are
    // inherited by its children (e.g. Feather/Bootstrap icons put stroke/fill on the root).
    const baseStyle = resolveStyle(svgEl, rootStyle);
    const body = walk(svgEl, baseStyle, step);

    const aapt = usesGradient ? `\n${step}xmlns:aapt="http://schemas.android.com/aapt"` : '';
    // tint is an Android color literal (#AARRGGBB), not an SVG color — pass it through verbatim.
    const tintLine = tint ? `\n${step}android:tint="${tint.trim()}"` : '';
    const decl = xmlTag ? '<?xml version="1.0" encoding="utf-8"?>\n' : '';
    const xml =
        decl +
        `<vector xmlns:android="http://schemas.android.com/apk/res/android"${aapt}${tintLine}\n` +
        `${step}android:width="${num(String(width), floatPrecision)}dp"\n` +
        `${step}android:height="${num(String(height), floatPrecision)}dp"\n` +
        `${step}android:viewportWidth="${num(String(vpW), floatPrecision)}"\n` +
        `${step}android:viewportHeight="${num(String(vpH), floatPrecision)}">\n` +
        `${body}\n` +
        `</vector>\n`;

    return { xml, warnings };
}
