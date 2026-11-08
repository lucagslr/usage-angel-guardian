/**
 * Placement de l'overlay relativement à la fenêtre Claude (fonctions pures, testées).
 * Toutes les coordonnées sont en DIP (pixels indépendants de la résolution).
 */
import type { Settings } from '../../core/types';
import type { Rect } from './win32';

/** Distance entre le bas de la fenêtre Claude et le bas de la barre (zone de saisie Claude ≈ 120–140 DIP). */
export const INPUT_INSET = 146;
export const TITLEBAR_INSET = 6;
export const EDGE_INSET = 6;
export const MARGIN = 8;

export interface OverlaySize { width: number; height: number }

export function computeBounds(claude: Rect, size: OverlaySize, ov: Settings['overlay']): Rect {
  const width = Math.round(Math.min(size.width, Math.max(160, claude.width - 2 * MARGIN)));
  const height = Math.round(Math.min(size.height, Math.max(24, claude.height - 2 * MARGIN)));
  const cx = claude.x + claude.width / 2;
  let x = cx - width / 2 + ov.offsetX;
  let y: number;
  switch (ov.anchor) {
    case 'titlebar':
      y = claude.y + TITLEBAR_INSET + ov.offsetY; // le panneau déplié s'étend vers le bas
      break;
    case 'bottom-edge':
      y = claude.y + claude.height - EDGE_INSET - height + ov.offsetY;
      break;
    default:
      y = claude.y + claude.height - INPUT_INSET - height + ov.offsetY; // s'étend vers le haut
  }
  // Toujours à l'intérieur de la fenêtre Claude.
  x = clamp(x, claude.x + MARGIN, claude.x + claude.width - MARGIN - width);
  y = clamp(y, claude.y + MARGIN, claude.y + claude.height - MARGIN - height);
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(hi, Math.max(lo, v));
}

/** Convertit un déplacement souris en décalage persistant, borné à la fenêtre. */
export function offsetsAfterDrag(ov: Settings['overlay'], dx: number, dy: number): { offsetX: number; offsetY: number } {
  return { offsetX: Math.round(ov.offsetX + dx), offsetY: Math.round(ov.offsetY + dy) };
}

export interface VisibilityInput {
  enabled: boolean;
  userHidden: boolean;
  claude: { hwnd: bigint; iconic: boolean; cloaked: boolean } | null;
  foreground: { hwnd: bigint; pid: number };
  ownPid: number;
  overlayHwnd: bigint | null;
}

export type HideReason = 'disabled' | 'user-hidden' | 'claude-absent' | 'minimized' | 'other-desktop' | 'claude-inactive' | null;

/**
 * La barre n'est visible que si Claude Desktop est la fenêtre active (ou si l'utilisateur
 * interagit avec la barre elle-même) : jamais par-dessus une autre application,
 * ni par-dessus une boîte de dialogue de Claude.
 */
export function visibility(v: VisibilityInput): { show: boolean; reason: HideReason } {
  if (!v.enabled) return { show: false, reason: 'disabled' };
  if (v.userHidden) return { show: false, reason: 'user-hidden' };
  if (!v.claude) return { show: false, reason: 'claude-absent' };
  if (v.claude.iconic) return { show: false, reason: 'minimized' };
  if (v.claude.cloaked) return { show: false, reason: 'other-desktop' };
  if (v.foreground.hwnd === v.claude.hwnd) return { show: true, reason: null };
  if (v.overlayHwnd && v.foreground.hwnd === v.overlayHwnd) return { show: true, reason: null };
  return { show: false, reason: 'claude-inactive' };
}
