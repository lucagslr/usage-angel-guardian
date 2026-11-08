// Généré depuis mod/src/register.tsx par scripts/build-mod.mjs — ne pas éditer ici.
/**
 * Mod officiel Claude Desktop (onglet Code) — Usage Guardian.
 *
 * - Reçoit les limites officielles (`session.measure` → rateLimits : %, heure de reset).
 * - Les enregistre dans %USERPROFILE%\.claude-usage-guardian\snapshots\ (source de l'overlay).
 * - Dessine une bande native au-dessus de la zone de saisie et un panneau détaillé (/guardian).
 * Aucun réseau, aucun contenu de conversation lu.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { FREEDOM_LABEL, PACE_LABEL, STATUS_ICON, STATUS_SHORT } from './core/alerts.ts'
import { fmtDateTime, fmtDuration, fmtNum, fmtPct, fmtRelative } from './core/format.ts'
import { parseDesktopHistory, parseModRateLimits, validateSnapshot } from './core/normalize.ts'
import { isWorthStoring, mergeSnapshots } from './core/schedule.ts'
import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings.ts'
import { computeState, type GuardianState } from './core/state.ts'
import type { Settings, StatusLevel, UsageSnapshot } from './core/types.ts'

const PANE = 'usage-guardian'
const stateAtom = atom({ plugin: 'usage-guardian', key: 'view' } as const, null, { shape: 'view-1' })
const hiddenAtom = atom({ plugin: 'usage-guardian', key: 'isHidden' } as const, false)

type Ctx = { dir: string | null; history: string | null; writer: string; last?: UsageSnapshot }

const COLOR: Record<StatusLevel, string> = {
  green: 'success', yellow: 'warning', orange: 'warning', red: 'error', critical: 'error', unknown: 'inactive',
}

function bar(fraction: number, width = 18): string {
  const f = Math.max(0, Math.min(1, fraction))
  const full = Math.round(f * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

function day(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type $T = EngineInterface
const NL = String.fromCharCode(10)
const HEARTBEAT_MS = 10 * 60_000

const ctx: Ctx = { dir: null, history: null, writer: `mod-${Math.random().toString(36).slice(2, 10)}` }
let settings: Settings = { ...DEFAULT_SETTINGS }

async function ensurePaths($: $T) {
  if (ctx.dir) return
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  const appData = await $.env.get('APPDATA')
  if (home) ctx.dir = `${home}/.claude-usage-guardian`
  if (appData) ctx.history = `${appData}/Claude/plan-usage-history.json`
}

async function readJsonl($: $T, file: string): Promise<UsageSnapshot[]> {
  try {
    const text = String(await $.fs.read(file))
    const out: UsageSnapshot[] = []
    for (const line of text.split(NL)) {
      if (!line.trim()) continue
      try { const v = validateSnapshot(JSON.parse(line)); if (v) out.push(v) } catch { /* ligne ignorée */ }
    }
    return out
  } catch { return [] }
}

async function refresh($: $T): Promise<GuardianState> {
  await ensurePaths($)
  const now = await $.clock.now()
  let snaps: UsageSnapshot[] = []
  if (ctx.dir) {
    try { settings = normalizeSettings(JSON.parse(String(await $.fs.read(`${ctx.dir}/settings.json`)))) } catch { /* défauts */ }
    try {
      const oldest = day(now - 9 * 86_400_000)
      const files = (await $.fs.list(`${ctx.dir}/snapshots`)).filter(f => f.name.endsWith('.jsonl') && f.name.slice(0, 10) >= oldest)
      for (const f of files) snaps.push(...(await readJsonl($, `${ctx.dir}/snapshots/${f.name}`)))
    } catch { /* dossier absent */ }
  }
  if (ctx.history) {
    try { snaps.push(...parseDesktopHistory(JSON.parse(String(await $.fs.read(ctx.history))))) } catch { /* journal absent */ }
  }
  snaps = mergeSnapshots(snaps)
  const view = computeState(snaps, settings, now)
  await update($, stateAtom, () => view as never)
  return view
}

