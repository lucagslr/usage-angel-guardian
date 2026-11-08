// Installe la statusline optionnelle pour Claude Code CLI.
// Sans --apply : copie le script et AFFICHE la configuration à ajouter (aucune modification).
// Avec --apply : sauvegarde ~/.claude/settings.json puis ajoute la clé statusLine
// (refusé si une statusLine existe déjà, sauf --force).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const src = path.join(root, 'dist', 'statusline', 'guardian-statusline.cjs');
if (!fs.existsSync(src)) { console.error('Lancez d’abord : npm run build'); process.exit(1); }
const binDir = path.join(os.homedir(), '.claude-usage-guardian', 'bin');
fs.mkdirSync(binDir, { recursive: true });
const dst = path.join(binDir, 'guardian-statusline.cjs');
fs.copyFileSync(src, dst);
const command = `node "${dst.replace(/\/g, '/')}"`;
const entry = { type: 'command', command, refreshInterval: 60 };
console.log(`Script copié : ${dst}`);

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
if (!process.argv.includes('--apply')) {
  console.log('\nAucun paramètre modifié. Pour activer, ajoutez dans', settingsPath, ':\n');
  console.log(JSON.stringify({ statusLine: entry }, null, 2));
  console.log('\nou relancez : npm run statusline:install -- --apply');
  process.exit(0);
}
let current = {};
if (fs.existsSync(settingsPath)) {
  current = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (current.statusLine && !process.argv.includes('--force') && current.statusLine.command !== command) {
    console.error('Une statusLine existe déjà ; rien n’a été modifié. Utilisez --force pour la remplacer (elle sera sauvegardée).');
    process.exit(2);
  }
  const backup = `${settingsPath}.cug-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(settingsPath, backup);
  console.log(`Sauvegarde : ${backup}`);
}
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify({ ...current, statusLine: entry }, null, 2) + '\n');
console.log('statusLine ajoutée. Désinstallation : npm run statusline:uninstall');
