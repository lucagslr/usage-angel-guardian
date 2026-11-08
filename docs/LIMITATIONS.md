# Limites connues

1. **Pas de mesure en direct dans le seul onglet Chat.** Claude Desktop n'expose pas les quotas à une application tierce sans secret d'authentification. Les mesures en direct viennent du mod (onglet Code). Sinon, il reste le journal `plan-usage-history.json`, que Claude Desktop met à jour irrégulièrement, et la saisie manuelle. Les quotas étant partagés, chaque réponse d'une session Code actualise aussi l'usage du Chat.
2. **Position de la zone de saisie estimée.** Le contenu web de Claude n'est pas exposé à UI Automation : la barre est placée à 146 DIP du bas de la fenêtre, centrée. Si la barre latérale de Claude ou la hauteur de la saisie change, il faut la déplacer avec ⋮⋮ (position mémorisée relativement à la fenêtre).
3. **Fenêtre au-dessus.** Pour rester au-dessus de Claude, la barre est « toujours au premier plan » tant que Claude est actif, et masquée dès qu'une autre fenêtre ou une boîte de dialogue de Claude prend le premier plan. Un délai d'environ 100 ms est possible lors d'un changement de fenêtre ou d'un déplacement rapide.
4. **Heure de reset requise pour le budget.** Sans mesure du mod, sans statusline et sans saisie, seul le % hebdomadaire est affiché, et le budget du jour est indiqué comme indisponible.
5. **Heure déduite.** Après une réinitialisation anticipée décidée par Anthropic, la projection hebdomadaire peut être fausse jusqu'à la prochaine mesure officielle.
6. **Format interne du journal Desktop.** `plan-usage-history.json` n'est pas documenté. S'il change, la source passe en erreur sans affecter les autres.
7. **Quotas par modèle** : affichés uniquement s'ils sont transmis par la source (mod ou statusline).
8. **Tokens** : exacts pour Claude Code (Code et CLI) ; indisponibles pour l'onglet Chat. Un % de quota n'est jamais converti en tokens.
9. **Nombre de messages** du Chat : indisponible (il faudrait lire les conversations).
10. **Tests graphiques.** Placement, visibilité et rendu ont été vérifiés par tests automatiques et par un autotest sur le bureau réel (Windows 11, un écran à 150 %). Non testés en conditions réelles : plusieurs écrans physiques, autres facteurs DPI, redémarrage de Windows, mise à jour effective de Claude Desktop, désinstallation complète via le panneau Windows.
11. **Mémoire** : environ 210 Mo privés (Electron), même en rendu logiciel.
12. **Notifications** : la fenêtre « Ne pas déranger » de Windows peut les retenir ; en mode non installé, Windows peut afficher l'expéditeur « electron.app ».
