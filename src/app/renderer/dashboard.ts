/** Dashboard complet (niveau 3) : historique, prévisions, sources, paramètres. */
import type { GuardianState } from '../../core/state';
import type { DayType, Settings, Strategy } from '../../core/types';
import type { Report } from '../main/data';
import type { TokenSummary } from '../../sources/transcripts';
import { barChart, lineChart } from './charts';
import { fmtNum, fmtTokens } from '../../core/format';
import {
  api, applyTheme, badge, fmtDateTime, fmtDuration, fmtPct, freshnessText, FREEDOM_LABEL, h, PACE_LABEL, progress,
  SOURCE_TEXT, sourceKind, STATUS_ICON, STATUS_LABEL,
} from './ui';

type Tab = 'overview' | 'week' | 'stats' | 'forecast' | 'sources' | 'settings' | 'help';
const TABS: [Tab, string][] = [
  ['overview', 'Vue d’ensemble'], ['week', 'Semaine & budgets'], ['stats', 'Statistiques'], ['forecast', 'Prévisions'],
  ['sources', 'Sources & saisie'], ['settings', 'Paramètres'], ['help', 'Aide'],
];
const DAY_TYPE_LABEL: Record<DayType, string> = { normal: 'Normal', heavy: 'Forte activité', rest: 'Repos' };
const WEEKDAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const STRAT_LABEL: Record<Strategy, string> = { balanced: 'Équilibré', conservative: 'Conservateur', intensive: 'Intensif' };
const VERDICT: Record<string, string> = { comfortable: 'Confortable', tight: 'Juste', unlikely: 'Peu probable', unknown: 'Inconnu' };
const BASE_Q: Record<string, string> = {
  exact: 'mesure au changement de jour', 'window-start': 'début de semaine officielle (0 %)', interpolated: 'interpolée (mesures proches)',
  approximate: 'approximative (mesures espacées)', partial: 'partielle (aucune mesure avant)',
};

let tab: Tab = ((location.hash.slice(1) as Tab) || 'overview');
let report: Report | null = null;
let settings: Settings | null = null;
let tokens: TokenSummary | null = null;
const app = document.getElementById('app')!;

