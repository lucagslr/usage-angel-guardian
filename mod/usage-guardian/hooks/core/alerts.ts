// Copie générée depuis src/core par scripts/build-mod.mjs — ne pas éditer ici.
/**
 * Statuts, conseiller de consommation, messages et décisions de notification.
 * Ce sont des recommandations : rien ici ne bloque l'utilisation de Claude.
 */
import type { WeekPlan } from './budget.ts';
import type { WeeklyForecast } from './forecast.ts';
import { fmtDateTime, fmtPct, fmtWeekday } from './format.ts';
import type { PaceResult } from './pace.ts';
import { DAY } from './time.ts';
import type { PaceLevel, StatusLevel, StatusThresholds } from './types.ts';

export function statusFromRatio(ratio: number | null, th: StatusThresholds): StatusLevel {
  if (ratio === null || Number.isNaN(ratio)) return 'unknown';
  if (ratio < th.yellow) return 'green';
  if (ratio < th.orange) return 'yellow';
  if (ratio < th.red) return 'orange';
  if (ratio < th.critical) return 'red';
  return 'critical';
}

const ORDER: StatusLevel[] = ['unknown', 'green', 'yellow', 'orange', 'red', 'critical'];
export const worse = (a: StatusLevel, b: StatusLevel): StatusLevel => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

export const STATUS_LABEL: Record<StatusLevel, string> = {
  green: 'Utilisation maîtrisée',
  yellow: 'À surveiller',
  orange: 'Prudence',
  red: 'Budget du jour dépassé',
  critical: 'Surconsommation critique',
  unknown: 'Données indisponibles',
};

export const STATUS_SHORT: Record<StatusLevel, string> = {
  green: 'VERT', yellow: 'JAUNE', orange: 'ORANGE', red: 'ROUGE', critical: 'CRITIQUE', unknown: '—',
};

/** Icônes textuelles (accessibilité : la couleur n'est jamais le seul signal). */
export const STATUS_ICON: Record<StatusLevel, string> = {
  green: '●', yellow: '◐', orange: '▲', red: '■', critical: '⛔', unknown: '○',
};

export const PACE_LABEL: Record<PaceLevel, string> = {
  idle: 'Au repos',
  calm: 'Rythme calme',
  steady: 'Rythme soutenu',
  fast: 'Rythme rapide',
  'very-fast': 'Rythme dangereusement rapide',
  unknown: 'Rythme inconnu',
};

/** Statut global : ratio du jour, aggravé par le risque hebdomadaire et la réserve entamée. */
export function overallStatus(plan: WeekPlan | null, fc: WeeklyForecast | null, th: StatusThresholds): StatusLevel {
  if (!plan) return 'unknown';
  let s = statusFromRatio(Number.isFinite(plan.today.ratio) ? plan.today.ratio : th.critical, th);
  const highRisk = fc?.exhaustionAt != null && fc.confidence !== 'low' && plan.resetsAt - fc.exhaustionAt > DAY;
  if (highRisk && (s === 'red' || s === 'orange')) s = 'critical';
  if (plan.weeklyRemaining <= plan.reservePct && plan.reservePct > 0) s = worse(s, 'red');
  if (plan.weeklyRemaining <= 0.5) s = 'critical';
  return s;
}

export type FreedomLevel = 'high' | 'normal' | 'caution' | 'slow-down' | 'over' | 'unknown';

export const FREEDOM_LABEL: Record<FreedomLevel, string> = {
  high: 'Liberté élevée',
  normal: 'Utilisation normale',
  caution: 'Prudence recommandée',
  'slow-down': 'Ralentir maintenant',
  over: 'Budget dépassé',
  unknown: 'Pas assez de données',
};

/** Répond à « Puis-je encore beaucoup utiliser Claude aujourd'hui ? » sans nombre de prompts inventé. */
export function advisor(plan: WeekPlan | null, pace: PaceResult, fc: WeeklyForecast | null): FreedomLevel {
  if (!plan) return 'unknown';
  const r = plan.today.ratio;
  const risk = fc?.exhaustionAt != null && fc.confidence !== 'low';
  if (r >= 1) return 'over';
  if (r >= 0.8 || pace.level === 'very-fast' || (pace.level === 'fast' && r >= 0.6)) return 'slow-down';
  if (r >= 0.6 || pace.level === 'fast' || risk) return 'caution';
  if (r < 0.35 && plan.deviation <= -3 && (pace.level === 'idle' || pace.level === 'calm' || pace.level === 'unknown')) return 'high';
  return 'normal';
}

export interface Insight {
  id: string;
  level: 'info' | 'good' | 'warn' | 'danger';
  text: string;
  estimate: boolean;
}

