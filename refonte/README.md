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
| `domain/factures.js` | Vérifier les états de factures et calculer l'encaissement complet d'une étude |
| `domain/bv.js` | Valider les lignes d'un BV et le minimum global d'une JEH par bulletin |
| `domain/clients.js` | Définir une relation ponctuelle/récurrente et une cadence explicite |
| `domain/identites.js` | Valider les identifiants stables et les liens entre objets |
| `domain/audit-migration.js` | Auditer les anciennes collections sans les modifier |

## Tests

Depuis la racine du dépôt, avec Node.js :

```sh
node --test refonte/domain/*.test.js
```

Les tests utilisent le module natif `node:test` et ne nécessitent pas de dépendance supplémentaire.

## État d'intégration

L'audit historique est en lecture seule : il relève les numéros d'étude dupliqués, les références facture/temps introuvables ou ambiguës, ainsi que les noms de clients et prénoms réutilisés qui nécessitent une revue humaine.

Les modules sont actuellement autonomes. Les formats d'entrée constituent le modèle cible de travail, pas encore un contrat de données migré. Avant raccordement à `app.js`, il faut construire et tester un adaptateur depuis les collections historiques (`etudes`, `factures`, `temps`, etc.), traiter les doublons et attribuer des identifiants stables sans perdre les références. Les calculs actuels de production restent inchangés.