function toast(msg: string): void {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

async function load(): Promise<void> {
  [report, settings] = await Promise.all([api().getReport(), api().getSettings()]);
  render();
}

function render(): void {
  if (!report || !settings) return;
  applyTheme(settings.overlay.theme, settings.overlay.reducedMotion);
  const st = report.state;
  const nav = h('nav', { 'aria-label': 'Sections' },
    h('div', { class: `brand lvl-${st.status}` }, h('span', { class: 'dot' }), 'Usage Guardian'),
    ...TABS.map(([id, label]) => h('button', { 'aria-current': id === tab ? 'page' : null, onclick: () => { tab = id; location.hash = id; render(); } }, label)),
    h('div', { class: 'foot' }, freshnessText(st), h('br'), 'Données 100 % locales'));
  const main = h('main', {});
  const views: Record<Tab, () => (HTMLElement | null)[]> = { overview, week, stats, forecast, sources, settings: settingsView, help };
  main.append(...views[tab]().filter((x): x is HTMLElement => !!x));
  app.replaceChildren(nav, main);
}

// ------------------------------------------------------------- Vue d'ensemble

function kpi(k: string, b: HTMLElement | null, v: string, sub: (string | HTMLElement | null)[], lvl = 'unknown'): HTMLElement {
  return h('div', { class: `panel kpi lvl-${lvl}` }, h('div', { class: 'k' }, k, b), h('div', { class: 'v num' }, v), ...sub.map((x) => (x ? h('div', { class: 'sub num' }, x) : null)));
}

function overview(): HTMLElement[] {
  const st = report!.state;
  const t = st.budget?.today;
  const b = st.budget;
  const freeLvl = { high: 'green', normal: 'green', caution: 'yellow', 'slow-down': 'orange', over: 'red', unknown: 'unknown' }[st.freedom];
  const out: HTMLElement[] = [
    h('h1', {}, 'Vue d’ensemble'),
    h('div', { class: `banner lvl-${t && t.ratio >= 1 ? 'red' : freeLvl}` },
      h('span', {}, STATUS_ICON[st.status]),
      h('div', {}, h('div', { class: 'muted' }, 'Est-ce que je peux encore beaucoup utiliser Claude aujourd’hui ?'),
        h('b', {}, t && t.ratio >= 1 ? 'BUDGET QUOTIDIEN DÉPASSÉ — PAUSE RECOMMANDÉE' : FREEDOM_LABEL[st.freedom])),
      h('span', { style: 'margin-left:auto', class: 'muted' }, `${STATUS_LABEL[st.status]} · ${PACE_LABEL[st.pace.level]}`)),
    h('div', { class: 'grid g4' },
      kpi("AUJOURD'HUI", t ? badge('observe', 'Différence de mesures officielles horodatées') : badge('indispo'), t ? `${fmtPct(t.usedPct)} / ${fmtPct(t.budgetPct)}` : '—',
        t ? [progress(t.ratio, st.status, 'Budget du jour'), `${Math.round(t.ratio * 100)} % du budget · reste ${fmtPct(Math.max(0, t.remainingPct))}`, `Base : ${BASE_Q[t.baselineQuality]}`] : ['Heure de reset hebdomadaire requise (voir Sources)'], st.status),
      kpi('SESSION 5 H', st.fiveHour ? badge(sourceKind(st.fiveHour.source), SOURCE_TEXT[st.fiveHour.source]) : badge('indispo'), st.fiveHour ? fmtPct(st.fiveHour.used, 0) : '—',
        st.fiveHour ? [progress(st.fiveHour.used / 100, st.fiveHour.level, 'Session 5 h'), `Reste ${fmtPct(st.fiveHour.remaining, 0)}`, st.fiveHour.resetsAt ? `Reset ${fmtDateTime(st.fiveHour.resetsAt, st.tz, false)} (${fmtDuration(st.fiveHour.resetsAt - st.now)})` : 'Heure de reset non fournie'] : ['Aucune session active mesurée'], st.fiveHour?.level),
      kpi('SEMAINE', st.weekly ? badge(sourceKind(st.weekly.source), SOURCE_TEXT[st.weekly.source]) : badge('indispo'), st.weekly ? fmtPct(st.weekly.used, 0) : '—',
        st.weekly ? [progress(st.weekly.used / 100, st.weekly.used > 85 ? 'red' : 'green', 'Semaine'), `Reste ${fmtPct(st.weekly.remaining, 0)}`, st.weekly.resetsAt ? `Reset ${fmtDateTime(st.weekly.resetsAt, st.tz)}${st.weekly.resetOrigin === 'inferred' ? ' (déduit)' : ''}` : 'Reset inconnu'] : ['Aucune mesure'], 'green'),
      kpi('PRÉVISION', st.forecast ? badge('estime', `Confiance ${st.forecast.confidence}`) : badge('indispo'), st.forecast?.exhaustionAt ? fmtDateTime(st.forecast.exhaustionAt, st.tz) : st.forecast ? 'Tenable' : '—',
        st.forecast ? [`Rythme ${fmtNum(st.forecast.blendedRate, 2)} %/h`, st.forecast.projectedAtReset !== null ? `≈ ${fmtPct(Math.min(100, st.forecast.projectedAtReset), 0)} au reset` : null, `Confiance : ${st.forecast.confidence}`] : ['Suspendue (données insuffisantes ou périmées)'], st.forecast?.exhaustionAt ? 'red' : 'green'),
    ),
  ];
  if (b) {
    out.push(h('div', { class: 'panel' }, h('h2', {}, 'Budget et consommation par jour'), weekChart(), legendWeek()));
    out.push(h('div', { class: 'panel' }, h('h2', {}, 'Trajectoire de la semaine'), trajectoryChart(),
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--accent)' }), 'Mesures officielles'), h('span', {}, h('i', { style: 'background:var(--text-2)' }), 'Trajectoire recommandée'), h('span', {}, h('i', { style: 'background:var(--orange)' }), 'Projection (estimation)'))));
  }
  out.push(h('div', { class: 'panel' }, h('h2', {}, 'Messages'), st.insights.length
    ? h('ul', { class: 'insights' }, ...st.insights.map((i) => h('li', { class: i.level }, i.text, ' ', i.estimate ? badge('estime') : null)))
    : h('div', { class: 'muted' }, 'Rien à signaler.')));
  return out;
}

function legendWeek(): HTMLElement {
  return h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--green)' }), 'Consommé (dans le budget)'), h('span', {}, h('i', { style: 'background:var(--red)' }), 'Consommé (au-delà)'), h('span', {}, h('i', { style: 'background:var(--text)' }), 'Budget recommandé'), h('span', {}, h('i', { style: 'background:var(--track)' }), 'Inconnu / à venir'));
}

function weekChart(): SVGElement {
  const st = report!.state;
  return barChart(st.budget!.days.map((d) => ({
    label: new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', timeZone: st.tz }).format(new Date(d.start + 3_600_000)),
    value: d.usedPct, ref: d.budgetPct,
    level: d.usedPct !== null && d.budgetPct !== null && d.usedPct > d.budgetPct ? 'red' : 'green',
    faded: d.status === 'future', highlight: d.status === 'today',
    tip: `${d.key} (${DAY_TYPE_LABEL[d.type]}) — budget ${fmtPct(d.budgetPct)}${d.status === 'future' ? ' (projeté)' : ''} · consommé ${d.usedPct === null ? (d.status === 'future' ? 'à venir' : 'inconnu') : fmtPct(d.usedPct)}`,
  })));
}

function trajectoryChart(): SVGElement {
  const st = report!.state;
  const b = st.budget!;
  const actual = report!.trajectory.map((p) => ({ t: p.t, v: p.pct }));
  const planned = [{ t: b.windowStart, v: 0 }, { t: b.resetsAt, v: 100 - b.reservePct }];
  const proj = st.forecast?.blendedRate && actual.length
    ? [{ t: st.now, v: b.weeklyUsed }, { t: b.resetsAt, v: Math.min(120, b.weeklyUsed + st.forecast.blendedRate * ((b.resetsAt - st.now) / 3_600_000)) }]
    : [];
  return lineChart([
    { points: planned, cls: 'planned', label: 'Trajectoire recommandée' },
    { points: proj, cls: 'projection', label: 'Projection au rythme actuel (estimation)' },
    { points: actual, cls: 'actual', label: 'Mesures officielles' },
  ], { from: b.windowStart, to: b.resetsAt, max: 100 }, [{ t: st.now, label: 'maintenant' }]);
}

// ------------------------------------------------------------------ Semaine

function week(): HTMLElement[] {
  const st = report!.state;
  const b = st.budget;
  if (!b) return [h('h1', {}, 'Semaine & budgets'), noBudget()];
  return [
    h('h1', {}, 'Semaine & budgets'),
    h('div', { class: 'grid g4' },
      kpi('CONSOMMÉ (SEMAINE)', badge('officiel'), fmtPct(b.weeklyUsed), []),
      kpi('RESTANT', badge('officiel'), fmtPct(b.weeklyRemaining), [`Réserve : ${fmtPct(b.reservePct, 0)}`, `Distribuable : ${fmtPct(b.distributable)}`]),
      kpi('ÉCART TRAJECTOIRE', badge('observe'), `${b.deviation >= 0 ? '+' : ''}${fmtPct(b.deviation)}`, [b.deviation > 0 ? 'En avance de consommation' : 'Marge disponible'], b.deviation > 5 ? 'orange' : 'green'),
      kpi('BUDGET MOYEN À VENIR', badge('estime', 'Projection si le budget du jour est respecté'), fmtPct(b.futurePerDay), [`${b.days.filter((d) => d.status === 'future').length} jour(s) après aujourd’hui`])),
    h('div', { class: 'panel' }, h('h2', {}, `Stratégie : ${STRAT_LABEL[settings!.strategy]}`),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Stratégie'), h('th', { class: 'r' }, 'Budget aujourd’hui'), h('th', { class: 'r' }, 'Ensuite, par jour'))),
        h('tbody', {}, ...b.previews.map((p) => h('tr', { class: p.strategy === settings!.strategy ? 'today' : '' }, h('td', {}, STRAT_LABEL[p.strategy]), h('td', { class: 'r' }, fmtPct(p.today)), h('td', { class: 'r' }, fmtPct(p.futurePerDay)))))),
      h('div', { class: 'muted', style: 'margin-top:6px;font-size:12px' }, 'Impact du mode intensif : la colonne « Ensuite » suppose que le budget d’aujourd’hui est entièrement consommé.')),
    h('div', { class: 'panel' }, h('h2', {}, 'Détail des journées'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Jour'), h('th', {}, 'Type'), h('th', { class: 'r' }, 'Budget'), h('th', { class: 'r' }, 'Consommé'), h('th', { class: 'r' }, 'Écart'), h('th', {}, 'Qualité'))),
        h('tbody', {}, ...b.days.map((d) => h('tr', { class: d.status === 'today' ? 'today' : '' },
          h('td', {}, `${d.key}${d.status === 'today' ? ' (aujourd’hui)' : ''}`), h('td', {}, DAY_TYPE_LABEL[d.type]),
          h('td', { class: 'r' }, `${fmtPct(d.budgetPct)}${d.status === 'future' ? '*' : ''}`),
          h('td', { class: 'r' }, d.usedPct === null ? (d.status === 'future' ? '—' : 'inconnu') : fmtPct(d.usedPct)),
          h('td', { class: 'r' }, d.usedPct !== null && d.budgetPct !== null ? `${d.usedPct - d.budgetPct >= 0 ? '+' : ''}${fmtPct(d.usedPct - d.budgetPct)}` : ''),
          h('td', { class: 'faint' }, d.quality ? BASE_Q[d.quality] : d.status === 'future' ? 'projeté' : ''))))),
      h('div', { class: 'faint', style: 'font-size:11px;margin-top:6px' }, '* projeté : recalculé en continu selon la consommation réelle. Les budgets passés sont figés à leur début (pas de modification rétroactive).')),
  ];
}

