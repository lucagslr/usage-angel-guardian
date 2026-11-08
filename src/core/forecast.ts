/**
 * Prévisions statistiques locales (aucun appel LLM).
 * Toutes les valeurs produites ici sont des ESTIMATIONS, accompagnées d'un niveau de confiance.
 */
import { attributeDeltas, latest, valueAt, type Epoch } from './series';
import { HOUR } from './time';
import type { Confidence } from './types';

export interface WeeklyForecast {
  /** Moyenne depuis le début de la fenêtre (%/h). */
  windowRate: number | null;
  /** Rythme des dernières 24 h (%/h). */
  recentRate: number | null;
  /** Rythme des 24 h précédentes, pour mesurer l'accélération. */
  previousRate: number | null;
  /** recent / previous (> 1 = accélération). */
  acceleration: number | null;
  blendedRate: number | null;
  /** Consommation moyenne par jour écoulé de la fenêtre (%). */
  perDay: number | null;
  /** Consommation moyenne par heure active (heure avec hausse mesurée). */
  perActiveHour: number | null;
  activeHours: number;
  /** Date estimée d'épuisement si elle précède le reset, sinon null. */
  exhaustionAt: number | null;
  /** Projection du % atteint au moment du reset au rythme actuel. */
  projectedAtReset: number | null;
  confidence: Confidence;
}

function rateBetween(e: Epoch, from: number, to: number): number | null {
  if (from < e.start) return null;
  const a = valueAt(e, from);
  const b = valueAt(e, to);
  if (a.quality === 'partial' || b.quality === 'partial') return null;
  return Math.max(0, b.value - a.value) / ((to - from) / HOUR);
}

export function forecastWeekly(e: Epoch, now: number): WeeklyForecast {
  const used = latest(e).pct;
  const elapsedH = (now - e.start) / HOUR;
  const windowRate = e.startIsReset && elapsedH >= 3 ? used / elapsedH : null;
  const recentRate = rateBetween(e, now - 24 * HOUR, now) ?? (e.startIsReset && elapsedH < 24 && elapsedH >= 3 ? windowRate : null);
  const previousRate = rateBetween(e, now - 48 * HOUR, now - 24 * HOUR);
  const acceleration = recentRate !== null && previousRate !== null && previousRate > 0.01 ? recentRate / previousRate : null;
  const rates = [recentRate, windowRate].filter((x): x is number => x !== null);
  const blendedRate = recentRate !== null && windowRate !== null
    ? 0.6 * recentRate + 0.4 * windowRate
    : rates[0] ?? null;
  const hourly = attributeDeltas([e], (t) => String(Math.floor(t / HOUR)));
  const activeHours = hourly.size;
  const perActiveHour = activeHours > 0 ? [...hourly.values()].reduce((a, b) => a + b, 0) / activeHours : null;
  const hoursLeft = (e.resetsAt - now) / HOUR;
  let exhaustionAt: number | null = null;
  let projectedAtReset: number | null = null;
  if (blendedRate !== null) {
    projectedAtReset = used + blendedRate * hoursLeft;
    if (blendedRate > 0 && used < 100) {
      const t = now + ((100 - used) / blendedRate) * HOUR;
      exhaustionAt = t < e.resetsAt ? t : null;
    } else if (used >= 100) exhaustionAt = now;
  }
  let confidence: Confidence = 'low';
  const pts = e.points.length;
  if (elapsedH >= 48 && recentRate !== null && windowRate !== null && pts >= 20) {
    const gap = Math.abs(recentRate - windowRate) / Math.max(recentRate, windowRate, 0.01);
    confidence = gap < 0.5 ? 'high' : 'medium';
  } else if (elapsedH >= 12 && blendedRate !== null && pts >= 6) confidence = 'medium';
  return {
    windowRate, recentRate, previousRate, acceleration, blendedRate,
    perDay: windowRate !== null ? windowRate * 24 : null,
    perActiveHour, activeHours, exhaustionAt, projectedAtReset, confidence,
  };
}

/** Quantiles d'une liste (interpolation linéaire). */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export type SessionVerdict = 'comfortable' | 'tight' | 'unlikely' | 'unknown';

