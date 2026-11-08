/**
 * Processus principal de Claude Desktop Usage Guardian.
 * Overlay non activable attaché à la fenêtre Claude Desktop, icône de zone de
 * notification, notifications Windows et dashboard. 100 % local.
 */
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { STATUS_LABEL } from '../../core/alerts';
import { fmtPct } from '../../core/format';
import type { GuardianState } from '../../core/state';
import type { Settings, StatusLevel } from '../../core/types';
import { dataDir, loadSettings } from '../../sources/store';
import { loadTokenUsage } from '../../sources/transcripts';
import { DataService, paths } from './data';
import { computeBounds, offsetsAfterDrag, visibility, type HideReason } from './layout';
import { gaugeIcon } from './png';
import { ClaudeTracker, type TrackerSnapshot } from './tracker';
import { win32, win32Error, type Rect } from './win32';

const APP_ID = 'ch.luca.claude-desktop-usage-guardian';
const STATUS_HEX: Record<StatusLevel, string> = {
  green: '#2e9d5b', yellow: '#d4a106', orange: '#e0761b', red: '#d13c3c', critical: '#a3172b', unknown: '#8a8a8a',
};
const BAR_WIDTH = 660;
const PANEL_HEIGHT = 470;

let overlay: BrowserWindow | null = null;
let dashboard: BrowserWindow | null = null;
let tray: Tray | null = null;
let data: DataService;
let tracker: ClaudeTracker | null = null;
let lastTrack: TrackerSnapshot | null = null;
let expanded = false;
let userHidden = false;
let hideReason: HideReason = 'claude-absent';
let drag: { startX: number; startY: number; base: Settings['overlay']; timer: NodeJS.Timeout } | null = null;
let liveOffsets: { offsetX: number; offsetY: number } | null = null;
let quitting = false;
let panelHeight = PANEL_HEIGHT;

// Économie mémoire (rendu logiciel, ~85 Mo de moins) : lu avant l'initialisation d'Electron.
const lowMemory = process.env.CUG_NO_GPU ? process.env.CUG_NO_GPU !== '0' : loadSettings().lowMemory;
if (lowMemory) app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openDashboard());
  app.whenReady().then(main).catch((e) => {
    dialog.showErrorBox('Claude Desktop Usage Guardian', `Démarrage impossible : ${(e as Error).message}`);
    app.quit();
  });
}

function rendererFile(name: string): string {
  return path.join(__dirname, 'renderer', name);
}

function main(): void {
  app.setAppUserModelId(APP_ID);
  paths.marketplace = app.isPackaged ? path.join(process.resourcesPath, 'marketplace') : app.getAppPath();
  Menu.setApplicationMenu(null);
  const firstRun = !fs.existsSync(path.join(dataDir(), 'settings.json'));
  data = new DataService((n) => {
    if (!Notification.isSupported()) return;
    new Notification({ title: n.title, body: n.message, icon: trayImage(data.state) }).show();
  });
  if (firstRun) data.updateSettings({});
  data.on('state', (s: GuardianState) => {
    overlay?.webContents.send('state', s);
    dashboard?.webContents.send('state', s);
    updateTray(s);
  });
  data.start();
  createOverlay();
  createTray();

  const w = win32();
  if (w) {
    tracker = new ClaudeTracker(w);
    tracker.on('change', (snap: TrackerSnapshot) => { lastTrack = snap; place(); });
    tracker.on('error', (e: Error) => { data.lastError = `Suivi de fenêtre : ${e.message}`; });
    tracker.start();
  } else {
    data.lastError = `Suivi de la fenêtre Claude indisponible (${win32Error()}) : barre affichée depuis la zone de notification uniquement.`;
  }
  screen.on('display-metrics-changed', () => place());
  nativeTheme.on('updated', () => overlay?.webContents.send('state', data.state));
  registerIpc();
  if (process.env.CUG_CAPTURE) { void capture(process.env.CUG_CAPTURE); return; }
  if (process.env.CUG_SELFTEST) { void selfTest(process.env.CUG_SELFTEST); return; }
  if (firstRun || !process.argv.includes('--hidden')) {
    if (firstRun) openDashboard('sources');
  }
}

// ---------------------------------------------------------------- overlay ---

function createOverlay(): void {
  overlay = new BrowserWindow({
    width: BAR_WIDTH, height: 56, show: false, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    focusable: false, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
    title: 'Usage Guardian',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.loadFile(rendererFile('overlay.html'));
  overlay.webContents.on('did-finish-load', () => overlay?.webContents.send('state', data.state));
  overlay.on('close', (e) => { if (!quitting) e.preventDefault(); });
}

function overlayHwnd(): bigint | null {
  if (!overlay) return null;
  const b = overlay.getNativeWindowHandle();
  return b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0));
}

