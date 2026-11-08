import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendSnapshot, deleteAllSnapshots, loadDesktopHistory, loadNotified, loadSettings, loadSnapshots, markNotified, pruneSnapshots, saveSettings, toCsv } from '../src/sources/store';
import { loadTokenUsage, usageFromLine } from '../src/sources/transcripts';
import { snap, z } from './helpers';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cug-test-'));
const R = z(2026, 11, 16, 0);

beforeAll(() => {
  process.env.CUG_DATA_DIR = path.join(tmp, 'data');
  process.env.CUG_DESKTOP_HISTORY = path.join(tmp, 'plan-usage-history.json');
  process.env.CUG_CLAUDE_PROJECTS = path.join(tmp, 'projects');
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('stockage local', () => {
  it('écrit, dédoublonne et relit les mesures ; lignes corrompues ignorées', () => {
    const now = Date.now();
    expect(appendSnapshot('mod-a', snap(now, 5, R))).toBe(true);
    expect(appendSnapshot('mod-a', snap(now + 1000, 5, R))).toBe(false); // aucune nouveauté
    expect(appendSnapshot('mod-b', snap(now + 2000, 6, R))).toBe(true); // second écrivain (autre session)
    const dir = path.join(process.env.CUG_DATA_DIR!, 'snapshots');
    fs.appendFileSync(path.join(dir, fs.readdirSync(dir)[0]!), '{pas du json\n');
    const r = loadSnapshots(7);
    expect(r.snapshots.map((s) => s.sevenDay!.pct)).toEqual([5, 6]);
    expect(r.invalidLines).toBe(1);
  });

  it('paramètres : défauts, validation, écriture atomique', () => {
    expect(loadSettings().timezone).toBe('Europe/Zurich');
    const s = saveSettings({ ...loadSettings(), personalReservePct: 999 });
    expect(s.personalReservePct).toBe(50);
    expect(loadSettings().personalReservePct).toBe(50);
  });

  it('anti-spam des notifications persistant', () => {
    markNotified(['daily-warn:2026-11-09']);
    expect(loadNotified().has('daily-warn:2026-11-09')).toBe(true);
  });

  it('journal de Claude Desktop absent : pas d’erreur', () => {
    expect(loadDesktopHistory()).toMatchObject({ found: false, snapshots: [], error: null });
  });

  it('journal de Claude Desktop présent : lu sans modification', () => {
    const p = process.env.CUG_DESKTOP_HISTORY!;
    const raw = JSON.stringify({ version: 2, samples: [{ t: Date.now(), org: 'o', u: { fh: 3, sd: 12 } }] });
    fs.writeFileSync(p, raw);
    expect(loadDesktopHistory().snapshots[0]!.sevenDay!.pct).toBe(12);
    expect(fs.readFileSync(p, 'utf8')).toBe(raw);
  });

  it('rétention, export CSV et suppression', () => {
    const dir = path.join(process.env.CUG_DATA_DIR!, 'snapshots');
    fs.writeFileSync(path.join(dir, '2020-01-01-old.jsonl'), '');
    expect(pruneSnapshots(30)).toBe(1);
    expect(toCsv(loadSnapshots(7).snapshots).split('\r\n')[0]).toContain('hebdo_pct');
    deleteAllSnapshots();
    expect(loadSnapshots(7).snapshots).toEqual([]);
  });
});

describe('tokens Claude Code (journaux locaux)', () => {
  it('lit uniquement l’usage, dédoublonne les blocs d’un même message', () => {
    const d = path.join(process.env.CUG_CLAUDE_PROJECTS!, 'proj');
    fs.mkdirSync(d, { recursive: true });
    const t = new Date().toISOString();
    const line = (out: number) => JSON.stringify({ type: 'assistant', timestamp: t, sessionId: 's1', message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'SECRET' }], usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 } } });
    fs.writeFileSync(path.join(d, 'a.jsonl'), [line(1), line(42), JSON.stringify({ type: 'user', message: { content: 'x' } }), 'corrompu'].join('\n'));
    const r = loadTokenUsage(2, 'Europe/Zurich', 0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ model: 'claude-opus-5-5', input: 10, output: 42, cacheCreate: 5, cacheRead: 7, messages: 1 });
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(usageFromLine('{"type":"user"}')).toBeNull();
  });
});
