/** Graphiques SVG simples (aucune dépendance), lisibles en thème clair et sombre. */
import { s } from './ui';

export interface Bar { label: string; value: number | null; ref?: number | null; tip: string; level?: string; faded?: boolean; highlight?: boolean }

const W = 640;

/** Barres verticales (valeur) avec repère horizontal facultatif (budget). */
export function barChart(bars: Bar[], opts: { height?: number; unit?: string; max?: number } = {}): SVGElement {
  const H = opts.height ?? 160;
  const padB = 22, padT = 10, padL = 30;
  const max = Math.max(opts.max ?? 0, 1, ...bars.map((b) => Math.max(b.value ?? 0, b.ref ?? 0))) * 1.1;
  const n = Math.max(1, bars.length);
  const bw = (W - padL - 4) / n;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (const t of ticks(max)) {
    svg.append(s('line', { x1: padL, x2: W, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(s('text', { x: padL - 4, y: y(t) + 3, class: 'axis', 'text-anchor': 'end' }, `${fmt(t)}`));
  }
  bars.forEach((b, i) => {
    const x = padL + i * bw;
    const g = s('g', { class: `lvl-${b.level ?? 'accent'}${b.faded ? ' faded' : ''}${b.highlight ? ' hl' : ''}` });
    g.append(s('title', {}, b.tip));
    if (b.value !== null) {
      const top = y(Math.max(0, b.value));
      g.append(s('rect', { x: x + bw * 0.15, y: top, width: Math.max(1, bw * 0.7), height: Math.max(0, H - padB - top), rx: 2, class: 'bar' }));
    } else {
      g.append(s('rect', { x: x + bw * 0.15, y: padT, width: Math.max(1, bw * 0.7), height: H - padB - padT, class: 'nodata' }));
    }
    if (b.ref !== null && b.ref !== undefined) g.append(s('line', { x1: x + bw * 0.05, x2: x + bw * 0.95, y1: y(b.ref), y2: y(b.ref), class: 'ref' }));
    if (n <= 40 && (n <= 14 || i % Math.ceil(n / 14) === 0)) g.append(s('text', { x: x + bw / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }, b.label));
    svg.append(g);
  });
  return svg;
}

export interface LinePoint { t: number; v: number }

/** Courbes temporelles : mesures (pleine), trajectoire recommandée (pointillé), projection (tirets). */
export function lineChart(series: { points: LinePoint[]; cls: string; label: string }[], range: { from: number; to: number; max?: number }, marks: { t: number; label: string }[] = []): SVGElement {
  const H = 190, padL = 30, padB = 22, padT = 10;
  const max = Math.max(range.max ?? 0, 10, ...series.flatMap((s2) => s2.points.map((p) => p.v))) * 1.05;
  const x = (t: number) => padL + ((W - padL - 6) * (t - range.from)) / Math.max(1, range.to - range.from);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (const t of ticks(max)) {
    svg.append(s('line', { x1: padL, x2: W, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(s('text', { x: padL - 4, y: y(t) + 3, class: 'axis', 'text-anchor': 'end' }, `${fmt(t)}`));
  }
  for (const m of marks) {
    svg.append(s('line', { x1: x(m.t), x2: x(m.t), y1: padT, y2: H - padB, class: 'mark' }));
    svg.append(s('text', { x: x(m.t) + 3, y: H - 6, class: 'axis' }, m.label));
  }
  for (const se of series) {
    if (se.points.length < 2) continue;
    const d = se.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const path = s('path', { d, class: `line ${se.cls}` });
    path.append(s('title', {}, se.label));
    svg.append(path);
  }
  return svg;
}

function ticks(max: number): number[] {
  const step = max > 60 ? 25 : max > 30 ? 10 : max > 12 ? 5 : max > 5 ? 2 : max > 2 ? 1 : 0.5;
  const out: number[] = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  return out;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}