function noBudget(): HTMLElement {
  return h('div', { class: 'panel' }, h('h2', {}, 'Budget quotidien indisponible'),
    h('p', { class: 'muted' }, 'Le budget exige le % hebdomadaire ET l’heure de reset hebdomadaire. Activez le mod « usage-guardian » dans l’onglet Code de Claude Desktop (mesure officielle avec heure de reset), ou saisissez l’heure de reset dans « Sources & saisie ».'),
    h('button', { class: 'btn primary', onclick: () => { tab = 'sources'; render(); } }, 'Ouvrir Sources & saisie'));
}

// ------------------------------------------------------------ Statistiques

function stats(): HTMLElement[] {
  const r = report!;
  const st = r.state;
  const c = r.comparison;
  if (!tokens) void api().getTokens().then((t) => { tokens = t as TokenSummary; if (tab === 'stats') render(); });
  const out: HTMLElement[] = [
    h('h1', {}, 'Statistiques'),
    h('div', { class: 'grid g4' },
      kpi('AUJOURD’HUI', badge('observe'), fmtPct(c.today), []),
      kpi('HIER', badge('observe'), fmtPct(c.yesterday), []),
      kpi('MOYENNE / JOUR', badge('observe', 'Jours couverts à au moins 50 %'), fmtPct(c.average), [`${c.daysCounted} jour(s) bien couverts`]),
      kpi('TENDANCE', badge('estime', 'Régression linéaire sur 14 jours'), c.trendPerDay === null ? '—' : `${c.trendPerDay >= 0 ? '+' : ''}${fmtNum(c.trendPerDay, 2)} pt/j`, [c.trendPerDay === null ? 'Au moins 4 jours nécessaires' : c.trendPerDay > 0 ? 'En hausse' : 'En baisse'])),
    h('div', { class: 'panel' }, h('h2', {}, 'Consommation hebdomadaire attribuée par jour (35 jours)'),
      r.daily.length ? barChart(r.daily.map((d) => ({ label: d.key.slice(5), value: d.used, tip: `${d.key} : ${fmtPct(d.used)} · couverture ${Math.round(d.coverage * 100)} %`, faded: d.coverage < 0.5, highlight: d.key === st.budget?.today.key })))
        : h('div', { class: 'muted' }, 'Pas encore d’historique enregistré.'),
      h('div', { class: 'faint', style: 'font-size:11px' }, 'Seuls les jours réellement mesurés figurent. Barres pâles : moins de 50 % de la journée couverte par des mesures rapprochées.')),
    h('div', { class: 'grid g2' },
      h('div', { class: 'panel' }, h('h2', {}, 'Heures de forte activité (28 jours)'),
        r.hourly.some((v) => v > 0) ? barChart(r.hourly.map((v, i) => ({ label: String(i), value: v, tip: `${i} h : ${fmtPct(v)} du quota hebdo` }))) : h('div', { class: 'muted' }, 'Pas assez de mesures rapprochées.')),
      h('div', { class: 'panel' }, h('h2', {}, 'Cycles hebdomadaires'),
        r.cycles.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Reset'), h('th', { class: 'r' }, 'Pic observé'), h('th', {}, 'État'))),
          h('tbody', {}, ...r.cycles.slice(-8).reverse().map((cy) => h('tr', {}, h('td', {}, fmtDateTime(cy.resetsAt, st.tz)), h('td', { class: 'r' }, fmtPct(cy.peak)), h('td', { class: 'faint' }, cy.complete ? 'terminé' : 'en cours')))))
          : h('div', { class: 'muted' }, 'Aucun cycle mesuré.'))),
    h('div', { class: 'panel' }, h('h2', {}, 'Activité'),
      h('table', {}, h('tbody', {},
        h('tr', {}, h('td', {}, 'Sessions de 5 h distinctes observées aujourd’hui'), h('td', { class: 'r' }, String(r.sessions[st.budget?.today.key ?? ''] ?? 0)), h('td', {}, badge('observe'))),
        h('tr', {}, h('td', {}, 'Messages envoyés dans l’onglet Chat'), h('td', { class: 'r' }, '—'), h('td', {}, badge('indispo', 'Claude Desktop ne les expose pas sans lire les conversations'))),
        h('tr', {}, h('td', {}, 'Réponses Claude Code (onglet Code + CLI) aujourd’hui'), h('td', { class: 'r' }, tokens ? String(tokens.rows.filter((x) => x.day === st.budget?.today.key || x.day === r.daily[r.daily.length - 1]?.key).reduce((a, x) => a + x.messages, 0)) : '…'), h('td', {}, badge('observe', 'Journaux locaux Claude Code')))))),
  ];
  out.push(tokenPanel());
  return out;
}

