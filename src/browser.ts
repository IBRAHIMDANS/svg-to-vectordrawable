// Browser entry: the pure converter only (no Node fs helpers). svgo resolves to its browser
// bundle via the tsup alias, so this stays free of Node built-ins.
export { convert } from './convert.js';
export type { ConvertOptions, ConvertResult, Warning, AndroidColor } from './types.js';
