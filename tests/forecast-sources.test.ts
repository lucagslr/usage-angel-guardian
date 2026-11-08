import { describe, expect, it } from 'vitest';
import { notificationsToSend } from '../src/core/alerts';
import { estimateSession } from '../src/core/forecast';
import { parseDesktopHistory, parseModRateLimits, parseStatuslineInput, validateSnapshot } from '../src/core/normalize';
import { inferWeeklyResets, isWorthStoring, mergeSnapshots } from '../src/core/schedule';
import { computeState, derive } from '../src/core/state';
import { HOUR, MINUTE, WEEK } from '../src/core/time';
import { series, settings, snap, z } from './helpers';

const R = z(2026, 11, 16, 0);

describe('vitesse de consommation', () => {
  it('65 % du budget en 15 minutes : rythme dangereusement rapide', () => {
    const budget = 100 / 7;
    const t0 = z(2026, 11, 9, 10);
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(t0, 0, R), snap(t0 + 5 * MINUTE, 3, R), snap(t0 + 10 * MINUTE, 6, R), snap(t0 + 15 * MINUTE, 0.65 * budget, R)];
    const st = computeState(snaps, settings(), t0 + 15 * MINUTE);
    expect(st.budget!.today.ratio).toBeCloseTo(0.65, 2);
    expect(st.status).toBe('yellow'); // budget non épuisé…
    expect(['fast', 'very-fast']).toContain(st.pace.level); // …mais rythme alarmant
    expect(['slow-down', 'caution']).toContain(st.freedom);
  });

  it('65 % du budget en 12 heures : rythme calme', () => {
    const budget = 100 / 7;
    const from = z(2026, 11, 9, 0);
    const snaps = series(from, from + 12 * HOUR, 10, (t) => (0.65 * budget * (t - from)) / (12 * HOUR), R);
    const st = computeState(snaps, settings(), from + 12 * HOUR + MINUTE);
    expect(st.pace.level).toBe('calm');
  });

  it('aucune hausse récente : au repos', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 9), 4, R), snap(z(2026, 11, 9, 9, 30), 4, R), snap(z(2026, 11, 9, 10), 4, R)];
    expect(computeState(snaps, settings(), z(2026, 11, 9, 10, 1)).pace.level).toBe('idle');
  });
});

describe('prévisions', () => {
  it('rythme soutenu : épuisement estimé avant le reset, confiance élevée', () => {
    const from = R - WEEK;
    const snaps = series(from, from + 60 * HOUR, 30, (t) => (t - from) / HOUR, R); // 1 %/h
    const st = computeState(snaps, settings(), from + 60 * HOUR + MINUTE);
    const fc = st.forecast!;
    expect(fc.windowRate).toBeCloseTo(1, 1);
    expect(fc.exhaustionAt).not.toBeNull();
    expect(fc.exhaustionAt!).toBeLessThan(R);
    expect(fc.confidence).toBe('high');
    expect(st.insights.find((i) => i.id === 'exhaust')?.estimate).toBe(true);
  });

  it('consommation modérée : pas d’épuisement prévu, marge signalée', () => {
    const from = R - WEEK;
    const snaps = series(from, from + 72 * HOUR, 30, (t) => (0.2 * (t - from)) / HOUR, R);
    const st = computeState(snaps, settings(), from + 72 * HOUR + MINUTE);
    expect(st.forecast!.exhaustionAt).toBeNull();
    expect(st.insights.some((i) => i.id === 'ahead')).toBe(true);
  });

  it('simulation de session : historique insuffisant → inconnu', () => {
    const d = derive([snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 1), 1, R)], z(2026, 11, 9, 1));
    const est = estimateSession({ hours: 1, weeklyEpochs: d.weeklyEpochs, fiveHourEpochs: [], weeklyAvailable: 99, todayRemaining: 10, fiveHourUsed: null, fiveHourResetsAt: null, now: z(2026, 11, 9, 1) });
    expect(est.verdict).toBe('unknown');
  });

  it('simulation de session : verdict basé sur l’historique réel', () => {
    const from = R - WEEK;
    const snaps = series(from, from + 30 * HOUR, 15, (t) => (0.5 * (t - from)) / HOUR, R); // 0,5 %/h actif
    const d = derive(snaps, from + 30 * HOUR);
    const mk = (hours: number, avail: number) => estimateSession({ hours, weeklyEpochs: d.weeklyEpochs, fiveHourEpochs: [], weeklyAvailable: avail, todayRemaining: 5, fiveHourUsed: null, fiveHourResetsAt: null, now: from + 30 * HOUR });
    expect(mk(1, 50).verdict).toBe('comfortable');
    expect(mk(3, 1).verdict).toBe('unlikely');
    expect(mk(3, 50).weeklyMedian).toBeCloseTo(1.5, 1);
  });
});