function barHeight(s: Settings): number {
  return Math.round((s.overlay.showSecondLine ? 58 : 36) * s.overlay.scale);
}

function claudeRectDip(): Rect | null {
  const c = lastTrack?.claude;
  if (!c) return null;
  const r = screen.screenToDipRect(null, c.rect);
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Recalcule position et visibilité de la barre (appelé à chaque changement de la fenêtre Claude). */
function place(): void {
  if (!overlay) return;
  const s = data.settings;
  const c = lastTrack?.claude ?? null;
  const vis = visibility({
    enabled: s.overlay.enabled,
    userHidden,
    claude: c ? { hwnd: c.hwnd, iconic: c.iconic, cloaked: c.cloaked } : null,
    foreground: process.env.CUG_SELFTEST && c ? { hwnd: c.hwnd, pid: c.pid } : lastTrack?.foreground ?? { hwnd: 0n, pid: 0 },
    ownPid: process.pid,
    overlayHwnd: overlayHwnd(),
  });
  hideReason = vis.reason;
  const rect = claudeRectDip();
  if (process.env.CUG_DEBUG) console.log(`[place] show=${vis.show} reason=${vis.reason} claude=${JSON.stringify(c?.rect)} dpi=${c?.dpi} dip=${JSON.stringify(rect)} fg=${lastTrack?.foreground.hwnd} claudeHwnd=${c?.hwnd}`);
  if (!vis.show || !rect) {
    if (overlay.isVisible()) overlay.hide();
    return;
  }
  const ov = liveOffsets ? { ...s.overlay, ...liveOffsets } : s.overlay;
  const height = expanded ? Math.round(panelHeight * s.overlay.scale) : barHeight(s);
  const width = Math.round(BAR_WIDTH * Math.min(1.3, s.overlay.scale));
  // Le panneau déplié garde le bas de la barre fixe (ou le haut pour l'ancrage barre de titre).
  const base = computeBounds(rect, { width, height: barHeight(s) }, ov);
  let b = computeBounds(rect, { width, height }, ov);
  if (expanded) {
    const y = ov.anchor === 'titlebar' ? base.y : base.y + base.height - b.height;
    b = { ...b, y: Math.max(rect.y + 8, y) };
  }
  const cur = overlay.getBounds();
  if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) overlay.setBounds(b);
  if (process.env.CUG_DEBUG) console.log(`[place] bounds=${JSON.stringify(b)}`);
  overlay.setOpacity(s.overlay.opacity);
  if (!overlay.isVisible()) {
    overlay.showInactive();
    overlay.setAlwaysOnTop(true, 'floating');
  }
}

function setExpanded(v: boolean): void {
  if (!overlay) return;
  expanded = v;
  overlay.setFocusable(v); // clavier disponible uniquement quand l'utilisateur ouvre le panneau
  place();
  if (v) overlay.focus();
  else if (lastTrack?.claude) win32()?.activate(lastTrack.claude.hwnd); // rend le focus à Claude
  overlay.webContents.send('expanded', v);
}

// --------------------------------------------------------------- dashboard ---

function openDashboard(tab = 'overview'): void {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.webContents.send('tab', tab);
    if (dashboard.isMinimized()) dashboard.restore();
    dashboard.show();
    dashboard.focus();
    return;
  }
  dashboard = new BrowserWindow({
    width: 1120, height: 800, minWidth: 720, minHeight: 520, show: false, autoHideMenuBar: true,
    title: 'Claude Desktop Usage Guardian', backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1d' : '#faf9f5',
    icon: trayImage(data.state, 64),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  dashboard.loadFile(rendererFile('dashboard.html'), { hash: tab });
  dashboard.once('ready-to-show', () => dashboard?.show());
  dashboard.on('closed', () => { dashboard = null; }); // libère la mémoire : recréé à la demande
}

// -------------------------------------------------------------------- tray ---

function trayImage(s: GuardianState | undefined, size = 32): Electron.NativeImage {
  const ratio = s?.budget ? Math.min(1, s.budget.today.ratio) : null;
  const img = nativeImage.createFromBuffer(gaugeIcon(size, ratio, STATUS_HEX[s?.status ?? 'unknown']), { scaleFactor: size / 16 });
  return img;
}

function createTray(): void {
  tray = new Tray(trayImage(data.state));
  tray.on('click', () => openDashboard());
  updateTray(data.state);
}

function updateTray(s: GuardianState): void {
  if (!tray) return;
  tray.setImage(trayImage(s));
  const t = s.budget?.today;
  const lines = [
    'Claude Desktop Usage Guardian',
    t ? `Aujourd'hui ${fmtPct(t.usedPct)} / ${fmtPct(t.budgetPct)} — ${STATUS_LABEL[s.status]}` : 'Budget du jour indisponible',
    `5 h ${s.fiveHour ? fmtPct(s.fiveHour.used, 0) : '—'} · Semaine ${s.weekly ? fmtPct(s.weekly.used, 0) : '—'}`,
  ];
  tray.setToolTip(lines.join('\n').slice(0, 127));
  const autostart = app.getLoginItemSettings(loginArgs()).openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Afficher la barre', type: 'checkbox', checked: !userHidden && data.settings.overlay.enabled, click: (i) => { userHidden = !i.checked; if (i.checked && !data.settings.overlay.enabled) data.updateSettings({ overlay: { ...data.settings.overlay, enabled: true } }); place(); } },
    { label: 'Ouvrir le dashboard', click: () => openDashboard('overview') },
    { label: 'Actualiser les statistiques', click: () => { tracker?.rescan(); data.reload(); } },
    { label: 'Paramètres', click: () => openDashboard('settings') },
    { type: 'separator' },
    { label: 'Mode silencieux (notifications)', type: 'checkbox', checked: data.settings.notifications.quiet, click: (i) => data.updateSettings({ notifications: { ...data.settings.notifications, quiet: i.checked } }) },
    { label: 'Lancer avec Windows', type: 'checkbox', checked: autostart, click: (i) => setAutoStart(i.checked) },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]));
}

