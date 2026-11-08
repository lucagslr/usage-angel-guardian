// Copie générée depuis src/core par scripts/build-mod.mjs — ne pas éditer ici.
/** Formatage français (pourcentages, durées, dates). */
import { DAY, HOUR, MINUTE } from './time.ts';

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits).replace('.', ',')} %`;
}

/** Nombre sans unité : 5,2 */
export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(digits).replace('.', ',');
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms <= 0) return '0 min';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
  return `${Math.max(1, m)} min`;
}

export function fmtDateTime(t: number | null | undefined, tz: string, withDay = true): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return '—';
  return new Intl.DateTimeFormat('fr-CH', {
    timeZone: tz,
    ...(withDay ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(t));
}

export function fmtWeekday(t: number, tz: string): string {
  return new Intl.DateTimeFormat('fr-CH', { timeZone: tz, weekday: 'long' }).format(new Date(t));
}

export function fmtTime(t: number | null | undefined, tz: string): string {
  return fmtDateTime(t, tz, false);
}

export function fmtTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2).replace('.', ',')} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace('.', ',')} k`;
  return String(Math.round(n));
}

export function fmtRelative(ms: number): string {
  if (ms < MINUTE) return "à l'instant";
  return `il y a ${fmtDuration(ms)}`;
}
