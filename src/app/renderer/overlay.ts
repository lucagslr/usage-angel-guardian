/** Barre compacte (niveau 1) et panneau déplié (niveau 2), dessinés dans l'overlay. */
import type { GuardianState } from '../../core/state';
import type { Settings } from '../../core/types';
import {
  api, applyTheme, badge, fmtDateTime, fmtDuration, fmtPct, freshnessText, FREEDOM_LABEL, h, PACE_LABEL, progress,
  SOURCE_TEXT, sourceKind, STATUS_ICON, STATUS_SHORT,
} from './ui';

const root = document.getElementById('root')!;
let state: GuardianState | null = null;
let settings: Settings | null = null;
let expanded = false;

const FREEDOM_LVL: Record<string, string> = { high: 'green', normal: 'green', caution: 'yellow', 'slow-down': 'orange', over: 'red', unknown: 'unknown' };

function render(): void {
  if (!state || !settings) return;
  applyTheme(settings.overlay.theme, settings.overlay.reducedMotion);
  document.body.classList.toggle('top', settings.overlay.anchor === 'titlebar');
  document.body.style.zoom = String(settings.overlay.scale);
  const bar = renderBar(state, settings);
  const panel = expanded ? renderPanel(state) : null;
  root.replaceChildren(...(panel ? (settings.overlay.anchor === 'titlebar' ? [bar, panel] : [panel, bar]) : [bar]));
  if (panel) {
    // Hauteur naturelle du panneau (non zoomée) + barre + marges, transmise au processus principal.
    panel.style.flex = 'none';
    const natural = panel.scrollHeight + bar.offsetHeight + 14;
    panel.style.flex = '';
    void api().reportHeight(natural);
  }
}

function renderBar(st: GuardianState, s: Settings): HTMLElement {
  const t = st.budget?.today;
  const lvl = st.status;
  const over = !!t && t.ratio >= 1;
  const tip = t
    ? `Consommation attribuable à aujourd'hui (${t.baselineQuality === 'partial' ? 'partielle, depuis ' + fmtDateTime(t.trackedSince, st.tz, false) : 'depuis le début de la journée'}) / budget recommandé du jour.\nLe budget est virtuel : il ne réinitialise pas le quota d'Anthropic.`
    : 'Le budget du jour exige une mesure hebdomadaire et son heure de reset.';
  const row1 = h('div', { class: `row row1 lvl-${lvl}`, title: tip },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('span', { class: 'label' }, "AUJOURD'HUI"),
    t
      ? h('span', { class: 'today num' }, fmtPct(t.usedPct), h('span', { class: 'of' }, ` / ${fmtPct(t.budgetPct)}`), t.baselineQuality === 'partial' ? h('span', { class: 'faint', title: 'Historique insuffisant : suivi depuis la première mesure du jour' }, ' ◔') : null)
      : h('span', { class: 'faint' }, 'indisponible'),
    t ? progress(t.ratio, lvl, `${Math.round(t.ratio * 100)} % du budget du jour`) : h('div', { class: 'progress' }),
    t ? h('span', { class: 'ratio num' }, `${Math.min(999, Math.round(t.ratio * 100))} %`) : null,
    h('span', { class: `status${over ? ' alert' : ''}` }, `${STATUS_ICON[lvl]} ${over ? 'BUDGET QUOTIDIEN DÉPASSÉ — PAUSE RECOMMANDÉE' : `${STATUS_SHORT[lvl]} — ${st.statusLabel.toUpperCase()}`}`),
    h('button', { class: 'icon-btn', title: expanded ? 'Réduire (Échap)' : 'Détails', 'aria-label': expanded ? 'Réduire le panneau' : 'Ouvrir le panneau détaillé', 'aria-expanded': String(expanded), onclick: () => api().expand(!expanded) }, expanded ? '▾' : '▴'),
    grip(),
  );
  const fh = st.fiveHour;
  const wk = st.weekly;
  const row2 = s.overlay.showSecondLine ? h('div', { class: 'row row2 num' },
    h('span', { title: fh ? `Session de 5 h · ${SOURCE_TEXT[fh.source]}${fh.resetsAt ? '' : ' (heure de reset non fournie par cette source)'}` : 'Aucune mesure de session' },
      `5H : ${fh ? fmtPct(fh.used, 0) : '—'}${fh?.resetsAt ? ` ↻ ${fmtDuration(fh.resetsAt - st.now)}` : ''}`),
    h('span', { class: 'sep' }, '|'),
    h('span', { title: wk ? `Quota hebdomadaire · ${SOURCE_TEXT[wk.source]}` : '' }, `SEMAINE : ${wk ? fmtPct(wk.used, 0) : '—'}`),
    h('span', { class: 'sep' }, '|'),
    h('span', { title: wk?.resetsAt ? `Reset hebdomadaire ${fmtDateTime(wk.resetsAt, st.tz)}${wk.resetOrigin === 'inferred' ? ' — déduit du cycle hebdomadaire fixe' : ' — fourni par Claude'}` : 'Heure de reset inconnue : à saisir dans Sources, ou ouvrir une session Code avec le mod actif' },
      `RESET : ${wk?.resetsAt ? fmtDuration(wk.resetsAt - st.now) : '?'}${wk?.resetOrigin === 'inferred' ? '*' : ''}`),
    h('span', { class: `pace ${st.pace.level}`, title: st.pace.rate !== null ? `Rythme récent ${st.pace.rate.toFixed(2).replace('.', ',')} %/h (estimation)` : 'Rythme inconnu' }, PACE_LABEL[st.pace.level]),
    h('span', { class: st.freshness === 'stale' ? 'stale-text' : '', title: st.data.lastAt ? `Dernière mesure : ${fmtDateTime(st.data.lastAt, st.tz)}` : '' },
      h('span', { class: `fresh-dot ${st.freshness}` }), freshnessText(st)),
  ) : null;
  return h('div', { class: `bar lvl-${lvl}`, role: 'status', 'aria-label': 'Usage Guardian' }, row1, row2);
}

