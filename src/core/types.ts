/**
 * Types partagés par l'overlay Windows, le mod Claude Desktop et la statusline.
 * Tous les pourcentages sont exprimés sur une échelle 0–100 (100 = quota du plan).
 * Toutes les dates sont des millisecondes epoch (UTC).
 */

/** Provenance d'une donnée — affichée dans l'interface pour rester honnête. */
export type DataOrigin =
  | 'claude-exact' // valeur rapportée par Claude (mod, statusline, journal de Claude Desktop)
  | 'local-exact' // mesurée localement sans approximation (différence d'instantanés, compteur)
  | 'estimate' // calcul statistique
  | 'unavailable';

export type SourceId =
  | 'desktop-mod' // mod officiel dans l'onglet Code de Claude Desktop (rateLimits)
  | 'claude-code' // statusline Claude Code CLI (rate_limits)
  | 'desktop-history' // %APPDATA%\Claude\plan-usage-history.json (écrit par Claude Desktop)
  | 'manual' // saisie de l'utilisateur
  | 'import';

export interface QuotaWindow {
  /** % consommé, 0–100 (peut dépasser 100 en cas de crédits supplémentaires). */
  pct: number;
  /** Heure de réinitialisation fournie par Claude, ou null si inconnue / aucune fenêtre active. */
  resetsAt: number | null;
  /** true si `resetsAt` a été déduit (cycle hebdomadaire fixe) et non rapporté par Claude. */
  resetInferred?: boolean;
}

export interface ScopedQuota extends QuotaWindow {
  /** Identifiant stable, ex. "weekly:fable". */
  key: string;
  /** Libellé lisible, ex. "Fable (hebdo)". */
  label: string;
  kind: 'weekly' | 'session' | 'other';
}

export type PlanId = 'free' | 'pro' | 'max' | 'ultra' | 'team' | 'enterprise' | 'unknown';

export interface UsageSnapshot {
  /** Horodatage de la mesure. */
  t: number;
  source: SourceId;
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  scoped: ScopedQuota[];
  plan?: PlanId;
}

export type Strategy = 'balanced' | 'conservative' | 'intensive';
export type DayType = 'normal' | 'heavy' | 'rest';

export interface StatusThresholds {
  /** Fractions du budget du jour. */
  yellow: number; // 0.6
  orange: number; // 0.8
  red: number; // 1.0
  critical: number; // 1.5
}

export interface Settings {
  version: 1;
  timezone: string;
  /** Heure locale (0–23) à laquelle commence une « journée » de budget. */
  dayStartHour: number;
  strategy: Strategy;
  /** Réserve personnelle (% du quota hebdo) toujours préservée. */
  personalReservePct: number;
  /** Réserve supplémentaire du mode conservateur (10–20 % conseillé). */
  conservativeReservePct: number;
  /** Multiplicateur du budget d'aujourd'hui en mode intensif. */
  intensiveFactor: number;
  /** Type de journée par jour de semaine (0 = dimanche … 6 = samedi). */
  weekdayTypes: DayType[];
  dayTypeWeights: Record<DayType, number>;
  thresholds: StatusThresholds;
  /** Heures d'activité typiques par jour, pour évaluer le rythme soutenable. */
  activeHoursPerDay: number;
  /** Plan choisi manuellement (prioritaire sur la détection si différent de 'auto'). */
  manualPlan: PlanId | 'auto';
  /** Âge (min) au-delà duquel une mesure n'est plus « fraîche ». */
  freshMinutes: number;
  /** Âge (min) au-delà duquel une mesure est périmée : prévisions suspendues. */
  staleMinutes: number;
  retentionDays: number;
  /** Heure officielle de reset hebdomadaire saisie manuellement (repli), ms epoch. */
  manualWeeklyReset: number | null;
  notifications: {
    enabled: boolean;
    /** Mode silencieux : aucune notification, sans perdre les préférences. */
    quiet: boolean;
    dailyWarn: boolean;
    dailyOver: boolean;
    fastPace: boolean;
    weeklyLow: boolean;
    resets: boolean;
  };
  /** Rendu logiciel (sans GPU) : ~85 Mo de mémoire en moins ; appliqué au prochain démarrage. */
  lowMemory: boolean;
  overlay: {
    enabled: boolean;
    /** Ancrage dans la fenêtre Claude. */
    anchor: 'above-input' | 'titlebar' | 'bottom-edge';
    /** Décalage manuel (DIP) depuis la position d'ancrage. */
    offsetX: number;
    offsetY: number;
    scale: number;
    opacity: number;
    theme: 'auto' | 'light' | 'dark';
    reducedMotion: boolean;
    showSecondLine: boolean;
  };
}

export type StatusLevel = 'green' | 'yellow' | 'orange' | 'red' | 'critical' | 'unknown';
export type PaceLevel = 'idle' | 'calm' | 'steady' | 'fast' | 'very-fast' | 'unknown';
export type Confidence = 'low' | 'medium' | 'high';

export type BaselineQuality =
  | 'exact' // instantané au changement de jour sans variation ambiguë
  | 'window-start' // la fenêtre a commencé aujourd'hui : 0 % au reset
  | 'interpolated' // interpolé entre deux instantanés proches
  | 'approximate' // interpolé entre deux instantanés éloignés (bornes affichées)
  | 'partial'; // aucun instantané avant : suivi depuis la première mesure du jour