function tokenPanel(): HTMLElement {
  if (!tokens) return h('div', { class: 'panel' }, h('h2', {}, 'Tokens'), h('div', { class: 'muted' }, 'Lecture des journaux locaux…'));
  const byDay = new Map<string, { i: number; o: number; cc: number; cr: number }>();
  const byModel = new Map<string, { i: number; o: number; cc: number; cr: number; n: number }>();
  for (const r of tokens.rows) {
    const d = byDay.get(r.day) ?? { i: 0, o: 0, cc: 0, cr: 0 };
    d.i += r.input; d.o += r.output; d.cc += r.cacheCreate; d.cr += r.cacheRead; byDay.set(r.day, d);
    const m = byModel.get(r.model) ?? { i: 0, o: 0, cc: 0, cr: 0, n: 0 };
    m.i += r.input; m.o += r.output; m.cc += r.cacheCreate; m.cr += r.cacheRead; m.n += r.messages; byModel.set(r.model, m);
  }
  const days = [...byDay].slice(-10).reverse();
  return h('div', { class: 'panel' }, h('h2', {}, 'Tokens ', badge('officiel', 'Valeurs exactes des journaux locaux Claude Code')),
    h('p', { class: 'muted', style: 'margin-top:0;font-size:12px' }, 'Tokens exacts des sessions Claude Code (onglet Code et CLI). Les tokens de l’onglet Chat ne sont pas exposés par Claude : indisponibles. Un quota en % ne correspond à aucun nombre fixe de tokens.'),
    days.length ? h('div', { class: 'grid g2' },
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Jour'), h('th', { class: 'r' }, 'Entrée'), h('th', { class: 'r' }, 'Sortie'), h('th', { class: 'r' }, 'Cache écrit'), h('th', { class: 'r' }, 'Cache lu'))),
        h('tbody', {}, ...days.map(([d, v]) => h('tr', {}, h('td', {}, d), h('td', { class: 'r' }, fmtTokens(v.i)), h('td', { class: 'r' }, fmtTokens(v.o)), h('td', { class: 'r' }, fmtTokens(v.cc)), h('td', { class: 'r' }, fmtTokens(v.cr)))))),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Modèle'), h('th', { class: 'r' }, 'Réponses'), h('th', { class: 'r' }, 'Entrée'), h('th', { class: 'r' }, 'Sortie'))),
        h('tbody', {}, ...[...byModel].map(([m, v]) => h('tr', {}, h('td', {}, m), h('td', { class: 'r' }, String(v.n)), h('td', { class: 'r' }, fmtTokens(v.i + v.cc + v.cr)), h('td', { class: 'r' }, fmtTokens(v.o)))))))
      : h('div', { class: 'muted' }, tokens.available ? 'Aucune session Claude Code sur 35 jours.' : 'Dossier ~/.claude/projects introuvable.'),
    tokens.sessions.length ? h('details', { style: 'margin-top:8px' }, h('summary', {}, 'Total par session'),
      h('table', {}, h('tbody', {}, ...tokens.sessions.slice(0, 15).map((x) => h('tr', {}, h('td', { class: 'mono' }, x.session), h('td', {}, x.day), h('td', { class: 'r' }, `${x.messages} réponses`), h('td', { class: 'r' }, fmtTokens(x.total))))))) : null);
}

