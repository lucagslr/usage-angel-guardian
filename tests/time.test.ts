import { describe, expect, it } from 'vitest';
import { HOUR, dayKey, dayStart, nextDayStart, segmentDays, tzOffset } from '../src/core/time';
import { TZ, z } from './helpers';

describe('fuseau Europe/Zurich', () => {
  it('début de journée à minuit local', () => {
    const t = z(2026, 11, 10, 15, 30);
    expect(dayStart(t, TZ, 0)).toBe(z(2026, 11, 10, 0));
    expect(nextDayStart(t, TZ, 0)).toBe(z(2026, 11, 11, 0));
    expect(dayKey(t, TZ, 0)).toBe('2026-11-10');
  });

  it('heure de début de journée configurable (4 h)', () => {
    expect(dayKey(z(2026, 11, 10, 3), TZ, 4)).toBe('2026-11-09');
    expect(dayStart(z(2026, 11, 10, 3), TZ, 4)).toBe(z(2026, 11, 9, 4));
  });

  it("passage à l'heure d'été : journée de 23 h", () => {
    const s = dayStart(z(2026, 3, 29, 12), TZ, 0);
    expect((nextDayStart(s, TZ, 0) - s) / HOUR).toBe(23);
  });

  it("passage à l'heure d'hiver : journée de 25 h", () => {
    const s = dayStart(z(2026, 10, 25, 12), TZ, 0);
    expect((nextDayStart(s, TZ, 0) - s) / HOUR).toBe(25);
    expect(tzOffset(z(2026, 10, 26, 12), TZ)).toBe(HOUR);
  });

  it('découpe une semaine qui ne commence pas lundi minuit (jours partiels)', () => {
    const segs = segmentDays(z(2026, 11, 6, 9), z(2026, 11, 13, 9), TZ, 0);
    expect(segs).toHaveLength(8);
    expect((segs[0]!.end - segs[0]!.start) / HOUR).toBe(15);
    expect((segs[7]!.end - segs[7]!.start) / HOUR).toBe(9);
    expect(segs[0]!.weekday).toBe(5); // vendredi
  });
});
