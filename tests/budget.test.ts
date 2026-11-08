import { describe, expect, it } from 'vitest';
import { computeState } from '../src/core/state';
import { HOUR, MINUTE, WEEK } from '../src/core/time';
import { settings, snap, z } from './helpers';

// Semaine « ronde » : reset lundi 16 nov. 00:00 → fenêtre du lundi 9 nov. 00:00.
const R = z(2026, 11, 16, 0);
// Semaine réelle : reset vendredi 13 nov. 09:00 (ne commence pas lundi minuit).
const RF = z(2026, 11, 13, 9);

const at = (snaps: ReturnType<typeof snap>[], now: number, s = settings()) => computeState(snaps, s, now);

describe('répartition quotidienne', () => {
  it('semaine sans consommation : 100 / 7 = 14,2857 % par jour', () => {
    const st = at([snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 10), 0, R)], z(2026, 11, 9, 10, 5));
    expect(st.budget!.today.budgetPct).toBeCloseTo(100 / 7, 3);
    expect(st.budget!.today.usedPct).toBe(0);
    expect(st.status).toBe('green');
  });

  it('jours partiels : la semaine officielle commence vendredi 09:00', () => {
    const st = at([snap(RF - WEEK + MINUTE, 0, RF), snap(z(2026, 11, 6, 12), 0, RF)], z(2026, 11, 6, 12, 1));
    // Aujourd'hui = 15 h sur 168 h.
    expect(st.budget!.today.budgetPct).toBeCloseTo((100 * 15) / 168, 3);
    expect(st.budget!.today.baselineQuality).toBe('window-start');
    expect(st.budget!.days).toHaveLength(8);
  });

  it('consommation faible : la part non utilisée est redistribuée sur les jours restants', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 18), 7, R), snap(z(2026, 11, 9, 23, 55), 7, R), snap(z(2026, 11, 10, 8), 7, R)];
    const st = at(snaps, z(2026, 11, 10, 8, 1));
    expect(st.budget!.today.baselineQuality).toBe('exact');
    expect(st.budget!.today.budgetPct).toBeCloseTo(93 / 6, 3); // 15,5 % > 14,29 %
    const past = st.budget!.days.find((d) => d.key === '2026-11-09')!;
    expect(past.usedPct).toBeCloseTo(7, 5);
    expect(past.budgetPct).toBeCloseTo(100 / 7, 3); // budget de référence figé
  });

  it('dépassement : les budgets suivants diminuent et le statut passe au rouge', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 20), 20, R)];
    const st = at(snaps, z(2026, 11, 9, 20, 1));
    expect(st.budget!.today.ratio).toBeCloseTo(1.4, 2);
    expect(st.status).toBe('red');
    const tomorrow = st.budget!.days.find((d) => d.status === 'future')!;
    expect(tomorrow.budgetPct!).toBeCloseTo(80 / 6, 3);
    const next = at([...snaps, snap(z(2026, 11, 10, 7), 20, R)], z(2026, 11, 10, 7, 1));
    expect(next.budget!.today.budgetPct).toBeCloseTo(80 / 6, 3);
  });

  it('forte surconsommation : statut critique', () => {
    const st = at([snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 12), 30, R)], z(2026, 11, 9, 12, 1));
    expect(st.status).toBe('critical');
    expect(st.freedom).toBe('over');
  });

  it('plusieurs jours sans activité : le restant est réparti sur moins de jours', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 23, 50), 10, R), snap(z(2026, 11, 12, 10), 10, R)];
    const st = at(snaps, z(2026, 11, 12, 10, 1));
    expect(st.budget!.today.baselinePct).toBe(10);
    expect(st.budget!.today.budgetPct).toBeCloseTo(90 / 4, 3);
  });

  it('quota hebdomadaire quasiment épuisé', () => {
    const st = at([snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 14, 0, 30), 98, R), snap(z(2026, 11, 14, 9), 98, R)], z(2026, 11, 14, 9, 1));
    expect(st.budget!.distributable).toBeCloseTo(2, 5);
    expect(st.budget!.today.budgetPct).toBeLessThanOrEqual(2);
    expect(st.insights.some((i) => i.id === 'left')).toBe(true);
  });

  it('mode conservateur : réserve préservée', () => {
    const s = settings({ strategy: 'conservative', conservativeReservePct: 15 });
    const st = at([snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 1), 0, R)], z(2026, 11, 9, 1, 1), s);
    expect(st.budget!.reservePct).toBe(15);
    expect(st.budget!.today.budgetPct).toBeCloseTo(85 / 7, 3);
  });

  it("mode intensif : plus aujourd'hui, impact visible sur les jours suivants", () => {
    const s = settings({ strategy: 'intensive', intensiveFactor: 2 });
    const st = at([snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 1), 0, R)], z(2026, 11, 9, 1, 1), s);
    expect(st.budget!.today.budgetPct).toBeCloseTo(200 / 8, 3);
    const p = Object.fromEntries(st.budget!.previews.map((x) => [x.strategy, x]));
    expect(p.intensive!.futurePerDay).toBeLessThan(p.balanced!.futurePerDay);
  });

  it('jours de repos et de forte activité pondèrent la répartition', () => {
    const types = settings().weekdayTypes.map((_, i) => (i === 0 || i === 6 ? 'rest' : i === 1 ? 'heavy' : 'normal'));
    const s = settings({ weekdayTypes: types as never });
    const st = at([snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 1), 0, R)], z(2026, 11, 9, 1, 1), s); // lundi = heavy
    const w = s.dayTypeWeights;
    expect(st.budget!.today.budgetPct).toBeCloseTo((100 * w.heavy) / (w.heavy + 4 * w.normal + 2 * w.rest), 3);
  });

  it('changement de mode de répartition : recalcul immédiat', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 1), 0, R)];
    const a = at(snaps, z(2026, 11, 9, 1, 1), settings({ strategy: 'balanced' }));
    const b = at(snaps, z(2026, 11, 9, 1, 1), settings({ strategy: 'conservative' }));
    expect(b.budget!.today.budgetPct).toBeLessThan(a.budget!.today.budgetPct);
  });
});

