// Copie générée depuis src/core par scripts/build-mod.mjs — ne pas éditer ici.
/**
 * Calculs de dates dans un fuseau IANA (Europe/Zurich par défaut), sans dépendance.
 * Gère les journées de 23 h / 25 h des changements d'heure.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const FIVE_HOURS = 5 * HOUR;

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = dimanche
}

export function localParts(t: number, tz: string): LocalParts {
  const out: Partial<LocalParts> = {};
  for (const p of formatter(tz).formatToParts(new Date(t))) {
    switch (p.type) {
      case 'year': out.year = +p.value; break;
      case 'month': out.month = +p.value; break;
      case 'day': out.day = +p.value; break;
      case 'hour': out.hour = +p.value; break;
      case 'minute': out.minute = +p.value; break;
      case 'second': out.second = +p.value; break;
      case 'weekday': out.weekday = WEEKDAYS[p.value] ?? 0; break;
    }
  }
  return out as LocalParts;
}

/** Décalage du fuseau par rapport à UTC à l'instant t (ms, positif à l'est). */
export function tzOffset(t: number, tz: string): number {
  const p = localParts(t, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Instant UTC correspondant à une heure locale (année, mois 1–12, jour, heure). */
export function zonedTime(year: number, month: number, day: number, hour: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  const t1 = guess - tzOffset(guess, tz);
  const t2 = guess - tzOffset(t1, tz);
  return t2;
}

function addCalendarDays(year: number, month: number, day: number, n: number): [number, number, number] {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** Début de la « journée de budget » contenant t. */
export function dayStart(t: number, tz: string, startHour: number): number {
  const p = localParts(t, tz);
  let [y, m, d] = [p.year, p.month, p.day];
  if (p.hour < startHour) [y, m, d] = addCalendarDays(y, m, d, -1);
  let s = zonedTime(y, m, d, startHour, tz);
  // Sécurité pour les heures inexistantes (passage à l'heure d'été).
  if (s > t) {
    [y, m, d] = addCalendarDays(y, m, d, -1);
    s = zonedTime(y, m, d, startHour, tz);
  }
  return s;
}

export function nextDayStart(t: number, tz: string, startHour: number): number {
  const s = dayStart(t, tz, startHour);
  const p = localParts(s + 12 * HOUR, tz); // milieu de journée : date locale non ambiguë
  const [y, m, d] = addCalendarDays(p.year, p.month, p.day, startHour >= 12 ? 0 : 1);
  let n = zonedTime(y, m, d, startHour, tz);
  if (n <= s) n = zonedTime(...addCalendarDays(y, m, d, 1), startHour, tz);
  return n;
}

/** Clé "AAAA-MM-JJ" de la journée de budget (date locale de son début). */
export function dayKey(t: number, tz: string, startHour: number): string {
  const p = localParts(dayStart(t, tz, startHour), tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export interface DaySegment {
  key: string;
  /** Début effectif du segment (≥ début de journée). */
  start: number;
  /** Fin effective (≤ fin de journée). */
  end: number;
  dayStart: number;
  dayEnd: number;
  weekday: number;
}

/** Découpe [from, to) en segments de journées locales (premier et dernier partiels). */
export function segmentDays(from: number, to: number, tz: string, startHour: number): DaySegment[] {
  const out: DaySegment[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor < to && guard++ < 400) {
    const ds = dayStart(cursor, tz, startHour);
    const de = nextDayStart(cursor, tz, startHour);
    out.push({
      key: dayKey(cursor, tz, startHour),
      start: cursor,
      end: Math.min(de, to),
      dayStart: ds,
      dayEnd: de,
      weekday: localParts(ds, tz).weekday,
    });
    cursor = de;
  }
  return out;
}
