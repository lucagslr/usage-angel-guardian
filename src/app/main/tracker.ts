/**
 * Suit la fenêtre Claude Desktop : présence, position, taille, DPI, état actif.
 * Interrogation adaptative (coût CPU négligeable : 3 appels Win32 par tick) :
 *  - 100 ms tant que Claude est au premier plan (suivi fluide des déplacements) ;
 *  - 400 ms quand Claude est ouvert mais inactif ;
 *  - 2 s quand Claude est fermé (re-détection).
 */
import { EventEmitter } from 'node:events';
import type { ClaudeWindowInfo, ForegroundInfo, Rect, Win32 } from './win32';

export interface TrackerSnapshot {
  claude: ClaudeWindowInfo | null;
  foreground: ForegroundInfo;
}

export class ClaudeTracker extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private current: ClaudeWindowInfo | null = null;
  private lastKey = '';
  private lastScan = 0;

  constructor(private w: Win32, private now: () => number = Date.now) {
    super();
  }

  start(): void {
    if (this.timer) return;
    this.tick();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get claude(): ClaudeWindowInfo | null {
    return this.current;
  }

  /** Force une nouvelle détection (après un redémarrage ou une mise à jour de Claude). */
  rescan(): void {
    this.current = null;
    this.lastScan = 0;
  }

  private tick = (): void => {
    let snap: TrackerSnapshot;
    try {
      snap = this.sample();
    } catch (e) {
      this.emit('error', e);
      snap = { claude: null, foreground: { hwnd: 0n, rootOwner: 0n, pid: 0 } };
    }
    const key = keyOf(snap);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.emit('change', snap);
    }
    const delay = !snap.claude ? 2000 : snap.foreground.hwnd === snap.claude.hwnd ? 100 : 400;
    this.timer = setTimeout(this.tick, delay);
  };

  private sample(): TrackerSnapshot {
    const t = this.now();
    if (this.current) {
      const again = this.w.describe(this.current.hwnd, this.current.pid, this.current.exe);
      this.current = again && again.rect.width > 0 ? again : null;
    }
    // Re-détection périodique : nouvelle fenêtre après mise à jour/redémarrage de Claude.
    if (!this.current && t - this.lastScan > 1500) {
      this.lastScan = t;
      this.current = this.w.findClaudeWindow();
    }
    return { claude: this.current, foreground: this.w.foreground() };
  }
}

function rectKey(r: Rect): string {
  return `${r.x},${r.y},${r.width},${r.height}`;
}

function keyOf(s: TrackerSnapshot): string {
  const c = s.claude;
  return c ? `${c.hwnd}|${rectKey(c.rect)}|${c.iconic}|${c.cloaked}|${c.dpi}|${s.foreground.hwnd}` : `none|${s.foreground.hwnd}`;
}