describe('sources de données', () => {
  it('mod Claude Desktop : rateLimits officiels (ISO)', () => {
    const s = parseModRateLimits([
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-11-09T14:00:00.000Z' },
      { kind: 'seven_day', percentUsed: 41.2, resetsAt: '2026-11-13T08:00:00Z' },
      { kind: 'spend_limit', percentUsed: 10 },
    ], 1000)!;
    expect(s.source).toBe('desktop-mod');
    expect(s.fiveHour).toEqual({ pct: 23.5, resetsAt: Date.parse('2026-11-09T14:00:00.000Z') });
    expect(s.sevenDay!.pct).toBe(41.2);
    expect(parseModRateLimits([], 1)).toBeNull();
  });

  it('statusline Claude Code : resets_at en secondes epoch', () => {
    const s = parseStatuslineInput({ rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } } }, 5)!;
    expect(s.fiveHour!.resetsAt).toBe(1738425600 * 1000);
    expect(parseStatuslineInput({ model: {} }, 5)).toBeNull(); // abonnés API : pas de rate_limits
  });

  it('journal de Claude Desktop : % sans heure de reset, autres comptes ignorés', () => {
    const raw = { version: 2, samples: [
      { t: 1, org: 'old', u: { sd: 99 } },
      { t: z(2026, 11, 9, 9), org: 'a', u: { fh: 0, sd: 6, xu: 0 } },
      { t: z(2026, 11, 10, 9), org: 'a', u: { sd: 13 } },
      { t: 'x', org: 'a', u: {} },
    ] };
    const snaps = parseDesktopHistory(raw);
    expect(snaps).toHaveLength(2);
    expect(snaps[1]!.sevenDay).toEqual({ pct: 13, resetsAt: null });
    expect(parseDesktopHistory({ unexpected: true })).toEqual([]);
  });

  it('reset hebdomadaire déduit du cycle fixe à partir d’une heure officielle', () => {
    const anchor = snap(z(2026, 11, 9, 12), 5, R);
    const hist = [snap(z(2026, 11, 18, 9), 20, null, { source: 'desktop-history' }), snap(z(2026, 11, 3, 9), 40, null, { source: 'desktop-history' })];
    const out = inferWeeklyResets([...hist, anchor], null);
    expect(out[0]!.sevenDay).toEqual({ pct: 20, resetsAt: R + WEEK, resetInferred: true });
    expect(out[1]!.sevenDay!.resetsAt).toBe(R - WEEK);
    const st = computeState(hist.slice(0, 1), settings(), z(2026, 11, 18, 9, 1));
    expect(st.budget).toBeNull();
    expect(st.insights.some((i) => i.id === 'no-reset')).toBe(true);
    const manual = computeState(hist.slice(0, 1), settings({ manualWeeklyReset: R }), z(2026, 11, 18, 9, 1));
    expect(manual.weekly!.resetOrigin).toBe('inferred');
  });

  it('plusieurs sessions écrivent la même mesure : dédoublonnage', () => {
    const a = snap(z(2026, 11, 9, 9), 5, R);
    expect(mergeSnapshots([a], [{ ...a, t: a.t + 2000 }])).toHaveLength(1);
    expect(isWorthStoring(a, { ...a, t: a.t + MINUTE })).toBe(false);
    expect(isWorthStoring(a, snap(a.t + MINUTE, 6, R))).toBe(true);
  });

  it("format inconnu (évolution de l'interface Claude) : rejet propre", () => {
    expect(validateSnapshot({ t: 'nope' })).toBeNull();
    expect(validateSnapshot({ t: 5, sevenDay: { pct: -3 } })).toBeNull();
    expect(validateSnapshot({ t: 5, source: 'desktop-mod', sevenDay: { pct: 3, resetsAt: 9e12 } })!.sevenDay!.pct).toBe(3);
  });
});

describe('notifications', () => {
  it('anti-répétition par jour', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 12), 13, R)];
    const st = computeState(snaps, settings(), z(2026, 11, 9, 12, 1));
    const prefs = { dailyWarn: true, dailyOver: true, fastPace: false, weeklyLow: true };
    const first = notificationsToSend({ plan: st.budget, pace: st.pace, now: st.now, prefs, sent: new Set() });
    expect(first.map((n) => n.key)).toEqual(['daily-warn:2026-11-09']);
    expect(notificationsToSend({ plan: st.budget, pace: st.pace, now: st.now, prefs, sent: new Set(['daily-warn:2026-11-09']) })).toEqual([]);
  });
});
