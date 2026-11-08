// Copie générée depuis src/core par scripts/build-mod.mjs — ne pas éditer ici.
/**
 * Moteur de budget quotidien.
 *
 * Principe (voir docs/BUDGET_MATH.md) :
 *  - la semaine officielle [reset − 7 j, reset) est découpée en journées locales ;
 *  - chaque journée reçoit un poids = durée (h) × multiplicateur du type de jour ;
 *  - au début de chaque journée, le quota encore disponible (100 − consommé − réserve)
 *    est réparti entre la journée et les suivantes au prorata des poids ;
 *  - le budget du jour est donc figé à son début ; les jours futurs sont reprojetés en continu.
 */
import { effectiveReserve } from './settings.ts';
import { latest, usageBetween, valueAt, type Epoch } from './series.ts';
import { DAY, HOUR, WEEK, segmentDays, type DaySegment } from './time.ts';
import type { BaselineQuality, DayType, Settings, Strategy } from './types.ts';

export interface BudgetDay {
  key: string;
  start: number;
  end: number;
  weekday: number;
  type: DayType;
  weight: number;
  /** Budget recommandé (figé au début du jour pour les jours passés et aujourd'hui, projeté pour les futurs). */
  budgetPct: number | null;
  /** Consommation attribuable au jour (null si inconnue ou future). */
  usedPct: number | null;
  status: 'past' | 'today' | 'future';
  quality: BaselineQuality | null;
}

export interface TodayBudget {
  key: string;
  dayStart: number;
  dayEnd: number;
  /** Début effectif du suivi pour aujourd'hui (début de jour, reset, rupture ou première mesure). */
  trackedSince: number;
  budgetPct: number;
  usedPct: number;
  /** Bornes de la consommation du jour quand la base est interpolée. */
  usedRange: [number, number];
  remainingPct: number;
  /** used / budget, plafonné à 99 (99 si budget nul et consommation > 0). */
  ratio: number;
  baselinePct: number;
  baselineQuality: BaselineQuality;
  /** Consommation du jour appartenant à la fenêtre précédente (reset en cours de journée). */
  usedBeforeReset: number | null;
}

export interface StrategyPreview {
  strategy: Strategy;
  today: number;
  /** Budget moyen par jour restant si le budget d'aujourd'hui est entièrement consommé. */
  futurePerDay: number;
}

export interface WeekPlan {
  windowStart: number;
  resetsAt: number;
  weeklyUsed: number;
  weeklyRemaining: number;
  reservePct: number;
  /** Quota encore distribuable (restant − réserve). */
  distributable: number;
  today: TodayBudget;
  days: BudgetDay[];
  /** Trajectoire recommandée cumulée à l'instant (% hebdo). */
  plannedNow: number;
  /** Point de départ de la trajectoire : début de semaine (0 %) ou dernière rupture (reset anticipé…). */
  trajectoryFrom: { t: number; v: number };
  /** weeklyUsed − plannedNow : positif = consommation en avance sur la trajectoire. */
  deviation: number;
  /** Budget moyen par jour futur, en tenant compte de la consommation actuelle. */
  futurePerDay: number;
  futureDays: number;
  previews: StrategyPreview[];
}

function dayType(s: Settings, weekday: number): DayType {
  return s.weekdayTypes[weekday] ?? 'normal';
}

function weightOf(s: Settings, seg: { weekday: number }, from: number, to: number): number {
  const hours = Math.max(0, to - from) / HOUR;
  return hours * s.dayTypeWeights[dayType(s, seg.weekday)];
}

/** Part du disponible attribuée à un jour de poids w face aux poids futurs. */
function share(available: number, w: number, futureW: number, factor = 1): number {
  const wt = w * factor;
  const total = wt + futureW;
  if (available <= 0) return 0;
  if (total <= 0) return available;
  return (available * wt) / total;
}

