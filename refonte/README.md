# HAC — refonte progressive

Cette arborescence contient le nouveau socle métier, isolé de l'application actuelle.
Elle n'est pas encore branchée sur l'interface ni sur le backend de production.

## Principes

- Les calculs métier sont des fonctions JavaScript indépendantes de l'interface.
- Les données absentes ou incohérentes sont signalées : elles ne sont pas corrigées silencieusement.
- Les règles historiques doivent être traitées par un adaptateur ou une migration explicite.
- Les relations entre objets devront utiliser des identifiants stables, jamais un prénom ou un numéro d'étude supposé unique.
- Aucune migration de données ni aucun déploiement sans sauvegarde restaurable et accord explicite.

## Modules actuels

| Fichier | Responsabilité |
| --- | --- |
| `domain/jeh.js` | Distinguer les JEH travaillées des interventions à venir ou non effectuées |
| `domain/tableau-de-bord.js` | Calculer les agrégats du tableau de bord sans mélanger CA signé, facturation, encaissement et JEH réellement travaillées |
| `domain/etudes.js` | Valider le cycle de vie d'une étude, calculer son CA HT signé et son prix HT/JEH, contrôler les factures liées et signaler les alertes métier |
| `domain/interventions.js` | Modéliser les durées individuelles, convertir en JEH, distinguer travail réalisé et à venir, agréger par membre et étude |
| `domain/factures.js` | Vérifier les états de factures et calculer l'encaissement complet d'une étude |
| `domain/bv.js` | Valider les lignes d'un BV et le minimum global d'une JEH par bulletin |
| `domain/clients.js` | Définir une relation ponctuelle/récurrente et une cadence explicite |
| `domain/identites.js` | Valider les identifiants stables et les liens entre objets |
| `domain/audit-migration.js` | Auditer les anciennes collections sans les modifier |
| `domain/adaptateur-historique.js` | Produire un aperçu de migration sans écriture, avec correspondances client/membre explicites |

## Backend

Le contrat cible est documenté dans [`backend/contrat-api-v3.md`](backend/contrat-api-v3.md). C'est une spécification de conception : aucun serveur ni aucune donnée n'ont été modifiés.

## Tests

Depuis la racine du dépôt, avec Node.js :

```sh
node --test refonte/domain/*.test.js
```

Les tests utilisent le module natif `node:test` et ne nécessitent pas de dépendance supplémentaire. Un workflow GitHub Actions exécute automatiquement toute la suite avec Node.js 22 sur les changements de la branche `Refonte`. Au 10 novembre 2026, la suite compte 75 tests après l'ajout du modèle d'interventions individuelles. Le dernier run complet vérifié : 65 réussis, 0 échec ; le nouveau run doit confirmer les 75 tests.

## État d'intégration

L'audit historique est en lecture seule : il relève les numéros d'étude dupliqués, les références facture/temps introuvables ou ambiguës, ainsi que les noms de clients et prénoms réutilisés qui nécessitent une revue humaine.

L’adaptateur historique produit uniquement un aperçu : il bloque les références d’étude ambiguës, exige un générateur d’identifiants explicite, signale les correspondances client/membre absentes ou invalides et ne regroupe jamais automatiquement les lignes de temps en BV. Il ne réalise aucune écriture.

Les modules sont actuellement autonomes. Le module interventions utilise une durée explicitement individuelle (`minutesIndividuelles`) pour éviter de deviner la répartition d'une ancienne durée collective ; une JEH correspond à 480 minutes individuelles. Il exclut les statuts `A venir` et `Non effectué` des JEH travaillées, tout en comptant `Payé` et `Pas payé`. L'agrégateur bloque les totaux complets si une ligne est invalide. Le module études distingue les statuts qui contribuent au CA signé HT, calcule le prix HT/JEH à partir des montants historiques TTC et signale le dépassement du plafond de gestion HAC de 300 € HT/JEH (ce plafond est une règle interne configurable, pas une règle légale générale). Il contrôle aussi les factures liées par identifiant stable et les situations d'archivage/refus. Le calcul du tableau de bord sépare le CA signé (études), le facturé et l'encaissé (factures liées par identifiant stable), et les JEH réellement travaillées (interventions aux statuts Payé/Pas payé). En cas de données financières incohérentes, les totaux concernés sont renvoyés à `null` plutôt que présentés comme fiables. Les formats d'entrée constituent le modèle cible de travail, pas encore un contrat de données migré. Les tests sont exécutés automatiquement dans GitHub Actions. La prochaine étape est d'appliquer l'aperçu à une copie des données réelles et d'arbitrer les correspondances manuelles. Aucun raccordement à `app.js` ni aucune migration n'est autorisé à ce stade. Les calculs actuels de production restent inchangés.


## Aperçu d'interface

Un premier prototype mobile-first est disponible dans [`demo/index.html`](demo/index.html). Il présente les cinq onglets retenus (Accueil, Études, Finances, Équipe, Réglages), le tableau de bord avec les JEH réellement travaillées par les étudiants, les listes d'études et de factures, ainsi que les alertes adaptées aux clients ponctuels/récurrents.

**Limites du prototype :** les données sont fictives, les interactions sont locales et aucune connexion au backend ni aux données de production n'est faite. Ce fichier permet de valider une direction d'interface, pas encore de tester la gestion réelle. Il n'est pas publié sur l'URL de production.
