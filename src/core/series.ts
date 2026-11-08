/**
 * Séries temporelles de pourcentages et découpage en « époques ».
 * Une époque = portion continue d'une même fenêtre officielle (même `resets_at`)
 * sans rupture (réinitialisation anticipée, changement d'abonnement, baisse inexpliquée).
 * À l'intérieur d'une époque, le % officiel est croissant : les différences sont des consommations.
 */
import { HOUR, MINUTE } from './time';
import type { BaselineQuality, PlanId, QuotaWindow, UsageSnapshot } from './types';

export interface Point {
  t: number;
  pct: number;
  resetsAt: number;
  plan?: PlanId;
}

export interface Epoch {
  /** Début de validité de l'époque. */
  start: number;
  /** Valeur connue au début (0 au début d'une fenêtre officielle). */
  startValue: number;
  /** Le début correspond à une réinitialisation officielle (valeur 0 exacte). */
  startIsReset: boolean;
  resetsAt: number;
  /** Fin (prochain reset ou début de l'époque suivante). */
  end: number;
  points: Point[];
  /** Raison du début de l'époque. */
  reason: 'window' | 'early-reset' | 'plan-change' | 'drop' | 'first-observation';
}

export type Extract = (s: UsageSnapshot) => QuotaWindow | null | undefined;
export const weeklyOf: Extract = (s) => s.sevenDay;
export const fiveHourOf: Extract = (s) => s.fiveHour;
export const scopedOf = (key: string): Extract => (s) => s.scoped.find((q) => q.key === key);

/** Tolérance sur `resets_at` : les arrondis côté serveur ne doivent pas créer de faux resets. */
const RESET_TOLERANCE = 20 * MINUTE;
/** Baisse minimale (points de %) considérée comme une rupture plutôt que du bruit. */
const DROP_THRESHOLD = 0.5;
/** Écart maximal entre instantanés pour une interpolation jugée fiable. */
export const RELIABLE_GAP = 30 * MINUTE;

