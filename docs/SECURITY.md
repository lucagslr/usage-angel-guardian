# Sécurité et confidentialité

## Garanties

- **100 % local.** L'application n'effectue aucune requête réseau, n'a pas de télémétrie et n'utilise aucun service tiers.
- **Aucun secret lu.** Les cookies, jetons OAuth (`.credentials.json`) et mots de passe ne sont ni lus ni stockés.
- **Aucun contenu de conversation.** Le mod reçoit seulement des pourcentages et des heures de reset. Dans les journaux Claude Code, seuls les compteurs `usage` sont extraits. L'onglet Chat n'est jamais lu.
- **Claude Desktop intact.** Aucune modification de l'installation MSIX, d'`app.asar`, des fuses Electron ou des paramètres. Pas d'injection de DLL, pas de lecture mémoire, pas d'option de lancement imposée. Win32 est utilisé uniquement en observation : position de fenêtre, processus, premier plan.
- **Pas d'élévation de privilèges.** Installation par utilisateur, sans droits administrateur.
- **Aucun contournement** des limites d'Anthropic, ni réinitialisation forcée. Les alertes ne bloquent jamais Claude.
- **Paramètres globaux de Claude Code** : jamais modifiés sans `--apply` explicite, et toujours après sauvegarde.

## Surfaces techniques

| Élément | Mesure |
|---|---|
| Interface Electron | `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP `default-src 'none'; script-src 'self'`, DOM construit sans `innerHTML` |
| IPC | Canaux nommés, entrées validées (`normalizeSettings`, `validateSnapshot`, bornes 0–100) |
| Fichiers | Écritures atomiques. Le dossier de données est sous votre profil. Le journal de Claude Desktop est ouvert en lecture seule et ignoré au-delà de 8 Mo. |
| Mod | Validé par `claude plugin validate`. Hooks : `session.start`, `session.measure`, `command.run`, `ui.render`. Pas de `tool.call` ni de `prompt.*`. |
| Dépendance native | `koffi` (MIT), binaires précompilés, chargés uniquement par le processus principal |

## Données stockées

`%USERPROFILE%\.claude-usage-guardian\` contient `settings.json`, `notified.json` et `snapshots\*.jsonl` (horodatage, source, pourcentages, heures de reset). Rétention réglable (180 jours par défaut). Export CSV/JSON et suppression depuis le dashboard ; la suppression est confirmée et irréversible. Le dépôt Git ignore ces fichiers.

## Exécutable non signé

L'installateur n'est pas signé : SmartScreen avertit. Vous pouvez reconstruire vous-même depuis les sources (`npm run dist`).
