// Build a fully self-contained index.html (works from file:// and GitHub Pages).
// usage: node scripts/build.mjs [--dev] [--out path]
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? path.resolve(root, args[outIdx + 1]) : path.join(root, 'index.html');

const t0 = Date.now();
const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: !dev,
  sourcemap: false,
  legalComments: 'none',
  write: false,
  define: {
    __DEV__: JSON.stringify(dev),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
const js = result.outputFiles[0].text;
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
const uiHtml = await readFile(path.join(root, 'src/ui/ui.html'), 'utf8');
let tpl = await readFile(path.join(root, 'src/index.template.html'), 'utf8');
tpl = tpl.replace('/*__CSS__*/', () => css)
         .replace('<!--__UI__-->', () => uiHtml)
         .replace('/*__BUNDLE__*/', () => js);
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, tpl, 'utf8');
// also keep a copy under dist for tooling
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/index.html'), tpl, 'utf8');
const kb = (Buffer.byteLength(tpl) / 1024).toFixed(0);
console.log(`built ${path.relative(root, outFile)} (${kb} KB, js ${(js.length / 1024).toFixed(0)} KB) in ${Date.now() - t0}ms${dev ? ' [dev]' : ''}`);
