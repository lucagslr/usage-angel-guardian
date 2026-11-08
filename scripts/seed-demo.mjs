// Génère des données SIMULÉES dans un dossier de démonstration (jamais dans vos vraies données).
// Usage : node scripts/seed-demo.mjs <dossier>   puis CUG_DATA_DIR=<dossier> npm start
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir || /\.claude-usage-guardian[\\/]?$/.test(dir)) {
  console.error('Indiquez un dossier de démonstration distinct de ~/.claude-usage-guardian');
  process.exit(1);
}
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const now = Date.now();
const reset = Math.ceil((now + 3.6 * DAY) / HOUR) * HOUR;
const start = reset - 7 * DAY;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const snaps = [];
let weekly = 0;
let five = null;
for (let t = start + MIN; t <= now; t += 10 * MIN) {
  const hour = new Date(t).getHours();
  const active = (hour >= 9 && hour < 12) || (hour >= 14 && hour < 19) || (hour >= 21 && hour < 23 && rnd() < 0.4);
  const recordOn = hour >= 8 && hour < 24; // ordinateur allumé
  if (active) {
    const isLast = now - t < 25 * MIN;
    weekly += (isLast ? 0.9 : 0.12 + rnd() * 0.18);
    if (!five || t >= five.resetsAt) five = { pct: 0, resetsAt: t + 5 * HOUR };
    five.pct = Math.min(100, five.pct + (isLast ? 6 : 0.8 + rnd() * 1.4));
  }
  if (five && t >= five.resetsAt) five = null;
  if (!recordOn) continue;
  snaps.push({
    t, source: 'desktop-mod',
    sevenDay: { pct: Math.round(weekly * 10) / 10, resetsAt: reset },
    fiveHour: five ? { pct: Math.round(five.pct), resetsAt: five.resetsAt } : null,
    scoped: [{ key: 'weekly:fable', label: 'Fable', kind: 'weekly', pct: Math.round(weekly * 0.6), resetsAt: reset }],
  });
}
const sd = path.join(dir, 'snapshots');
fs.rmSync(sd, { recursive: true, force: true });
fs.mkdirSync(sd, { recursive: true });
const byDay = new Map();
for (const s of snaps) {
  const d = new Date(s.t);
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  byDay.set(k, (byDay.get(k) ?? '') + JSON.stringify(s) + '\n');
}
for (const [k, v] of byDay) fs.writeFileSync(path.join(sd, `${k}-demo.jsonl`), v);
console.log(`${snaps.length} mesures simulées écrites dans ${sd} (hebdo final ${weekly.toFixed(1)} %)`);
