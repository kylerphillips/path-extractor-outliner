import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

mkdirSync('dist', { recursive: true });

let commitHash = 'dev';
try {
  commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch (_) {}

// Build the Figma plugin sandbox code (includes SVGO)
await build({
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  platform: 'browser',
  target: 'es2017',
  define: { 'process.env.NODE_ENV': '"production"', 'global': 'globalThis' },
  inject: ['src/buffer-shim.js'],
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

// Inline the UI bundle into the HTML template and inject commit hash
const html = readFileSync('src/ui.html', 'utf8');
const bundle = readFileSync('dist/ui.bundle.js', 'utf8');
const finalHtml = html
  .replace('<!-- __BUNDLE__ -->', `<script>${bundle}</script>`)
  .replace('__COMMIT_HASH__', commitHash);
writeFileSync('dist/ui.html', finalHtml);

console.log(`Build complete. (${commitHash})`);
