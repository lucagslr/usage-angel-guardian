/**
 * Statistiques dérivées de l'historique local. Seules les périodes réellement
 * enregistrées sont restituées : aucune reconstitution des trous.
 */
import { attributeDeltas, usageBetween, type Epoch, type Point } from './series';
import { DAY, localParts, segmentDays } from './time';
import type { Settings } from './types';

export interface DailyUsage {
  key: string;
  start: number;
  used: number;
  /** Fraction de la journée couverte par des mesures rapprochées (0–1). */
  coverage: number;
}

export function dailyHistory(epochs: Epoch[], s: Settings, from: number, now: number): DailyUsage[] {
  if (!epochs.length) return [];
  const first = Math.max(from, epochs[0]!.start);
  const out: DailyUsage[] = [];
  for (const g of segmentDays(first, now, s.timezone, s.dayStartHour)) {
    const u = usageBetween(epochs, g.start, g.end);
    if (!u.anyData) continue;
    out.push({ key: g.key, start: g.dayStart, used: u.used, coverage: u.coverage });
  }
  return out;
}

/** Consommation hebdo attribuée par heure locale (0–23), sur la période donnée. */
export function hourlyProfile(epochs: Epoch[], tz: string, from: number): number[] {
  const res = new Array<number>(24).fill(0);
  const m = attributeDeltas(epochs, (t) => (t < from ? 'skip' : String(localParts(t, tz).hour)));
  for (const [k, v] of m) if (k !== 'skip') res[+k]! += v;
  return res;
}

export interface WeeklyCycle {
  resetsAt: number;
  /** % le plus élevé observé dans la fenêtre. */
  peak: number;
  complete: boolean;
}

export function weeklyCycles(epochs: Epoch[], now: number): WeeklyCycle[] {
  const byReset = new Map<number, WeeklyCycle>();
  for (const e of epochs) {
    const key = Math.round(e.resetsAt / 3_600_000) * 3_600_000;
    const peak = Math.max(...e.points.map((p) => p.pct));
    const c = byReset.get(key);
    if (c) c.peak = Math.max(c.peak, peak);
    else byReset.set(key, { resetsAt: e.resetsAt, peak, complete: now >= e.resetsAt });
  }
  return [...byReset.values()].sort((a, b) => a.resetsAt - b.resetsAt);
}

/** Nombre de sessions de 5 h distinctes observées par jour. */
export function sessionsPerDay(points: Point[], s: Settings): Map<string, number> {
  const seen = new Map<string, Set<number>>();
  for (const p of points) {
    const k = segmentDays(p.t, p.t + 1, s.timezone, s.dayStartHour)[0]!.key;
    const set = seen.get(k) ?? new Set<number>();
    set.add(Math.round(p.resetsAt / 600_000));
    seen.set(k, set);
  }
  return new Map([...seen].map(([k, v]) => [k, v.size]));
}

export interface Comparison {
  today: number | null;
  yesterday: number | null;
  average: number | null;
  /** Pente (points de % par jour) des 14 derniers jours bien couverts. */
  trendPerDay: number | null;
  daysCounted: number;
}

export function compareDays(history: DailyUsage[], todayKey: string): Comparison {
  const today = history.find((d) => d.key === todayKey)?.used ?? null;
  const past = history.filter((d) => d.key < todayKey);
  const yesterdayRow = past[past.length - 1];
  const yesterday = yesterdayRow && Date.parse(todayKey) - Date.parse(yesterdayRow.key) <= 1.5 * DAY ? yesterdayRow.used : null;
  const good = past.filter((d) => d.coverage >= 0.5).slice(-14);
  const average = good.length ? good.reduce((a, d) => a + d.used, 0) / good.length : null;
  let trendPerDay: number | null = null;
  if (good.length >= 4) {
    const xs = good.map((d) => (Date.parse(d.key) - Date.parse(good[0]!.key)) / DAY);
    const ys = good.map((d) => d.used);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i]! - my); den += (x - mx) ** 2; });
    trendPerDay = den > 0 ? num / den : null;
  }
  return { today, yesterday, average, trendPerDay, daysCounted: good.length };
}

/** Tokens mesurés (Claude Code) agrégés par jour et modèle. */
export interface TokenRow {
  day: string;
  model: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  messages: number;
}

export function summarizeTokens(rows: TokenRow[]): { byDay: Map<string, TokenRow>; byModel: Map<string, TokenRow> } {
  const add = (m: Map<string, TokenRow>, k: string, r: TokenRow, day: string, model: string) => {
    const c = m.get(k) ?? { day, model, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, messages: 0 };
    c.input += r.input; c.output += r.output; c.cacheCreate += r.cacheCreate; c.cacheRead += r.cacheRead; c.messages += r.messages;
    m.set(k, c);
  };
  const byDay = new Map<string, TokenRow>();
  const byModel = new Map<string, TokenRow>();
  for (const r of rows) {
    add(byDay, r.day, r, r.day, '*');
    add(byModel, r.model, r, '*', r.model);
  }
  return { byDay, byModel };
}