describe('historique incomplet et données manquantes', () => {
  it('pas de mesure avant aujourd’hui : indicateur partiel, suivi depuis la 1re mesure', () => {
    const snaps = [snap(z(2026, 11, 12, 14), 40, R), snap(z(2026, 11, 12, 16), 44, R)];
    const st = at(snaps, z(2026, 11, 12, 16, 1));
    expect(st.budget!.today.baselineQuality).toBe('partial');
    expect(st.budget!.today.trackedSince).toBe(z(2026, 11, 12, 14));
    expect(st.budget!.today.usedPct).toBeCloseTo(4, 5);
    expect(st.insights.some((i) => i.id === 'partial')).toBe(true);
  });

  it('base interpolée entre deux mesures éloignées : bornes exposées', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 22), 10, R), snap(z(2026, 11, 10, 9), 15, R)];
    const st = at(snaps, z(2026, 11, 10, 9, 1));
    expect(st.budget!.today.baselineQuality).toBe('approximate');
    expect(st.budget!.today.usedRange).toEqual([0, 5]);
  });

  it('perte de connexion : données périmées, prévisions et rythme suspendus', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 10), 5, R)];
    const st = at(snaps, z(2026, 11, 9, 14));
    expect(st.freshness).toBe('stale');
    expect(st.forecast).toBeNull();
    expect(st.pace.level).toBe('unknown');
    expect(st.weekly!.used).toBe(5); // dernière valeur fiable conservée
    expect(st.insights[0]!.id).toBe('stale');
  });

  it('aucune donnée : état inconnu, rien d’inventé', () => {
    const st = at([], z(2026, 11, 9, 12));
    expect(st.status).toBe('unknown');
    expect(st.weekly).toBeNull();
    expect(st.budget).toBeNull();
    expect(st.freshness).toBe('none');
  });

  it('redémarrage : l’état recalculé depuis l’historique sérialisé est identique', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 12), 6, R)];
    const now = z(2026, 11, 9, 12, 1);
    const reloaded = JSON.parse(JSON.stringify(snaps));
    expect(at(reloaded, now).budget).toEqual(at(snaps, now).budget);
  });
});