export function buildInsights(p: {
  plan: WeekPlan | null;
  fc: WeeklyForecast | null;
  pace: PaceResult;
  tz: string;
  now: number;
  fiveHour: { used: number; resetsAt: number | null; hitsLimitAt: number | null } | null;
  constraining: { label: string; used: number } | null;
}): Insight[] {
  const out: Insight[] = [];
  const { plan, fc, tz, now } = p;
  if (plan && fc?.exhaustionAt != null) {
    out.push({
      id: 'exhaust', level: 'danger', estimate: true,
      text: `Ton rythme actuel risque d'épuiser le quota ${fmtWeekday(fc.exhaustionAt, tz)} (${fmtDateTime(fc.exhaustionAt, tz)}), alors qu'il se réinitialise ${fmtWeekday(plan.resetsAt, tz)}.`,
    });
  }
  if (plan && plan.today.ratio >= 1) {
    out.push({ id: 'over', level: 'danger', estimate: false, text: 'Tu as consommé ton budget quotidien : une pause est recommandée pour préserver ta capacité des prochains jours.' });
  } else if (plan && plan.deviation <= -5 && !fc?.exhaustionAt) {
    out.push({ id: 'ahead', level: 'good', estimate: false, text: `Tu es en avance sur ton budget : ${fmtPct(-plan.deviation)} de marge par rapport à la trajectoire recommandée.` });
  } else if (plan && plan.deviation >= 5) {
    out.push({ id: 'behind', level: 'warn', estimate: false, text: `Tu as consommé ${fmtPct(plan.deviation)} de plus que la trajectoire recommandée à ce stade de la semaine.` });
  }
  if (plan) {
    const daysLeft = (plan.resetsAt - now) / DAY;
    const dl = daysLeft >= 1.5 ? `${Math.round(daysLeft)} jours` : daysLeft >= 1 ? 'un peu plus d\'un jour' : 'moins d\'un jour';
    out.push({ id: 'left', level: 'info', estimate: false, text: `Il te reste ${fmtPct(plan.weeklyRemaining, 0)} de quota hebdomadaire pour ${dl}.` });
  }
  if (p.pace.level === 'very-fast' || p.pace.level === 'fast') {
    const h = p.pace.hoursToBudget;
    out.push({
      id: 'pace', level: p.pace.level === 'very-fast' ? 'danger' : 'warn', estimate: true,
      text: h !== null && h < 6
        ? `Consommation rapide : à ce rythme, le budget du jour serait épuisé dans ${h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h.toFixed(1).replace('.', ',')} h`}.`
        : 'Consommation nettement plus rapide que le rythme soutenable.',
    });
  }
  if (p.fiveHour?.hitsLimitAt) {
    out.push({ id: '5h', level: 'warn', estimate: true, text: `Au rythme actuel, la limite de 5 h serait atteinte vers ${fmtDateTime(p.fiveHour.hitsLimitAt, tz, false)}.` });
  } else if (p.fiveHour && p.fiveHour.used >= 80) {
    out.push({ id: '5h', level: 'warn', estimate: false, text: `Session de 5 h à ${fmtPct(p.fiveHour.used, 0)} : la limite approche.` });
  }
  if (p.constraining) {
    out.push({ id: 'scoped', level: 'warn', estimate: false, text: `Le quota ${p.constraining.label} (${fmtPct(p.constraining.used, 0)}) est plus contraignant que le quota général.` });
  }
  return out;
}

export interface NotificationRequest {
  key: string;
  title: string;
  message: string;
}

/** Décide des notifications à émettre ; `sent` contient les clés déjà notifiées (anti-répétition). */
export function notificationsToSend(p: {
  plan: WeekPlan | null;
  pace: PaceResult;
  now: number;
  prefs: { dailyWarn: boolean; dailyOver: boolean; fastPace: boolean; weeklyLow: boolean };
  sent: Set<string>;
}): NotificationRequest[] {
  const out: NotificationRequest[] = [];
  const { plan, prefs, sent } = p;
  if (!plan) return out;
  const day = plan.today.key;
  const push = (n: NotificationRequest) => { if (!sent.has(n.key)) out.push(n); };
  if (prefs.dailyOver && plan.today.ratio >= 1) {
    push({ key: `daily-over:${day}`, title: 'Budget du jour dépassé', message: `${fmtPct(plan.today.usedPct)} utilisés pour un budget de ${fmtPct(plan.today.budgetPct)}. Une pause préserverait les prochains jours.` });
  } else if (prefs.dailyWarn && plan.today.ratio >= 0.8) {
    push({ key: `daily-warn:${day}`, title: '80 % du budget du jour', message: `Il reste ${fmtPct(Math.max(0, plan.today.remainingPct))} de budget pour aujourd'hui.` });
  }
  if (prefs.fastPace && p.pace.level === 'very-fast') {
    const slot = Math.floor(p.now / (2 * 3600_000)); // au plus une alerte de rythme toutes les 2 h
    push({ key: `pace:${slot}`, title: 'Rythme de consommation excessif', message: 'La consommation récente dépasse largement le rythme soutenable pour aujourd\'hui.' });
  }
  if (prefs.weeklyLow && plan.weeklyRemaining <= 10) {
    push({ key: `weekly-low:${plan.resetsAt}`, title: 'Quota hebdomadaire presque épuisé', message: `Il reste ${fmtPct(plan.weeklyRemaining)} avant le reset hebdomadaire.` });
  }
  return out;
}
