import type { XastElement } from './gradient.js';

/**
 * Resolves `<use>` references in an SVG AST so the rest of the pipeline only ever sees concrete
 * geometry. svgo's `removeUselessDefs` / `inlineStyles` do not expand `<use>`, and a VectorDrawable
 * has no equivalent of "instance a symbol", so we inline each referenced subtree by hand.
 */

/** Max nesting of `<use>` → `<use>` we expand before giving up (guards against reference cycles). */
const MAX_DEPTH = 10;

/** Attributes consumed by `<use>` itself; they must not leak onto the inlined group as presentation. */
const USE_GEOMETRY_ATTRS = new Set(['href', 'xlink:href', 'x', 'y', 'width', 'height', 'id']);

const isElement = (node: XastElement): boolean => node.type === 'element' && node.name !== undefined;

/** Reads a `<use>` target id, or undefined when the reference is absent / not a local `#id`. */
function targetId(use: XastElement): string | undefined {
    const href = use.attributes?.href ?? use.attributes?.['xlink:href'];
    if (href === undefined || !href.startsWith('#')) return undefined;
    return href.slice(1);
}

/** Indexes every element carrying an `id` (including those inside `<defs>`/`<symbol>`). */
function indexById(root: XastElement): Map<string, XastElement> {
    const byId = new Map<string, XastElement>();
    const visit = (node: XastElement): void => {
        const id = node.attributes?.id;
        // First id wins, matching how a browser resolves a duplicated id.
        if (id !== undefined && !byId.has(id)) byId.set(id, node);
        for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return byId;
}

/** Deep-clones an element so inlining never mutates (or aliases) the original target. */
function cloneElement(node: XastElement): XastElement {
    const clone: XastElement = { type: node.type };
    if (node.name !== undefined) clone.name = node.name;
    if (node.attributes !== undefined) clone.attributes = { ...node.attributes };
    if (node.children !== undefined) clone.children = node.children.map(cloneElement);
    return clone;
}

/**
 * Builds the inlined replacement for a `<use>`: a deep clone of the target wrapped in a `<g>` that
 * carries the use's `x`/`y` translation (composed after any `transform` on the use) and its
 * presentation attributes. A `<symbol>` target is treated as a group (cloned, then renamed to `g`).
 */
function buildReplacement(use: XastElement, target: XastElement): XastElement {
    const clone = cloneElement(target);
    if (clone.name === 'symbol') clone.name = 'g';

    const attributes: Record<string, string> = {};

    const useAttrs = use.attributes ?? {};
    const x = useAttrs.x;
    const y = useAttrs.y;
    const baseTransform = useAttrs.transform;
    const translate = x !== undefined || y !== undefined ? `translate(${x ?? '0'} ${y ?? '0'})` : undefined;
    // SVG applies the use's own transform first, then the x/y offset — keep that order.
    const transform = [baseTransform, translate].filter((t): t is string => t !== undefined).join(' ');
    if (transform.length > 0) attributes.transform = transform;

    // Carry presentation attributes (fill, stroke, style, class, clip-path, opacity, …) but never
    // the use's geometry attributes — `transform` is rebuilt above so it is excluded here too.
    for (const [key, value] of Object.entries(useAttrs)) {
        if (USE_GEOMETRY_ATTRS.has(key) || key === 'transform') continue;
        attributes[key] = value;
    }

    return { type: 'element', name: 'g', attributes, children: [clone] };
}

/**
 * Expands `<use>` elements in place. For each `<use>` with a resolvable local `#id`, the target is
 * deep-cloned and wrapped in a `<g>`; unresolvable references (missing target or non-`#` href) are
 * left untouched so they can be reported downstream. `<defs>` is preserved (gradients/clip-paths
 * still live there).
 */
export function resolveUses(root: XastElement): void {
    const byId = indexById(root);

    const resolveChildren = (node: XastElement, depth: number): void => {
        const children = node.children;
        if (children === undefined) return;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child === undefined) continue;

            if (isElement(child) && child.name === 'use') {
                const id = depth > 0 ? targetId(child) : undefined;
                const target = id !== undefined ? byId.get(id) : undefined;
                if (target !== undefined) {
                    const replacement = buildReplacement(child, target);
                    // Expand any `<use>` nested in the freshly inlined subtree, with less budget.
                    resolveChildren(replacement, depth - 1);
                    children[i] = replacement;
                    continue;
                }
                // Unresolvable (or depth exhausted): leave the <use> as-is.
            }

            resolveChildren(child, depth);
        }
    };

    resolveChildren(root, MAX_DEPTH);
}
