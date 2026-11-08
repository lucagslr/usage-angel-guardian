/**
 * Tokens EXACTS des sessions Claude Code (onglet Code de Claude Desktop et CLI),
 * lus dans les journaux locaux ~/.claude/projects/**\/*.jsonl.
 *
 * Confidentialité : seules les lignes de réponse assistant sont analysées et seuls
 * `message.usage`, `message.model`, `message.id` et `timestamp` sont conservés.
 * Le contenu des messages n'est ni lu en mémoire durable ni stocké.
 * Les conversations de l'onglet Chat ne figurent pas dans ces journaux : leurs tokens
 * restent INDISPONIBLES (Claude ne les expose pas).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TokenRow } from '../core/stats';
import { dayKey } from '../core/time';

export function projectsDir(): string {
  return process.env.CUG_CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects');
}

interface FileCache { mtimeMs: number; size: number; rows: Map<string, { day: string; model: string; u: Usage; session: string }> }
interface Usage { input: number; output: number; cacheCreate: number; cacheRead: number }
const cache = new Map<string, FileCache>();

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Extrait l'usage d'une ligne JSONL ; null si ce n'est pas une réponse assistant avec usage. */
export function usageFromLine(line: string): { id: string; t: number; model: string; u: Usage; session: string } | null {
  // Filtre rapide sans parser les lignes sans usage (les plus volumineuses sont des sorties d'outils).
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(line); } catch { return null; }
  if (o.type !== 'assistant' || !o.message || typeof o.message !== 'object') return null;
  const m = o.message as Record<string, unknown>;
  const u = m.usage as Record<string, unknown> | undefined;
  if (!u) return null;
  const t = Date.parse(String(o.timestamp ?? ''));
  if (!Number.isFinite(t)) return null;
  const id = String(m.id ?? o.requestId ?? o.uuid ?? '');
  if (!id) return null;
  return {
    id, t, model: String(m.model ?? 'inconnu'), session: String(o.sessionId ?? ''),
    u: { input: num(u.input_tokens), output: num(u.output_tokens), cacheCreate: num(u.cache_creation_input_tokens), cacheRead: num(u.cache_read_input_tokens) },
  };
}

function walk(dir: string, since: number, out: string[], depth = 0): void {
  if (depth > 3) return;
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, since, out, depth + 1);
    else if (e.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs >= since) out.push(p); } catch { /* ignoré */ }
    }
  }
}

export interface TokenSummary {
  rows: TokenRow[];
  sessions: { session: string; day: string; total: number; messages: number }[];
  files: number;
  available: boolean;
}

/** Agrège par jour et modèle les tokens des `days` derniers jours (cache par fichier). */
export function loadTokenUsage(days: number, tz: string, startHour: number, now = Date.now()): TokenSummary {
  const files: string[] = [];
  walk(projectsDir(), now - days * 86_400_000, files);
  const agg = new Map<string, TokenRow>();
  const sess = new Map<string, { session: string; day: string; total: number; messages: number }>();
  for (const f of files) {
    let st: fs.Stats;
    try { st = fs.statSync(f); } catch { continue; }
    let c = cache.get(f);
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
      const rows = new Map<string, { day: string; model: string; u: Usage; session: string }>();
      let text = '';
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        const r = usageFromLine(line);
        // Plusieurs lignes par message (blocs successifs) : on garde la dernière, la plus complète.
        if (r) rows.set(r.id, { day: dayKey(r.t, tz, startHour), model: r.model, u: r.u, session: r.session });
      }
      text = '';
      c = { mtimeMs: st.mtimeMs, size: st.size, rows };
      cache.set(f, c);
    }
    for (const r of c.rows.values()) {
      const k = `${r.day}|${r.model}`;
      const a = agg.get(k) ?? { day: r.day, model: r.model, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, messages: 0 };
      a.input += r.u.input; a.output += r.u.output; a.cacheCreate += r.u.cacheCreate; a.cacheRead += r.u.cacheRead; a.messages += 1;
      agg.set(k, a);
      const sk = `${r.session}|${r.day}`;
      const s = sess.get(sk) ?? { session: r.session.slice(0, 8), day: r.day, total: 0, messages: 0 };
      s.total += r.u.input + r.u.output + r.u.cacheCreate + r.u.cacheRead; s.messages += 1;
      sess.set(sk, s);
    }
  }
  return {
    rows: [...agg.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model)),
    sessions: [...sess.values()].sort((a, b) => b.day.localeCompare(a.day) || b.total - a.total).slice(0, 30),
    files: files.length,
    available: fs.existsSync(projectsDir()),
  };
}
