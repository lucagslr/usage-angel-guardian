# Sources de données

Chaque valeur affichée porte sa provenance :

| Badge | Sens |
|---|---|
| **Officiel** | pourcentage ou heure rapportés par Claude |
| **Observé** | calculé localement à partir de mesures officielles horodatées (ex. consommation du jour) ou mesuré localement (tokens des journaux Claude Code) |
| **Estimé** | modèle statistique (prévisions, simulation, rythme) |
| **Indisponible** | Claude ne l'expose pas : jamais inventé |

## Sources utilisées

### 1. Mod Claude Desktop (onglet Code) — officiel, avec heure de reset
- API officielle des plugins Claude Code embarquée dans Claude Desktop : événement `session.measure` → `rateLimits[] = { kind: five_hour | seven_day | …, percentUsed (0–100), resetsAt (ISO) }`.
- Mise à jour après chaque réponse d'une session Code (les quotas étant partagés, les % reflètent aussi l'usage de l'onglet Chat, du web et des autres appareils).
- Écrit dans `%USERPROFILE%\.claude-usage-guardian\snapshots\AAAA-MM-JJ-mod-<id>.jsonl`.

### 2. Journal de Claude Desktop — officiel, sans heure de reset
- `%APPDATA%\Claude\plan-usage-history.json`, écrit par Claude Desktop lui-même : `samples[] = { t, org, u: { fh: % 5 h, sd: % hebdo, xu } }`.
- Lecture seule, sans modification. Échantillonnage irrégulier (souvent ≈ 1 par jour) ; seule l'organisation la plus récente est retenue.
- Format interne non documenté : en cas de changement, la source passe en « erreur » sans affecter les autres.

### 3. Statusline Claude Code CLI — officiel (optionnelle)
- JSON documenté (`code.claude.com/docs/en/statusline`) : `rate_limits.five_hour|seven_day.used_percentage`, `resets_at` (secondes epoch).
- Absent pour les comptes API et avant la première réponse.

### 4. Saisie manuelle
- % hebdo, heure de reset et % 5 h recopiés depuis *Claude › Paramètres › Utilisation*.

### 5. Heure de reset déduite — estimée
- La documentation Anthropic précise que la limite hebdomadaire se réinitialise **à heure fixe chaque semaine, propre au compte**. Une heure officielle connue est donc projetée par pas de 7 jours pour les mesures qui n'en portent pas (journal Desktop). Elle est marquée `*` / « déduit ».

### 6. Tokens Claude Code — officiels, locaux
- `~/.claude/projects/**/*.jsonl` : seuls `message.usage`, `message.model`, `message.id` et `timestamp` des réponses assistant sont extraits, dédoublonnés par message. Le contenu n'est pas conservé.
- Couvre l'onglet Code et le CLI. **Pas l'onglet Chat.**

## Sources écartées

| Source | Raison |
|---|---|
| Jeton OAuth `~/.claude/.credentials.json` → `api.anthropic.com/api/oauth/usage` (utilisé par d'autres projets) | Récupération automatique d'un secret d'authentification : interdite. |
| Cookies du profil Claude Desktop → `claude.ai/api/organizations/{id}/usage` | Secret de session ; endpoint interne non documenté. |
| Patch de `app.asar` / injection CSS-JS | MSIX signé, contournement d'intégrité : exclu. |
| UI Automation sur la fenêtre Claude | Testé : le contenu web n'est pas exposé (14 éléments). Le forcer imposerait de relancer Claude avec des options. |
| Comptage des messages de l'onglet Chat | Impossible sans lire les conversations : indisponible. |

## Fonctionnement sans Claude Code

Sans mod actif ni statusline, l'overlay fonctionne avec le journal de Claude Desktop et/ou la saisie manuelle. La fraîcheur est alors faible : la barre indique l'âge (« màj il y a 3 h »), passe en « PÉRIMÉ » au-delà du seuil (3 h par défaut) et suspend vitesse et prévisions. Les anciennes valeurs ne sont jamais présentées comme actuelles.
