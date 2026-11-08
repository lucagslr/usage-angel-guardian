// Build : mod Claude Desktop + application Electron (overlay) + statusline.
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const r = (...p) => path.join(root, ...p);

const targets = {
  _modBundle: {
    entryPoints: [r('mod/src/register.tsx')],
    outfile: r('mod/usage-guardian/hooks/register.js'),
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    external: ['claude-code'], jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment',
    banner: { js: '// Généré par scripts/build.mjs depuis mod/src/register.tsx — ne pas éditer.' },
  },
  main: {
    entryPoints: [r('src/app/main/index.ts')], outfile: r('dist/app/main.cjs'),
    bundle: true, format: 'cjs', platform: 'node', target: 'node20', external: ['electron', 'koffi'],
  },
  preload: {
    entryPoints: [r('src/app/preload/index.ts')], outfile: r('dist/app/preload.cjs'),
    bundle: true, format: 'cjs', platform: 'node', target: 'node20', external: ['electron'],
  },
  renderer: {
    entryPoints: { overlay: r('src/app/renderer/overlay.ts'), dashboard: r('src/app/renderer/dashboard.ts') },
    outdir: r('dist/app/renderer'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  },
  statusline: {
    entryPoints: [r('statusline/statusline.ts')], outfile: r('dist/statusline/guardian-statusline.cjs'),
    bundle: true, format: 'cjs', platform: 'node', target: 'node18',
  },
};

function copyStatic() {
  const dst = r('dist/app/renderer');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(r('src/app/renderer'))) {
    if (/\.(html|css|svg|png)$/.test(f)) fs.copyFileSync(r('src/app/renderer', f), path.join(dst, f));
  }
  fs.mkdirSync(r('dist/app/assets'), { recursive: true });
  for (const f of fs.existsSync(r('assets')) ? fs.readdirSync(r('assets')) : []) fs.copyFileSync(r('assets', f), r('dist/app/assets', f));
}

import { execFileSync } from "node:child_process";
if (!only || only.split(",").includes("mod")) execFileSync(process.execPath, [r("scripts/build-mod.mjs")], { stdio: "inherit" });
delete targets._modBundle;
const names = only ? only.split(',') : Object.keys(targets).filter((k) => fs.existsSync(targets[k].entryPoints[0] ?? Object.values(targets[k].entryPoints)[0]));
for (const n of names) {
  const opts = { ...targets[n], logLevel: 'warning', legalComments: 'none' };
  if (watch) await (await context(opts)).watch();
  else await build(opts);
}
if (names.includes('renderer')) copyStatic();
console.log(`build ok: ${names.join(', ')}${watch ? ' (watch)' : ''}`);