export interface SessionEstimate {
  hours: number;
  verdict: SessionVerdict;
  /** Consommation hebdo attendue (médiane, pessimiste p80) en %. */
  weeklyMedian: number | null;
  weeklyHigh: number | null;
  fiveHourMedian: number | null;
  fiveHourHigh: number | null;
  /** Dépassement attendu du budget du jour (médiane), si positif. */
  overBudget: number | null;
  basis: { activeHoursWeekly: number; activeHoursFiveHour: number };
  confidence: Confidence;
  reason: string;
}

/**
 * Estime si une session de travail de `hours` heures tient dans les quotas restants,
 * à partir de la consommation réellement mesurée par heure active (historique local).
 */
export function estimateSession(params: {
  hours: number;
  weeklyEpochs: Epoch[];
  fiveHourEpochs: Epoch[];
  weeklyAvailable: number | null; // restant − réserve
  todayRemaining: number | null;
  fiveHourUsed: number | null;
  fiveHourResetsAt: number | null;
  now: number;
}): SessionEstimate {
  const { hours, now } = params;
  const wk = [...attributeDeltas(params.weeklyEpochs, (t) => String(Math.floor(t / HOUR))).values()];
  const fh = [...attributeDeltas(params.fiveHourEpochs, (t) => String(Math.floor(t / HOUR))).values()];
  const base = { activeHoursWeekly: wk.length, activeHoursFiveHour: fh.length };
  const out: SessionEstimate = {
    hours, verdict: 'unknown', weeklyMedian: null, weeklyHigh: null, fiveHourMedian: null, fiveHourHigh: null,
    overBudget: null, basis: base, confidence: 'low', reason: '',
  };
  if (wk.length < 3 || params.weeklyAvailable === null) {
    out.reason = 'Historique insuffisant : au moins 3 heures actives mesurées sont nécessaires.';
    return out;
  }
  const mw = (wk.reduce((a, b) => a + b, 0) / wk.length);
  const hw = quantile(wk, 0.8)!;
  out.weeklyMedian = mw * hours;
  out.weeklyHigh = Math.max(hw, mw) * hours;
  let fiveOk: 'yes' | 'tight' | 'no' | 'n/a' = 'n/a';
  if (fh.length >= 3 && params.fiveHourUsed !== null) {
    const m5 = fh.reduce((a, b) => a + b, 0) / fh.length;
    const h5 = Math.max(quantile(fh, 0.8)!, m5);
    // Jusqu'au reset de 5 h en cours, la marge est (100 − utilisé) ; après, une fenêtre neuve (100) toutes les 5 h.
    const ttr = params.fiveHourResetsAt ? Math.max(0, (params.fiveHourResetsAt - now) / HOUR) : 0;
    const firstSpan = Math.min(hours, ttr || hours);
    const firstRoom = params.fiveHourResetsAt ? 100 - params.fiveHourUsed : 100;
    out.fiveHourMedian = m5 * firstSpan;
    out.fiveHourHigh = h5 * firstSpan;
    const fits = (rate: number) => rate * firstSpan <= firstRoom && (hours <= firstSpan || rate * Math.min(5, hours - firstSpan) <= 100);
    fiveOk = fits(h5) ? 'yes' : fits(m5) ? 'tight' : 'no';
  }
  if (params.todayRemaining !== null) {
    const over = out.weeklyMedian - Math.max(0, params.todayRemaining);
    out.overBudget = over > 0 ? over : null;
  }
  const avail = params.weeklyAvailable;
  if (out.weeklyHigh <= avail && fiveOk !== 'no' && fiveOk !== 'tight') out.verdict = 'comfortable';
  else if (out.weeklyMedian <= avail && fiveOk !== 'no') out.verdict = 'tight';
  else out.verdict = 'unlikely';
  out.confidence = wk.length >= 20 ? 'high' : wk.length >= 8 ? 'medium' : 'low';
  out.reason = fiveOk === 'n/a'
    ? 'Basé sur le quota hebdomadaire ; historique de la limite de 5 h insuffisant.'
    : 'Basé sur les quotas hebdomadaire et de 5 h.';
  return out;
}
