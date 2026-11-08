/**
 * Validation et normalisation des données brutes en `UsageSnapshot`.
 * Les parseurs sont défensifs : un champ inconnu ou malformé est ignoré, jamais inventé.
 */
import type { QuotaWindow, ScopedQuota, SourceId, UsageSnapshot } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Accepte ISO 8601, secondes epoch ou millisecondes epoch. */
export function parseTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+(\.\d+)?$/.test(v.trim())) return parseTime(Number(v));
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function parsePct(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 1000);
}

function windowFrom(pct: unknown, resets: unknown): QuotaWindow | null {
  const p = parsePct(pct);
  if (p === null) return null;
  return { pct: p, resetsAt: parseTime(resets) };
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

const KNOWN_SCOPED_LABELS: Record<string, string> = {
  seven_day_opus: 'Opus',
  seven_day_sonnet: 'Sonnet',
  seven_day_fable: 'Fable',
  seven_day_omelette: 'Claude Design',
};

/** Entrée de `rateLimits` fournie par l'API officielle des mods (session.measure / $.session.usage). */
export interface ModRateLimit {
  kind: string;
  percentUsed: number;
  resetsAt?: string;
}

/** Instantané depuis les limites officielles reçues par le mod Claude Desktop (onglet Code). */
export function parseModRateLimits(raw: unknown, now: number): UsageSnapshot | null {
  if (!Array.isArray(raw)) return null;
  let fiveHour: QuotaWindow | null = null;
  let sevenDay: QuotaWindow | null = null;
  const scoped: ScopedQuota[] = [];
  for (const r of raw) {
    if (!isObj(r) || typeof r.kind !== 'string') continue;
    const w = windowFrom(r.percentUsed, r.resetsAt);
    if (!w) continue;
    if (r.kind === 'five_hour') fiveHour = w;
    else if (r.kind === 'seven_day') sevenDay = w;
    else if (r.kind.startsWith('seven_day_')) {
      const name = KNOWN_SCOPED_LABELS[r.kind] ?? r.kind.replace('seven_day_', '');
      scoped.push({ ...w, key: `weekly:${slug(name)}`, label: name, kind: 'weekly' });
    }
    // spend_limit (passerelle) : hors périmètre des quotas d'abonnement.
  }
  if (!fiveHour && !sevenDay && !scoped.length) return null;
  return { t: now, source: 'desktop-mod', fiveHour, sevenDay, scoped };
}

/**
 * Journal local écrit par Claude Desktop : %APPDATA%\Claude\plan-usage-history.json
 * Format observé (version 2) : { version, samples: [{ t, org, u: { fh?, sd?, xu? } }] }
 *   fh = % session 5 h, sd = % hebdomadaire (seven_day), xu = crédits supplémentaires.
 * Aucune heure de reset n'y figure : `resetsAt` reste null (déduit plus tard si possible).
 */
export function parseDesktopHistory(raw: unknown): UsageSnapshot[] {
  if (!isObj(raw) || !Array.isArray(raw.samples)) return [];
  const samples = raw.samples.filter(isObj);
  // Organisation la plus récente : évite de mélanger plusieurs comptes.
  const lastOrg = [...samples].reverse().find((x) => typeof x.org === 'string')?.org;
  const out: UsageSnapshot[] = [];
  for (const x of samples) {
    if (lastOrg && x.org !== undefined && x.org !== lastOrg) continue;
    const t = parseTime(x.t);
    const u = isObj(x.u) ? x.u : null;
    if (!t || !u) continue;
    const fh = parsePct(u.fh);
    const sd = parsePct(u.sd);
    if (fh === null && sd === null) continue;
    out.push({
      t,
      source: 'desktop-history',
      fiveHour: fh === null ? null : { pct: fh, resetsAt: null },
      sevenDay: sd === null ? null : { pct: sd, resetsAt: null },
      scoped: [],
    });
  }
  return out.sort((p, q) => p.t - q.t);
}

/** Construit un instantané depuis l'entrée JSON de la statusline Claude Code. */
export function parseStatuslineInput(raw: unknown, now: number): UsageSnapshot | null {
  if (!isObj(raw) || !isObj(raw.rate_limits)) return null;
  const rl = raw.rate_limits;
  const fh = isObj(rl.five_hour) ? windowFrom(rl.five_hour.used_percentage, rl.five_hour.resets_at) : null;
  const sd = isObj(rl.seven_day) ? windowFrom(rl.seven_day.used_percentage, rl.seven_day.resets_at) : null;
  const scoped: ScopedQuota[] = [];
  for (const [k, v] of Object.entries(rl)) {
    if (!k.startsWith('seven_day_') || !isObj(v)) continue;
    const w = windowFrom(v.used_percentage, v.resets_at);
    const name = KNOWN_SCOPED_LABELS[k] ?? k.replace('seven_day_', '');
    if (w) scoped.push({ ...w, key: `weekly:${slug(name)}`, label: name, kind: 'weekly' });
  }
  if (!fh && !sd && !scoped.length) return null;
  return { t: now, source: 'claude-code', fiveHour: fh, sevenDay: sd, scoped };
}

/** Valide un instantané importé (fichier JSON/JSONL) ; renvoie null s'il est invalide. */
export function validateSnapshot(v: unknown): UsageSnapshot | null {
  if (!isObj(v)) return null;
  const t = parseTime(v.t);
  if (!t) return null;
  const win = (x: unknown): QuotaWindow | null => {
    if (!isObj(x)) return null;
    const w = windowFrom(x.pct, x.resetsAt);
    if (w && x.resetInferred === true) w.resetInferred = true;
    return w;
  };
  const scoped: ScopedQuota[] = Array.isArray(v.scoped)
    ? v.scoped.flatMap((s) => {
        if (!isObj(s) || typeof s.key !== 'string') return [];
        const w = windowFrom(s.pct, s.resetsAt);
        return w ? [{ ...w, key: s.key, label: String(s.label ?? s.key), kind: 'weekly' as const }] : [];
      })
    : [];
  const known: SourceId[] = ['desktop-mod', 'claude-code', 'desktop-history', 'manual', 'import'];
  const source = known.includes(v.source as SourceId) ? (v.source as SourceId) : 'import';
  const snap: UsageSnapshot = { t, source, fiveHour: win(v.fiveHour), sevenDay: win(v.sevenDay), scoped };
  if (!snap.fiveHour && !snap.sevenDay && !scoped.length) return null;
  return snap;
}
