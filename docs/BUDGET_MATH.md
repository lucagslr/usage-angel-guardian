# Mathématiques du budget quotidien

Code : `src/core/budget.ts`, `series.ts`, `pace.ts`, `forecast.ts`. Tests : `tests/budget.test.ts`.

## 1. La semaine officielle

Claude fournit `U` (% hebdomadaire utilisé, 0–100) et `R` (heure du prochain reset). La fenêtre est `[R − 7 j, R)`. On ne suppose jamais qu'elle commence le lundi.

Cette fenêtre est découpée en **journées locales** (fuseau `Europe/Zurich`, début à `h₀` = minuit par défaut). La première et la dernière journée sont partielles. Les journées de 23 h et 25 h (changements d'heure) gardent leur vraie durée.

## 2. Poids des journées

```
w(j) = durée_en_heures(j) × m(type(j))      m(normal)=1, m(forte)=1,6, m(repos)=0,3 (réglables)
```

Pour sept journées complètes et normales, chaque jour pèse 24/168, soit **14,2857 %** du quota distribuable.

## 3. Budget du jour, figé à son début

Soit `t₀` le début du suivi aujourd'hui (début de journée, ou plus tard après un reset, un changement d'abonnement ou une première mesure) et `B` = % hebdo à `t₀` (la « base ») :

```
D       = max(0, 100 − B − réserve)              quota distribuable
w_auj   = heures(t₀ → fin du jour) × m × k       k = facteur intensif (mode intensif), sinon 1
W_futur = Σ w(jours suivants)
Budget  = D × w_auj / (w_auj + W_futur)
```

- **Réserve** = réserve personnelle + (mode conservateur ? 10–20 %).
- **Report automatique** : un jour sous-consommé laisse un `B` plus bas pour le lendemain, donc un `D` plus grand, réparti sur moins de jours. Exemple testé : 7 % utilisés sur 14,29 % → lendemain `93/6 = 15,5 %`. À l'inverse, 20 % utilisés → `80/6 = 13,33 %`.
- Le budget du jour ne change pas pendant la journée (pas de cible mouvante). Les budgets des jours passés restent ceux calculés à leur début : pas de réécriture rétroactive.

## 4. Consommation attribuable à aujourd'hui

```
Utilisé_auj = U_actuel − B
```

`B` est estimé à partir des mesures horodatées autour de `t₀`, avec une qualité affichée :

| Qualité | Règle |
|---|---|
| `window-start` | la semaine officielle commence aujourd'hui : `B = 0` exact |
| `exact` | même valeur avant et après `t₀` |
| `interpolated` | interpolation linéaire entre deux mesures espacées de ≤ 30 min |
| `approximate` | mesures plus espacées : bornes `[min, max]` affichées |
| `partial` | aucune mesure avant `t₀` : suivi depuis la première mesure du jour, budget calculé sur les heures restantes (`◔`) |

Si la semaine se réinitialise en cours de journée, la part consommée avant le reset est affichée à part (`usedBeforeReset`).

## 5. Jours suivants (reprojection continue)

```
réservé_auj = max(0, Budget − Utilisé_auj)
Pool        = max(0, 100 − U_actuel − réserve − réservé_auj)
Budget(j)   = Pool × w(j) / W_futur
```

Trajectoire recommandée (sans report) : `P(t) = (100 − réserve) × W(début → t) / W(total)`. Écart = `U − P(t)` (positif = consommation en avance).

## 6. Ruptures (« époques »)

Une époque est une portion continue d'une même fenêtre. Une nouvelle époque commence si :
- l'heure de reset change **et** la fenêtre précédente est échue, ou le % baisse (reset officiel ou anticipé : base 0 au reset) ;
- le % baisse de plus de 0,5 point sans changement de reset (correction côté Claude) ;
- l'abonnement change.

Une heure de reset différente **sans baisse** du % (deux sources légèrement discordantes) n'est pas un reset : la dernière heure l'emporte. Aucune consommation négative n'est jamais comptée.

## 7. Statut et vitesse

```
ratio = Utilisé_auj / Budget     vert < 0,6 ≤ jaune < 0,8 ≤ orange < 1 ≤ rouge < 1,5 ≤ critique
```

Le statut est aggravé en *critique* si l'épuisement hebdomadaire est prévu plus d'un jour avant le reset (confiance ≥ moyenne) alors que le ratio est déjà orange ou rouge, ou si la réserve est entamée.

Vitesse : `r₆₀` = hausse mesurée sur ~60 min (%/h), `r₁₅` = rafale sur ~15 min. Rythme soutenable `s = Budget / heures_actives_par_jour` (8 h par défaut). Niveau = `max(r₆₀/s, min(r₁₅/s, 4))` : calme < 1 ≤ soutenu < 2 ≤ rapide < 4 ≤ dangereusement rapide. Une rafale isolée plafonne à « rapide ».

## 8. Prévisions (estimations)

- `rate_fenêtre = U / heures écoulées depuis le reset` ; `rate_24h` = hausse sur 24 h ; `rate = 0,6·rate_24h + 0,4·rate_fenêtre`.
- Épuisement estimé = `maintenant + (100 − U)/rate`, signalé s'il précède `R`.
- Accélération = `rate_24h / rate_24h précédentes`.
- Confiance *haute* si ≥ 48 h écoulées, ≥ 20 mesures et rythmes cohérents ; *moyenne* si ≥ 12 h ; *basse* sinon.
- Simulation de session de `H` heures : moyenne et 80ᵉ centile de la consommation par **heure active** réellement mesurée, multipliés par `H`, comparés au distribuable et à la marge de la session 5 h. Il faut au moins 3 heures actives mesurées.
- Prévisions et vitesse sont **suspendues** quand la dernière mesure est périmée.