export function computeWeekPlan(epoch: Epoch, priorEpochs: Epoch[], settings: Settings, now: number): WeekPlan | null {
  if (now >= epoch.resetsAt) return null;
  const tz = settings.timezone;
  const sh = settings.dayStartHour;
  const reserve = effectiveReserve(settings);
  const windowStart = epoch.resetsAt - WEEK;
  const segs = segmentDays(windowStart, epoch.resetsAt, tz, sh);
  const idx = segs.findIndex((g) => now >= g.start && now < g.end);
  if (idx < 0) return null;
  const todaySeg = segs[idx]!;
  const future = segs.slice(idx + 1);
  const futureW = future.reduce((a, g) => a + weightOf(settings, g, g.start, g.end), 0);

  const weeklyUsed = latest(epoch).pct;
  const factorFor = (st: Strategy) => (st === 'intensive' ? settings.intensiveFactor : 1);
  const reserveFor = (st: Strategy) =>
    Math.min(60, settings.personalReservePct + (st === 'conservative' ? settings.conservativeReservePct : 0));

  // --- Aujourd'hui ---------------------------------------------------------
  let trackedSince = Math.max(todaySeg.start, epoch.start);
  const base = valueAt(epoch, trackedSince);
  if (base.quality === 'partial') trackedSince = Math.max(trackedSince, base.knownFrom);
  const todayW = weightOf(settings, todaySeg, trackedSince, todaySeg.end);
  const avail0 = Math.max(0, 100 - reserve - base.value);
  const budgetToday = share(avail0, todayW, futureW, factorFor(settings.strategy));
  const usedToday = Math.max(0, weeklyUsed - base.value);
  const usedRange: [number, number] = [Math.max(0, weeklyUsed - base.hi), Math.max(0, weeklyUsed - base.lo)];
  let usedBeforeReset: number | null = null;
  if (epoch.start > todaySeg.dayStart && priorEpochs.length) {
    const u = usageBetween(priorEpochs, todaySeg.dayStart, epoch.start);
    usedBeforeReset = u.anyData ? u.used : null;
  }
  const today: TodayBudget = {
    key: todaySeg.key,
    dayStart: todaySeg.dayStart,
    dayEnd: todaySeg.dayEnd,
    trackedSince,
    budgetPct: budgetToday,
    usedPct: usedToday,
    usedRange,
    remainingPct: budgetToday - usedToday,
    ratio: budgetToday > 0 ? Math.min(99, usedToday / budgetToday) : usedToday > 0 ? 99 : 0,
    baselinePct: base.value,
    baselineQuality: base.quality,
    usedBeforeReset,
  };

  // --- Jours passés (budget figé à leur début, avec la stratégie actuelle) ---
  const days: BudgetDay[] = [];
  for (let i = 0; i < idx; i++) {
    const g = segs[i]!;
    const restW = segs.slice(i + 1).reduce((a, x) => a + weightOf(settings, x, x.start, x.end), 0);
    days.push(pastDay(g, epoch, settings, reserve, restW));
  }
  days.push({
    key: todaySeg.key, start: todaySeg.start, end: todaySeg.end, weekday: todaySeg.weekday,
    type: dayType(settings, todaySeg.weekday), weight: todayW, budgetPct: budgetToday, usedPct: usedToday,
    status: 'today', quality: base.quality,
  });

  // --- Jours futurs : reprojection continue --------------------------------
  const pendingToday = Math.max(0, budgetToday - usedToday);
  const futurePool = Math.max(0, 100 - reserve - weeklyUsed - pendingToday);
  for (const g of future) {
    const w = weightOf(settings, g, g.start, g.end);
    days.push({
      key: g.key, start: g.start, end: g.end, weekday: g.weekday, type: dayType(settings, g.weekday), weight: w,
      budgetPct: futureW > 0 ? (futurePool * w) / futureW : 0, usedPct: null, status: 'future', quality: null,
    });
  }

  // --- Trajectoire recommandée (sans report) -------------------------------
  // Après une réinitialisation anticipée ou un changement d'abonnement, la trajectoire repart
  // de la rupture (valeur connue) au lieu du début de la semaine officielle.
  const tFrom = Math.max(windowStart, epoch.start);
  const vFrom = epoch.start > windowStart ? epoch.startValue : 0;
  const wBetween = (a: number, b2: number) => segs.reduce((acc, g) => acc + weightOf(settings, g, Math.max(g.start, a), Math.min(g.end, b2)), 0);
  const totalW = wBetween(tFrom, epoch.resetsAt);
  const elapsedW = wBetween(tFrom, now);
  const plannedNow = totalW > 0 ? vFrom + ((Math.max(0, 100 - reserve - vFrom)) * elapsedW) / totalW : vFrom;

  const futureDays = future.reduce((a, g) => a + (g.end - g.start) / DAY, 0);
  const previews: StrategyPreview[] = (['balanced', 'conservative', 'intensive'] as Strategy[]).map((st) => {
    const av = Math.max(0, 100 - reserveFor(st) - base.value);
    const t = share(av, todayW, futureW, factorFor(st));
    const left = Math.max(0, av - t);
    return { strategy: st, today: t, futurePerDay: futureDays > 0 ? left / Math.max(1, future.length) : 0 };
  });

  return {
    windowStart,
    resetsAt: epoch.resetsAt,
    weeklyUsed,
    weeklyRemaining: Math.max(0, 100 - weeklyUsed),
    reservePct: reserve,
    distributable: Math.max(0, 100 - weeklyUsed - reserve),
    today,
    days,
    plannedNow,
    trajectoryFrom: { t: tFrom, v: vFrom },
    deviation: weeklyUsed - plannedNow,
    futurePerDay: future.length ? futurePool / future.length : 0,
    futureDays,
    previews,
  };
}

function pastDay(g: DaySegment, epoch: Epoch, s: Settings, reserve: number, restW: number): BudgetDay {
  const type = dayType(s, g.weekday);
  const common = { key: g.key, start: g.start, end: g.end, weekday: g.weekday, type, status: 'past' as const };
  if (g.end <= epoch.start) {
    // Avant une rupture dans la même fenêtre : non comparable.
    return { ...common, weight: weightOf(s, g, g.start, g.end), budgetPct: null, usedPct: null, quality: null };
  }
  let from = Math.max(g.start, epoch.start);
  const b = valueAt(epoch, from);
  if (b.quality === 'partial') from = Math.max(from, b.knownFrom);
  const w = weightOf(s, g, from, g.end);
  if (from >= g.end) return { ...common, weight: w, budgetPct: null, usedPct: null, quality: 'partial' };
  const budget = share(Math.max(0, 100 - reserve - b.value), w, restW, s.strategy === 'intensive' ? s.intensiveFactor : 1);
  const e = valueAt(epoch, g.end);
  return { ...common, weight: w, budgetPct: budget, usedPct: Math.max(0, e.value - b.value), quality: b.quality };
}
