import { describe, expect, it } from 'vitest';
import { computeBounds, INPUT_INSET, offsetsAfterDrag, visibility } from '../src/app/main/layout';
import { isClaudeDesktopExe } from '../src/app/main/win32';
import { DEFAULT_SETTINGS } from '../src/core/settings';

const OV = DEFAULT_SETTINGS.overlay;
const CLAUDE = { x: 0, y: 0, width: 1707, height: 1067 }; // 2560×1600 à 150 %
const SIZE = { width: 660, height: 58 };

describe('placement de la barre', () => {
  it('au-dessus de la zone de saisie, centrée', () => {
    const b = computeBounds(CLAUDE, SIZE, OV);
    expect(b.x).toBe(Math.round(1707 / 2 - 330));
    expect(b.y + b.height).toBe(1067 - INPUT_INSET);
  });

  it('suit un déplacement et un redimensionnement de Claude', () => {
    const moved = computeBounds({ x: 300, y: 120, width: 900, height: 700 }, SIZE, OV);
    expect(moved.x).toBe(300 + 450 - 330);
    expect(moved.y + moved.height).toBe(120 + 700 - INPUT_INSET);
  });

  it('second écran à gauche (coordonnées négatives)', () => {
    const b = computeBounds({ x: -1920, y: 0, width: 1920, height: 1040 }, SIZE, OV);
    expect(b.x).toBeLessThan(0);
    expect(b.x).toBeGreaterThanOrEqual(-1920);
  });

  it('fenêtre Claude étroite : la barre rétrécit et reste à l’intérieur', () => {
    const small = { x: 100, y: 100, width: 420, height: 300 };
    const b = computeBounds(small, SIZE, OV);
    expect(b.width).toBeLessThanOrEqual(420 - 16);
    expect(b.x).toBeGreaterThanOrEqual(small.x);
    expect(b.x + b.width).toBeLessThanOrEqual(small.x + small.width);
    expect(b.y).toBeGreaterThanOrEqual(small.y);
  });

  it('déplacement manuel persistant et borné à la fenêtre', () => {
    const off = offsetsAfterDrag(OV, 5000, -40);
    const b = computeBounds(CLAUDE, SIZE, { ...OV, ...off });
    expect(b.x + b.width).toBeLessThanOrEqual(1707 - 8);
    expect(b.y + b.height).toBe(1067 - INPUT_INSET - 40);
  });

  it('ancrage barre de titre et bord inférieur', () => {
    expect(computeBounds(CLAUDE, SIZE, { ...OV, anchor: 'titlebar' }).y).toBe(8);
    const e = computeBounds(CLAUDE, SIZE, { ...OV, anchor: 'bottom-edge' });
    expect(e.y + e.height).toBe(1067 - 8);
  });
});

describe('visibilité (jamais par-dessus une autre application)', () => {
  const claude = { hwnd: 10n, iconic: false, cloaked: false };
  const base = { enabled: true, userHidden: false, claude, foreground: { hwnd: 10n, pid: 1 }, ownPid: 99, overlayHwnd: 50n };
  it('Claude au premier plan : visible', () => expect(visibility(base).show).toBe(true));
  it('autre application active : masquée', () => expect(visibility({ ...base, foreground: { hwnd: 77n, pid: 5 } }).reason).toBe('claude-inactive'));
  it('boîte de dialogue de Claude active : masquée pour ne rien recouvrir', () => expect(visibility({ ...base, foreground: { hwnd: 11n, pid: 1 } }).show).toBe(false));
  it('interaction avec la barre elle-même : reste visible', () => expect(visibility({ ...base, foreground: { hwnd: 50n, pid: 99 } }).show).toBe(true));
  it('Claude minimisé', () => expect(visibility({ ...base, claude: { ...claude, iconic: true } }).reason).toBe('minimized'));
  it('Claude sur un autre bureau virtuel', () => expect(visibility({ ...base, claude: { ...claude, cloaked: true } }).reason).toBe('other-desktop'));
  it('Claude fermé', () => expect(visibility({ ...base, claude: null }).reason).toBe('claude-absent'));
  it('barre désactivée ou masquée par l’utilisateur', () => {
    expect(visibility({ ...base, enabled: false }).reason).toBe('disabled');
    expect(visibility({ ...base, userHidden: true }).reason).toBe('user-hidden');
  });
});

describe('reconnaissance de Claude Desktop', () => {
  it('installation MSIX (Microsoft Store / winget)', () => {
    expect(isClaudeDesktopExe('C:\\Program Files\\WindowsApps\\Claude_4.23118.0.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe')).toBe(true);
  });
  it('installation classique (Squirrel) et après mise à jour (nouveau dossier de version)', () => {
    expect(isClaudeDesktopExe('C:\\Users\\a\\AppData\\Local\\AnthropicClaude\\app-1.2.3\\claude.exe')).toBe(true);
    expect(isClaudeDesktopExe('C:\\Program Files\\WindowsApps\\Claude_4.30000.0.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe')).toBe(true);
  });
  it('ignore le CLI Claude Code et les autres programmes', () => {
    expect(isClaudeDesktopExe('C:\\Users\\a\\AppData\\Roaming\\Claude\\claude-code\\2.1.317\\x\\claude.exe')).toBe(false);
    expect(isClaudeDesktopExe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe(false);
  });
});
