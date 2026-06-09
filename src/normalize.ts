import { optimize } from './svgo.js';
import type { Config } from 'svgo';
import type { XastElement } from './gradient.js';

export interface XastRoot {
    type: 'root';
    children: XastElement[];
}

/**
 * Default normalization: flatten inline `<style>`, turn shapes into paths, bake transforms and
 * collapse trivial groups. This is what lets one walker handle SVGs from any editor.
 * `viewBox` is preserved (svgo 4's preset-default no longer strips it).
 */
const DEFAULT_CONFIG: Config = {
    plugins: [
        {
            name: 'preset-default',
            params: {
                overrides: {
                    inlineStyles: { onlyMatchedOnce: false },
                    convertShapeToPath: { convertArcs: true },
                    // Keep ids: gradients / clip-paths are referenced by url(#id).
                    cleanupIds: { remove: false },
                },
            },
        },
    ],
};

/**
 * Parses (and optionally normalizes) an SVG string into svgo's AST, reusing svgo as the XML
 * parser — no third-party parser needed. The capture plugin grabs the tree in the same pass.
 */
export function parseSvg(svg: string, optimizeFlag: boolean, svgoConfig?: Config): XastRoot {
    let captured: XastRoot | null = null;
    const capture = {
        name: 'svgvd-capture',
        fn: (root: unknown) => {
            captured = root as XastRoot;
            return {};
        },
    };

    const base = optimizeFlag ? (svgoConfig ?? DEFAULT_CONFIG) : { plugins: [] };
    const plugins = [...(base.plugins ?? []), capture] as Config['plugins'];

    try {
        optimize(svg, { ...base, plugins });
    } catch (err) {
        throw new Error(`Invalid SVG: ${(err as Error).message}`);
    }
    if (!captured) throw new Error('Failed to parse SVG: empty document');
    return captured;
}