// -------------------------------------------------------------- Prévisions

function forecast(): HTMLElement[] {
  const r = report!;
  const st = r.state;
  const f = st.forecast;
  return [
    h('h1', {}, 'Prévisions'),
    h('div', { class: 'panel', style: 'font-size:12px' }, badge('estime'), ' Estimations statistiques locales à partir de vos mesures réelles — pas des garanties. Suspendues si les données sont insuffisantes ou périmées.'),
    f ? h('div', { class: 'grid g4' },
      kpi('RYTHME MOYEN', badge('estime'), f.windowRate === null ? '—' : `${fmtNum(f.windowRate, 2)} %/h`, [f.perDay !== null ? `≈ ${fmtPct(f.perDay)} par jour` : null]),
      kpi('RYTHME RÉCENT (24 H)', badge('estime'), f.recentRate === null ? '—' : `${fmtNum(f.recentRate, 2)} %/h`, [f.acceleration !== null ? `Accélération ×${fmtNum(f.acceleration, 2)}` : 'Accélération : —']),
      kpi('PAR HEURE ACTIVE', badge('estime'), f.perActiveHour === null ? '—' : fmtPct(f.perActiveHour, 2), [`${f.activeHours} heure(s) active(s) mesurée(s)`]),
      kpi('ÉPUISEMENT', badge('estime', `Confiance ${f.confidence}`), f.exhaustionAt ? fmtDateTime(f.exhaustionAt, st.tz) : 'Après le reset', [`Confiance : ${f.confidence}`, st.budget ? `Recommandé : ${fmtPct(st.budget.futurePerDay)} / jour à venir` : null], f.exhaustionAt ? 'red' : 'green'))
      : h('div', { class: 'panel muted' }, 'Prévisions suspendues : historique insuffisant ou données périmées.'),
    h('div', { class: 'panel' }, h('h2', {}, 'Simulation d’une session de travail'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Durée'), h('th', {}, 'Verdict'), h('th', { class: 'r' }, 'Hebdo attendu'), h('th', { class: 'r' }, 'Pessimiste'), h('th', { class: 'r' }, 'Session 5 h'), h('th', {}, 'Budget du jour'))),
        h('tbody', {}, ...r.estimates.map((e) => h('tr', {},
          h('td', {}, e.hours < 1 ? '30 min' : `${e.hours} h`),
          h('td', { class: `verdict-${e.verdict}` }, VERDICT[e.verdict]),
          h('td', { class: 'r' }, fmtPct(e.weeklyMedian)), h('td', { class: 'r' }, fmtPct(e.weeklyHigh)),
          h('td', { class: 'r' }, e.fiveHourMedian === null ? '—' : fmtPct(e.fiveHourMedian, 0)),
          h('td', {}, e.overBudget ? `dépasserait de ${fmtPct(e.overBudget)}` : e.weeklyMedian !== null ? 'dans le budget' : '—'))))),
      h('div', { class: 'faint', style: 'font-size:11px;margin-top:6px' }, r.estimates[0]?.reason ?? '', ` Base : ${r.estimates[0]?.basis.activeHoursWeekly ?? 0} heure(s) active(s) mesurée(s), confiance ${r.estimates[0]?.confidence ?? 'low'}.`)),
    h('div', { class: 'panel' }, h('h2', {}, 'Vitesse de consommation (7 jours, % hebdo par heure)'),
      r.speed.length ? barChart(r.speed.map((p) => ({ label: new Intl.DateTimeFormat('fr-CH', { weekday: 'short', hour: '2-digit', timeZone: st.tz }).format(new Date(p.t)), value: p.rate, tip: `${fmtDateTime(p.t, st.tz)} : ${fmtPct(p.rate, 2)}` }))) : h('div', { class: 'muted' }, 'Pas assez de mesures rapprochées.')),
  ];
}

