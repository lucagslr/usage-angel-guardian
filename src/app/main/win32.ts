/**
 * Accès Win32 en lecture seule via koffi (FFI, aucune compilation native).
 * Uniquement des appels d'observation de fenêtres : aucune injection, aucune
 * lecture mémoire d'un autre processus, aucune modification de Claude Desktop.
 */
import type * as KoffiNs from 'koffi';

export interface Rect { x: number; y: number; width: number; height: number }

export interface ClaudeWindowInfo {
  hwnd: bigint;
  pid: number;
  exe: string;
  /** Rectangle visible (sans bordure invisible), pixels physiques. */
  rect: Rect;
  iconic: boolean;
  zoomed: boolean;
  /** Fenêtre « masquée » par DWM (autre bureau virtuel). */
  cloaked: boolean;
  dpi: number;
}

export interface ForegroundInfo { hwnd: bigint; rootOwner: bigint; pid: number }

/** Reconnaît l'exécutable de Claude Desktop (MSIX ou installation classique), pas le CLI Claude Code. */
export function isClaudeDesktopExe(path: string): boolean {
  const p = path.replace(/\//g, '\\').toLowerCase();
  if (!p.endsWith('\\claude.exe')) return false;
  if (p.includes('\\claude-code\\')) return false; // CLI embarqué, sans fenêtre
  return p.includes('\\windowsapps\\claude_') || p.includes('\\anthropicclaude\\') || p.includes('\\programs\\claude\\');
}

type Fn = (...args: unknown[]) => unknown;

class Win32 {
  private k: typeof KoffiNs;
  private f: Record<string, Fn> = {};
  private enumCb: unknown;
  private enumResults: bigint[] = [];

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.k = require('koffi') as typeof KoffiNs;
    const k = this.k;
    const user32 = k.load('user32.dll');
    const kernel32 = k.load('kernel32.dll');
    const dwmapi = k.load('dwmapi.dll');
    k.struct('CUG_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const EnumProc = k.proto('bool __stdcall CUG_EnumProc(void *hwnd, intptr_t lParam)');
    const def = (lib: { func: (sig: string) => unknown }, name: string, sig: string) => { this.f[name] = lib.func(sig) as Fn; };
    def(user32, 'EnumWindows', 'bool __stdcall EnumWindows(CUG_EnumProc *cb, intptr_t lParam)');
    def(user32, 'IsWindow', 'bool __stdcall IsWindow(void *hwnd)');
    def(user32, 'IsWindowVisible', 'bool __stdcall IsWindowVisible(void *hwnd)');
    def(user32, 'IsIconic', 'bool __stdcall IsIconic(void *hwnd)');
    def(user32, 'IsZoomed', 'bool __stdcall IsZoomed(void *hwnd)');
    def(user32, 'GetWindow', 'void * __stdcall GetWindow(void *hwnd, uint32_t cmd)');
    def(user32, 'GetAncestor', 'void * __stdcall GetAncestor(void *hwnd, uint32_t flags)');
    def(user32, 'GetForegroundWindow', 'void * __stdcall GetForegroundWindow()');
    def(user32, 'SetForegroundWindow', 'bool __stdcall SetForegroundWindow(void *hwnd)');
    def(user32, 'GetWindowThreadProcessId', 'uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)');
    def(user32, 'GetWindowRect', 'bool __stdcall GetWindowRect(void *hwnd, _Out_ CUG_RECT *r)');
    def(user32, 'GetDpiForWindow', 'uint32_t __stdcall GetDpiForWindow(void *hwnd)');
    def(kernel32, 'OpenProcess', 'void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
    def(kernel32, 'CloseHandle', 'bool __stdcall CloseHandle(void *h)');
    def(kernel32, 'QueryFullProcessImageNameW', 'bool __stdcall QueryFullProcessImageNameW(void *h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)');
    def(dwmapi, 'DwmGetWindowAttributeRect', 'int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ CUG_RECT *v, uint32_t size)');
    def(dwmapi, 'DwmGetWindowAttributeInt', 'int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ int32_t *v, uint32_t size)');
    this.enumCb = k.register((hwnd: unknown) => {
      this.enumResults.push(this.addr(hwnd));
      return true;
    }, k.pointer(EnumProc));
  }

  private addr(p: unknown): bigint {
    return p ? BigInt(this.k.address(p as never) as unknown as bigint) : 0n;
  }

  /** koffi accepte un bigint comme pointeur. */
  private ptr(h: bigint): unknown {
    return h || null;
  }

  pidOf(hwnd: bigint): number {
    const out = [0];
    this.f.GetWindowThreadProcessId!(this.ptr(hwnd), out);
    return out[0]!;
  }

  private exeCache = new Map<number, string>();
  exeOf(pid: number): string {
    const c = this.exeCache.get(pid);
    if (c !== undefined) return c;
    const h = this.f.OpenProcess!(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
    let p = '';
    if (h) {
      const buf = new Uint16Array(1024);
      const size = [1024];
      if (this.f.QueryFullProcessImageNameW!(h, 0, buf, size)) p = String.fromCharCode(...buf.subarray(0, size[0]));
      this.f.CloseHandle!(h);
    }
    if (this.exeCache.size > 256) this.exeCache.clear();
    this.exeCache.set(pid, p);
    return p;
  }

  /** Fenêtre principale de Claude Desktop (visible, sans propriétaire, la plus grande). */
  findClaudeWindow(): ClaudeWindowInfo | null {
    this.enumResults = [];
    this.f.EnumWindows!(this.enumCb, 0);
    let best: ClaudeWindowInfo | null = null;
    for (const h of this.enumResults) {
      const p = this.ptr(h);
      if (!this.f.IsWindowVisible!(p) || this.f.GetWindow!(p, 4 /* GW_OWNER */)) continue;
      const pid = this.pidOf(h);
      const exe = this.exeOf(pid);
      if (!isClaudeDesktopExe(exe)) continue;
      const info = this.describe(h, pid, exe);
      if (!info) continue;
      if (!best || info.rect.width * info.rect.height > best.rect.width * best.rect.height) best = info;
    }
    return best;
  }

  describe(hwnd: bigint, pid: number, exe: string): ClaudeWindowInfo | null {
    const p = this.ptr(hwnd);
    if (!this.f.IsWindow!(p)) return null;
    const r: Record<string, number> = {};
    // Rectangle visible (DWMWA_EXTENDED_FRAME_BOUNDS = 9), repli sur GetWindowRect.
    if (this.f.DwmGetWindowAttributeRect!(p, 9, r, 16) !== 0) this.f.GetWindowRect!(p, r);
    const cloakedOut = [0];
    this.f.DwmGetWindowAttributeInt!(p, 14 /* DWMWA_CLOAKED */, cloakedOut, 4);
    return {
      hwnd, pid, exe,
      rect: { x: r.left!, y: r.top!, width: r.right! - r.left!, height: r.bottom! - r.top! },
      iconic: !!this.f.IsIconic!(p),
      zoomed: !!this.f.IsZoomed!(p),
      cloaked: cloakedOut[0] !== 0,
      dpi: Number(this.f.GetDpiForWindow!(p)) || 96,
    };
  }

  foreground(): ForegroundInfo {
    const fg = this.addr(this.f.GetForegroundWindow!());
    if (!fg) return { hwnd: 0n, rootOwner: 0n, pid: 0 };
    const root = this.addr(this.f.GetAncestor!(this.ptr(fg), 3 /* GA_ROOTOWNER */));
    return { hwnd: fg, rootOwner: root || fg, pid: this.pidOf(fg) };
  }

  activate(hwnd: bigint): void {
    this.f.SetForegroundWindow!(this.ptr(hwnd));
  }
}

let instance: Win32 | null | undefined;
let loadError: string | null = null;

/** Renvoie l'accès Win32, ou null hors Windows / si koffi est indisponible (mode dégradé). */
export function win32(): Win32 | null {
  if (instance !== undefined) return instance;
  if (process.platform !== 'win32') { instance = null; loadError = 'non Windows'; return null; }
  try { instance = new Win32(); } catch (e) { instance = null; loadError = String((e as Error).message); }
  return instance;
}

export function win32Error(): string | null {
  return loadError;
}

export type { Win32 };