async function record($: $T, rateLimits: unknown): Promise<boolean> {
  await ensurePaths($)
  const now = await $.clock.now()
  const s = parseModRateLimits(rateLimits, now)
  if (!s || !ctx.dir) return false
  // Mesure enregistrée si le % change, ou en confirmation toutes les 10 min au plus (fraîcheur exacte).
  if (!isWorthStoring(ctx.last, s, HEARTBEAT_MS)) return false
  const file = `${ctx.dir}/snapshots/${day(now)}-${ctx.writer}.jsonl`
  let prev = ''
  try { prev = String(await $.fs.read(file)) } catch { /* nouveau fichier */ }
  await $.fs.write(file, prev + JSON.stringify(s) + NL)
  ctx.last = s
  return true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'guardian', description: 'Usage Guardian : budget du jour, quotas 5 h et hebdo, prévisions' })
    try {
      const u = await $.session.usage()
      if (u.rateLimits?.length) await record($, u.rateLimits)
    } catch { /* pas encore de mesure */ }
    await refresh($)
    $.clock.every(60_000, () => { void refresh($) })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    // Déclenché après chaque réponse (le coût ou le contexte change toujours) : on confirme la mesure.
    if (e.rateLimits.length) {
      if (await record($, e.rateLimits)) {
        const v = await refresh($)
        const t = v.budget?.today
        if (t && t.ratio >= 1 && !(await $.store.get(`over:${t.key}`))) {
          await $.store.set(`over:${t.key}`, true)
          $.ui.toast('BUDGET QUOTIDIEN DÉPASSÉ — pause recommandée')
        } else if (t && t.ratio >= 0.8 && !(await $.store.get(`warn:${t.key}`))) {
          await $.store.set(`warn:${t.key}`, true)
          $.ui.toast(`80 % du budget du jour utilisé (${fmtPct(t.usedPct)} / ${fmtPct(t.budgetPct)})`)
        }
      }
    }
    return next(e)
  })

  on('command.run', { command: 'guardian' }, async $ => {
    await refresh($)
    await update($, hiddenAtom, () => false)
    await $.ui.open({ id: PANE, title: 'Usage Guardian' })
    return { text: 'Panneau Usage Guardian ouvert.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = (await read($, stateAtom)) as GuardianState | null
    if (e.props.hasSurvey || !v || (await read($, hiddenAtom))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = v.budget?.today
    const color = COLOR[v.status]
    const stale = v.freshness === 'stale' || v.freshness === 'aging'
    const age = v.data.ageMs !== null ? fmtRelative(v.data.ageMs) : 'aucune mesure'
    const reset = v.weekly?.resetsAt ? fmtDuration(v.weekly.resetsAt - v.now) : '?'
    const fh = v.fiveHour
    const line2 = [
      `5H : ${fh ? fmtPct(fh.used, 0) : '—'}${fh?.resetsAt ? ` ↻ ${fmtDuration(fh.resetsAt - v.now)}` : ''}`,
      `SEMAINE : ${v.weekly ? fmtPct(v.weekly.used, 0) : '—'}`,
      `RESET : ${reset}${v.weekly?.resetOrigin === 'inferred' ? ' (déduit)' : ''}`,
      PACE_LABEL[v.pace.level].toLowerCase(),
      `màj ${age}`,
    ].join('  |  ')
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={color} weight="semibold">{STATUS_ICON[v.status]} </Text>
          {t ? (
            <Text tabular>
              AUJOURD'HUI {fmtNum(t.usedPct)} % / {fmtNum(t.budgetPct)} %{t.baselineQuality === 'partial' ? ' (partiel)' : ''}{'  '}
            </Text>
          ) : (
            <Text dimColor>Budget du jour indisponible (heure de reset inconnue){'  '}</Text>
          )}
          {t && <Text color={color}>{bar(t.ratio)} {Math.round(t.ratio * 100)} %{'  '}</Text>}
          <Text color={color} weight="semibold">
            {t && t.ratio >= 1 ? 'BUDGET QUOTIDIEN DÉPASSÉ — PAUSE RECOMMANDÉE' : `${STATUS_SHORT[v.status]} — ${v.statusLabel.toUpperCase()}`}
          </Text>
          <Text> </Text>
          <Button key="details" label="Détails" onPress={() => $.ui.open({ id: PANE, title: 'Usage Guardian' })} />
          <Button key="hide" label="Masquer" onPress={() => update($, hiddenAtom, () => true)} />
        </Box>
        <Text dimColor={!stale} color={stale ? 'warning' : undefined} tabular>{line2}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = (await read($, stateAtom)) as GuardianState | null
    if (!v) return <Text dimColor>Chargement…</Text>
    const tz = v.tz
    const b = v.budget
    const src = (s: string | null | undefined) =>
      s === 'desktop-mod' ? 'officiel (mod)' : s === 'desktop-history' ? 'officiel (journal Desktop)' : s === 'claude-code' ? 'officiel (statusline)' : s === 'manual' ? 'manuel' : '—'
    return (
      <Box flexDirection="column">
        <Text weight="semibold" color={COLOR[v.status]}>{STATUS_ICON[v.status]} {v.statusLabel} · {FREEDOM_LABEL[v.freedom]}</Text>
        <Text dimColor>Dernière mesure : {v.data.lastAt ? fmtDateTime(v.data.lastAt, tz) : '—'} ({src(v.data.source)}){v.freshness === 'stale' ? ' — PÉRIMÉE' : ''}</Text>
        <Text> </Text>
        <Text weight="semibold">Aujourd'hui</Text>
        {b ? (
          <Box flexDirection="column">
            <Text tabular>Consommé : {fmtPct(b.today.usedPct)} sur un budget de {fmtPct(b.today.budgetPct)} · reste {fmtPct(b.today.remainingPct)}</Text>
            <Text dimColor>Base du jour : {b.today.baselineQuality}{b.today.baselineQuality === 'partial' ? ` (suivi depuis ${fmtDateTime(b.today.trackedSince, tz, false)})` : ''} · réserve {fmtPct(b.reservePct, 0)}</Text>
          </Box>
        ) : <Text dimColor>Indisponible : il faut une heure de reset hebdomadaire (officielle ou saisie).</Text>}
        <Text> </Text>
        <Text weight="semibold">Limites officielles</Text>
        <Text tabular>Session 5 h : {v.fiveHour ? `${fmtPct(v.fiveHour.used, 0)} utilisés, ${fmtPct(v.fiveHour.remaining, 0)} restants` : '—'}{v.fiveHour?.resetsAt ? ` · reset ${fmtDateTime(v.fiveHour.resetsAt, tz, false)} (dans ${fmtDuration(v.fiveHour.resetsAt - v.now)})` : ''}</Text>
        <Text tabular>Hebdomadaire : {v.weekly ? `${fmtPct(v.weekly.used, 0)} utilisés, ${fmtPct(v.weekly.remaining, 0)} restants · ${v.weekly.resetsAt ? `reset ${fmtDateTime(v.weekly.resetsAt, tz)}` : 'reset inconnu'}${v.weekly.resetOrigin === 'inferred' ? ' (déduit)' : ''}` : '—'}</Text>
        {v.scoped.map(q => <Text tabular color={q.constraining ? 'warning' : undefined}>{q.label} (hebdo) : {fmtPct(q.used, 0)}{q.constraining ? ' — plus contraignant' : ''}</Text>)}
        <Text> </Text>
        {b && <Text weight="semibold">Budgets de la semaine</Text>}
        {b && b.days.map(d => (
          <Text tabular dimColor={d.status === 'past'} weight={d.status === 'today' ? 'semibold' : undefined}>
            {d.key} {d.type !== 'normal' ? `(${d.type})` : ''} budget {fmtPct(d.budgetPct)} · {d.usedPct === null ? (d.status === 'future' ? 'à venir' : 'inconnu') : `utilisé ${fmtPct(d.usedPct)}`}
          </Text>
        ))}
        <Text> </Text>
        <Text weight="semibold">Prévisions (estimations)</Text>
        {v.forecast ? (
          <Text tabular>Rythme {fmtNum(v.forecast.blendedRate)} %/h · confiance {v.forecast.confidence} · {v.forecast.exhaustionAt ? `épuisement estimé ${fmtDateTime(v.forecast.exhaustionAt, tz)}` : 'pas d’épuisement prévu avant le reset'}</Text>
        ) : <Text dimColor>Suspendues (données insuffisantes ou périmées).</Text>}
        {v.insights.map(i => <Text color={i.level === 'danger' ? 'error' : i.level === 'warn' ? 'warning' : i.level === 'good' ? 'success' : undefined}>• {i.text}{i.estimate ? ' (estimation)' : ''}</Text>)}
      </Box>
    )
  })
}
