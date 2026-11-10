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
| `domain/bv.js` | Valider les BV et les lignes normalisées séparées, les identifiants stables, les liens membre/BV, l'unicité par personne et le minimum global d'une JEH |
| `domain/factures.js` | Vérifier les états de factures et calculer l'encaissement complet d'une étude |
| `domain/clients.js` | Distinguer une relation ponctuelle d'une relation longue durée (type CDI) et séparer cette qualification de la cadence de facturation |
| `domain/identites.js` | Valider les identifiants stables et les liens entre objets |
| `domain/audit-migration.js` | Auditer les anciennes collections sans les modifier |
| `domain/adaptateur-historique.js` | Produire un aperçu de migration sans écriture, avec correspondances client/membre explicites |
| `application/lecture.js` | Assembler les collections validées, vérifier les références et fournir un modèle de lecture unifié à l'interface |
| `application/commandes.js` | Préparer et appliquer des ajouts/modifications immuables en mémoire, après validation structurelle et métier |
| `build/build-browser.mjs` | Construire un bundle navigateur sans dépendance externe à partir des modules CommonJS testés |

## Backend

Le contrat cible est documenté dans [`backend/contrat-api-v3.md`](backend/contrat-api-v3.md). L'audit du candidat v2.2 est dans [`backend/audit-compatibilite-v2.2.md`](backend/audit-compatibilite-v2.2.md) : il confirme que le candidat ne peut pas être raccordé tel quel au nouveau modèle (clients, membres, BV, identifiants stables et protocole). Ce sont des documents de conception ; aucun serveur ni aucune donnée n'ont été modifiés.

## Tests

Depuis la racine du dépôt, avec Node.js :

```sh
node --test refonte/domain/*.test.js
```

Les tests utilisent le module natif `node:test` et ne nécessitent pas de dépendance supplémentaire. Un workflow GitHub Actions exécute automatiquement toute la suite avec Node.js 22 sur les changements de la branche `Refonte`. Au 10 novembre 2026, la suite compte 108 tests (90 tests domaine + 18 tests applicatifs : lecture et commandes). Le dernier run complet vérifié : 108 réussis, 0 échec ; la CI doit reconfirmer les 108 tests et la reproductibilité du bundle.

## État d'intégration

L'audit historique est en lecture seule : il relève les numéros d'étude dupliqués, les références facture/temps introuvables ou ambiguës, ainsi que les noms de clients et prénoms réutilisés qui nécessitent une revue humaine.

L’adaptateur historique produit uniquement un aperçu : il bloque les références d’étude ambiguës, exige un générateur d’identifiants explicite, signale les correspondances client/membre absentes ou invalides et ne regroupe jamais automatiquement les lignes de temps en BV. Il ne réalise aucune écriture.

La couche `application/lecture.js` relie désormais les collections métier pour l'interface : elle vérifie les identifiants et références, assemble les factures avec les études, les interventions avec les membres et les BV avec leurs lignes. Elle renvoie une vue unifiée en lecture seule ; si une anomalie structurelle existe, elle bloque la vue complète plutôt que d'afficher des données partielles. Elle n'effectue aucune écriture. `application/commandes.js` prépare les ajouts et modifications en mémoire, conserve les identifiants stables et refuse toute commande qui casserait les références ou les règles métier. La persistance et la gestion des conflits restent du ressort du backend v3 ; ces commandes ne prétendent pas remplacer un contrôle de version serveur.

Les modules sont actuellement autonomes. Le modèle client distingue `ponctuelle` et `longue_duree` (relation durable comparable à un CDI) sans imposer de cadence. La cadence de facturation est un paramètre séparé, facultatif, qui doit être explicitement renseigné pour activer une alerte périodique ; une étude peut la surcharger ou la désactiver explicitement. Le module BV prend désormais en charge la structure normalisée `bvs` + `lignesBV` : les identifiants sont stables, chaque ligne référence un BV et un membre existants, une personne ne peut figurer qu'une fois par BV et le minimum d'une JEH s'applique au total du BV, pas à chaque ligne. Le module interventions utilise une durée explicitement individuelle (`minutesIndividuelles`) pour éviter de deviner la répartition d'une ancienne durée collective ; une JEH correspond à 480 minutes individuelles. Il exclut les statuts `A venir` et `Non effectué` des JEH travaillées, tout en comptant `Payé` et `Pas payé`. L'agrégateur bloque les totaux complets si une ligne est invalide. Le module études distingue les statuts qui contribuent au CA signé HT, calcule le prix HT/JEH à partir des montants historiques TTC et signale le dépassement du plafond de gestion HAC de 300 € HT/JEH (ce plafond est une règle interne configurable, pas une règle légale générale). Il contrôle aussi les factures liées par identifiant stable et les situations d'archivage/refus. Le tableau de bord calcule le CA signé uniquement à partir des statuts signés, convertit les montants d'études TTC en HT, et convertit également les factures TTC en HT avec le taux de TVA configurable (défaut 20 %). Il ne confond donc pas le montant des études en faisabilité/devis non signé avec du CA signé. Le tableau de bord consomme désormais les interventions individuelles canoniques : il dérive les JEH depuis `minutesIndividuelles`, les statuts et les identifiants stables, au lieu d'attendre une quantité de JEH pré-calculée et potentiellement incohérente. Si une intervention est invalide, les agrégats JEH complets sont masqués (`null`) et les anomalies remontées. Le calcul du tableau de bord sépare le CA signé (études), le facturé et l'encaissé (factures liées par identifiant stable), et les JEH réellement travaillées (interventions aux statuts Payé/Pas payé). En cas de données financières incohérentes, les totaux concernés sont renvoyés à `null` plutôt que présentés comme fiables. Les formats d'entrée constituent le modèle cible de travail, pas encore un contrat de données migré. Les tests sont exécutés automatiquement dans GitHub Actions. La prochaine étape est d'appliquer l'aperçu à une copie des données réelles et d'arbitrer les correspondances manuelles. Aucun raccordement à `app.js` ni aucune migration n'est autorisé à ce stade. Les calculs actuels de production restent inchangés.


## Aperçu d'interface

Un premier prototype mobile-first est disponible dans [`demo/index.html`](demo/index.html). Il présente les cinq onglets retenus (Accueil, Études, Finances, Équipe, Réglages), le tableau de bord avec les JEH réellement travaillées par les étudiants, les listes d'études et de factures, ainsi que les alertes adaptées aux clients ponctuels/récurrents.

**Limites du prototype :** les données sont fictives, les interactions sont locales et aucune connexion au backend ni aux données de production n'est faite. Ce fichier permet de valider une direction d'interface, pas encore de tester la gestion réelle. Il n'est pas publié sur l'URL de production.
