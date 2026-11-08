/** Utilitaires d'interface partagés (DOM sans framework, aucune injection HTML). */
import { FREEDOM_LABEL, PACE_LABEL, STATUS_ICON, STATUS_LABEL, STATUS_SHORT } from '../../core/alerts';
import { fmtDateTime, fmtDuration, fmtPct, fmtRelative } from '../../core/format';
import type { GuardianState } from '../../core/state';
import type { SourceId } from '../../core/types';
import type { GuardianApi } from '../preload/index';

declare global {
  interface Window { guardian: GuardianApi }
}

export const api = (): GuardianApi => window.guardian;

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

/** Crée un élément ; les textes passent par textContent (jamais innerHTML). */
export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    // CSSOM : autorisé par la CSP stricte (les attributs style inline sont bloqués).
    else if (k === 'style') el.style.cssText = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export const SOURCE_TEXT: Record<SourceId, string> = {
  'desktop-mod': 'Officiel · mod Claude Desktop',
  'claude-code': 'Officiel · statusline Claude Code',
  'desktop-history': 'Officiel · journal de Claude Desktop',
  manual: 'Saisie manuelle',
  import: 'Importé',
};

/** Badge de provenance : Officiel / Observé / Estimé / Indisponible. */
export function badge(kind: 'officiel' | 'observe' | 'estime' | 'indispo' | 'manuel', title?: string): HTMLElement {
  const text = { officiel: 'Officiel', observe: 'Observé', estime: 'Estimé', indispo: 'Indisponible', manuel: 'Manuel' }[kind];
  return h('span', { class: `badge b-${kind}`, title: title ?? text }, text);
}

export function sourceKind(id: SourceId | null | undefined): 'officiel' | 'manuel' | 'indispo' {
  if (!id) return 'indispo';
  return id === 'manual' ? 'manuel' : 'officiel';
}

export function freshnessText(st: GuardianState): string {
  if (st.data.ageMs === null) return 'aucune mesure';
  const age = fmtRelative(st.data.ageMs);
  return st.freshness === 'stale' ? `PÉRIMÉ — ${age}` : `màj ${age}`;
}

export function applyTheme(theme: 'auto' | 'light' | 'dark', reducedMotion: boolean): void {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.toggleAttribute('data-reduced-motion', reducedMotion);
}

export function progress(fraction: number, level: string, label: string): HTMLElement {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  const fill = h('div', { class: `fill lvl-${level}`, style: `width:${pct.toFixed(1)}%` });
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct), 'aria-label': label, title: label }, fill,
    fraction > 1 ? h('div', { class: 'overflow', title: 'Dépassement du budget' }) : null);
}

export { FREEDOM_LABEL, PACE_LABEL, STATUS_ICON, STATUS_LABEL, STATUS_SHORT, fmtDateTime, fmtDuration, fmtPct };
