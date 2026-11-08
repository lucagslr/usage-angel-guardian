/**
 * Agrège toutes les briques en un « état » sérialisable, consommé par l'interface
 * (barre, popup, dashboard) et par la statusline. L'interface ne dépend jamais
 * directement d'une source de données : uniquement de cet état.
 */
import { advisor, buildInsights, overallStatus, STATUS_LABEL, type FreedomLevel, type Insight } from './alerts';
import { computeWeekPlan, type WeekPlan } from './budget';
import { forecastWeekly, type WeeklyForecast } from './forecast';
import { computePace, fiveHourProjection, type PaceResult } from './pace';
import { activeEpoch, buildEpochs, fiveHourOf, latest, toPoints, weeklyOf, type Epoch } from './series';
import { inferWeeklyResets } from './schedule';
import { FIVE_HOURS, MINUTE, WEEK } from './time';
import type { PlanId, Settings, SourceId, StatusLevel, UsageSnapshot } from './types';

export const PLAN_LABEL: Record<PlanId, string> = {
  free: 'Free', pro: 'Pro', max: 'Max', ultra: 'Ultra / Max 20×', team: 'Team', enterprise: 'Enterprise', unknown: 'Inconnu',
};

export interface StateMeta {
  detectedPlan?: PlanId;
  planEvidence?: string;
  lastError?: string | null;
  lastErrorAt?: number | null;
}

export interface GuardianState {
  v: 1;
  now: number;
  tz: string;
  data: { lastAt: number | null; ageMs: number | null; stale: boolean; source: SourceId | null; error: string | null };
  plan: { id: PlanId; label: string; origin: 'detected' | 'manual' | 'unknown'; evidence: string | null };
  weekly: {
    used: number;
    remaining: number;
    /** null si aucune heure de reset n'est connue (journal Desktop seul, sans ancre). */
    resetsAt: number | null;
    windowStart: number | null;
    /** Provenance du % (source de la dernière mesure). */
    source: SourceId;
    /** L'heure de reset est rapportée par Claude, déduite du cycle hebdomadaire, ou saisie. */
    resetOrigin: 'official' | 'inferred' | 'unknown';
    measuredAt: number;
  } | null;
  fiveHour: {
    used: number;
    remaining: number;
    /** null si la source ne fournit pas l'heure de reset (journal de Claude Desktop). */
    resetsAt: number | null;
    hitsLimitAt: number | null;
    level: StatusLevel;
    source: SourceId;
    measuredAt: number;
  } | null;
  /** Freshness : 'fresh' < freshMinutes ≤ 'aging' < staleMinutes ≤ 'stale'. */
  freshness: 'fresh' | 'aging' | 'stale' | 'none';
  scoped: { key: string; label: string; used: number; resetsAt: number | null; constraining: boolean }[];
  budget: WeekPlan | null;
  status: StatusLevel;
  statusLabel: string;
  pace: PaceResult;
  freedom: FreedomLevel;
  forecast: WeeklyForecast | null;
  insights: Insight[];
}

export interface Derived {
  weeklyEpochs: Epoch[];
  fiveHourEpochs: Epoch[];
  weekly: Epoch | null;
  fiveHour: Epoch | null;
}

export function derive(snaps: UsageSnapshot[], now: number): Derived {
  const weeklyEpochs = buildEpochs(toPoints(snaps, weeklyOf), WEEK);
  const fiveHourEpochs = buildEpochs(toPoints(snaps, fiveHourOf), FIVE_HOURS);
  return {
    weeklyEpochs,
    fiveHourEpochs,
    weekly: activeEpoch(weeklyEpochs, now),
    fiveHour: activeEpoch(fiveHourEpochs, now),
  };
}

function fiveHourLevel(used: number): StatusLevel {
  if (used >= 100) return 'critical';
  if (used >= 90) return 'red';
  if (used >= 80) return 'orange';
  if (used >= 60) return 'yellow';
  return 'green';
}

