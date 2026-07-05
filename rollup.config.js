import process from 'node:process';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { compile } from 'sass';
import litCss from 'rollup-plugin-lit-css';
import postcss from 'postcss';
import cssnano from 'cssnano';
import pkg from './package.json' with { type: 'json' };

const dev = process.env.ROLLUP_WATCH === 'true';

function logCardInfo() {
  const part1 = `🌍 ${pkg.name.toUpperCase().replace(/-/g, ' ')}`;
  const part2 = `v${pkg.version}`;
  const part1Style =
    'color: orange; font-weight: bold; background: black; padding: 2px 4px; border-radius: 2px 0 0 2px;';
  const part2Style =
    'color: white; font-weight: bold; background: dimgray; padding: 2px 4px; border-radius: 0 2px 2px 0;';
  const repo = `Github:  ${pkg.repository.url}`;

  return `
    console.groupCollapsed(
      '%c${part1}%c${part2}',
      '${part1Style}',
      '${part2Style}'
    );
    console.info("${pkg.description}");
    console.info('${repo}');
    console.groupEnd();
  `;
}

export default {
  input: 'frontend/src/earthquakelist-card.ts',
  context: 'window', // Fix for "this" being undefined in some modules
  output: {
    file: pkg.main,
    format: 'es',
    sourcemap: dev, // Keep sourcemaps for debugging in dev mode
    banner: logCardInfo(),
    inlineDynamicImports: true,
  },
  onwarn: (warning, warn) => {
    if (warning.code === 'CIRCULAR_DEPENDENCY') {
      return;
    }
    warn(warning);
  },
  plugins: [
    {
      // Leaflet assumes a global `window`/`document` and pollutes `window.L`;
      // patch it so it plays nicely bundled inside a Lovelace card module.
      name: 'patch-leaflet',
      transform(code, id) {
        if (id.endsWith('leaflet-src.js') || id.endsWith('leaflet.js')) {
          let modifiedCode = code.replace(
            /function remove\(el\) \{\s+var parent = el\.parentNode;/g,
            'function remove(el) { if (!el) return; var parent = el.parentNode;',
          );
          modifiedCode = modifiedCode.replace(/window\.L = exports;/g, '');
          return modifiedCode;
        }
        return null;
      },
    },
    nodeResolve({
      browser: true,
      dedupe: ['lit'],
    }),
    commonjs(),
    litCss({
      include: ['**/*.scss', '**/*.css'],
      async transform(code, { filePath }) {
        if (filePath.endsWith('.scss')) {
          code = compile(filePath, { style: dev ? 'expanded' : 'compressed' }).css.toString();
        }
        const result = await postcss([cssnano({ preset: 'default' })]).process(code, { from: undefined });
        return result.css;
      },
    }),
    json({ compact: true }),
    typescript({
      sourceMap: dev,
      inlineSources: dev,
    }),
    !dev && terser(),
  ],
};
