/**
 * Statusline optionnelle pour Claude Code CLI (module secondaire).
 * Lit le JSON officiel sur stdin, enregistre `rate_limits` dans le stockage partagé
 * (même moteur que l'overlay et le mod) et affiche une ligne compacte colorée.
 * Ne sort jamais en erreur : une statusline vide vaut mieux qu'un terminal bloqué.
 */
import { STATUS_ICON } from '../src/core/alerts';
import { fmtDuration, fmtNum, fmtTokens } from '../src/core/format';
import { parseStatuslineInput } from '../src/core/normalize';
import { mergeSnapshots } from '../src/core/schedule';
import { computeState } from '../src/core/state';
import type { StatusLevel } from '../src/core/types';
import { appendSnapshot, loadDesktopHistory, loadSettings, loadSnapshots } from '../src/sources/store';

const C: Record<StatusLevel, string> = { green: '32', yellow: '33', orange: '38;5;208', red: '31', critical: '1;31', unknown: '90' };
const col = (code: string, s: string) => (process.env.NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const dim = (s: string) => col('2', s);

function run(raw: string): string {
  let input: Record<string, any> = {};
  try { input = JSON.parse(raw || '{}'); } catch { /* entrée invalide : ligne minimale */ }
  const now = Date.now();
  const snap = parseStatuslineInput(input, now);
  if (snap) { try { appendSnapshot('statusline', snap); } catch { /* lecture seule possible */ } }
  const settings = loadSettings();
  const snaps = mergeSnapshots(loadSnapshots(10, now).snapshots, loadDesktopHistory().snapshots);
  const st = computeState(snaps, settings, now);
  const parts: string[] = [];
  const t = st.budget?.today;
  const c = C[st.status];
  parts.push(t
    ? col(c, `${STATUS_ICON[st.status]} Jour ${fmtNum(t.usedPct)}/${fmtNum(t.budgetPct)} % (${Math.round(t.ratio * 100)} %)`) + (t.baselineQuality === 'partial' ? dim(' ◔') : '')
    : dim('○ Jour —'));
  if (st.fiveHour) parts.push(col(C[st.fiveHour.level], `5h ${Math.round(st.fiveHour.used)} %`) + (st.fiveHour.resetsAt ? dim(` ↻${fmtDuration(st.fiveHour.resetsAt - now)}`) : ''));
  if (st.weekly) parts.push(`Sem ${Math.round(st.weekly.used)} %` + (st.weekly.resetsAt ? dim(` ↻${fmtDuration(st.weekly.resetsAt - now)}`) : ''));
  if (st.freshness === 'stale') parts.push(col('31', 'données périmées'));
  const model = input.model?.display_name;
  if (model) parts.push(String(model));
  const ctx = input.context_window;
  if (ctx && typeof ctx.used_percentage === 'number') parts.push(dim(`ctx ${Math.round(ctx.used_percentage)} %`));
  const cu = ctx?.current_usage;
  if (cu) parts.push(dim(`↓${fmtTokens((cu.input_tokens ?? 0) + (cu.cache_creation_input_tokens ?? 0) + (cu.cache_read_input_tokens ?? 0))} ↑${fmtTokens(cu.output_tokens ?? 0)}`));
  return parts.join(dim(' │ '));
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => {
  try { process.stdout.write(run(buf) + '\n'); } catch { process.stdout.write('Usage Guardian\n'); }
});