// ------------------------------------------------------------------ Sources

function sources(): HTMLElement[] {
  const r = report!;
  const st = r.state;
  const local = (t: number) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };
  const wkIn = h('input', { type: 'number', min: 0, max: 100, step: 0.1, id: 'm-wk', value: st.weekly ? String(st.weekly.used) : '', required: true }) as HTMLInputElement;
  const rsIn = h('input', { type: 'datetime-local', id: 'm-rs', value: st.weekly?.resetsAt ? local(st.weekly.resetsAt) : '' }) as HTMLInputElement;
  const fhIn = h('input', { type: 'number', min: 0, max: 100, step: 1, id: 'm-fh', value: '' }) as HTMLInputElement;
  return [
    h('h1', {}, 'Sources & saisie'),
    h('div', { class: 'panel' }, h('h2', {}, 'Sources de données'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Source'), h('th', {}, 'Type'), h('th', {}, 'État'), h('th', {}, 'Dernière mesure'), h('th', { class: 'r' }, 'Mesures'))),
        h('tbody', {}, ...r.sources.map((s) => h('tr', {},
          h('td', {}, s.label, h('div', { class: 'faint', style: 'font-size:11px' }, s.detail)),
          h('td', {}, badge(s.kind === 'manuel' ? 'manuel' : 'officiel')),
          h('td', { class: `state-${s.state}` }, s.state),
          h('td', {}, s.lastAt ? fmtDateTime(s.lastAt, st.tz) : '—'),
          h('td', { class: 'r' }, String(s.count)))))),
      h('div', { class: 'row-actions', style: 'margin-top:10px' },
        h('button', { class: 'btn', onclick: async () => { await api().refresh(); await load(); toast('Sources relues'); } }, 'Actualiser'),
        h('button', { class: 'btn', onclick: () => api().openDataDir() }, 'Ouvrir le dossier de données'))),
    h('div', { class: 'panel' }, h('h2', {}, 'Saisie manuelle'),
      h('p', { class: 'muted', style: 'margin-top:0;font-size:12px' }, 'Recopiez les valeurs de Claude Desktop › Paramètres › Utilisation. L’heure de reset hebdomadaire saisie une fois suffit : elle se répète chaque semaine à la même heure (documentation Anthropic).'),
      h('form', { class: 'settings', onsubmit: async (e: Event) => {
        e.preventDefault();
        try {
          await api().addManual({ weeklyPct: Number(wkIn.value), weeklyResetsAt: rsIn.value ? new Date(rsIn.value).getTime() : null, fiveHourPct: fhIn.value === '' ? null : Number(fhIn.value) });
          await load(); toast('Mesure manuelle enregistrée');
        } catch (err) { toast(String((err as Error).message)); }
      } },
        field('% hebdomadaire utilisé (tous modèles)', wkIn),
        field('Prochain reset hebdomadaire', rsIn, 'Date et heure locales affichées par Claude'),
        field('% session 5 h (facultatif)', fhIn),
        h('div', {}, h('button', { class: 'btn primary', type: 'submit' }, 'Enregistrer la mesure')))),
    h('div', { class: 'panel' }, h('h2', {}, 'Activer le mod Claude Desktop (recommandé)'),
      h('ol', { style: 'margin:0;padding-left:18px;line-height:1.7' },
        h('li', {}, 'Ouvrir Claude Desktop › onglet Code, dans n’importe quel dossier.'),
        h('li', {}, 'Taper ', h('code', {}, `/plugin marketplace add ${r.marketplaceDir.split(String.fromCharCode(92)).join('/')}`), ' (dossier fourni avec l’application).'),
        h('li', {}, 'Puis ', h('code', {}, '/plugin install usage-guardian@claude-desktop-usage-guardian'), ' et ', h('code', {}, '/reload-plugins'), '.'),
        h('li', {}, 'La bande apparaît au-dessus de la saisie après la première réponse ; ', h('code', {}, '/guardian'), ' ouvre le panneau.')),
      h('p', { class: 'faint', style: 'font-size:11px' }, 'Le mod ne lit aucun contenu de conversation : il reçoit uniquement les pourcentages officiels et heures de reset fournis par Claude.')),
  ];
}