export function computeState(snaps: UsageSnapshot[], settings: Settings, now: number, meta: StateMeta = {}): GuardianState {
  const sorted = inferWeeklyResets([...snaps].sort((a, b) => a.t - b.t), settings.manualWeeklyReset);
  const last = sorted[sorted.length - 1] ?? null;
  const d = derive(sorted, now);
  const tz = settings.timezone;

  const ageMs = last ? now - last.t : null;
  const stale = ageMs === null || ageMs > settings.staleMinutes * MINUTE;
  const freshness: GuardianState['freshness'] = ageMs === null ? 'none' : stale ? 'stale' : ageMs > settings.freshMinutes * MINUTE ? 'aging' : 'fresh';

  const detected = meta.detectedPlan ?? [...sorted].reverse().find((s) => s.plan)?.plan;
  const plan: GuardianState['plan'] = settings.manualPlan !== 'auto'
    ? { id: settings.manualPlan, label: PLAN_LABEL[settings.manualPlan], origin: 'manual', evidence: null }
    : detected && detected !== 'unknown'
      ? { id: detected, label: PLAN_LABEL[detected], origin: 'detected', evidence: meta.planEvidence ?? null }
      : { id: 'unknown', label: PLAN_LABEL.unknown, origin: 'unknown', evidence: meta.planEvidence ?? null };

  const w = d.weekly;
  const lastWeeklySnap = w ? [...sorted].reverse().find((x) => x.t === latest(w).t && x.sevenDay) : undefined;
  const weekly: GuardianState['weekly'] = w
    ? {
        used: latest(w).pct,
        remaining: Math.max(0, 100 - latest(w).pct),
        resetsAt: w.resetsAt,
        windowStart: w.resetsAt - WEEK,
        source: lastWeeklySnap?.source ?? 'import',
        resetOrigin: lastWeeklySnap?.sevenDay?.resetInferred ? 'inferred' : 'official',
        measuredAt: latest(w).t,
      }
    : null;
  const lastSd = [...sorted].reverse().find((x) => x.sevenDay);
  const weeklyFinal: GuardianState['weekly'] = weekly && (!lastSd || lastSd.t <= weekly.measuredAt || lastSd.sevenDay!.resetsAt)
    ? weekly
    : lastSd?.sevenDay && !lastSd.sevenDay.resetsAt
      ? { used: lastSd.sevenDay.pct, remaining: Math.max(0, 100 - lastSd.sevenDay.pct), resetsAt: null, windowStart: null, source: lastSd.source, resetOrigin: 'unknown', measuredAt: lastSd.t }
      : weekly;
  const prior = w ? d.weeklyEpochs.filter((e) => e !== w) : [];
  const budget = w ? computeWeekPlan(w, prior, settings, now) : null;
  // Prévisions suspendues sur données périmées (aucune extrapolation sur des valeurs anciennes).
  const forecast = w && !stale ? forecastWeekly(w, now) : null;

  const f = d.fiveHour;
  const proj = fiveHourProjection(f, now);
  let fiveHour: GuardianState['fiveHour'] = null;
  if (f) {
    const src = [...sorted].reverse().find((x) => x.t === latest(f).t && x.fiveHour)?.source ?? 'import';
    fiveHour = { used: latest(f).pct, remaining: Math.max(0, 100 - latest(f).pct), resetsAt: f.resetsAt, hitsLimitAt: proj.hitsLimitAt, level: fiveHourLevel(latest(f).pct), source: src, measuredAt: latest(f).t };
  }
  const lastFh = [...sorted].reverse().find((x) => x.fiveHour);
  if (lastFh?.fiveHour && (!fiveHour || lastFh.t > fiveHour.measuredAt) && lastFh.fiveHour.resetsAt === null && now - lastFh.t < FIVE_HOURS) {
    // Mesure sans heure de reset (journal Desktop) : affichée telle quelle, sans compte à rebours.
    const u = lastFh.fiveHour.pct;
    fiveHour = { used: u, remaining: Math.max(0, 100 - u), resetsAt: null, hitsLimitAt: null, level: fiveHourLevel(u), source: lastFh.source, measuredAt: lastFh.t };
  }

  const scopedRaw = last?.scoped.filter((q) => q.resetsAt === null || q.resetsAt > now) ?? [];
  let worst: { label: string; used: number } | null = null;
  const scoped = scopedRaw.map((q) => {
    const constraining = !!weekly && q.pct > weekly.used && q.pct >= 30;
    if (constraining && (!worst || q.pct > worst.used)) worst = { label: q.label, used: q.pct };
    return { key: q.key, label: q.label, used: q.pct, resetsAt: q.resetsAt, constraining };
  });

  const pace = computePace(stale ? null : w, now, budget?.today.budgetPct ?? null, budget?.today.remainingPct ?? null, settings.activeHoursPerDay);
  const status = overallStatus(budget, forecast, settings.thresholds);
  const insights = buildInsights({
    plan: budget, fc: forecast, pace, tz, now,
    fiveHour: fiveHour ? { used: fiveHour.used, resetsAt: fiveHour.resetsAt, hitsLimitAt: fiveHour.hitsLimitAt } : null,
    constraining: worst,
  });
  if (stale && last) {
    insights.unshift({ id: 'stale', level: 'warn', estimate: false, text: 'Dernière mesure ancienne : les valeurs affichées peuvent ne plus être à jour.' });
  }
  if (!w && last?.sevenDay && !last.sevenDay.resetsAt) {
    insights.unshift({ id: 'no-reset', level: 'warn', estimate: false, text: "Heure de reset hebdomadaire inconnue : ouvre une session dans l'onglet Code (mod actif) ou saisis-la dans les paramètres pour activer le budget quotidien." });
  }
  if (!w && last?.sevenDay?.resetsAt && last.sevenDay.resetsAt <= now) {
    insights.unshift({ id: 'reset-wait', level: 'info', estimate: false, text: 'Quota hebdomadaire réinitialisé : en attente d\'une nouvelle mesure.' });
  }
  if (budget && budget.today.baselineQuality === 'partial') {
    insights.push({ id: 'partial', level: 'info', estimate: false, text: 'Historique insuffisant pour mesurer toute la journée : consommation suivie depuis la première mesure du jour.' });
  }

  return {
    v: 1,
    now,
    tz,
    data: { lastAt: last?.t ?? null, ageMs, stale, source: last?.source ?? null, error: meta.lastError ?? null },
    freshness,
    plan,
    weekly: weeklyFinal,
    fiveHour,
    scoped,
    budget,
    status,
    statusLabel: STATUS_LABEL[status],
    pace,
    freedom: advisor(budget, pace, forecast),
    forecast,
    insights,
  };
}
