// This file tells TypeScript how to handle imports for .scss and .css files.
// It declares that any such import is a module that exports a `CSSResult`
// object from Lit, so `rollup-plugin-lit-css` can process the file and hand
// it to the component as a valid `styles` entry.
declare module '*.scss' {
  import { CSSResultGroup } from 'lit';
  const css: CSSResultGroup;
  export default css;
}

declare module '*.css' {
  import { CSSResultGroup } from 'lit';
  const css: CSSResultGroup;
  export default css;
}

// Supplied by the `maplibre-worker-source` plugin in rollup.config.js: maplibre-gl's Web Worker,
// pre-bundled with the shared module it imports, as a string for `installMapLibreWorker` to wrap
// in a blob. Aliased to a stub in vitest.config.ts.
declare module 'virtual:maplibre-worker-source' {
  const source: string;
  export default source;
}
