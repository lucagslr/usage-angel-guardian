# Installation et désinstallation (Windows 10/11)

## 1. Installer l'application

**Option A — installateur (recommandé)**

1. Double-cliquer sur `release\Claude-Desktop-Usage-Guardian-Setup-0.1.0.exe`.
2. Windows SmartScreen peut afficher « Windows a protégé votre ordinateur », car l'exécutable n'est pas signé. Cliquer sur *Informations complémentaires*, puis *Exécuter quand même*.
3. Choisir le dossier proposé (`%LOCALAPPDATA%\Programs\ClaudeDesktopUsageGuardian`, pour votre seul compte, sans droits administrateur). Installation silencieuse possible : `Setup.exe /S`.
4. L'application démarre. Une jauge apparaît près de l'horloge (zone de notification ; elle peut être dans le menu « ^ »).

**Option B — portable** : lancer `release\Claude-Desktop-Usage-Guardian-Portable-0.1.0.exe`, sans installation.

**Option C — depuis les sources**

```bash
cd claude-desktop-usage-guardian
npm install
npm start
```

## 2. Brancher une source de mesures

Sans source, la barre affiche le dernier pourcentage connu du journal de Claude Desktop. Le budget du jour exige en plus l'**heure de reset hebdomadaire**.

**Recommandé : activer le mod dans l'onglet Code de Claude Desktop.**

1. Claude Desktop › onglet **Code**, ouvrir une session dans n'importe quel dossier.
2. Saisir la commande indiquée dans *Dashboard › Sources & saisie*. Elle ressemble à :
   ```
   /plugin marketplace add C:/Users/<vous>/AppData/Local/Programs/ClaudeDesktopUsageGuardian/resources/marketplace
   ```
   Depuis les sources, le dossier est celui du dépôt.
3. Puis `/plugin install usage-guardian@claude-desktop-usage-guardian` et `/reload-plugins`.
4. Après la réponse suivante, la bande apparaît au-dessus de la saisie, et l'overlay reçoit l'heure de reset.

**Alternative : saisie manuelle.** *Dashboard › Sources & saisie* : recopier le % hebdomadaire et l'heure de reset affichés dans *Claude › Paramètres › Utilisation*. L'heure de reset saisie une fois suffit, car elle revient chaque semaine.

**Optionnel : statusline Claude Code CLI**

```bash
npm run build
npm run statusline:install
```

Sans `-- --apply`, rien n'est modifié : la commande affiche la configuration à ajouter. Avec `npm run statusline:install -- --apply`, `~/.claude/settings.json` est d'abord sauvegardé, et l'opération est refusée si une statusline existe déjà (sauf `--force`).

## 3. Démarrage avec Windows

Désactivé par défaut. Pour l'activer : clic droit sur l'icône de la zone de notification › *Lancer avec Windows*, ou *Dashboard › Paramètres*. Au démarrage, l'application reste discrète et la barre n'apparaît qu'avec Claude.

## 4. Désinstaller

1. *Paramètres Windows › Applications › Applications installées › Claude Desktop Usage Guardian › Désinstaller*.
2. Le désinstalleur retire le démarrage automatique, puis demande s'il faut **supprimer vos données** (`%USERPROFILE%\.claude-usage-guardian`). Répondre *Non* pour les conserver en vue d'une réinstallation.
3. Mod : dans l'onglet Code, `/plugin uninstall usage-guardian@claude-desktop-usage-guardian`, puis `/plugin marketplace remove claude-desktop-usage-guardian`.
4. Statusline : `npm run statusline:uninstall` restaure la statusline précédente (avec une sauvegarde de sécurité).

Claude Desktop, ses paramètres et son journal `plan-usage-history.json` ne sont jamais modifiés, ni à l'installation ni à la désinstallation.

## Mise à jour

Réinstaller par-dessus avec le nouvel installateur : les données sont conservées. Le mod est relu depuis le dossier de l'application (`/reload-plugins`).