function loginArgs(): Electron.LoginItemSettingsOptions {
  // En développement (non empaqueté), Electron doit recevoir le chemin de l'application.
  // Valeur de registre HKCU\…\Run nommée d’après l’AppUserModelId (retirée par le désinstalleur).
  return app.isPackaged ? { args: ['--hidden'] } : { path: process.execPath, args: [app.getAppPath(), '--hidden'] };
}

function setAutoStart(on: boolean): void {
  app.setLoginItemSettings({ ...loginArgs(), openAtLogin: on });
  updateTray(data.state);
}

// --------------------------------------------------------------------- IPC ---

function registerIpc(): void {
  ipcMain.handle('state:get', () => data.state);
  ipcMain.handle('report:get', () => data.report());
  ipcMain.handle('tokens:get', () => loadTokenUsage(35, data.settings.timezone, data.settings.dayStartHour));
  ipcMain.handle('settings:get', () => data.settings);
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => { const s = data.updateSettings(patch); place(); updateTray(data.state); return s; });
  ipcMain.handle('manual:add', (_e, input) => { data.addManual(input); return data.state; });
  ipcMain.handle('refresh', () => { tracker?.rescan(); data.reload(); return data.state; });
  ipcMain.handle('dashboard:open', (_e, tab?: string) => { openDashboard(typeof tab === 'string' ? tab : 'overview'); });
  ipcMain.handle('overlay:expand', (_e, v: boolean) => setExpanded(!!v));
  ipcMain.handle('overlay:content-height', (_e, px: number) => {
    if (typeof px !== 'number' || !Number.isFinite(px)) return;
    const next = Math.max(220, Math.min(620, Math.ceil(px)));
    if (Math.abs(next - panelHeight) > 2) { panelHeight = next; if (expanded) place(); }
  });
  ipcMain.handle('overlay:hide', () => { userHidden = true; setExpanded(false); place(); updateTray(data.state); });
  ipcMain.handle('overlay:reset-position', () => { data.updateSettings({ overlay: { ...data.settings.overlay, offsetX: 0, offsetY: 0 } }); place(); });
  ipcMain.handle('drag:start', () => {
    const p = screen.getCursorScreenPoint();
    if (drag) clearInterval(drag.timer);
    drag = {
      startX: p.x, startY: p.y, base: { ...data.settings.overlay },
      timer: setInterval(() => {
        if (!drag) return;
        const q = screen.getCursorScreenPoint();
        liveOffsets = offsetsAfterDrag(drag.base, q.x - drag.startX, q.y - drag.startY);
        place();
      }, 16),
    };
  });
  ipcMain.handle('drag:end', () => {
    if (!drag) return;
    clearInterval(drag.timer);
    const off = liveOffsets;
    drag = null;
    liveOffsets = null;
    if (off) data.updateSettings({ overlay: { ...data.settings.overlay, ...off } });
    place();
  });
  ipcMain.handle('export', async (_e, format: 'json' | 'csv') => {
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog({
      title: 'Exporter l’historique', defaultPath: `cug-export-${stamp}.${format}`,
      filters: [format === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, format === 'csv' ? '﻿' + data.exportCsv() : data.exportJson());
    return r.filePath;
  });
  ipcMain.handle('history:delete', async () => {
    const r = await dialog.showMessageBox({
      type: 'warning', buttons: ['Annuler', 'Supprimer définitivement'], defaultId: 0, cancelId: 0,
      title: 'Supprimer l’historique',
      message: 'Supprimer toutes les mesures enregistrées par Usage Guardian ?',
      detail: 'Action irréversible. Le journal de Claude Desktop (plan-usage-history.json) n’est pas touché et reste lu.',
    });
    if (r.response !== 1) return false;
    data.deleteHistory();
    return true;
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: dataDir(),
    autoStart: app.getLoginItemSettings(loginArgs()).openAtLogin,
    win32: win32() ? 'ok' : win32Error(),
    claudeFound: !!lastTrack?.claude,
    claudeExe: lastTrack?.claude?.exe ?? null,
    hideReason,
    modFolder: path.join(app.getAppPath(), 'mod', 'usage-guardian'),
  }));
  ipcMain.handle('autostart:set', (_e, on: boolean) => { setAutoStart(!!on); return on; });
  ipcMain.handle('open:data-dir', () => shell.openPath(dataDir()));
}

