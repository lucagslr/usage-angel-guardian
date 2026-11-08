# Personnaliser et modifier

Ce guide sert à adapter Usage Guardian à vos besoins : réglages, apparence, calculs, sources de données. Les données simulées (`npm run demo`) permettent de tout tester sans consommer de quota.

## 0. Boucle de travail

```bash
npm install
npm run demo -- C:\tmp\demo-data          # crée une semaine simulée
set CUG_DATA_DIR=C:\tmp\demo-data          # PowerShell : $env:CUG_DATA_DIR="C:\tmp\demo-data"
npm start                                   # compile et lance l'overlay
npm test                                    # après toute modification du moteur
```

Pour lancer l'overlay alors que la version installée tourne déjà, ajoutez un profil séparé : `npx electron . --user-data-dir=C:\tmp\cug-profile`.

Variables utiles :

| Variable | Effet |
|---|---|
| `CUG_DATA_DIR` | Dossier de données (au lieu de `%USERPROFILE%\.claude-usage-guardian`) |
| `CUG_DESKTOP_HISTORY` | Chemin du journal Claude Desktop à lire |
| `CUG_CLAUDE_PROJECTS` | Dossier des journaux Claude Code (tokens) |
| `CUG_DEBUG=1` | Journal de placement de la barre dans la console |
| `CUG_CAPTURE=<dossier>` | Captures PNG hors écran de la barre, du panneau et du dashboard, puis arrêt |
| `CUG_SELFTEST=<dossier>` | Affiche la barre sur Claude 2 s, capture sa zone, mesure la mémoire |
| `CUG_NO_GPU=0/1` | Force le rendu GPU ou logiciel |

## 1. Réglages par défaut

`src/core/settings.ts` → `DEFAULT_SETTINGS`. Exemples :

```ts
timezone: 'Europe/Paris',         // fuseau IANA
dayStartHour: 4,                  // la journée commence à 4 h
strategy: 'conservative',
conservativeReservePct: 15,
thresholds: { yellow: 0.6, orange: 0.8, red: 1.0, critical: 1.5 },
dayTypeWeights: { normal: 1, heavy: 1.6, rest: 0.3 },
overlay: { anchor: 'above-input', scale: 1, ... },
```

`normalizeSettings` valide et borne chaque valeur : si vous ajoutez un réglage, déclarez-le dans `src/core/types.ts`, donnez-lui une valeur par défaut, validez-le, puis ajoutez son champ dans `settingsView()` (`src/app/renderer/dashboard.ts`).

## 2. Apparence

- **Couleurs** : `src/app/renderer/theme.css`. Les variables `--green`, `--yellow`, `--orange`, `--red`, `--critical`, `--accent` et `--surface` existent en version claire et sombre.
- **Barre et panneau** : `overlay.css` (styles) et `overlay.ts` (`renderBar`, `renderPanel`).
- **Dashboard** : `dashboard.ts` (une fonction par onglet), `charts.ts` (graphiques SVG sans dépendance).
- **Icône de la zone de notification** : `gaugeIcon()` dans `src/app/main/png.ts`. Icône d'application : `npm run dist` la régénère via `scripts/make-icon.mjs`.
- **Textes** : en français, directement dans les fichiers ci-dessus ainsi que dans `src/core/alerts.ts` (statuts, conseils, messages) et `src/core/format.ts` (format des nombres et des dates).

> La politique de sécurité (CSP) interdit les styles en ligne posés par attribut. Passez par `h('div', { style: '…' })`, qui utilise le CSSOM, ou par des classes CSS.

## 3. Position de la barre

`src/app/main/layout.ts` :
- `INPUT_INSET` (146 DIP) : distance entre le bas de la fenêtre Claude et le bas de la barre. Augmentez-la si la barre chevauche la zone de saisie.
- `computeBounds()` : ancrages `above-input`, `titlebar`, `bottom-edge`. Ajoutez-en un, puis testez dans `tests/overlay.test.ts`.
- `visibility()` : règle « jamais par-dessus une autre application ».

## 4. Le calcul du budget

`src/core/budget.ts` → `computeWeekPlan()`. Le principe tient en une ligne :

```ts
budget = share(disponible, poidsAujourdhui, poidsJoursSuivants, facteur)
```

Exemple : nouvelle stratégie `'weekend-saver'`, qui garde plus pour le week-end.
1. Ajouter la valeur au type `Strategy` (`types.ts`) et à `STRATEGIES` (`settings.ts`).
2. Dans `computeWeekPlan`, ajuster `factorFor` ou les poids (`weightOf`).
3. Ajouter un test dans `tests/budget.test.ts` avec des mesures simulées (`snap()`, `z()` dans `tests/helpers.ts`).
4. Ajouter l'option dans le sélecteur du dashboard.

Toute la logique de temps (journées, DST) est dans `time.ts` ; les ruptures (resets, changement d'abonnement) dans `series.ts`. Formules : [BUDGET_MATH.md](BUDGET_MATH.md).

## 5. Ajouter une source de données

1. **Parser** dans `src/core/normalize.ts` : convertir la donnée brute en `UsageSnapshot { t, source, fiveHour, sevenDay, scoped }`. Ne jamais inventer de valeur : `null` si absente.
2. Ajouter l'identifiant à `SourceId` (`types.ts`) et son libellé (`SOURCE_TEXT` dans `renderer/ui.ts`, `SOURCE_LABEL` dans `main/data.ts`).
3. **Lecture** : soit écrire des mesures avec `appendSnapshot('<écrivain>', snap)` (`src/sources/store.ts`), soit charger depuis un fichier dans `DataService.reload()`.
4. Tester le parseur avec des entrées valides, invalides et inconnues.

Règle du projet : n'utiliser que des sources qui ne demandent ni secret ni contournement. Voir [DATA_SOURCES.md](DATA_SOURCES.md).

## 6. Le mod de l'onglet Code

- Source : `mod/src/register.tsx`. Le dossier `mod/usage-guardian/` est **généré** par `npm run build` (le moteur y est copié, car un mod n'importe que ses propres fichiers).
- Valider : `claude plugin validate mod/usage-guardian`. Tester : `claude plugin test mod/usage-guardian`.
- Contraintes de l'API des mods : `export const register` en haut du fichier ; fonctions recevant `$` déclarées au niveau du module ; références `atom({ plugin: 'usage-guardian', key: '…' })` en littéraux.
- Pendant le développement : copier `mod/usage-guardian` dans le dossier de mods de développement indiqué par Claude Code, ou réinstaller depuis le marketplace local, puis `/reload-plugins`.

## 7. Empaquetage

`package.json` → section `build` (electron-builder) : identifiant, nom, cibles (`nsis`, `portable`), ressources embarquées (marketplace du mod, statusline). Le script de désinstallation personnalisé se trouve dans `build/installer.nsh` (retrait du démarrage automatique, conservation des données au choix).

Si vous publiez votre propre variante, changez `appId`, `productName` et l'`APP_ID` de `src/app/main/index.ts` pour qu'elle cohabite avec l'originale.

## 8. Avant de proposer une modification

```bash
npm run check   # typecheck + tests + build
```

Gardez la règle d'or du projet : une donnée affichée est **officielle**, **observée**, **estimée** ou **indisponible**, et toujours étiquetée comme telle.
