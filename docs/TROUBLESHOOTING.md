# Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| La barre n'apparaît jamais | Claude n'est pas la fenêtre active, la barre est masquée, ou l'application n'est pas lancée | Cliquer dans Claude. Vérifier la jauge près de l'horloge › *Afficher la barre*. |
| La barre recouvre du texte ou la zone de saisie | Hauteur de la saisie différente de l'estimation | Faire glisser ⋮⋮ (position mémorisée). Double-clic pour revenir. Ou *Paramètres › Emplacement* : « Sous la barre de titre ». |
| « Budget du jour indisponible » | Heure de reset hebdomadaire inconnue | Activer le mod (onglet Code) ou la saisir dans *Sources & saisie*. |
| « PÉRIMÉ » / point rouge | Aucune mesure récente (pas de session Code, journal Desktop ancien) | Ouvrir une session Code avec le mod, ou saisir les valeurs. Seuil réglable (*Paramètres › Fraîcheur*). |
| `◔` à côté du budget | Aucune mesure en début de journée | Normal le premier jour ; le suivi part de la première mesure. |
| Valeurs différentes de Claude › Utilisation | Mesure ancienne | Comparer l'heure de la dernière mesure (info-bulle). Les % officiels font foi. |
| Le mod n'affiche rien | Mod non activé ou pas encore de réponse dans la session | `/plugin` pour vérifier, `/reload-plugins`, puis une réponse. `/guardian` ouvre le panneau. |
| Pas de notifications | Désactivées, mode silencieux, ou « Ne pas déranger » de Windows | *Paramètres › Notifications*. Vérifier les paramètres de notification Windows. |
| Barre au mauvais endroit après un changement d'écran ou d'échelle | Rafraîchissement DPI | Elle se recalcule au prochain mouvement de Claude ; sinon *Actualiser* dans le menu de la zone de notification. |
| Mémoire trop élevée | Rendu GPU actif | *Paramètres › Économie de mémoire* (redémarrage requis). |
| « Suivi de la fenêtre Claude indisponible » | Échec de chargement de koffi | Réinstaller ; le reste (dashboard, tray, notifications) continue de fonctionner. |

## Diagnostic

- Données : *Dashboard › Sources & saisie › Ouvrir le dossier de données*.
- Journal de placement : lancer depuis les sources avec `CUG_DEBUG=1` (`npm start`).
- Autotest du rendu réel : `CUG_SELFTEST=<dossier>` capture uniquement la zone de la barre et mesure la mémoire.
