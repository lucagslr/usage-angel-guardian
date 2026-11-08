# Architecture

```
src/core/        Moteur métier pur (aucune dépendance, testé) — partagé par les 3 composants
  types.ts         modèles de données (UsageSnapshot, Settings…)
  normalize.ts     validation/normalisation : mod (rateLimits), statusline, journal Desktop, imports
  schedule.ts      déduction du reset hebdomadaire, fusion/dédoublonnage des mesures
  series.ts        séries temporelles, époques (resets, ruptures), valeur à un instant, couverture
  time.ts          fuseaux IANA, journées locales, DST
  budget.ts        budget quotidien adaptatif, stratégies, trajectoire
  pace.ts          vitesse de consommation, projection 5 h
  forecast.ts      prévisions, confiance, simulation de session
  stats.ts         historique quotidien, heures actives, cycles, comparaisons, tokens
  alerts.ts        statuts, conseiller, messages, décisions de notification (anti-spam)
  state.ts         agrégation → GuardianState sérialisable (la seule entrée de toute interface)
  settings.ts      paramètres par défaut et validation
src/sources/     Adaptateurs Node
  store.ts         dossier partagé ~/.claude-usage-guardian (JSONL par jour et par écrivain)
  transcripts.ts   tokens exacts des journaux Claude Code
src/app/         Application Windows (Electron)
  main/win32.ts    observation Win32 en lecture seule via koffi (FFI)
  main/tracker.ts  suivi adaptatif de la fenêtre Claude
  main/layout.ts   placement et règle de visibilité (pur, testé)
  main/data.ts     service de données : sources → état → notifications
  main/index.ts    cycle de vie, overlay, tray, dashboard, IPC
  preload/         pont IPC minimal (contextIsolation, sandbox)
  renderer/        barre, panneau, dashboard (DOM sans framework, SVG)
mod/src/         Source du mod Claude Desktop → mod/usage-guardian/ (assemblé par scripts/build-mod.mjs)
statusline/      Statusline Claude Code CLI
```

## Flux de données

```
Claude (quotas officiels)
 ├─ onglet Code ── mod (session.measure) ──┐
 ├─ CLI ───────── statusline ──────────────┼─► ~/.claude-usage-guardian/snapshots/*.jsonl
 ├─ Claude Desktop ── plan-usage-history.json (lecture seule)
 └─ vous ──────── saisie manuelle ─────────┘
                         │ fs.watch / stat
                         ▼
     DataService : merge → inferWeeklyResets → computeState → GuardianState
                         │ IPC
          ┌──────────────┼───────────────┐
        barre          dashboard       tray / notifications Windows
```

L'interface ne dépend jamais d'une source : elle lit uniquement `GuardianState`. Une source peut disparaître sans casser le reste.

## Overlay attaché à Claude

- **Détection** : `EnumWindows` + `QueryFullProcessImageNameW`. Exécutable `…\WindowsApps\Claude_*\app\Claude.exe` (MSIX) ou `AnthropicClaude` (installation classique). Le CLI `claude-code\…\claude.exe` est ignoré. Re-détection automatique après fermeture ou mise à jour.
- **Géométrie** : `DwmGetWindowAttribute(EXTENDED_FRAME_BOUNDS)` en pixels physiques, puis `screen.screenToDipRect` (multi-écran, DPI par écran).
- **Visibilité** : affichée seulement si la fenêtre active est la fenêtre principale de Claude (ou la barre elle-même). Masquée si Claude est minimisé, sur un autre bureau virtuel (`DWMWA_CLOAKED`), inactif, ou si une de ses boîtes de dialogue est active.
- **Focus** : fenêtre `focusable:false` (aucun vol de clavier). Elle ne devient focusable que lorsque l'utilisateur ouvre le panneau ; à la fermeture, le focus revient à Claude.
- **Coût** : 3 appels Win32 par tick, toutes les 100 ms quand Claude est actif, 400 ms quand il est inactif, 2 s quand il est fermé. CPU mesuré ≈ 0 %. Mémoire privée ≈ 210 Mo (rendu logiciel par défaut, −85 Mo).

## Choix techniques

Voir [DECISION.md](DECISION.md). En bref : Electron + koffi pour partager un unique moteur TypeScript avec le mod et la statusline, sans SDK .NET ni Rust ; interface en DOM natif + SVG (aucun framework) ; CSP stricte.

## Tests

`npm test` lance 68 tests vitest (moteur, sources, placement, visibilité, stockage, tokens). `claude plugin test mod/usage-guardian` lance 2 tests du mod avec le kit officiel, sur les surfaces desktop et terminal. Les données sont simulées : aucun quota n'est consommé. L'autotest sur le bureau réel est disponible via `CUG_SELFTEST=<dossier>`.
