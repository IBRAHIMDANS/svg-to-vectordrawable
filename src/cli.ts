#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { convert } from './convert.js';
import type { ConvertOptions } from './types.js';

const HELP = `svgvd — convert SVG to Android VectorDrawable

Usage:
  svgvd <input.svg|dir> [options]

Options:
  -s, --string <svg>   Convert an inline SVG string (prints to stdout)
  -o, --out <path>     Output file (single input) or directory (batch)
  --stdout             Print result to stdout instead of writing a file
  --no-optimize        Skip svgo normalization (not recommended)
  --strict             Fail on the first unsupported construct
  --xml-tag            Prepend an XML declaration
  --tint <color>       Add android:tint to the <vector>
  -p, --precision <n>  Decimal places for numbers (default 3)
  -h, --help           Show this help
`;

function parseArgs(argv: string[]): {
    inputs: string[];
    inline?: string;
    out?: string;
    stdout: boolean;
    opts: ConvertOptions;
} {
    const inputs: string[] = [];
    const opts: ConvertOptions = {};
    let out: string | undefined;
    let inline: string | undefined;
    let stdout = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '-h' || arg === '--help') {
            process.stdout.write(HELP);
            process.exit(0);
        } else if (arg === '-s' || arg === '--string') inline = argv[++i];
        else if (arg === '-o' || arg === '--out') out = argv[++i];
        else if (arg === '--stdout') stdout = true;
        else if (arg === '--no-optimize') opts.optimize = false;
        else if (arg === '--strict') opts.strict = true;
        else if (arg === '--xml-tag') opts.xmlTag = true;
        else if (arg === '--tint') opts.tint = argv[++i];
        else if (arg === '-p' || arg === '--precision') opts.floatPrecision = Number(argv[++i]);
        else if (arg.startsWith('-') && arg !== '-') {
            process.stderr.write(`Unknown option: ${arg}\n`);
            process.exit(1);
        } else inputs.push(arg);
    }
    return { inputs, inline, out, stdout, opts };
}

function listSvgs(path: string): string[] {
    if (statSync(path).isDirectory())
        return readdirSync(path)
            .filter((f) => extname(f).toLowerCase() === '.svg')
            .map((f) => join(path, f));
    return [path];
}

function run(): void {
    const { inputs, inline, out, stdout, opts } = parseArgs(process.argv.slice(2));

    if (inline !== undefined) {
        const { xml, warnings } = convert(inline, opts);
        for (const w of warnings) process.stderr.write(`  ⚠ [${w.code}] ${w.message}\n`);
        if (out && extname(out) === '.xml') writeFileSync(out, xml);
        else process.stdout.write(xml);
        return;
    }

    if (inputs.length === 0) {
        process.stderr.write(HELP);
        process.exit(1);
    }

    const files = inputs.flatMap(listSvgs);
    let failures = 0;
    for (const file of files) {
        try {
            const { xml, warnings } = convert(readFileSync(file, 'utf8'), opts);
            for (const w of warnings) process.stderr.write(`  ⚠ ${basename(file)}: [${w.code}] ${w.message}\n`);
            if (stdout) {
                process.stdout.write(xml);
            } else {
                const target =
                    out && files.length === 1 && extname(out) === '.xml'
                        ? out
                        : join(out ?? dirname(file), `${basename(file, '.svg')}.xml`);
                writeFileSync(target, xml);
                process.stderr.write(`✓ ${file} → ${target}\n`);
            }
        } catch (err) {
            failures++;
            process.stderr.write(`✗ ${file}: ${(err as Error).message}\n`);
        }
    }
    if (failures) process.exit(1);
}

run();
