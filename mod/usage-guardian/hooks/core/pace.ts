// Copie générée depuis src/core par scripts/build-mod.mjs — ne pas éditer ici.
/**
 * Indicateur de vitesse de consommation : compare le rythme récent mesuré
 * au rythme soutenable (budget du jour / heures actives par jour).
 */
import { valueAt, type Epoch } from './series.ts';
import { HOUR, MINUTE } from './time.ts';
import type { PaceLevel } from './types.ts';

export interface RateSample {
  /** %/h mesuré. */
  rate: number;
  /** Durée réellement couverte par les mesures (ms). */
  span: number;
  delta: number;
}

/** Rythme de consommation sur la fenêtre [now − lookback, now], à partir des mesures réelles. */
export function recentRate(epoch: Epoch, now: number, lookback: number): RateSample | null {
  const from = Math.max(epoch.start, now - lookback);
  const pts = epoch.points.filter((p) => p.t >= from && p.t <= now);
  const v0 = valueAt(epoch, from);
  const last = pts[pts.length - 1];
  if (!last) return null;
  // Point de départ : base exacte/interpolée au début de la fenêtre d'observation, sinon première mesure.
  const startT = v0.quality === 'partial' ? v0.knownFrom : from;
  const startV = v0.quality === 'partial' ? (pts[0]?.pct ?? v0.value) : v0.value;
  const span = Math.max(last.t, now) - startT;
  if (span < 5 * MINUTE) return null;
  const delta = Math.max(0, last.pct - startV);
  return { rate: delta / (span / HOUR), span, delta };
}

export interface PaceResult {
  level: PaceLevel;
  /** %/h mesuré sur ~60 min. */
  rate: number | null;
  /** %/h sur ~15 min (rafale). */
  burstRate: number | null;
  /** Rythme soutenable (%/h) pour tenir le budget du jour. */
  sustainable: number | null;
  ratio: number | null;
  /** Heures avant d'épuiser le budget restant du jour au rythme actuel. */
  hoursToBudget: number | null;
}

export function computePace(
  epoch: Epoch | null,
  now: number,
  budgetToday: number | null,
  remainingToday: number | null,
  activeHoursPerDay: number,
): PaceResult {
  const none: PaceResult = { level: 'unknown', rate: null, burstRate: null, sustainable: null, ratio: null, hoursToBudget: null };
  if (!epoch) return none;
  const r60 = recentRate(epoch, now, 60 * MINUTE);
  const r15 = recentRate(epoch, now, 15 * MINUTE);
  if (!r60) return none;
  const sustainable = budgetToday !== null && budgetToday > 0 ? budgetToday / activeHoursPerDay : null;
  if (r60.delta === 0 && (!r15 || r15.delta === 0)) {
    return { ...none, level: 'idle', rate: 0, burstRate: r15?.rate ?? 0, sustainable, ratio: 0 };
  }
  // Sans budget positif, toute consommation est rapide par définition.
  const ratio60 = sustainable ? r60.rate / sustainable : Infinity;
  const ratio15 = sustainable && r15 && r15.span >= 10 * MINUTE ? r15.rate / sustainable : 0;
  const ratio = Math.max(ratio60, Math.min(ratio15, 4)); // une rafale seule plafonne à « rapide »
  let level: PaceLevel;
  if (ratio < 1) level = 'calm';
  else if (ratio < 2) level = 'steady';
  else if (ratio < 4) level = 'fast';
  else level = 'very-fast';
  const rate = Math.max(r60.rate, r15 && r15.span >= 10 * MINUTE ? r15.rate : 0);
  const hoursToBudget = remainingToday !== null && rate > 0 ? Math.max(0, remainingToday) / rate : null;
  return { level, rate: r60.rate, burstRate: r15?.rate ?? null, sustainable, ratio: Number.isFinite(ratio) ? ratio : null, hoursToBudget };
}

/** Projection de la limite de 5 h : heure estimée d'atteinte de 100 % avant le reset. */
export function fiveHourProjection(epoch: Epoch | null, now: number): { hitsLimitAt: number | null; rate: number | null } {
  if (!epoch || now >= epoch.resetsAt) return { hitsLimitAt: null, rate: null };
  const r = recentRate(epoch, now, 45 * MINUTE);
  const last = epoch.points[epoch.points.length - 1]!;
  if (!r || r.rate <= 0) return { hitsLimitAt: null, rate: r?.rate ?? null };
  const t = now + ((100 - last.pct) / r.rate) * HOUR;
  return { hitsLimitAt: t < epoch.resetsAt ? t : null, rate: r.rate };
}
