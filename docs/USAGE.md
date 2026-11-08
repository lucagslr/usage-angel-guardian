# Guide d'utilisation

## Niveau 1 — la barre

Elle apparaît au-dessus de la zone de saisie dès que Claude Desktop est la fenêtre active. Elle disparaît dès que vous passez à une autre application, réduisez Claude ou changez de bureau virtuel. Elle ne prend jamais le focus du clavier.

- **Ligne 1** : consommation du jour / budget recommandé, barre de progression, % du budget, statut (icône + texte + couleur).
- **Ligne 2** : session 5 h (compte à rebours), semaine, temps avant le reset hebdomadaire, rythme, fraîcheur de la mesure.
- **⋮⋮** : faire glisser pour déplacer la barre ; double-clic pour revenir à la position par défaut.
- **▴** : ouvrir le panneau détaillé.

| Statut | Signification (seuils réglables) |
|---|---|
| ● Vert | moins de 60 % du budget du jour |
| ◐ Jaune | 60 à 80 % |
| ▲ Orange | 80 à 100 %, prudence |
| ■ Rouge | budget du jour dépassé : « BUDGET QUOTIDIEN DÉPASSÉ — PAUSE RECOMMANDÉE » |
| ⛔ Critique | forte surconsommation ou risque d'épuiser la semaine avant le reset |

Symboles : `◔` = journée suivie partiellement (pas de mesure en début de journée) ; `RESET : …*` = heure de reset déduite du cycle hebdomadaire ; point rouge et « PÉRIMÉ » = dernière mesure trop ancienne (prévisions suspendues).

Rien n'est jamais bloqué : les alertes sont des recommandations.

## Niveau 2 — le panneau

Il comprend le conseiller (*Liberté élevée*, *Utilisation normale*, *Prudence recommandée*, *Ralentir maintenant*, *Budget dépassé*), trois cartes (aujourd'hui, session 5 h, semaine) avec leur provenance, la semaine en mini-barres (barre = consommé, trait = budget) et les messages principaux. Échap ou ▾ le referme et rend le focus à Claude.

## Niveau 3 — le dashboard

On l'ouvre depuis le panneau ou d'un clic sur l'icône près de l'horloge.

- **Vue d'ensemble** : indicateurs, budget/consommé par jour, trajectoire de la semaine (mesures, trajectoire recommandée, projection).
- **Semaine & budgets** : écart à la trajectoire, comparaison des stratégies (impact du mode intensif), détail jour par jour avec la qualité de la mesure.
- **Statistiques** : aujourd'hui contre hier, moyenne, tendance, historique 35 jours (seuls les jours mesurés), heures actives, cycles hebdomadaires, sessions, tokens exacts Claude Code (par jour, modèle et session).
- **Prévisions** : rythme moyen et récent, accélération, consommation par heure active, épuisement estimé, simulation 30 min / 1 h / 2 h / 3 h.
- **Sources & saisie** : état de chaque source, saisie manuelle, activation du mod.
- **Paramètres** : stratégie, réserves, jours de repos et de forte activité, fuseau, début de journée, seuils, barre (emplacement, taille, opacité, thème, animations), notifications (types, mode silencieux), démarrage avec Windows, économie de mémoire, rétention, export, suppression.

## Icône de la zone de notification

La jauge est colorée selon le statut, et l'info-bulle résume la journée. Le menu propose : afficher ou masquer la barre, dashboard, actualiser, paramètres, mode silencieux, lancer avec Windows, quitter.

## Dans l'onglet Code (mod)

Une bande sur deux lignes s'affiche au-dessus de la saisie, avec les boutons *Détails* et *Masquer*. `/guardian` ouvre le panneau détaillé. Des toasts discrets signalent 80 % du budget puis son dépassement.
