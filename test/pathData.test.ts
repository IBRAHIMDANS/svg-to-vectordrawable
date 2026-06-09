import { describe, expect, it } from 'vitest';
import { pathBBox, transformPathData } from '../src/pathData.js';
import { IDENTITY, type Matrix } from '../src/transform.js';

/** Extracts all numbers from a path string, for tolerant coordinate assertions. */
function nums(d: string): number[] {
    return (d.match(/-?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
}

/** The (x, y) of the very last coordinate pair in a path string. */
function lastPoint(d: string): [number, number] {
    const n = nums(d);
    expect(n.length).toBeGreaterThanOrEqual(2);
    return [n[n.length - 2]!, n[n.length - 1]!];
}

describe('pathBBox', () => {
    it('computes the bbox of a simple closed rectangle', () => {
        expect(pathBBox('M0 0h10v10z')).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    });

    it('handles absolute commands and negative coordinates', () => {
        expect(pathBBox('M-5 -5 L5 5')).toEqual({ x: -5, y: -5, width: 10, height: 10 });
    });

    it('widens the bbox to include cubic Bézier control points', () => {
        // End points stay within x:[0,10] y:0, but control point pulls y up to 20 and x to 15.
        const box = pathBBox('M0 0 C5 20 15 20 10 0');
        expect(box).not.toBeNull();
        expect(box!.x).toBe(0);
        expect(box!.y).toBe(0);
        // Max X is the second control point at x=15 → width 15.
        expect(box!.width).toBe(15);
        // Max Y is the control points at y=20 → height 20.
        expect(box!.height).toBe(20);
    });

    it('includes quadratic control points too', () => {
        const box = pathBBox('M0 0 Q10 -8 20 0');
        expect(box).not.toBeNull();
        expect(box!.y).toBe(-8);
        expect(box!.width).toBe(20);
    });

    it('tracks the endpoint of an arc', () => {
        const box = pathBBox('M0 0 A5 5 0 0 1 10 0');
        expect(box).not.toBeNull();
        expect(box!.width).toBeCloseTo(10, 5);
    });

    it('returns null for an empty path', () => {
        expect(pathBBox('')).toBeNull();
    });

    it('returns null for an invalid / non-geometric path', () => {
        expect(pathBBox('not a path at all')).toBeNull();
        expect(pathBBox('   ')).toBeNull();
    });
});

describe('transformPathData', () => {
    it('scales coordinates by a diagonal matrix', () => {
        const out = transformPathData('M0 0L10 0', { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
        // Expect M0 0 then L20 0.
        expect(nums(out)).toEqual([0, 0, 20, 0]);
        expect(out).toContain('L20 0');
    });

    it('applies a translation via e/f', () => {
        const out = transformPathData('M0 0L10 0', { a: 1, b: 0, c: 0, d: 1, e: 5, f: 7 });
        expect(nums(out)).toEqual([5, 7, 15, 7]);
    });

    it('normalizes relative commands and H/V to absolute L', () => {
        const out = transformPathData('M0 0h10v10', IDENTITY);
        // h10 → L10 0, v10 → L10 10 (current x preserved).
        expect(nums(out)).toEqual([0, 0, 10, 0, 10, 10]);
        expect(out).not.toMatch(/[hvHV]/);
    });

    it('preserves geometry under the identity matrix (no arc)', () => {
        const out = transformPathData('M1 2 L3 4 C5 6 7 8 9 10 Z', IDENTITY);
        expect(nums(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(out.trim().endsWith('Z')).toBe(true);
    });

    it('rounds to 3 decimals and trims trailing zeros', () => {
        const out = transformPathData('M0 0 L1 1', { a: 2.5, b: 0, c: 0, d: 2, e: 0, f: 0 });
        // x: 1*2.5 = 2.5 (kept), y: 1*2 = 2 (no ".000").
        expect(out).toContain('L2.5 2');
        expect(out).not.toContain('2.500');
        expect(out).not.toContain('2.000');
    });

    it('converts an arc to cubics, producing a valid non-empty path ending near the arc endpoint', () => {
        const out = transformPathData('M0 0A5 5 0 0 1 10 0', IDENTITY);
        expect(out.length).toBeGreaterThan(0);
        // Arc must be lowered to cubics: no A command remains.
        expect(out).not.toMatch(/[aA]/);
        expect(out).toMatch(/C/);
        const [lx, ly] = lastPoint(out);
        expect(lx).toBeCloseTo(10, 1);
        expect(Math.abs(ly)).toBeLessThanOrEqual(0.5);
    });

    it('still maps arc-derived cubics through the matrix', () => {
        const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 100, f: 0 };
        const out = transformPathData('M0 0A5 5 0 0 1 10 0', m);
        const [lx] = lastPoint(out);
        // Endpoint (10,0) translated by +100 in x.
        expect(lx).toBeCloseTo(110, 1);
    });
});