export function toPoints(snaps: UsageSnapshot[], extract: Extract): Point[] {
  const out: Point[] = [];
  for (const s of snaps) {
    const w = extract(s);
    if (!w || w.resetsAt === null || !Number.isFinite(w.pct)) continue;
    out.push({ t: s.t, pct: w.pct, resetsAt: w.resetsAt, ...(s.plan ? { plan: s.plan } : {}) });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Découpe une série en époques. `windowLength` = durée officielle de la fenêtre
 * (7 j pour l'hebdo, 5 h pour la session) servant à déduire le début de fenêtre.
 */
export function buildEpochs(points: Point[], windowLength: number): Epoch[] {
  const epochs: Epoch[] = [];
  let cur: Epoch | null = null;
  let prev: Point | null = null;
  for (const p of points) {
    const sameReset = !!cur && Math.abs(p.resetsAt - cur.resetsAt) <= RESET_TOLERANCE;
    // Donnée périmée renvoyée après l'expiration de la fenêtre : ignorée.
    if (cur && sameReset && p.t > cur.resetsAt + RESET_TOLERANCE) continue;
    const planChanged = !!(prev && prev.plan && p.plan && prev.plan !== p.plan);
    const dropped = !!(prev && p.pct < prev.pct - DROP_THRESHOLD);
    if (cur && prev && sameReset && !planChanged && !dropped) {
      cur.points.push(p);
      prev = p;
      continue;
    }
    // Heure de reset différente SANS baisse du % alors que la fenêtre courante n'est pas échue :
    // ce n'est pas une réinitialisation (qui remet le % à ~0) mais une heure corrigée par une
    // autre source (ex. saisie manuelle approximative). On garde l'époque, la dernière heure prime.
    if (cur && prev && !sameReset && !planChanged && !dropped && p.t < cur.resetsAt - RESET_TOLERANCE && p.resetsAt > p.t) {
      cur.resetsAt = p.resetsAt;
      cur.end = p.resetsAt;
      cur.points.push(p);
      prev = p;
      continue;
    }
    const officialStart = p.resetsAt - windowLength;
    let next: Epoch;
    if (cur && prev && sameReset) {
      // Même fenêtre mais rupture (changement d'abonnement, baisse) : on repart de ce point.
      next = mk(p.t, p.pct, false, p, planChanged ? 'plan-change' : 'drop');
    } else if (!prev) {
      next = officialStart <= p.t
        ? mk(officialStart, 0, true, p, 'window')
        : mk(p.t, p.pct, false, p, 'first-observation');
    } else if (officialStart >= prev.t) {
      // Reset officiel situé entre la dernière mesure et celle-ci : 0 % exact au début de fenêtre.
      const early = !!cur && officialStart < cur.resetsAt - RESET_TOLERANCE;
      next = mk(Math.min(officialStart, p.t), 0, true, p, early ? 'early-reset' : 'window');
    } else {
      // Reset entre prev et p, mais fenêtre de durée inattendue : réinitialisation anticipée.
      next = mk(prev.t, 0, true, p, 'early-reset');
    }
    if (cur) cur.end = Math.min(cur.end, next.start);
    cur = next;
    epochs.push(cur);
    prev = p;
  }
  return epochs;
}

function mk(start: number, startValue: number, startIsReset: boolean, p: Point, reason: Epoch['reason']): Epoch {
  return { start, startValue, startIsReset, resetsAt: p.resetsAt, end: p.resetsAt, points: [p], reason };
}

/** Époque active à l'instant `now` (fenêtre non expirée), sinon null. */
export function activeEpoch(epochs: Epoch[], now: number): Epoch | null {
  const last = epochs[epochs.length - 1];
  if (!last) return null;
  if (now >= last.resetsAt) return null;
  return last;
}

export interface ValueAt {
  value: number;
  quality: BaselineQuality;
  lo: number;
  hi: number;
  /** Instant à partir duquel la valeur est connue (pour 'partial'). */
  knownFrom: number;
}

/**
 * Estime le % de l'époque à l'instant T à partir des instantanés.
 * Ne fabrique pas de donnée : si aucune mesure n'existe avant T (hors reset officiel),
 * renvoie 'partial' avec la première mesure postérieure.
 */
export function valueAt(e: Epoch, T: number): ValueAt {
  if (T <= e.start) {
    const q: BaselineQuality = e.startIsReset ? 'window-start' : 'exact';
    return { value: e.startValue, quality: q, lo: e.startValue, hi: e.startValue, knownFrom: e.start };
  }
  let a: { t: number; pct: number } | null = e.startIsReset || e.reason !== 'first-observation'
    ? { t: e.start, pct: e.startValue }
    : null;
  let b: Point | null = null;
  for (const p of e.points) {
    if (p.t <= T) a = p;
    else { b = p; break; }
  }
  if (!a) {
    const first = e.points[0]!;
    return { value: first.pct, quality: 'partial', lo: first.pct, hi: first.pct, knownFrom: first.t };
  }
  // Seul le début officiel est connu avant T et la première mesure est loin : on ne devine pas.
  const onlyVirtual = a.t === e.start && !e.points.some((p) => p.t === e.start);
  if (!b) return { value: a.pct, quality: 'exact', lo: a.pct, hi: a.pct, knownFrom: a.t };
  if (a.pct === b.pct) return { value: a.pct, quality: 'exact', lo: a.pct, hi: a.pct, knownFrom: a.t };
  if (onlyVirtual && b.t - a.t > RELIABLE_GAP) {
    return { value: b.pct, quality: 'partial', lo: a.pct, hi: b.pct, knownFrom: b.t };
  }
  const f = (T - a.t) / (b.t - a.t);
  const v = a.pct + f * (b.pct - a.pct);
  const quality: BaselineQuality = b.t - a.t <= RELIABLE_GAP ? 'interpolated' : 'approximate';
  return { value: v, quality, lo: a.pct, hi: b.pct, knownFrom: a.t };
}

/** Dernière valeur connue de l'époque. */
export function latest(e: Epoch): Point {
  return e.points[e.points.length - 1]!;
}

/**
 * Consommation (points de %) entre `from` et `to`, toutes époques confondues,
 * avec fraction du temps couverte par des mesures fiables.
 */
export function usageBetween(epochs: Epoch[], from: number, to: number): { used: number; coverage: number; anyData: boolean } {
  let used = 0;
  let covered = 0;
  let anyData = false;
  for (const e of epochs) {
    const s = Math.max(from, e.start);
    const en = Math.min(to, e.end);
    if (en <= s) continue;
    const v0 = valueAt(e, s);
    const v1 = valueAt(e, en);
    if (v0.quality === 'partial' && v0.knownFrom >= en) continue; // aucune mesure dans l'intervalle
    anyData = true;
    used += Math.max(0, v1.value - v0.value);
    covered += coverageOf(e, s, en);
  }
  const span = Math.max(1, to - from);
  return { used, coverage: Math.min(1, covered / span), anyData };
}

/** Durée de [from, to) couverte par des intervalles entre mesures ≤ RELIABLE_GAP. */
function coverageOf(e: Epoch, from: number, to: number): number {
  const pts = e.startIsReset ? [{ t: e.start }, ...e.points] : e.points;
  let c = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!.t;
    const b = pts[i]!.t;
    if (b - a > RELIABLE_GAP) continue;
    c += Math.max(0, Math.min(b, to) - Math.max(a, from));
  }
  return c;
}

/**
 * Répartit les hausses de % entre instantanés consécutifs sur des intervalles
 * (heures, jours) proportionnellement au temps — utilisé pour les statistiques.
 * Les hausses séparées par un trou > maxGap sont ignorées pour ne pas inventer de profil horaire.
 */
export function attributeDeltas(
  epochs: Epoch[],
  bucketOf: (t: number) => string,
  maxGap = 2 * HOUR,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of epochs) {
    const pts = e.startIsReset ? [{ t: e.start, pct: e.startValue }, ...e.points] : e.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const d = b.pct - a.pct;
      if (d <= 0 || b.t - a.t > maxGap) continue;
      // Attribution au bucket de la mesure qui constate la hausse (pas d'interpolation fine).
      const k = bucketOf(b.t);
      out.set(k, (out.get(k) ?? 0) + d);
    }
  }
  return out;
}
