# Phase 1 — Audit et décision technique (8 novembre 2026)

## Environnement constaté

| Élément | Valeur |
|---|---|
| Windows | 11 Famille 10.0.26200 |
| Claude Desktop | 4.23118.0.0, **MSIX** (`C:\Program Files\WindowsApps\Claude_…_pzs8sxrjxfjjc`), Electron/Chromium, fenêtre `Chrome_WidgetWin_1` |
| Claude Code intégré | 2.1.317 (onglet Code de Claude Desktop) |
| Affichage | 1 écran, 150 % (DPI 144) |
| Outils | Node 22, Git, runtime .NET 8 (pas de SDK), pas de Rust, WebView2 157 |

Aucun fichier installé n'a été modifié pendant l'audit (lecture seule).

## Les trois solutions

**A — Modifier Claude Desktop (asar, CSS/JS injecté) : exclue.**
Le paquet MSIX est signé et vérifié (AppxBlockMap) ; le seul mod connu (`claude-theme-mod`, MIT) exige la version Squirrel, la désactivation des fuses d'intégrité Electron et un re-patch à chaque mise à jour. Contraire aux exigences (pas de contournement de signature, pas de modification de l'installation).

**C — Extension officielle : retenue pour l'onglet Code.**
Les *Desktop Extensions* / MCP n'offrent pas d'interface persistante. En revanche, le moteur Claude Code embarqué dans Claude Desktop supporte des **mods officiels** (plugins à hooks) qui peuvent :
- dessiner une **bande native au-dessus de la zone de saisie** (`ui.render` → `AbovePrompt`, surface `desktop`) ;
- recevoir les **limites officielles** (`session.measure` → `rateLimits[]` : `kind`, `percentUsed`, `resetsAt` ISO) ;
- lire/écrire des fichiers locaux (`$.fs`) et envoyer des notifications.
Activation explicite par l'utilisateur, réversible, sans toucher à l'installation, survit aux mises à jour.

**B — Overlay Windows attaché : retenu pour le reste de Claude Desktop (onglet Chat).**
Application compagnon : fenêtre transparente sans bordure, non activable (`focusable:false`), positionnée relativement à la fenêtre Claude (Win32 via `koffi` : `EnumWindows`, `QueryFullProcessImageNameW`, `DwmGetWindowAttribute`, `GetForegroundWindow`), masquée quand Claude est minimisé, sur un autre bureau ou en arrière-plan. Prototype validé : détection en 2,7 ms.

## Choix de technologie de l'overlay

| Option | Verdict |
|---|---|
| C# WPF/WinUI | Idéal en Win32, mais SDK .NET absent et moteur à réécrire en C# (deux moteurs à maintenir). |
| Tauri | Le plus léger, mais exige Rust + MSVC Build Tools (plusieurs Go). |
| **Electron + koffi** | **Retenu** : un seul moteur TypeScript partagé avec le mod et la statusline, outillage npm uniquement, fenêtres transparentes/non activables, tray, notifications Windows et démarrage automatique natifs. Coût : ~100–150 Mo de RAM, mesuré en phase 8. |

## Sources de données retenues

| Priorité | Source | Statut | Remarque |
|---|---|---|---|
| 1 | Mod Claude Desktop (onglet Code) : `rateLimits` | **Officiel** | % + heure de reset ; mis à jour après chaque réponse d'une session Code. |
| 2 | Statusline Claude Code CLI (optionnelle) | **Officiel** | Même données, installation soumise à autorisation. |
| 3 | `%APPDATA%\Claude\plan-usage-history.json` | **Officiel** (journal local écrit par Claude Desktop) | % 5 h / hebdo, **sans heure de reset**, échantillonnage irrégulier (≈ 1/jour). Lecture seule. |
| 4 | Saisie manuelle (% et/ou heure de reset) | Manuel | Repli toujours disponible. |
| — | Reset hebdomadaire déduit | **Estimé** | Le reset a lieu à heure fixe chaque semaine (doc. Anthropic) : projeté par pas de 7 j depuis la dernière heure officielle connue. |

**Écartées :** lecture du jeton OAuth `~/.claude/.credentials.json` (utilisée par `claude-usage-tracker` et `claude-usage-widget`) et lecture des cookies du profil Claude Desktop — ce sont des secrets d'authentification. Endpoint web interne `/api/organizations/{id}/usage` — exigerait une session (cookies) ; non utilisé par défaut.

**Limite assumée :** sans session Code active, la mesure « live » dépend du journal de Claude Desktop (rare). L'interface affiche alors l'âge de la dernière mesure et suspend les prévisions devenues non fiables.