function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = input.id || `f-${Math.random().toString(36).slice(2)}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

// --------------------------------------------------------------- Paramètres

function settingsView(): HTMLElement[] {
  const s = settings!;
  const save = async (patch: Partial<Settings>) => { settings = await api().setSettings(patch); report = await api().getReport(); render(); toast('Paramètre enregistré'); };
  const num = (v: number, min: number, max: number, step: number, on: (n: number) => void) => {
    const i = h('input', { type: 'number', value: String(v), min, max, step }) as HTMLInputElement;
    i.addEventListener('change', () => { const n = Number(i.value); if (Number.isFinite(n)) on(n); });
    return i;
  };
  const sel = <T extends string>(v: T, opts: [T, string][], on: (x: T) => void) => {
    const e = h('select', {}, ...opts.map(([k, l]) => h('option', { value: k, selected: k === v }, l))) as HTMLSelectElement;
    e.addEventListener('change', () => on(e.value as T));
    return e;
  };
  const chk = (v: boolean, on: (b: boolean) => void) => {
    const e = h('input', { type: 'checkbox', checked: v }) as HTMLInputElement;
    e.addEventListener('change', () => on(e.checked));
    return e;
  };
  const ov = s.overlay;
  const nt = s.notifications;
  const autostartBox = chk(false, (b) => void api().setAutoStart(b).then(() => toast(b ? 'Lancement avec Windows activé' : 'Lancement avec Windows désactivé')));
  void api().appInfo().then((i: { autoStart: boolean }) => { autostartBox.checked = i.autoStart; });
  return [
    h('h1', {}, 'Paramètres'),
    h('form', { class: 'settings', onsubmit: (e: Event) => e.preventDefault() },
      h('fieldset', {}, h('legend', {}, 'Répartition du budget'),
        field('Stratégie', sel<Strategy>(s.strategy, [['balanced', 'Équilibré (défaut)'], ['conservative', 'Conservateur'], ['intensive', 'Intensif']], (v) => save({ strategy: v }))),
        field('Réserve personnelle (% hebdo)', num(s.personalReservePct, 0, 50, 1, (n) => save({ personalReservePct: n })), 'Toujours préservée pour les urgences, quel que soit le mode.'),
        field('Réserve du mode conservateur (%)', num(s.conservativeReservePct, 0, 40, 1, (n) => save({ conservativeReservePct: n })), '10 à 20 % conseillé.'),
        field('Facteur du mode intensif', num(s.intensiveFactor, 1, 5, 0.1, (n) => save({ intensiveFactor: n }))),
        field('Types de journée', h('div', { class: 'days' }, ...WEEKDAYS.map((d, i) => h('label', {}, d, sel<DayType>(s.weekdayTypes[i] ?? 'normal', [['normal', 'Normal'], ['heavy', 'Forte'], ['rest', 'Repos']], (v) => { const w = [...s.weekdayTypes]; w[i] = v; void save({ weekdayTypes: w }); }))))),
        field('Poids forte activité / repos', h('div', { class: 'days' }, num(s.dayTypeWeights.heavy, 0.05, 5, 0.1, (n) => save({ dayTypeWeights: { ...s.dayTypeWeights, heavy: n } })), num(s.dayTypeWeights.rest, 0, 5, 0.1, (n) => save({ dayTypeWeights: { ...s.dayTypeWeights, rest: n } })))),
        field('Heures actives par jour', num(s.activeHoursPerDay, 1, 24, 1, (n) => save({ activeHoursPerDay: n })), 'Sert à juger si le rythme est soutenable.')),
      h('fieldset', {}, h('legend', {}, 'Journée et fuseau'),
        field('Fuseau horaire', (() => { const i = h('input', { type: 'text', value: s.timezone }) as HTMLInputElement; i.addEventListener('change', () => void save({ timezone: i.value.trim() })); return i; })(), 'Identifiant IANA, ex. Europe/Zurich.'),
        field('Début de journée (heure)', num(s.dayStartHour, 0, 23, 1, (n) => save({ dayStartHour: n })))),
      h('fieldset', {}, h('legend', {}, 'Seuils d’alerte (part du budget du jour)'),
        field('Jaune à partir de', num(s.thresholds.yellow, 0.05, 0.99, 0.05, (n) => save({ thresholds: { ...s.thresholds, yellow: n } }))),
        field('Orange à partir de', num(s.thresholds.orange, 0.05, 0.999, 0.05, (n) => save({ thresholds: { ...s.thresholds, orange: n } }))),
        field('Rouge à partir de', num(s.thresholds.red, 0.5, 5, 0.05, (n) => save({ thresholds: { ...s.thresholds, red: n } }))),
        field('Critique à partir de', num(s.thresholds.critical, 0.5, 10, 0.05, (n) => save({ thresholds: { ...s.thresholds, critical: n } })))),
      h('fieldset', {}, h('legend', {}, 'Barre dans Claude Desktop'),
        field('Afficher la barre', chk(ov.enabled, (b) => save({ overlay: { ...ov, enabled: b } }))),
        field('Emplacement', sel(ov.anchor, [['above-input', 'Au-dessus de la zone de saisie'], ['titlebar', 'Sous la barre de titre'], ['bottom-edge', 'Bord inférieur']], (v) => save({ overlay: { ...ov, anchor: v, offsetX: 0, offsetY: 0 } })), 'Faites glisser la poignée ⋮⋮ pour ajuster ; double-clic pour revenir.'),
        field('Taille', num(ov.scale, 0.75, 1.6, 0.05, (n) => save({ overlay: { ...ov, scale: n } }))),
        field('Opacité', num(ov.opacity, 0.5, 1, 0.05, (n) => save({ overlay: { ...ov, opacity: n } }))),
        field('Seconde ligne (5 h, semaine, reset)', chk(ov.showSecondLine, (b) => save({ overlay: { ...ov, showSecondLine: b } }))),
        field('Thème', sel(ov.theme, [['auto', 'Automatique (Windows)'], ['light', 'Clair'], ['dark', 'Sombre']], (v) => save({ overlay: { ...ov, theme: v } }))),
        field('Réduire les animations', chk(ov.reducedMotion, (b) => save({ overlay: { ...ov, reducedMotion: b } }))),
        field('Position', h('button', { class: 'btn', type: 'button', onclick: () => api().resetPosition().then(() => toast('Position réinitialisée')) }, 'Réinitialiser la position'))),
      h('fieldset', {}, h('legend', {}, 'Notifications Windows'),
        field('Activer', chk(nt.enabled, (b) => save({ notifications: { ...nt, enabled: b } }))),
        field('Mode silencieux', chk(nt.quiet, (b) => save({ notifications: { ...nt, quiet: b } })), 'Coupe toutes les notifications sans perdre vos choix. Windows (Ne pas déranger) reste prioritaire.'),
        field('80 % du budget du jour', chk(nt.dailyWarn, (b) => save({ notifications: { ...nt, dailyWarn: b } }))),
        field('Budget du jour dépassé', chk(nt.dailyOver, (b) => save({ notifications: { ...nt, dailyOver: b } }))),
        field('Rythme excessif', chk(nt.fastPace, (b) => save({ notifications: { ...nt, fastPace: b } }))),
        field('Quota hebdomadaire presque épuisé', chk(nt.weeklyLow, (b) => save({ notifications: { ...nt, weeklyLow: b } }))),
        field('Réinitialisation d’une limite officielle', chk(nt.resets, (b) => save({ notifications: { ...nt, resets: b } })))),
      h('fieldset', {}, h('legend', {}, 'Application et données'),
        field('Lancer avec Windows', autostartBox),
        field('Économie de mémoire', chk(s.lowMemory, (b) => save({ lowMemory: b })), 'Rendu logiciel : environ 85 Mo de moins. Pris en compte au prochain démarrage.'),
        field('Fraîcheur (minutes)', h('div', { class: 'days' }, num(s.freshMinutes, 1, 240, 1, (n) => save({ freshMinutes: n })), num(s.staleMinutes, 5, 2880, 5, (n) => save({ staleMinutes: n }))), 'Âge « récent » puis « périmé » d’une mesure (prévisions suspendues au-delà).'),
        field('Conservation de l’historique (jours)', num(s.retentionDays, 7, 730, 1, (n) => save({ retentionDays: n }))),
        field('Exporter', h('div', { class: 'row-actions' },
          h('button', { class: 'btn', type: 'button', onclick: async () => { const p = await api().exportData('csv'); if (p) toast(`Exporté : ${p}`); } }, 'CSV'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { const p = await api().exportData('json'); if (p) toast(`Exporté : ${p}`); } }, 'JSON'))),
        field('Supprimer l’historique', h('button', { class: 'btn', type: 'button', onclick: async () => { if (await api().deleteHistory()) { await load(); toast('Historique supprimé'); } } }, 'Supprimer…'), 'Confirmation demandée. Le journal de Claude Desktop n’est jamais modifié.'))),
  ];
}

// --------------------------------------------------------------------- Aide

function help(): HTMLElement[] {
  return [
    h('h1', {}, 'Aide'),
    h('div', { class: 'panel' }, h('h2', {}, 'Lire la barre'),
      h('ul', { style: 'margin:0;padding-left:18px;line-height:1.7' },
        h('li', {}, h('b', {}, 'AUJOURD’HUI x % / y %'), ' : consommation du quota hebdomadaire attribuable à aujourd’hui / budget recommandé du jour. Le budget est virtuel : il ne réinitialise jamais le quota réel.'),
        h('li', {}, h('b', {}, 'Couleurs'), ' : vert < 60 %, jaune 60–80 %, orange 80–100 %, rouge au-delà, critique en forte surconsommation ou risque d’épuisement. Icône et texte accompagnent toujours la couleur.'),
        h('li', {}, h('b', {}, 'Badges'), ' : ', badge('officiel'), ' valeur rapportée par Claude · ', badge('observe'), ' calculée à partir de mesures locales · ', badge('estime'), ' prévision · ', badge('indispo'), ' non disponible.'),
        h('li', {}, h('b', {}, 'RESET*'), ' : l’astérisque signale une heure de reset déduite du cycle hebdomadaire fixe.'),
        h('li', {}, h('b', {}, '◔'), ' : journée partielle, suivie depuis la première mesure disponible.'))),
    h('div', { class: 'panel' }, h('h2', {}, 'La barre n’apparaît pas ?'),
      h('ul', { style: 'margin:0;padding-left:18px;line-height:1.7' },
        h('li', {}, 'Elle n’est visible que lorsque Claude Desktop est la fenêtre active (jamais par-dessus une autre application).'),
        h('li', {}, 'Vérifiez l’icône près de l’horloge › « Afficher la barre ».'),
        h('li', {}, 'Voir docs/TROUBLESHOOTING.md dans le dépôt.'))),
  ];
}

// ----------------------------------------------------------------------------

api().on('state', async (v) => {
  if (!report) return;
  report = { ...report, state: v as GuardianState };
  if (tab === 'overview' || tab === 'week') report = await api().getReport();
  render();
});
api().on('tab', (v) => { tab = (v as Tab) || 'overview'; location.hash = tab; void load(); });
window.addEventListener('hashchange', () => { const t = location.hash.slice(1) as Tab; if (t && t !== tab) { tab = t; render(); } });
void load();
