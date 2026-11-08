/**
 * Stockage local partagé (Node) — aucun envoi réseau.
 *
 * %USERPROFILE%\.claude-usage-guardian\
 *   settings.json                 paramètres (partagés overlay / mod / statusline)
 *   snapshots\AAAA-MM-JJ-<écrivain>.jsonl   mesures horodatées, une par ligne
 *   notified.json                 clés des notifications déjà émises (anti-spam)
 *
 * Un fichier par jour et par écrivain évite les écritures concurrentes
 * (plusieurs sessions Code, statusline, overlay).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDesktopHistory, validateSnapshot } from '../core/normalize';
import { isWorthStoring } from '../core/schedule';
import { DEFAULT_SETTINGS, normalizeSettings } from '../core/settings';
import { DAY } from '../core/time';
import type { Settings, UsageSnapshot } from '../core/types';

export function dataDir(): string {
  return process.env.CUG_DATA_DIR || path.join(os.homedir(), '.claude-usage-guardian');
}

/** Journal écrit par Claude Desktop (MSIX et installation classique utilisent %APPDATA%\Claude). */
export function desktopHistoryPath(): string {
  return process.env.CUG_DESKTOP_HISTORY || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'plan-usage-history.json');
}

const snapDir = () => path.join(dataDir(), 'snapshots');

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Écriture atomique (fichier temporaire puis renommage). */
export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export function loadSettings(): Settings {
  const raw = readJson(path.join(dataDir(), 'settings.json'));
  return raw === undefined ? { ...DEFAULT_SETTINGS } : normalizeSettings(raw);
}

export function saveSettings(s: Settings): Settings {
  const n = normalizeSettings(s);
  writeJsonAtomic(path.join(dataDir(), 'settings.json'), n);
  return n;
}

const lastByWriter = new Map<string, UsageSnapshot>();

/** Ajoute une mesure si elle apporte une information nouvelle. Renvoie true si écrite. */
export function appendSnapshot(writer: string, s: UsageSnapshot, force = false): boolean {
  const safe = writer.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  if (!force && !isWorthStoring(lastByWriter.get(safe), s)) return false;
  ensureDir(snapDir());
  fs.appendFileSync(path.join(snapDir(), `${localDay(s.t)}-${safe}.jsonl`), JSON.stringify(s) + '\n');
  lastByWriter.set(safe, s);
  return true;
}

export interface LoadResult {
  snapshots: UsageSnapshot[];
  files: number;
  invalidLines: number;
}

/** Lit les mesures des `days` derniers jours, lignes invalides ignorées (et comptées). */
export function loadSnapshots(days: number, now = Date.now()): LoadResult {
  const out: UsageSnapshot[] = [];
  let files = 0;
  let invalidLines = 0;
  let names: string[] = [];
  try {
    names = fs.readdirSync(snapDir()).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return { snapshots: [], files: 0, invalidLines: 0 };
  }
  const oldest = localDay(now - days * DAY);
  for (const n of names) {
    if (n.slice(0, 10) < oldest) continue;
    files++;
    let text = '';
    try { text = fs.readFileSync(path.join(snapDir(), n), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const v = validateSnapshot(JSON.parse(line));
        if (v) out.push(v); else invalidLines++;
      } catch { invalidLines++; }
    }
  }
  out.sort((a, b) => a.t - b.t);
  return { snapshots: out, files, invalidLines };
}

export interface DesktopHistoryResult {
  snapshots: UsageSnapshot[];
  found: boolean;
  mtimeMs: number | null;
  error: string | null;
}

/** Lecture seule du journal de Claude Desktop. */
export function loadDesktopHistory(): DesktopHistoryResult {
  const p = desktopHistoryPath();
  try {
    const st = fs.statSync(p);
    if (st.size > 8 * 1024 * 1024) return { snapshots: [], found: true, mtimeMs: st.mtimeMs, error: 'fichier trop volumineux' };
    const snaps = parseDesktopHistory(JSON.parse(fs.readFileSync(p, 'utf8')));
    return { snapshots: snaps, found: true, mtimeMs: st.mtimeMs, error: snaps.length ? null : 'format non reconnu ou vide' };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { snapshots: [], found: code !== 'ENOENT', mtimeMs: null, error: code === 'ENOENT' ? null : String((e as Error).message) };
  }
}

/** Supprime les fichiers de mesures plus anciens que la rétention. */
export function pruneSnapshots(retentionDays: number, now = Date.now()): number {
  let removed = 0;
  const oldest = localDay(now - retentionDays * DAY);
  try {
    for (const n of fs.readdirSync(snapDir())) {
      if (n.endsWith('.jsonl') && n.slice(0, 10) < oldest) { fs.rmSync(path.join(snapDir(), n)); removed++; }
    }
  } catch { /* dossier absent */ }
  return removed;
}

/** Efface toutes les mesures enregistrées par l'application (pas le journal de Claude Desktop). */
export function deleteAllSnapshots(): void {
  fs.rmSync(snapDir(), { recursive: true, force: true });
  lastByWriter.clear();
}

export function loadNotified(now = Date.now()): Set<string> {
  const raw = readJson(path.join(dataDir(), 'notified.json'));
  const entries = raw && typeof raw === 'object' ? Object.entries(raw as Record<string, number>) : [];
  return new Set(entries.filter(([, t]) => now - t < 14 * DAY).map(([k]) => k));
}

export function markNotified(keys: string[], now = Date.now()): void {
  const file = path.join(dataDir(), 'notified.json');
  const raw = (readJson(file) as Record<string, number>) || {};
  for (const k of keys) raw[k] = now;
  for (const [k, t] of Object.entries(raw)) if (now - t > 14 * DAY) delete raw[k];
  writeJsonAtomic(file, raw);
}

export function toCsv(snaps: UsageSnapshot[]): string {
  const rows = [['horodatage_iso', 'source', 'hebdo_pct', 'hebdo_reset_iso', 'hebdo_reset_deduit', 'session5h_pct', 'session5h_reset_iso']];
  const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : '');
  for (const s of snaps) {
    rows.push([iso(s.t), s.source, s.sevenDay?.pct?.toString() ?? '', iso(s.sevenDay?.resetsAt), s.sevenDay?.resetInferred ? 'oui' : '', s.fiveHour?.pct?.toString() ?? '', iso(s.fiveHour?.resetsAt)]);
  }
  return rows.map((r) => r.join(';')).join('\r\n') + '\r\n';
}
