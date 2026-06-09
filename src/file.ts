import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { convert } from './convert.js';
import type { ConvertOptions, ConvertResult, Warning } from './types.js';

/**
 * Converts a single SVG file to a VectorDrawable XML file.
 * Defaults the output path to the input with a `.xml` extension. (Node only.)
 */
export function convertFile(inputPath: string, outputPath?: string, options?: ConvertOptions): ConvertResult {
    const result = convert(readFileSync(inputPath, 'utf8'), options);
    const target = outputPath ?? join(dirname(inputPath), `${basename(inputPath, extname(inputPath))}.xml`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, result.xml);
    return result;
}

export interface ConvertDirResult {
    input: string;
    output: string;
    warnings: Warning[];
}

/** Converts every `*.svg` in a directory to `*.xml` in `outputDir`. (Node only, non-recursive.) */
export function convertDir(inputDir: string, outputDir: string, options?: ConvertOptions): ConvertDirResult[] {
    mkdirSync(outputDir, { recursive: true });
    const out: ConvertDirResult[] = [];
    for (const entry of readdirSync(inputDir)) {
        const p = join(inputDir, entry);
        if (statSync(p).isFile() && extname(entry).toLowerCase() === '.svg') {
            const target = join(outputDir, `${basename(entry, '.svg')}.xml`);
            const { warnings } = convertFile(p, target, options);
            out.push({ input: p, output: target, warnings });
        }
    }
    return out;
}
