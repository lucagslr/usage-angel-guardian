// Génère build/icon.ico (PNG 256/48/32/16 intégrés) à partir de la jauge de l'application.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = path.join(root, 'build', 'png-tool.cjs');
await build({ entryPoints: [path.join(root, 'src/app/main/png.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' });
const { gaugeIcon } = createRequire(import.meta.url)(out);
const sizes = [256, 48, 32, 16];
const pngs = sizes.map((s) => gaugeIcon(s, 0.62, '#c96442', '#b9b5aa'));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header[e] = s >= 256 ? 0 : s; header[e + 1] = s >= 256 ? 0 : s;
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, ...pngs]));
fs.writeFileSync(path.join(root, 'build', 'icon.png'), pngs[0]);
fs.rmSync(out);
console.log('build/icon.ico généré');
