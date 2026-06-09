import { describe, expect, it } from 'vitest';
import { resolveUses } from '../src/useResolver.js';
import type { XastElement } from '../src/gradient.js';

const el = (name: string, attributes: Record<string, string> = {}, children: XastElement[] = []): XastElement => ({
    type: 'element',
    name,
    attributes,
    children,
});

const root = (children: XastElement[]): XastElement => ({ type: 'root', children });

/** Returns the single child of a parent, asserting it is the only one (keeps tests readable). */
const onlyChild = (node: XastElement): XastElement => {
    expect(node.children).toHaveLength(1);
    const child = node.children?.[0];
    expect(child).toBeDefined();
    return child as XastElement;
};

describe('resolveUses', () => {
    it('replaces a <use href="#id"> with a <g> wrapping a deep clone of the target', () => {
        const path = el('path', { id: 'p', d: 'M0 0h8v8z' });
        const tree = root([
            el('svg', {}, [el('defs', {}, [path]), el('use', { href: '#p', fill: '#0a0', x: '2', y: '3' })]),
        ]);

        resolveUses(tree);

        const svg = onlyChild(tree);
        const defs = svg.children?.[0];
        const replaced = svg.children?.[1];

        // The <use> became a <g>…
        expect(replaced?.name).toBe('g');
        expect(replaced?.attributes?.fill).toBe('#0a0');
        expect(replaced?.attributes?.transform).toContain('translate(2 3)');
        expect(replaced?.attributes?.href).toBeUndefined();
        expect(replaced?.attributes?.x).toBeUndefined();
        expect(replaced?.attributes?.y).toBeUndefined();

        // …whose child is a clone of the path (same data, distinct object).
        const cloned = onlyChild(replaced as XastElement);
        expect(cloned.name).toBe('path');
        expect(cloned.attributes?.d).toBe('M0 0h8v8z');
        expect(cloned).not.toBe(path);

        // The original path inside <defs> is untouched (cloned, not moved).
        expect(defs?.name).toBe('defs');
        expect(defs?.children?.[0]).toBe(path);
        expect(path.attributes?.d).toBe('M0 0h8v8z');
    });

    it('supports the legacy xlink:href attribute', () => {
        const tree = root([
            el('svg', {}, [
                el('defs', {}, [el('rect', { id: 'r', width: '4', height: '4' })]),
                el('use', { 'xlink:href': '#r' }),
            ]),
        ]);

        resolveUses(tree);

        const svg = onlyChild(tree);
        const replaced = svg.children?.[1];
        expect(replaced?.name).toBe('g');
        expect(onlyChild(replaced as XastElement).name).toBe('rect');
    });

    it('treats a <symbol> target as a group (clones it but renames to g)', () => {
        const tree = root([
            el('svg', {}, [
                el('defs', {}, [el('symbol', { id: 's' }, [el('path', { d: 'M0 0z' })])]),
                el('use', { href: '#s' }),
            ]),
        ]);

        resolveUses(tree);

        const svg = onlyChild(tree);
        const wrapper = svg.children?.[1];
        expect(wrapper?.name).toBe('g'); // the wrapping group

        const symbolAsGroup = onlyChild(wrapper as XastElement);
        expect(symbolAsGroup.name).toBe('g'); // symbol renamed to g
        expect(onlyChild(symbolAsGroup).name).toBe('path');
    });

    it('leaves a <use> with a missing reference untouched', () => {
        const use = el('use', { href: '#missing' });
        const tree = root([el('svg', {}, [use])]);

        resolveUses(tree);

        const svg = onlyChild(tree);
        const child = svg.children?.[0];
        expect(child).toBe(use); // same node, not replaced
        expect(child?.name).toBe('use');
        expect(child?.attributes?.href).toBe('#missing');
    });

    it('leaves a <use> with a non-fragment href untouched', () => {
        const use = el('use', { href: 'other.svg#p' });
        const tree = root([el('svg', {}, [use])]);

        resolveUses(tree);

        expect(onlyChild(onlyChild(tree))).toBe(use);
    });

    it('does not loop forever when a target transitively references itself', () => {
        // <g id="a"> contains <use href="#b">, and <g id="b"> contains <use href="#a">.
        const tree = root([
            el('svg', {}, [
                el('defs', {}, [
                    el('g', { id: 'a' }, [el('use', { href: '#b' })]),
                    el('g', { id: 'b' }, [el('use', { href: '#a' })]),
                ]),
                el('use', { href: '#a' }),
            ]),
        ]);

        // The assertion that matters is simply that this returns (no stack overflow / hang).
        expect(() => resolveUses(tree)).not.toThrow();

        const svg = onlyChild(tree);
        const top = svg.children?.[1];
        expect(top?.name).toBe('g');
    });

    it('composes the use transform before the x/y translate', () => {
        const tree = root([
            el('svg', {}, [
                el('defs', {}, [el('path', { id: 'p', d: 'M0 0z' })]),
                el('use', { href: '#p', transform: 'rotate(45)', x: '1', y: '2' }),
            ]),
        ]);

        resolveUses(tree);

        const replaced = onlyChild(tree).children?.[1];
        expect(replaced?.attributes?.transform).toBe('rotate(45) translate(1 2)');
    });

    it('keeps <defs> in the tree after resolution', () => {
        const tree = root([
            el('svg', {}, [el('defs', {}, [el('path', { id: 'p', d: 'M0 0z' })]), el('use', { href: '#p' })]),
        ]);

        resolveUses(tree);

        const svg = onlyChild(tree);
        expect(svg.children?.some((c) => c.name === 'defs')).toBe(true);
    });
});