describe('réinitialisations et ruptures', () => {
  it('reset officiel de 5 h : nouvelle fenêtre active', () => {
    const A = z(2026, 11, 9, 14);
    const B = z(2026, 11, 9, 20);
    const snaps = [
      snap(z(2026, 11, 9, 9), 1, R, { fh: 80, fhReset: A }),
      snap(z(2026, 11, 9, 15), 2, R, { fh: 3, fhReset: B }),
    ];
    const st = at(snaps, z(2026, 11, 9, 15, 1));
    expect(st.fiveHour!.used).toBe(3);
    expect(st.fiveHour!.resetsAt).toBe(B);
  });

  it('reset hebdomadaire au milieu d’une journée', () => {
    const snaps = [snap(z(2026, 11, 13, 0), 80, RF), snap(z(2026, 11, 13, 8, 55), 84, RF), snap(z(2026, 11, 13, 9, 10), 1, RF + WEEK)];
    const st = at(snaps, z(2026, 11, 13, 9, 11));
    expect(st.weekly!.resetsAt).toBe(RF + WEEK);
    expect(st.budget!.today.trackedSince).toBe(RF);
    expect(st.budget!.today.baselineQuality).toBe('window-start');
    expect(st.budget!.today.usedPct).toBe(1);
    expect(st.budget!.today.usedBeforeReset).toBeCloseTo(4, 5);
  });

  it('réinitialisation anticipée détectée', () => {
    const newReset = z(2026, 11, 17, 15);
    const snaps = [snap(z(2026, 11, 10, 9), 60, RF), snap(z(2026, 11, 10, 15, 30), 0, newReset)];
    const st = at(snaps, z(2026, 11, 10, 15, 31));
    expect(st.weekly!.used).toBe(0);
    expect(st.budget!.resetsAt).toBe(newReset);
    expect(st.budget!.today.baselinePct).toBe(0);
  });

  it("changement d'abonnement : rupture, calcul repris depuis le changement", () => {
    const snaps = [
      snap(z(2026, 11, 10, 0), 50, R, { plan: 'pro' }),
      snap(z(2026, 11, 10, 9), 60, R, { plan: 'pro' }),
      snap(z(2026, 11, 10, 9, 30), 12, R, { plan: 'max' }),
      snap(z(2026, 11, 10, 11), 14, R, { plan: 'max' }),
    ];
    const st = at(snaps, z(2026, 11, 10, 11, 1));
    expect(st.budget!.today.trackedSince).toBe(z(2026, 11, 10, 9, 30));
    expect(st.budget!.today.usedPct).toBeCloseTo(2, 5);
  });

  it('heure de reset légèrement différente selon la source, sans baisse : pas de faux reset', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 10, 9), 20, R), snap(z(2026, 11, 10, 10), 21, R + 3 * HOUR, { source: 'manual' })];
    const st = at(snaps, z(2026, 11, 10, 10, 1));
    expect(st.budget!.today.usedPct).toBeCloseTo(21 - (20 * 24) / 33, 3); // interpolation, pas 21 (faux reset)
    expect(st.budget!.today.baselineQuality).toBe("approximate");
    expect(st.weekly!.resetsAt).toBe(R + 3 * HOUR);
  });

  it('baisse inexpliquée sans changement de reset : nouvelle époque, pas de consommation négative', () => {
    const snaps = [snap(z(2026, 11, 10, 0), 40, R), snap(z(2026, 11, 10, 9), 41, R), snap(z(2026, 11, 10, 10), 30, R)];
    const st = at(snaps, z(2026, 11, 10, 10, 1));
    expect(st.budget!.today.usedPct).toBeGreaterThanOrEqual(0);
  });
});

describe('changements d’heure et de fuseau', () => {
  it("journée de 25 h (heure d'hiver) pondérée par sa durée réelle", () => {
    const R2 = z(2026, 10, 26, 0); // fenêtre du 19 au 26 octobre, dimanche 25 = 25 h
    const st = at([snap(z(2026, 10, 25, 0), 30, R2), snap(z(2026, 10, 25, 1), 30, R2)], z(2026, 10, 25, 1, 1));
    expect(st.budget!.today.budgetPct).toBeCloseTo(70, 3); // dernier jour : tout le restant
    const st2 = at([snap(z(2026, 10, 24, 0), 30, R2), snap(z(2026, 10, 24, 1), 30, R2)], z(2026, 10, 24, 1, 1));
    expect(st2.budget!.today.budgetPct).toBeCloseTo((70 * 24) / 49, 3);
  });

  it('changement de fuseau : les journées sont recalculées', () => {
    const snaps = [snap(z(2026, 11, 9, 0), 0, R), snap(z(2026, 11, 9, 5), 2, R)];
    const zh = at(snaps, z(2026, 11, 9, 5, 1));
    const ny = at(snaps, z(2026, 11, 9, 5, 1), settings({ timezone: 'America/New_York' }));
    expect(zh.budget!.today.key).toBe('2026-11-09');
    expect(ny.budget!.today.key).toBe('2026-11-08');
  });

  it('début de semaine à la frontière exacte', () => {
    const st = at([snap(R - WEEK, 0, R)], R - WEEK + HOUR);
    expect(st.budget!.today.budgetPct).toBeCloseTo(100 / 7, 3);
  });
});
