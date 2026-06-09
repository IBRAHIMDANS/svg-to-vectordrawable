// Single choke point for svgo's runtime API. The browser build aliases `svgo` → `svgo/browser`
// (see tsup.config.ts), so every consumer goes through here and stays bundler-friendly.
export { optimize, _collections } from 'svgo';