function grip(): HTMLElement {
  const g = h('button', { class: 'icon-btn grip', title: 'Déplacer la barre (double-clic : position par défaut)', 'aria-label': 'Déplacer la barre' }, '⋮⋮');
  g.addEventListener('pointerdown', (e) => {
    g.setPointerCapture(e.pointerId);
    void api().dragStart();
  });
  const end = () => void api().dragEnd();
  g.addEventListener('pointerup', end);
  g.addEventListener('lostpointercapture', end);
  g.addEventListener('dblclick', () => void api().resetPosition());
  return g;
}

function card(k: string, b: HTMLElement | null, v: string | HTMLElement, sub: (string | HTMLElement | null)[] = [], lvl = 'unknown'): HTMLElement {
  return h('div', { class: `card lvl-${lvl}` }, h('div', { class: 'k' }, k, b), h('div', { class: 'v num' }, v), ...sub.map((x) => (x ? h('div', { class: 'sub num' }, x) : null)));
}

function renderPanel(st: GuardianState): HTMLElement {
  const t = st.budget?.today;
  const b = st.budget;
  const fh = st.fiveHour;
  const wk = st.weekly;
  const lvl = FREEDOM_LVL[st.freedom] ?? 'unknown';
  const todayCard = card("AUJOURD'HUI", t ? badge('observe', 'Différence entre mesures officielles horodatées') : badge('indispo'),
    t ? `${fmtPct(t.usedPct)} / ${fmtPct(t.budgetPct)}` : '—',
    t ? [
      progress(t.ratio, st.status, 'Budget du jour'),
      `Reste ${fmtPct(Math.max(0, t.remainingPct))}${t.remainingPct < 0 ? ` · dépassé de ${fmtPct(-t.remainingPct)}` : ''}`,
      t.baselineQuality === 'approximate' ? `Entre ${fmtPct(t.usedRange[0])} et ${fmtPct(t.usedRange[1])} (mesures espacées)` : t.baselineQuality === 'partial' ? `Partiel : suivi depuis ${fmtDateTime(t.trackedSince, st.tz, false)}` : null,
      t.usedBeforeReset ? `+ ${fmtPct(t.usedBeforeReset)} avant le reset de ce jour` : null,
    ] : ['Heure de reset hebdomadaire nécessaire'], st.status);
  const fhCard = card('SESSION 5 H', fh ? badge(sourceKind(fh.source), SOURCE_TEXT[fh.source]) : badge('indispo'),
    fh ? `${fmtPct(fh.used, 0)}` : '—',
    fh ? [progress(fh.used / 100, fh.level, 'Session de 5 h'), `Reste ${fmtPct(fh.remaining, 0)}`, fh.resetsAt ? `Reset ${fmtDateTime(fh.resetsAt, st.tz, false)} · dans ${fmtDuration(fh.resetsAt - st.now)}` : 'Heure de reset non fournie', fh.hitsLimitAt ? `⚠ Limite estimée vers ${fmtDateTime(fh.hitsLimitAt, st.tz, false)}` : null] : ['Aucune session mesurée'], fh?.level ?? 'unknown');
  const wkLvl = wk ? (wk.used >= 90 ? 'red' : wk.used >= 75 ? 'orange' : b && b.deviation > 5 ? 'yellow' : 'green') : 'unknown';
  const wkCard = card('SEMAINE', wk ? badge(sourceKind(wk.source), SOURCE_TEXT[wk.source]) : badge('indispo'),
    wk ? `${fmtPct(wk.used, 0)}` : '—',
    wk ? [
      progress(wk.used / 100, wkLvl, 'Quota hebdomadaire'),
      wk.resetsAt ? `Reset ${fmtDateTime(wk.resetsAt, st.tz)}${wk.resetOrigin === 'inferred' ? ' (déduit)' : ''}` : 'Heure de reset inconnue',
      b ? `Trajectoire : ${b.deviation >= 0 ? '+' : ''}${fmtPct(b.deviation)} vs recommandé` : null,
      st.forecast?.exhaustionAt ? h('span', {}, `Épuisement ${fmtDateTime(st.forecast.exhaustionAt, st.tz)} `, badge('estime', `Confiance ${st.forecast.confidence}`)) : null,
    ] : ['Aucune mesure hebdomadaire'], wkLvl);
  const week = b ? h('div', { class: 'week', title: 'Budget (trait) et consommation (barre) par jour de la semaine officielle' },
    ...b.days.map((d) => {
      const max = Math.max(1, ...b.days.map((x) => Math.max(x.budgetPct ?? 0, x.usedPct ?? 0)));
      const ul = d.usedPct !== null && d.budgetPct ? (d.usedPct > d.budgetPct ? 'red' : 'green') : 'unknown';
      const day = new Intl.DateTimeFormat('fr-CH', { weekday: 'narrow', timeZone: st.tz }).format(new Date(d.start + 3_600_000));
      return h('div', { class: `d${d.status === 'today' ? ' today' : ''}`, title: `${d.key} · budget ${fmtPct(d.budgetPct)}${d.usedPct !== null ? ` · utilisé ${fmtPct(d.usedPct)}` : d.status === 'future' ? ' (projeté)' : ''}` },
        h('div', { class: 'col' },
          d.usedPct !== null ? h('div', { class: `u lvl-${ul}`, style: `height:${(100 * d.usedPct) / max}%` }) : null,
          d.budgetPct !== null ? h('div', { class: 'b', style: `bottom:${(100 * d.budgetPct) / max}%` }) : null),
        day);
    })) : null;
  return h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Détails de consommation' },
    h('div', { class: `advisor lvl-${lvl}` },
      h('span', { class: 'dot' }),
      h('div', {}, h('div', { class: 'q' }, 'Puis-je encore beaucoup utiliser Claude aujourd’hui ?'), h('div', { class: 'a' }, FREEDOM_LABEL[st.freedom])),
      h('div', { style: 'margin-left:auto', class: 'q' }, PACE_LABEL[st.pace.level])),
    h('div', { class: 'cards' }, todayCard, fhCard, wkCard),
    week,
    st.insights.length ? h('ul', { class: 'insights' }, ...st.insights.slice(0, 5).map((i) => h('li', { class: i.level }, i.text, i.estimate ? ' ' : '', i.estimate ? badge('estime') : null))) : null,
    h('div', { class: 'actions' },
      h('span', { class: 'meta', title: st.data.source ? SOURCE_TEXT[st.data.source] : '' }, st.data.lastAt ? `Mesure ${fmtDateTime(st.data.lastAt, st.tz)} · ${st.data.source ? SOURCE_TEXT[st.data.source] : ''}` : 'Aucune mesure — voir Sources'),
      h('button', { class: 'btn', onclick: () => api().openDashboard('sources') }, 'Sources'),
      h('button', { class: 'btn', onclick: () => api().hideOverlay(), title: 'Réafficher depuis l’icône de la zone de notification' }, 'Masquer'),
      h('button', { class: 'btn primary', onclick: () => api().openDashboard('overview') }, 'Dashboard')),
  );
}

async function init(): Promise<void> {
  [state, settings] = await Promise.all([api().getState(), api().getSettings()]);
  render();
  api().on('state', async (v) => { state = v as GuardianState; settings = await api().getSettings(); render(); });
  api().on('expanded', (v) => { expanded = !!v; render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) void api().expand(false); });
}

void init();
