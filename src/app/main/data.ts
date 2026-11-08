/**
 * Service de données de l'overlay : agrège les sources locales, calcule l'état,
 * décide des notifications. Aucune requête réseau.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { notificationsToSend, type NotificationRequest } from '../../core/alerts';
import { estimateSession, type SessionEstimate } from '../../core/forecast';
import { fmtDateTime } from '../../core/format';
import { mergeSnapshots } from '../../core/schedule';

import { computeState, derive, type GuardianState } from '../../core/state';
import { compareDays, dailyHistory, hourlyProfile, sessionsPerDay, weeklyCycles, type Comparison, type DailyUsage, type WeeklyCycle } from '../../core/stats';
import { DAY, HOUR, WEEK } from '../../core/time';
import { toPoints, weeklyOf } from '../../core/series';
import type { Settings, SourceId, UsageSnapshot } from '../../core/types';
import {
  appendSnapshot, dataDir, deleteAllSnapshots, desktopHistoryPath, loadDesktopHistory, loadNotified, loadSettings,
  loadSnapshots, markNotified, pruneSnapshots, saveSettings, toCsv,
} from '../../sources/store';

/** Dossier marketplace du mod (dépôt en développement, ressources une fois installé). */
export const paths = { marketplace: '' };

export interface SourceStatus {
  id: SourceId;
  label: string;
  kind: 'officiel' | 'manuel';
  state: 'ok' | 'ancien' | 'absent' | 'erreur';
  lastAt: number | null;
  count: number;
  detail: string;
}

export interface Report {
  state: GuardianState;
  sources: SourceStatus[];
  daily: DailyUsage[];
  hourly: number[];
  cycles: WeeklyCycle[];
  comparison: Comparison;
  sessions: Record<string, number>;
  estimates: SessionEstimate[];
  /** Trajectoire hebdo : mesures réelles de la fenêtre active. */
  trajectory: { t: number; pct: number }[];
  /** Rythme horaire mesuré (% hebdo par heure active) sur 7 jours. */
  speed: { t: number; rate: number }[];
  dataDir: string;
  desktopHistoryPath: string;
  marketplaceDir: string;
}

const SOURCE_LABEL: Record<SourceId, string> = {
  'desktop-mod': 'Mod Claude Desktop (onglet Code)',
  'claude-code': 'Statusline Claude Code CLI',
  'desktop-history': 'Journal de Claude Desktop (plan-usage-history.json)',
  manual: 'Saisie manuelle',
  import: 'Import',
};

export class DataService extends EventEmitter {
  settings: Settings = loadSettings();
  state!: GuardianState;
  private snaps: UsageSnapshot[] = [];
  private desktop = loadDesktopHistory();
  private timers: NodeJS.Timeout[] = [];
  private watcher: fs.FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private prev: GuardianState | null = null;
  lastError: string | null = null;

  constructor(private notify: (n: NotificationRequest) => void) {
    super();
    this.reload();
  }

  start(): void {
    const dir = path.join(dataDir(), 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.watcher = fs.watch(dir, () => this.scheduleReload());
    } catch (e) {
      this.lastError = `surveillance du dossier impossible : ${(e as Error).message}`;
    }
    // Le journal de Claude Desktop est réécrit par Claude : simple stat périodique (peu coûteux).
    fs.watchFile(desktopHistoryPath(), { interval: 15_000 }, () => this.scheduleReload());
    fs.watchFile(path.join(dataDir(), 'settings.json'), { interval: 5_000 }, () => {
      this.settings = loadSettings();
      this.recompute();
    });
    this.timers.push(setInterval(() => this.recompute(), 30_000)); // comptes à rebours, fraîcheur
    this.timers.push(setInterval(() => this.scheduleReload(), 5 * 60_000)); // filet de sécurité
    this.timers.push(setInterval(() => pruneSnapshots(this.settings.retentionDays), 6 * HOUR));
    pruneSnapshots(this.settings.retentionDays);
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.watcher?.close();
    fs.unwatchFile(desktopHistoryPath());
    fs.unwatchFile(path.join(dataDir(), 'settings.json'));
  }