/** Mode de vérification visuelle : rendu hors écran de la barre, du panneau et du dashboard en PNG. */
async function capture(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const shot = async (name: string, file: string, w: number, hgt: number, setup?: (win: BrowserWindow) => void, hash?: string) => {
    const win = new BrowserWindow({ width: w, height: hgt, show: false, transparent: file === 'overlay.html', frame: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, offscreen: true } });
    await win.loadFile(rendererFile(file), hash ? { hash } : undefined);
    win.webContents.send('state', data.state);
    setup?.(win);
    await new Promise((r) => setTimeout(r, 900));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    win.destroy();
  };
  await shot('bar', 'overlay.html', BAR_WIDTH, barHeight(data.settings));
  await shot('panel', 'overlay.html', BAR_WIDTH, PANEL_HEIGHT, (win) => win.webContents.send('expanded', true));
  for (const t of ['overview', 'week', 'stats', 'forecast', 'sources', 'settings']) await shot(`dash-${t}`, 'dashboard.html', 1120, 900, undefined, t);
  quitting = true;
  app.quit();
}

/**
 * Autotest sur le bureau réel : affiche la barre sur la fenêtre Claude pendant ~2 s, capture
 * UNIQUEMENT la zone de la barre (pas le reste de l'écran), mesure la mémoire, puis quitte.
 */
async function selfTest(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const result: Record<string, unknown> = { claudeFound: !!lastTrack?.claude, gpu: !lowMemory };
  for (const exp of [false, true]) {
    if (exp) { expanded = true; place(); overlay?.webContents.send('expanded', true); } else place();
    await wait(1500);
    if (!overlay?.isVisible()) { result[exp ? 'panel' : 'bar'] = 'non visible'; continue; }
    const b = overlay.getBounds();
    const disp = screen.getDisplayMatching(b);
    const sf = disp.scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(disp.bounds.width * sf), height: Math.round(disp.bounds.height * sf) } });
    const src = sources.find((x) => x.display_id === String(disp.id)) ?? sources[0];
    if (src) {
      const crop = src.thumbnail.crop({ x: Math.round((b.x - disp.bounds.x) * sf), y: Math.round((b.y - disp.bounds.y) * sf), width: Math.round(b.width * sf), height: Math.round(b.height * sf) });
      fs.writeFileSync(path.join(dir, `real-${exp ? 'panel' : 'bar'}${lowMemory ? '-nogpu' : ''}.png`), crop.toPNG());
    }
    result[exp ? 'panelBounds' : 'barBounds'] = b;
  }
  expanded = false;
  overlay?.hide();
  await wait(300);
  const metrics = app.getAppMetrics();
  result.memoryMB = metrics.map((x) => ({ type: x.type, privateMB: Math.round((x.memory.privateBytes ?? 0) / 1024), wsMB: Math.round(x.memory.workingSetSize / 1024) }));
  result.totalPrivateMB = metrics.reduce((a, x) => a + Math.round((x.memory.privateBytes ?? 0) / 1024), 0);
  result.cpu = metrics.map((x) => ({ type: x.type, pct: Math.round(x.cpu.percentCPUUsage * 10) / 10 }));
  fs.writeFileSync(path.join(dir, `selftest${lowMemory ? '-nogpu' : ''}.json`), JSON.stringify(result, null, 2));
  quitting = true;
  app.quit();
}

app.on('window-all-closed', () => { /* reste actif dans la zone de notification */ });
app.on('before-quit', () => { quitting = true; tracker?.stop(); data?.stop(); });
