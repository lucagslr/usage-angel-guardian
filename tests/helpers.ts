import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings';
import { MINUTE, zonedTime } from '../src/core/time';
import type { PlanId, Settings, UsageSnapshot } from '../src/core/types';

export const TZ = 'Europe/Zurich';

/** Heure locale Zurich → ms epoch. */
export function z(y: number, m: number, d: number, h = 0, mi = 0): number {
  return zonedTime(y, m, d, h, TZ) + mi * MINUTE;
}

export function settings(over: Partial<Settings> = {}): Settings {
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...over });
}

export function snap(
  t: number,
  weekly: number | null,
  resetsAt: number | null,
  opts: { fh?: number; fhReset?: number; plan?: PlanId; source?: UsageSnapshot['source'] } = {},
): UsageSnapshot {
  return {
    t,
    source: opts.source ?? 'desktop-mod',
    sevenDay: weekly === null ? null : { pct: weekly, resetsAt },
    fiveHour: opts.fh === undefined ? null : { pct: opts.fh, resetsAt: opts.fhReset ?? null },
    scoped: [],
    ...(opts.plan ? { plan: opts.plan } : {}),
  };
}

/** Série régulière : de `from` à `to` toutes les `step` minutes, % = f(t). */
export function series(from: number, to: number, stepMin: number, f: (t: number) => number, resetsAt: number): UsageSnapshot[] {
  const out: UsageSnapshot[] = [];
  for (let t = from; t <= to; t += stepMin * MINUTE) out.push(snap(t, Math.round(f(t) * 10) / 10, resetsAt));
  return out;
}