  private scheduleReload(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.reload(), 400);
  }

  reload(): void {
    try {
      this.snaps = loadSnapshots(Math.max(14, this.settings.retentionDays)).snapshots;
      this.desktop = loadDesktopHistory();
      this.lastError = this.desktop.error ? `Journal Claude Desktop : ${this.desktop.error}` : null;
    } catch (e) {
      this.lastError = String((e as Error).message);
    }
    this.recompute();
  }

  allSnapshots(): UsageSnapshot[] {
    return mergeSnapshots(this.snaps, this.desktop.snapshots);
  }

  recompute(): void {
    const now = Date.now();
    this.state = computeState(this.allSnapshots(), this.settings, now, { lastError: this.lastError });
    this.emitNotifications();
    this.prev = this.state;
    this.emit('state', this.state);
  }

  private emitNotifications(): void {
    const s = this.state;
    const n = this.settings.notifications;
    if (!n.enabled || n.quiet) return;
    const sent = loadNotified();
    const out = s.freshness === 'stale' ? [] : notificationsToSend({ plan: s.budget, pace: s.pace, now: s.now, prefs: n, sent });
    const p = this.prev;
    if (n.resets && p) {
      if (p.fiveHour?.resetsAt && s.now >= p.fiveHour.resetsAt && !sent.has(`reset5:${p.fiveHour.resetsAt}`)) {
        out.push({ key: `reset5:${p.fiveHour.resetsAt}`, title: 'Session de 5 h réinitialisée', message: 'La limite de session officielle est de nouveau disponible.' });
      }
      if (p.weekly?.resetsAt && s.now >= p.weekly.resetsAt && !sent.has(`resetW:${p.weekly.resetsAt}`)) {
        out.push({ key: `resetW:${p.weekly.resetsAt}`, title: 'Quota hebdomadaire réinitialisé', message: `Nouvelle semaine de quota (reset ${fmtDateTime(p.weekly.resetsAt, s.tz)}).` });
      }
    }
    if (!out.length) return;
    markNotified(out.map((x) => x.key));
    out.forEach((x) => this.notify(x));
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const merged = { ...this.settings, ...patch } as Settings;
    if (patch.overlay) merged.overlay = { ...this.settings.overlay, ...patch.overlay };
    if (patch.notifications) merged.notifications = { ...this.settings.notifications, ...patch.notifications };
    if (patch.thresholds) merged.thresholds = { ...this.settings.thresholds, ...patch.thresholds };
    if (patch.dayTypeWeights) merged.dayTypeWeights = { ...this.settings.dayTypeWeights, ...patch.dayTypeWeights };
    this.settings = saveSettings(merged);
    this.recompute();
    return this.settings;
  }

  /** Saisie manuelle : % hebdo (obligatoire), heure de reset et % 5 h (facultatifs). */
  addManual(input: { weeklyPct: number; weeklyResetsAt?: number | null; fiveHourPct?: number | null; fiveHourResetsAt?: number | null }): void {
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
    if (!ok(input.weeklyPct)) throw new Error('Pourcentage hebdomadaire invalide (0–100).');
    const now = Date.now();
    if (input.weeklyResetsAt && input.weeklyResetsAt > now && input.weeklyResetsAt < now + WEEK + DAY) {
      this.settings = saveSettings({ ...this.settings, manualWeeklyReset: input.weeklyResetsAt });
    }
    appendSnapshot('manual', {
      t: now,
      source: 'manual',
      sevenDay: { pct: input.weeklyPct, resetsAt: input.weeklyResetsAt ?? null },
      fiveHour: ok(input.fiveHourPct) ? { pct: input.fiveHourPct, resetsAt: input.fiveHourResetsAt ?? null } : null,
      scoped: [],
    }, true);
    this.reload();
  }

  deleteHistory(): void {
    deleteAllSnapshots();
    this.reload();
  }

  exportJson(): string {
    return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'claude-desktop-usage-guardian', snapshots: this.allSnapshots() }, null, 2);
  }

  exportCsv(): string {
    return toCsv(this.allSnapshots());
  }

  sources(): SourceStatus[] {
    const all = this.allSnapshots();
    const ids: SourceId[] = ['desktop-mod', 'desktop-history', 'claude-code', 'manual'];
    return ids.map((id) => {
      const list = all.filter((s) => s.source === id);
      const lastAt = list.length ? list[list.length - 1]!.t : null;
      const age = lastAt ? Date.now() - lastAt : Infinity;
      let state: SourceStatus['state'] = !list.length ? 'absent' : age > this.settings.staleMinutes * 60_000 ? 'ancien' : 'ok';
      let detail = '';
      if (id === 'desktop-history') {
        if (this.desktop.error) { state = 'erreur'; detail = this.desktop.error; }
        else detail = this.desktop.found ? 'Écrit par Claude Desktop, sans heure de reset, à intervalle irrégulier.' : 'Fichier non trouvé.';
      } else if (id === 'desktop-mod') {
        detail = list.length ? 'Mesures officielles avec heure de reset, à chaque réponse d’une session Code.' : 'Activez le mod « usage-guardian » dans Claude Desktop (onglet Code).';
      } else if (id === 'claude-code') {
        detail = list.length ? 'Mesures officielles de la statusline.' : 'Optionnel : statusline Claude Code CLI non installée.';
      } else detail = list.length ? 'Valeurs saisies par vous.' : 'Aucune saisie.';
      return { id, label: SOURCE_LABEL[id], kind: id === 'manual' ? 'manuel' : 'officiel', state, lastAt, count: list.length, detail };
    });
  }

  report(): Report {
    const s = this.state;
    const all = this.allSnapshots();
    const d = derive(all, s.now);
    const from = s.now - 28 * DAY;
    const daily = dailyHistory(d.weeklyEpochs, this.settings, s.now - 35 * DAY, s.now);
    const todayKey = s.budget?.today.key ?? daily[daily.length - 1]?.key ?? '';
    const avail = s.budget ? s.budget.distributable : null;
    const estimates = [0.5, 1, 2, 3].map((hours) => estimateSession({
      hours, weeklyEpochs: d.weeklyEpochs.filter((e) => e.end > from), fiveHourEpochs: d.fiveHourEpochs.filter((e) => e.end > from),
      weeklyAvailable: avail, todayRemaining: s.budget?.today.remainingPct ?? null,
      fiveHourUsed: s.fiveHour?.used ?? null, fiveHourResetsAt: s.fiveHour?.resetsAt ?? null, now: s.now,
    }));
    const trajectory = d.weekly ? [{ t: d.weekly.start, pct: d.weekly.startValue }, ...d.weekly.points.map((p) => ({ t: p.t, pct: p.pct }))] : [];
    const speed: { t: number; rate: number }[] = [];
    const pts = toPoints(all, weeklyOf).filter((p) => p.t > s.now - 7 * DAY);
    const byHour = new Map<number, number>();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!; const b = pts[i]!;
      if (Math.abs(a.resetsAt - b.resetsAt) > HOUR || b.t - a.t > 2 * HOUR || b.pct < a.pct) continue;
      const h = Math.floor(b.t / HOUR) * HOUR;
      byHour.set(h, (byHour.get(h) ?? 0) + (b.pct - a.pct));
    }
    for (const [t, rate] of [...byHour].sort((x, y) => x[0] - y[0])) speed.push({ t, rate });
    return {
      state: s,
      sources: this.sources(),
      daily,
      hourly: hourlyProfile(d.weeklyEpochs, this.settings.timezone, from),
      cycles: weeklyCycles(d.weeklyEpochs, s.now),
      comparison: compareDays(daily, todayKey),
      sessions: Object.fromEntries(sessionsPerDay(toPoints(all, (x) => x.fiveHour), this.settings)),
      estimates,
      trajectory,
      speed,
      dataDir: dataDir(),
      desktopHistoryPath: desktopHistoryPath(),
      marketplaceDir: paths.marketplace,
    };
  }
}

