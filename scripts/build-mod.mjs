// Assemble le mod : copie du moteur partagé (src/core) dans le dossier du plugin,
// car un mod ne peut importer que ses propres fichiers.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const hooks = path.join(root, 'mod/usage-guardian/hooks');
const coreDst = path.join(hooks, 'core');
const ext = process.env.CUG_MOD_EXT ?? '.ts';
const banner = '// Copie générée depuis src/core par scripts/build-mod.mjs — ne pas éditer ici.\n';

fs.rmSync(coreDst, { recursive: true, force: true });
fs.mkdirSync(coreDst, { recursive: true });
const fix = (src, prefix) => src.replace(/from '(\.\.?\/[^']+)'/g, (m, p) => {
  let q = p.replace(/^\.\.\/\.\.\/src\/core\//, prefix);
  if (!/\.tsx?$/.test(q)) q += ext;
  return `from '${q}'`;
});
for (const f of fs.readdirSync(path.join(root, 'src/core'))) {
  if (!f.endsWith('.ts')) continue;
  fs.writeFileSync(path.join(coreDst, f), banner + fix(fs.readFileSync(path.join(root, 'src/core', f), 'utf8'), './'));
}
fs.rmSync(path.join(hooks, 'register.js'), { force: true });
fs.writeFileSync(path.join(hooks, 'register.tsx'), '// Généré depuis mod/src/register.tsx par scripts/build-mod.mjs — ne pas éditer ici.\n' + fix(fs.readFileSync(path.join(root, 'mod/src/register.tsx'), 'utf8'), './core/'));
fs.writeFileSync(path.join(hooks, 'hooks.json'), JSON.stringify({ modules: ['./register.tsx'] }, null, 2) + '\n');
console.log('mod assemblé :', hooks);
