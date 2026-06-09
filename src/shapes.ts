type Attrs = Record<string, string>;

const n = (attrs: Attrs, key: string, fallback = 0): number => {
    const v = attrs[key];
    if (v === undefined) return fallback;
    const parsed = parseFloat(v);
    return Number.isNaN(parsed) ? fallback : parsed;
};

/**
 * Converts a basic SVG shape element to path data, so the rest of the pipeline only deals with
 * `<path>`. svgo's `convertShapeToPath` normally does this upstream; this keeps us correct even
 * when normalization is disabled. Returns null for shapes we cannot express (or empty geometry).
 */
export function shapeToPathData(name: string, attrs: Attrs): string | null {
    switch (name) {
        case 'rect': {
            const w = n(attrs, 'width');
            const h = n(attrs, 'height');
            if (w <= 0 || h <= 0) return null;
            const x = n(attrs, 'x');
            const y = n(attrs, 'y');
            let rx = attrs.rx !== undefined ? n(attrs, 'rx') : n(attrs, 'ry');
            let ry = attrs.ry !== undefined ? n(attrs, 'ry') : n(attrs, 'rx');
            rx = Math.min(Math.max(rx, 0), w / 2);
            ry = Math.min(Math.max(ry, 0), h / 2);
            if (rx > 0 || ry > 0) {
                return (
                    `M${x + rx},${y}h${w - 2 * rx}a${rx},${ry} 0 0 1 ${rx},${ry}` +
                    `v${h - 2 * ry}a${rx},${ry} 0 0 1 ${-rx},${ry}h${-(w - 2 * rx)}` +
                    `a${rx},${ry} 0 0 1 ${-rx},${-ry}v${-(h - 2 * ry)}a${rx},${ry} 0 0 1 ${rx},${-ry}z`
                );
            }
            return `M${x},${y}h${w}v${h}h${-w}z`;
        }
        case 'circle': {
            const r = n(attrs, 'r');
            if (r <= 0) return null;
            const cx = n(attrs, 'cx');
            const cy = n(attrs, 'cy');
            return `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0z`;
        }
        case 'ellipse': {
            const rx = n(attrs, 'rx');
            const ry = n(attrs, 'ry');
            if (rx <= 0 || ry <= 0) return null;
            const cx = n(attrs, 'cx');
            const cy = n(attrs, 'cy');
            return `M${cx - rx},${cy}a${rx},${ry} 0 1 0 ${2 * rx},0a${rx},${ry} 0 1 0 ${-2 * rx},0z`;
        }
        case 'line':
            return `M${n(attrs, 'x1')},${n(attrs, 'y1')}L${n(attrs, 'x2')},${n(attrs, 'y2')}`;
        case 'polyline':
        case 'polygon': {
            const pts = (attrs.points ?? '')
                .trim()
                .split(/[\s,]+/)
                .map(Number)
                .filter((v) => !Number.isNaN(v));
            if (pts.length < 4) return null;
            let d = `M${pts[0]},${pts[1]}`;
            for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]},${pts[i + 1]}`;
            return name === 'polygon' ? d + 'z' : d;
        }
        default:
            return null;
    }
}

export const SHAPE_NAMES = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
