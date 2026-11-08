/**
 * Déduction de l'heure de reset hebdomadaire pour les mesures qui n'en portent pas
 * (journal de Claude Desktop, saisie manuelle du seul pourcentage).
 *
 * Base documentée : la limite hebdomadaire « se réinitialise à une heure fixe chaque
 * semaine, propre au compte ». On projette donc, par pas de 7 jours, l'heure officielle
 * connue la plus proche dans le temps. Toute valeur déduite est marquée `resetInferred`.
 */
import { MINUTE, WEEK } from './time';
import type { UsageSnapshot } from './types';

export interface ResetAnchor {
  /** Une heure de reset officielle (ms). */
  at: number;
  /** Instant où cette heure a été observée. */
  observedAt: number;
  manual: boolean;
}

export function collectAnchors(snaps: UsageSnapshot[], manualReset: number | null): ResetAnchor[] {
  const out: ResetAnchor[] = [];
  for (const s of snaps) {
    if (s.sevenDay?.resetsAt && !s.sevenDay.resetInferred) out.push({ at: s.sevenDay.resetsAt, observedAt: s.t, manual: false });
  }
  if (manualReset) out.push({ at: manualReset, observedAt: manualReset - WEEK / 2, manual: true });
  return out.sort((a, b) => a.observedAt - b.observedAt);
}

/** Premier reset strictement postérieur à t selon le cycle de l'ancre. */
export function projectReset(anchor: number, t: number): number {
  const k = Math.floor((t - anchor) / WEEK) + 1;
  return anchor + k * WEEK;
}

/**
 * Renvoie une copie des instantanés où chaque fenêtre hebdomadaire sans heure de reset
 * reçoit une heure déduite. Sans aucune ancre, les instantanés restent inchangés
 * (le moteur ne peut alors pas calculer de budget : l'interface le signale).
 */
export function inferWeeklyResets(snaps: UsageSnapshot[], manualReset: number | null): UsageSnapshot[] {
  const anchors = collectAnchors(snaps, manualReset);
  if (!anchors.length) return snaps;
  return snaps.map((s) => {
    if (!s.sevenDay || s.sevenDay.resetsAt) return s;
    // Ancre observée la plus proche dans le temps (une réinitialisation anticipée déplace le cycle).
    let best = anchors[0]!;
    for (const a of anchors) if (Math.abs(a.observedAt - s.t) < Math.abs(best.observedAt - s.t)) best = a;
    return { ...s, sevenDay: { pct: s.sevenDay.pct, resetsAt: projectReset(best.at, s.t), resetInferred: true } };
  });
}

/**
 * Fusionne des instantanés de plusieurs sources : tri chronologique, suppression des
 * doublons exacts (même source, même minute, mêmes valeurs).
 */
export function mergeSnapshots(...lists: UsageSnapshot[][]): UsageSnapshot[] {
  const seen = new Set<string>();
  const out: UsageSnapshot[] = [];
  for (const s of lists.flat().sort((a, b) => a.t - b.t)) {
    const k = `${s.source}|${Math.floor(s.t / MINUTE)}|${s.fiveHour?.pct}|${s.sevenDay?.pct}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Un instantané mérite d'être enregistré s'il apporte une variation ou après `minGap`. */
export function isWorthStoring(prev: UsageSnapshot | undefined, next: UsageSnapshot, minGap = 30 * MINUTE): boolean {
  if (!prev) return true;
  if (next.t - prev.t >= minGap) return true;
  const changed = (a?: { pct: number; resetsAt: number | null } | null, b?: { pct: number; resetsAt: number | null } | null) =>
    (a?.pct ?? null) !== (b?.pct ?? null) || Math.abs((a?.resetsAt ?? 0) - (b?.resetsAt ?? 0)) > MINUTE;
  if (changed(prev.fiveHour, next.fiveHour) || changed(prev.sevenDay, next.sevenDay)) return true;
  return JSON.stringify(prev.scoped.map((q) => q.pct)) !== JSON.stringify(next.scoped.map((q) => q.pct));
}
