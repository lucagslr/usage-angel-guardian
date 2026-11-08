// Retire la statusLine Usage Guardian de ~/.claude/settings.json (sauvegarde préalable).
// Restaure la statusLine précédente si la sauvegarde la plus ancienne en contenait une.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
if (!fs.existsSync(settingsPath)) { console.log('Aucun settings.json : rien à faire.'); process.exit(0); }
const cur = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
if (!cur.statusLine || !String(cur.statusLine.command || '').includes('guardian-statusline')) {
  console.log('La statusLine actuelle n’est pas celle d’Usage Guardian : rien modifié.');
  process.exit(0);
}
const dir = path.dirname(settingsPath);
const backups = fs.readdirSync(dir).filter((f) => f.startsWith('settings.json.cug-backup-')).sort();
fs.copyFileSync(settingsPath, `${settingsPath}.cug-before-uninstall`);
let previous;
if (backups[0]) {
  try { previous = JSON.parse(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).statusLine; } catch { /* ignoré */ }
}
if (previous && !String(previous.command || '').includes('guardian-statusline')) cur.statusLine = previous;
else delete cur.statusLine;
fs.writeFileSync(settingsPath, JSON.stringify(cur, null, 2) + '\n');
console.log(previous ? 'statusLine précédente restaurée.' : 'statusLine retirée.');
