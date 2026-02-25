import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

// Build the Figma plugin sandbox code (includes SVGO)
await build({
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  platform: 'browser',
  target: 'es2017',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Build the UI bundle (no SVGO — just clipboard logic)
await build({
  entryPoints: ['src/ui.ts'],
  bundle: true,
  outfile: 'dist/ui.bundle.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2017',
});

// Inline the UI bundle into the HTML template
const html = readFileSync('src/ui.html', 'utf8');
const bundle = readFileSync('dist/ui.bundle.js', 'utf8');
const finalHtml = html.replace('<!-- __BUNDLE__ -->', `<script>${bundle}</script>`);
writeFileSync('dist/ui.html', finalHtml);

console.log('Build complete.');
