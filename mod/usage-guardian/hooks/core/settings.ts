// Copie générée depuis src/core par scripts/build-mod.mjs — ne pas éditer ici.
import { isValidTimezone } from './time.ts';
import type { DayType, PlanId, Settings, Strategy } from './types.ts';

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  timezone: 'Europe/Zurich',
  dayStartHour: 0,
  strategy: 'balanced',
  personalReservePct: 0,
  conservativeReservePct: 15,
  intensiveFactor: 2,
  weekdayTypes: ['normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal'],
  dayTypeWeights: { normal: 1, heavy: 1.6, rest: 0.3 },
  thresholds: { yellow: 0.6, orange: 0.8, red: 1.0, critical: 1.5 },
  activeHoursPerDay: 8,
  manualPlan: 'auto',
  freshMinutes: 15,
  staleMinutes: 180,
  retentionDays: 180,
  manualWeeklyReset: null,
  notifications: {
    enabled: true,
    quiet: false,
    dailyWarn: true,
    dailyOver: true,
    fastPace: true,
    weeklyLow: true,
    resets: true,
  },
  lowMemory: true,
  overlay: {
    enabled: true,
    anchor: 'above-input',
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    opacity: 1,
    theme: 'auto',
    reducedMotion: false,
    showSecondLine: true,
  },
};

const STRATEGIES: Strategy[] = ['balanced', 'conservative', 'intensive'];
const DAY_TYPES: DayType[] = ['normal', 'heavy', 'rest'];
const PLANS: (PlanId | 'auto')[] = ['auto', 'free', 'pro', 'max', 'ultra', 'team', 'enterprise', 'unknown'];

function num(v: unknown, def: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}
function pick<T>(v: unknown, allowed: readonly T[], def: T): T {
  return allowed.includes(v as T) ? (v as T) : def;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Fusionne des paramètres partiels/anciens avec les valeurs par défaut et les valide. */
export function normalizeSettings(input: unknown): Settings {
  const i = obj(input);
  const d = DEFAULT_SETTINGS;
  const th = obj(i.thresholds);
  const n = obj(i.notifications);
  const ov = obj(i.overlay);
  const w = obj(i.dayTypeWeights);
  const yellow = num(th.yellow, d.thresholds.yellow, 0.05, 0.99);
  const orange = num(th.orange, d.thresholds.orange, yellow, 0.999);
  const red = num(th.red, d.thresholds.red, orange, 5);
  const critical = num(th.critical, d.thresholds.critical, red, 10);
  const weekdayTypes = Array.isArray(i.weekdayTypes) && i.weekdayTypes.length === 7
    ? i.weekdayTypes.map((x) => pick(x, DAY_TYPES, 'normal'))
    : [...d.weekdayTypes];
  return {
    version: 1,
    timezone: typeof i.timezone === 'string' && isValidTimezone(i.timezone) ? i.timezone : d.timezone,
    dayStartHour: Math.round(num(i.dayStartHour, d.dayStartHour, 0, 23)),
    strategy: pick(i.strategy, STRATEGIES, d.strategy),
    personalReservePct: num(i.personalReservePct, d.personalReservePct, 0, 50),
    conservativeReservePct: num(i.conservativeReservePct, d.conservativeReservePct, 0, 40),
    intensiveFactor: num(i.intensiveFactor, d.intensiveFactor, 1, 5),
    weekdayTypes,
    dayTypeWeights: {
      normal: num(w.normal, d.dayTypeWeights.normal, 0.05, 5),
      heavy: num(w.heavy, d.dayTypeWeights.heavy, 0.05, 5),
      rest: num(w.rest, d.dayTypeWeights.rest, 0, 5),
    },
    thresholds: { yellow, orange, red, critical },
    activeHoursPerDay: num(i.activeHoursPerDay, d.activeHoursPerDay, 1, 24),
    manualPlan: pick(i.manualPlan, PLANS, d.manualPlan),
    freshMinutes: Math.round(num(i.freshMinutes, d.freshMinutes, 1, 240)),
    staleMinutes: Math.round(num(i.staleMinutes, d.staleMinutes, 5, 2880)),
    retentionDays: Math.round(num(i.retentionDays, d.retentionDays, 7, 730)),
    manualWeeklyReset: typeof i.manualWeeklyReset === 'number' && Number.isFinite(i.manualWeeklyReset) ? i.manualWeeklyReset : null,
    notifications: {
      enabled: bool(n.enabled, d.notifications.enabled),
      quiet: bool(n.quiet, d.notifications.quiet),
      dailyWarn: bool(n.dailyWarn, d.notifications.dailyWarn),
      dailyOver: bool(n.dailyOver, d.notifications.dailyOver),
      fastPace: bool(n.fastPace, d.notifications.fastPace),
      weeklyLow: bool(n.weeklyLow, d.notifications.weeklyLow),
      resets: bool(n.resets, d.notifications.resets),
    },
    lowMemory: bool(i.lowMemory, d.lowMemory),
    overlay: {
      enabled: bool(ov.enabled, d.overlay.enabled),
      anchor: pick(ov.anchor, ['above-input', 'titlebar', 'bottom-edge'] as const, d.overlay.anchor),
      offsetX: num(ov.offsetX, 0, -4000, 4000),
      offsetY: num(ov.offsetY, 0, -4000, 4000),
      scale: num(ov.scale, d.overlay.scale, 0.75, 1.6),
      opacity: num(ov.opacity, d.overlay.opacity, 0.5, 1),
      theme: pick(ov.theme, ['auto', 'light', 'dark'] as const, d.overlay.theme),
      reducedMotion: bool(ov.reducedMotion, d.overlay.reducedMotion),
      showSecondLine: bool(ov.showSecondLine, d.overlay.showSecondLine),
    },
  };
}

/** Réserve totale (% du quota hebdo) appliquée par la stratégie courante. */
export function effectiveReserve(s: Settings): number {
  const extra = s.strategy === 'conservative' ? s.conservativeReservePct : 0;
  return Math.min(60, s.personalReservePct + extra);
}
